import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

/**
 * Explicit, auditable order lifecycle. Every transition must be declared here;
 * attempting an undeclared transition is rejected. This is the single source of
 * truth for "what can happen next" to an order.
 *
 *   CREATED → VALIDATED → ALLOCATED → RELEASED → PICKED → SHIPPED → DELIVERED
 *   (most pre-fulfilment states can also go to CANCELLED; DELIVERED → RETURNED)
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.CREATED]: [OrderStatus.VALIDATED, OrderStatus.CANCELLED],
  [OrderStatus.VALIDATED]: [OrderStatus.ALLOCATED, OrderStatus.CANCELLED],
  [OrderStatus.ALLOCATED]: [OrderStatus.RELEASED, OrderStatus.CANCELLED],
  [OrderStatus.RELEASED]: [OrderStatus.PICKED, OrderStatus.CANCELLED],
  [OrderStatus.PICKED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(
      `Illegal order transition ${from} → ${to}. Allowed: ${
        TRANSITIONS[from].join(', ') || '(none — terminal state)'
      }`,
    );
  }
}

/** States in which a reservation/allocation is still holding inventory. */
export const HOLDS_INVENTORY: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.VALIDATED,
  OrderStatus.ALLOCATED,
  OrderStatus.RELEASED,
  OrderStatus.PICKED,
];
