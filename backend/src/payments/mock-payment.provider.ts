import { Injectable, Logger } from '@nestjs/common';
import { Order } from '@prisma/client';
import { randomUUID } from 'crypto';
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
 * Deterministic in-memory gateway for dev/tests/demo. Behaviour mirrors the
 * legacy inline stub so existing flows are unchanged:
 *   • authorize: AUTHORIZED, unless the order's externalRef contains "DECLINE".
 *   • capture/refund: always succeed.
 * A real provider performs the same contract against a live gateway.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly log = new Logger(MockPaymentProvider.name);

  async authorize(order: OrderForPayment): Promise<PaymentAuthorization> {
    const amount = orderAmountMinor(order);
    if ((order.externalRef ?? '').toUpperCase().includes('DECLINE')) {
      this.log.debug(`Auth declined for order ${order.id} (amount ${amount})`);
      return { status: 'DECLINED', declineReason: 'payment declined' };
    }
    const reference = `mock_auth_${randomUUID().slice(0, 12)}`;
    this.log.debug(`Authorized ${amount} for order ${order.id} → ${reference}`);
    return { status: 'AUTHORIZED', reference };
  }

  async capture(
    _order: Order,
    authReference?: string,
  ): Promise<PaymentCapture> {
    return {
      status: 'CAPTURED',
      reference: authReference ?? `mock_cap_${randomUUID().slice(0, 12)}`,
    };
  }

  async refund(
    _order: OrderForPayment,
    _amountMinor: number,
  ): Promise<PaymentRefund> {
    return { status: 'REFUNDED', reference: `mock_ref_${randomUUID().slice(0, 12)}` };
  }

  async voidPayment(
    _order: Order,
    authReference?: string,
  ): Promise<PaymentVoid> {
    return { status: 'VOIDED', reference: authReference ?? `mock_void_${randomUUID().slice(0, 12)}` };
  }
}
