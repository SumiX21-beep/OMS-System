import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Order } from '@prisma/client';
import Stripe from 'stripe';
import {
  OrderForPayment,
  PaymentAuthorization,
  PaymentCapture,
  PaymentProvider,
  PaymentRefund,
  PaymentVoid,
  orderAmountMinor,
} from './payment-provider.interface';

/**
 * Stripe gateway adapter — the live drop-in for the payment seam.
 *
 * Selected by `PAYMENT_PROVIDER=stripe`. With `STRIPE_SECRET_KEY` set it talks to
 * the real Stripe API: authorize creates a manual-capture PaymentIntent, capture
 * captures it when the order ships, and refund/void reverse it. Without a key it
 * falls back to DRY-RUN (logs + synthetic refs) so the app stays runnable before
 * credentials exist — the same pattern the Shopify connector uses without a token.
 *
 * Card collection lives at the channel/checkout, not in the OMS, so authorize
 * uses a configurable server-side PaymentMethod (`STRIPE_PAYMENT_METHOD`,
 * defaulting to Stripe's `pm_card_visa` test method). An order whose channel ref
 * contains "DECLINE" is routed to `pm_card_chargeDeclined`, preserving the mock's
 * decline convention against the real test API.
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly log = new Logger(StripePaymentProvider.name);
  private readonly stripe?: Stripe;
  private readonly paymentMethod: string;
  private readonly declinePaymentMethod: string;

  constructor(config: ConfigService) {
    const secretKey = config.get<string>('STRIPE_SECRET_KEY') || undefined;
    this.paymentMethod = config.get<string>('STRIPE_PAYMENT_METHOD', 'pm_card_visa');
    this.declinePaymentMethod = config.get<string>(
      'STRIPE_DECLINE_PAYMENT_METHOD',
      'pm_card_chargeDeclined',
    );
    if (secretKey) {
      this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, typescript: true });
    } else {
      this.log.warn(
        'STRIPE_SECRET_KEY unset — Stripe provider runs in DRY-RUN (no live charges).',
      );
    }
  }

  /** Synthetic ref minted in dry-run; live calls must skip these (would 404). */
  private isDryRunRef(ref?: string | null): boolean {
    return !ref || ref.startsWith('stripe_dryrun_');
  }

  async authorize(order: OrderForPayment): Promise<PaymentAuthorization> {
    const amount = orderAmountMinor(order);
    const declined = (order.externalRef ?? '').toUpperCase().includes('DECLINE');

    // Nothing to charge (e.g. fully discounted) — authorize trivially.
    if (amount <= 0) return { status: 'AUTHORIZED' };

    if (!this.stripe) {
      if (declined) {
        return { status: 'DECLINED', declineReason: 'payment declined (dry-run)' };
      }
      return { status: 'AUTHORIZED', reference: `stripe_dryrun_${randomUUID().slice(0, 12)}` };
    }

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount,
          currency: order.currency.toLowerCase(),
          capture_method: 'manual',
          confirm: true,
          payment_method: declined ? this.declinePaymentMethod : this.paymentMethod,
          payment_method_types: ['card'],
          description: `OMS order ${order.id}`,
          metadata: {
            orderId: order.id,
            tenantId: order.tenantId,
            externalRef: order.externalRef ?? '',
          },
        },
        { idempotencyKey: `auth_${order.id}` },
      );
      if (intent.status === 'requires_capture') {
        return { status: 'AUTHORIZED', reference: intent.id };
      }
      return {
        status: 'DECLINED',
        reference: intent.id,
        declineReason:
          intent.last_payment_error?.message ?? `unexpected intent status ${intent.status}`,
      };
    } catch (err) {
      return { status: 'DECLINED', declineReason: this.describe(err) };
    }
  }

  async capture(
    _order: Order,
    authReference?: string,
  ): Promise<PaymentCapture> {
    if (!this.stripe || this.isDryRunRef(authReference)) {
      return { status: 'CAPTURED', reference: authReference };
    }
    try {
      const intent = await this.stripe.paymentIntents.capture(authReference!);
      return intent.status === 'succeeded'
        ? { status: 'CAPTURED', reference: intent.id }
        : { status: 'FAILED', reference: intent.id };
    } catch (err) {
      this.log.error(`Stripe capture failed for ${authReference}: ${this.describe(err)}`);
      return { status: 'FAILED', reference: authReference };
    }
  }

  async refund(order: OrderForPayment, amountMinor: number): Promise<PaymentRefund> {
    const ref = order.paymentReference ?? undefined;
    if (!this.stripe || this.isDryRunRef(ref)) {
      this.log.log(`(dry-run) refund ${amountMinor} ${order.currency} for order ${order.id}`);
      return { status: 'REFUNDED', reference: ref ?? `stripe_ref_${randomUUID().slice(0, 12)}` };
    }
    try {
      const refund = await this.stripe.refunds.create(
        { payment_intent: ref, amount: amountMinor },
        { idempotencyKey: `refund_${order.id}_${amountMinor}` },
      );
      // `pending` still represents an accepted refund (async settlement).
      return refund.status === 'succeeded' || refund.status === 'pending'
        ? { status: 'REFUNDED', reference: refund.id }
        : { status: 'FAILED', reference: refund.id };
    } catch (err) {
      this.log.error(`Stripe refund failed for order ${order.id}: ${this.describe(err)}`);
      return { status: 'FAILED', reference: ref };
    }
  }

  async voidPayment(
    order: Order,
    authReference?: string,
  ): Promise<PaymentVoid> {
    const ref = authReference ?? order.paymentReference ?? undefined;
    if (!this.stripe || this.isDryRunRef(ref)) {
      return { status: 'VOIDED', reference: ref };
    }
    try {
      const intent = await this.stripe.paymentIntents.cancel(ref!);
      return intent.status === 'canceled'
        ? { status: 'VOIDED', reference: intent.id }
        : { status: 'FAILED', reference: intent.id };
    } catch (err) {
      this.log.error(`Stripe void failed for order ${order.id}: ${this.describe(err)}`);
      return { status: 'FAILED', reference: ref };
    }
  }

  private describe(err: unknown): string {
    if (err instanceof Stripe.errors.StripeCardError) {
      return err.decline_code ?? err.message ?? 'card declined';
    }
    if (err instanceof Stripe.errors.StripeError) {
      return err.message ?? err.code ?? 'stripe error';
    }
    return err instanceof Error ? err.message : 'unknown payment error';
  }
}
