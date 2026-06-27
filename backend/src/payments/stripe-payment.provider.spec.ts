import { ConfigService } from '@nestjs/config';
import { StripePaymentProvider } from './stripe-payment.provider';

// No STRIPE_SECRET_KEY → provider runs in DRY-RUN (no network). Other keys fall
// back to their defaults. This exercises the offline contract the app relies on
// before real credentials exist; live API calls are covered by integration runs.
const config = {
  get: <T>(_key: string, def?: T): T | undefined => def,
} as unknown as ConfigService;

function order(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'o1',
    tenantId: 't1',
    externalRef: null,
    currency: 'USD',
    taxTotal: 0,
    discountTotal: 0,
    paymentReference: null,
    lines: [{ unitPrice: 1000, quantity: 2 }], // subtotal 2000
    ...overrides,
  };
}

describe('StripePaymentProvider (dry-run)', () => {
  const provider = new StripePaymentProvider(config);

  it('authorizes with a synthetic dry-run reference', async () => {
    const auth = await provider.authorize(order());
    expect(auth.status).toBe('AUTHORIZED');
    expect(auth.reference).toMatch(/^stripe_dryrun_/);
  });

  it('declines when the channel ref signals DECLINE', async () => {
    const auth = await provider.authorize(order({ externalRef: 'SHOP-DECLINE-1' }));
    expect(auth.status).toBe('DECLINED');
    expect(auth.declineReason).toBeDefined();
  });

  it('authorizes trivially when there is nothing to charge', async () => {
    const auth = await provider.authorize(
      order({ lines: [{ unitPrice: 0, quantity: 1 }] }),
    );
    expect(auth.status).toBe('AUTHORIZED');
    expect(auth.reference).toBeUndefined();
  });

  it('captures, refunds, and voids without a live client', async () => {
    const ref = 'stripe_dryrun_abc123';
    expect((await provider.capture(order(), ref)).status).toBe('CAPTURED');
    expect((await provider.refund(order({ paymentReference: ref }), 2000)).status).toBe(
      'REFUNDED',
    );
    expect(
      (await provider.voidPayment(order({ paymentReference: ref }), ref)).status,
    ).toBe('VOIDED');
  });
});
