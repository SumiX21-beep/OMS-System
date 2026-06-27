import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  OrderForPayment,
  PaymentAuthorization,
  PaymentCapture,
  PaymentProvider,
  PaymentRefund,
  orderAmountMinor,
} from './payment-provider.interface';

/**
 * Stripe gateway adapter — the drop-in seam for a real provider.
 *
 * Selected by `PAYMENT_PROVIDER=stripe`. A production build would `new Stripe(key)`
 * and call `paymentIntents.create / capture / refunds.create`; the points where
 * those calls go are marked below. Without `STRIPE_SECRET_KEY` it runs in
 * dry-run (logs and behaves like an authorized charge) so the app stays runnable
 * before real credentials exist — the same dry-run pattern the Shopify connector
 * uses without a token.
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly log = new Logger(StripePaymentProvider.name);
  private readonly secretKey?: string;

  constructor(config: ConfigService) {
    this.secretKey = config.get<string>('STRIPE_SECRET_KEY') || undefined;
    if (!this.secretKey) {
      this.log.warn(
        'STRIPE_SECRET_KEY unset — Stripe provider runs in DRY-RUN (no live charges).',
      );
    }
  }

  async authorize(order: OrderForPayment): Promise<PaymentAuthorization> {
    const amount = orderAmountMinor(order);
    if (!this.secretKey) {
      return { status: 'AUTHORIZED', reference: `stripe_dryrun_${randomUUID().slice(0, 12)}` };
    }
    // → const intent = await stripe.paymentIntents.create({ amount, currency: order.currency, capture_method: 'manual' })
    //   return intent.status === 'requires_capture' ? { status: 'AUTHORIZED', reference: intent.id } : { status: 'DECLINED', declineReason: intent.last_payment_error?.message }
    this.log.log(`Would authorize ${amount} ${order.currency} via Stripe for order ${order.id}`);
    return { status: 'AUTHORIZED', reference: `stripe_${randomUUID().slice(0, 12)}` };
  }

  async capture(
    _order: OrderForPayment,
    authReference?: string,
  ): Promise<PaymentCapture> {
    // → await stripe.paymentIntents.capture(authReference)
    return { status: 'CAPTURED', reference: authReference };
  }

  async refund(order: OrderForPayment, amountMinor: number): Promise<PaymentRefund> {
    // → await stripe.refunds.create({ payment_intent: ref, amount: amountMinor })
    this.log.log(`Would refund ${amountMinor} for order ${order.id} via Stripe`);
    return { status: 'REFUNDED', reference: `stripe_ref_${randomUUID().slice(0, 12)}` };
  }
}
