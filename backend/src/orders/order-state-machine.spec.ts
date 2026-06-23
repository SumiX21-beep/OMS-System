import { OrderStatus } from '@prisma/client';
import { assertTransition, canTransition } from './order-state-machine';

describe('order state machine', () => {
  it('allows the happy-path lifecycle', () => {
    const path: OrderStatus[] = [
      OrderStatus.CREATED,
      OrderStatus.VALIDATED,
      OrderStatus.ALLOCATED,
      OrderStatus.RELEASED,
      OrderStatus.PICKED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('permits cancellation from pre-fulfilment states only', () => {
    expect(canTransition(OrderStatus.CREATED, OrderStatus.CANCELLED)).toBe(true);
    expect(canTransition(OrderStatus.PICKED, OrderStatus.CANCELLED)).toBe(true);
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.CANCELLED)).toBe(false);
  });

  it('rejects skipping states', () => {
    expect(canTransition(OrderStatus.CREATED, OrderStatus.ALLOCATED)).toBe(false);
    expect(canTransition(OrderStatus.VALIDATED, OrderStatus.SHIPPED)).toBe(false);
  });

  it('treats terminal states as terminal', () => {
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.CREATED)).toBe(false);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.RETURNED)).toBe(true);
    expect(canTransition(OrderStatus.RETURNED, OrderStatus.CREATED)).toBe(false);
  });

  it('assertTransition throws on an illegal move', () => {
    expect(() =>
      assertTransition(OrderStatus.CREATED, OrderStatus.SHIPPED),
    ).toThrow();
    expect(() =>
      assertTransition(OrderStatus.CREATED, OrderStatus.VALIDATED),
    ).not.toThrow();
  });
});
