import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { PaymentsService } from './payments.service';
import { StripePaymentProvider } from './stripe-payment.provider';

/**
 * Payment gateway abstraction. The active provider is chosen by env
 * `PAYMENT_PROVIDER` (mock | stripe; default mock). Add a gateway by
 * implementing PaymentProvider and extending the factory below.
 */
@Module({
  providers: [
    MockPaymentProvider,
    StripePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, MockPaymentProvider, StripePaymentProvider],
      useFactory: (
        config: ConfigService,
        mock: MockPaymentProvider,
        stripe: StripePaymentProvider,
      ) => {
        const name = config.get<string>('PAYMENT_PROVIDER', 'mock').toLowerCase();
        return name === 'stripe' ? stripe : mock;
      },
    },
    PaymentsService,
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
