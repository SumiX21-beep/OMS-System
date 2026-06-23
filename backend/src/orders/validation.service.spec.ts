import { ConfigService } from '@nestjs/config';
import { FraudStatus, PaymentStatus } from '@prisma/client';
import { OrderValidationService } from './validation.service';

// Fake config returning the provided default (tax 0.08, promo 0).
const config = {
  get: <T>(_key: string, def: T): T => def,
} as unknown as ConfigService;

function order(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: 'o1',
    externalRef: null,
    customerRef: null,
    lines: [{ unitPrice: 1000, quantity: 2 }], // subtotal 2000
    ...overrides,
  };
}

describe('OrderValidationService', () => {
  const svc = new OrderValidationService(config);

  it('authorizes payment, passes fraud, and computes 8% tax', () => {
    const out = svc.evaluate(order());
    expect(out.paymentStatus).toBe(PaymentStatus.AUTHORIZED);
    expect(out.fraudStatus).toBe(FraudStatus.PASS);
    expect(out.taxTotal).toBe(160); // 2000 * 0.08
    expect(out.discountTotal).toBe(0);
    expect(out.rejection).toBeUndefined();
  });

  it('declines payment when externalRef signals DECLINE', () => {
    const out = svc.evaluate(order({ externalRef: 'SHOP-DECLINE-1' }));
    expect(out.paymentStatus).toBe(PaymentStatus.DECLINED);
    expect(out.rejection).toBe('payment declined');
  });

  it('fails fraud when customerRef signals FRAUD', () => {
    const out = svc.evaluate(order({ customerRef: 'cust-FRAUD' }));
    expect(out.fraudStatus).toBe(FraudStatus.FAIL);
    expect(out.rejection).toBeDefined();
  });
});
