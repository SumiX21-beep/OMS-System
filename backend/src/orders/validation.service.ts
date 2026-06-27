import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FraudStatus,
  Order,
  OrderLine,
  PaymentStatus,
} from '@prisma/client';
import { PaymentsService } from '../payments/payments.service';

export interface ValidationOutcome {
  paymentStatus: PaymentStatus;
  fraudStatus: FraudStatus;
  taxTotal: number;
  discountTotal: number;
  /** Gateway authorization handle, when the charge was authorized. */
  paymentReference?: string;
  /** Hard-block VALIDATED transition with this reason when set. */
  rejection?: string;
}

type OrderWithLines = Order & { lines: OrderLine[] };

interface ValidationHook {
  name: string;
  run(order: OrderWithLines, acc: ValidationOutcome): void;
}

/**
 * Pluggable order-validation pipeline. Real deployments swap these stubs for a
 * payment gateway, fraud provider, and tax/promo engines; the pipeline contract
 * (mutate the accumulator, optionally reject) stays the same.
 *
 * Payment is delegated to the configured PaymentsService gateway (mock | stripe);
 * the remaining hooks are deterministic stubs (for tests/demo):
 *   • fraud:   PASS, unless customerRef contains "FRAUD" → FAIL (reject)
 *   • tax:     TAX_RATE × subtotal
 *   • promo:   PROMO_PERCENT × subtotal
 */
@Injectable()
export class OrderValidationService {
  private readonly log = new Logger(OrderValidationService.name);
  private readonly hooks: ValidationHook[];

  constructor(
    config: ConfigService,
    private readonly payments: PaymentsService,
  ) {
    const taxRate = config.get<number>('TAX_RATE', 0.08);
    const promoPct = config.get<number>('PROMO_PERCENT', 0);

    this.hooks = [
      {
        name: 'fraud',
        run: (order, acc) => {
          if ((order.customerRef ?? '').toUpperCase().includes('FRAUD')) {
            acc.fraudStatus = FraudStatus.FAIL;
            acc.rejection = acc.rejection ?? 'failed fraud screen';
          } else {
            acc.fraudStatus = FraudStatus.PASS;
          }
        },
      },
      {
        name: 'tax',
        run: (order, acc) => {
          acc.taxTotal = Math.round(this.subtotal(order) * taxRate);
        },
      },
      {
        name: 'promo',
        run: (order, acc) => {
          acc.discountTotal = Math.round(this.subtotal(order) * promoPct);
        },
      },
    ];
  }

  async evaluate(order: OrderWithLines): Promise<ValidationOutcome> {
    const acc: ValidationOutcome = {
      paymentStatus: PaymentStatus.PENDING,
      fraudStatus: FraudStatus.PENDING,
      taxTotal: 0,
      discountTotal: 0,
    };
    // Fraud/tax/promo first so the gateway charges the final (taxed) amount.
    for (const hook of this.hooks) {
      hook.run(order, acc);
    }

    // Payment: delegate to the configured gateway with the resolved totals.
    const auth = await this.payments.authorize({
      ...order,
      taxTotal: acc.taxTotal,
      discountTotal: acc.discountTotal,
    });
    if (auth.status === 'AUTHORIZED') {
      acc.paymentStatus = PaymentStatus.AUTHORIZED;
      acc.paymentReference = auth.reference;
    } else {
      acc.paymentStatus = PaymentStatus.DECLINED;
      acc.rejection = acc.rejection ?? auth.declineReason ?? 'payment declined';
    }

    this.log.debug(
      `Validated order ${order.id}: pay=${acc.paymentStatus} fraud=${acc.fraudStatus} tax=${acc.taxTotal} promo=${acc.discountTotal}`,
    );
    return acc;
  }

  private subtotal(order: OrderWithLines): number {
    return order.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  }
}
