import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FraudStatus,
  Order,
  OrderLine,
  PaymentStatus,
} from '@prisma/client';

export interface ValidationOutcome {
  paymentStatus: PaymentStatus;
  fraudStatus: FraudStatus;
  taxTotal: number;
  discountTotal: number;
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
 * Deterministic stub behaviour (for tests/demo):
 *   • payment: AUTHORIZED, unless externalRef contains "DECLINE" → DECLINED (reject)
 *   • fraud:   PASS, unless customerRef contains "FRAUD" → FAIL (reject)
 *   • tax:     TAX_RATE × subtotal
 *   • promo:   PROMO_PERCENT × subtotal
 */
@Injectable()
export class OrderValidationService {
  private readonly log = new Logger(OrderValidationService.name);
  private readonly hooks: ValidationHook[];

  constructor(config: ConfigService) {
    const taxRate = config.get<number>('TAX_RATE', 0.08);
    const promoPct = config.get<number>('PROMO_PERCENT', 0);

    this.hooks = [
      {
        name: 'payment',
        run: (order, acc) => {
          if ((order.externalRef ?? '').toUpperCase().includes('DECLINE')) {
            acc.paymentStatus = PaymentStatus.DECLINED;
            acc.rejection = 'payment declined';
          } else {
            acc.paymentStatus = PaymentStatus.AUTHORIZED;
          }
        },
      },
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

  evaluate(order: OrderWithLines): ValidationOutcome {
    const acc: ValidationOutcome = {
      paymentStatus: PaymentStatus.PENDING,
      fraudStatus: FraudStatus.PENDING,
      taxTotal: 0,
      discountTotal: 0,
    };
    for (const hook of this.hooks) {
      hook.run(order, acc);
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
