import { Order, OrderLine } from '@prisma/client';

/** An order with its lines — enough to compute the amount to charge. */
export type OrderForPayment = Order & { lines: OrderLine[] };

export interface PaymentAuthorization {
  status: 'AUTHORIZED' | 'DECLINED';
  /** Gateway-side handle (charge / payment-intent id) for later capture/refund. */
  reference?: string;
  /** Populated when declined; surfaced by the validation pipeline as the reason. */
  declineReason?: string;
}

export interface PaymentCapture {
  status: 'CAPTURED' | 'FAILED';
  reference?: string;
}

export interface PaymentRefund {
  status: 'REFUNDED' | 'FAILED';
  reference?: string;
}

export interface PaymentVoid {
  status: 'VOIDED' | 'FAILED';
  reference?: string;
}

/**
 * A payment gateway. The OMS depends only on this interface; swapping the
 * built-in mock for Stripe / Adyen / Braintree is a single new class registered
 * under the PAYMENT_PROVIDER token — no caller changes.
 *
 * Money moves through the order lifecycle as: authorize (on validate) →
 * capture (when the order ships) → refund (on return) or voidPayment (when a
 * still-uncaptured order is cancelled).
 */
export interface PaymentProvider {
  readonly name: string;
  authorize(order: OrderForPayment): Promise<PaymentAuthorization>;
  // capture/voidPayment act on an existing gateway handle and need no line detail.
  capture(order: Order, authReference?: string): Promise<PaymentCapture>;
  refund(order: OrderForPayment, amountMinor: number): Promise<PaymentRefund>;
  /** Release an authorization that was never captured (e.g. order cancelled). */
  voidPayment(order: Order, authReference?: string): Promise<PaymentVoid>;
}

/** DI token for the selected provider (chosen by env PAYMENT_PROVIDER). */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Amount to charge in minor units (cents): line subtotal + tax − discount. */
export function orderAmountMinor(order: OrderForPayment): number {
  const subtotal = order.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return Math.max(0, subtotal + order.taxTotal - order.discountTotal);
}
