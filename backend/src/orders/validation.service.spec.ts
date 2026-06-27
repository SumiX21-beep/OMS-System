import { ConfigService } from '@nestjs/config';
import { FraudStatus, PaymentStatus } from '@prisma/client';
import { MockPaymentProvider } from '../payments/mock-payment.provider';
import { PaymentsService } from '../payments/payments.service';
import { OrderValidationService } from './validation.service';

// Fake config returning the provided default (tax 0.08, promo 0).
const config = {
  get: <T>(_key: string, def: T): T => def,
} as unknown as ConfigService;

const payments = new PaymentsService(new MockPaymentProvider());

function order(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: 'o1',
    externalRef: null,
    customerRef: null,
    taxTotal: 0,
    discountTotal: 0,
    lines: [{ unitPrice: 1000, quantity: 2 }], // subtotal 2000
    ...overrides,
  };
}

describe('OrderValidationService', () => {
  const svc = new OrderValidationService(config, payments);

  it('authorizes payment, passes fraud, and computes 8% tax', async () => {
    const out = await svc.evaluate(order());
    expect(out.paymentStatus).toBe(PaymentStatus.AUTHORIZED);
    expect(out.paymentReference).toBeDefined();
    expect(out.fraudStatus).toBe(FraudStatus.PASS);
    expect(out.taxTotal).toBe(160); // 2000 * 0.08
    expect(out.discountTotal).toBe(0);
    expect(out.rejection).toBeUndefined();
  });

  it('declines payment when externalRef signals DECLINE', async () => {
    const out = await svc.evaluate(order({ externalRef: 'SHOP-DECLINE-1' }));
    expect(out.paymentStatus).toBe(PaymentStatus.DECLINED);
    expect(out.rejection).toBe('payment declined');
  });

  it('fails fraud when customerRef signals FRAUD', async () => {
    const out = await svc.evaluate(order({ customerRef: 'cust-FRAUD' }));
    expect(out.fraudStatus).toBe(FraudStatus.FAIL);
    expect(out.rejection).toBeDefined();
  });
});
