import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OrderForPayment,
  PAYMENT_PROVIDER,
  PaymentAuthorization,
  PaymentCapture,
  PaymentProvider,
  PaymentRefund,
  orderAmountMinor,
} from './payment-provider.interface';

/**
 * Facade over the configured payment gateway. Callers depend on this, never on
 * a concrete provider, so switching gateways is a config change.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {
    this.log.log(`Payment provider: ${provider.name}`);
  }

  get providerName(): string {
    return this.provider.name;
  }

  authorize(order: OrderForPayment): Promise<PaymentAuthorization> {
    return this.provider.authorize(order);
  }

  capture(order: OrderForPayment, authReference?: string): Promise<PaymentCapture> {
    return this.provider.capture(order, authReference);
  }

  refund(order: OrderForPayment, amountMinor?: number): Promise<PaymentRefund> {
    return this.provider.refund(order, amountMinor ?? orderAmountMinor(order));
  }
}
