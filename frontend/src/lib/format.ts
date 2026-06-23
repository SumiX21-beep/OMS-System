import type { OrderStatus, ShipmentStatus } from './types';

/** Minor units (cents) → currency string. */
export function money(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format((minor ?? 0) / 100);
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function relativeDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ORDER_TONE: Record<OrderStatus, string> = {
  CREATED: 'bg-slate-500/15 text-slate-300',
  VALIDATED: 'bg-blue-500/15 text-blue-300',
  ALLOCATED: 'bg-indigo-500/15 text-indigo-300',
  RELEASED: 'bg-violet-500/15 text-violet-300',
  PICKED: 'bg-amber-500/15 text-amber-300',
  SHIPPED: 'bg-cyan-500/15 text-cyan-300',
  DELIVERED: 'bg-green-500/15 text-green-300',
  CANCELLED: 'bg-red-500/15 text-red-300',
  RETURNED: 'bg-orange-500/15 text-orange-300',
};

const SHIPMENT_TONE: Record<ShipmentStatus, string> = {
  PENDING: 'bg-slate-500/15 text-slate-300',
  PICKED: 'bg-amber-500/15 text-amber-300',
  READY_FOR_PICKUP: 'bg-teal-500/15 text-teal-300',
  SHIPPED: 'bg-cyan-500/15 text-cyan-300',
  PICKED_UP: 'bg-green-500/15 text-green-300',
  DELIVERED: 'bg-green-500/15 text-green-300',
  CANCELLED: 'bg-red-500/15 text-red-300',
};

export function orderTone(s: OrderStatus): string {
  return ORDER_TONE[s] ?? 'bg-slate-500/15 text-slate-300';
}

export function shipmentTone(s: ShipmentStatus): string {
  return SHIPMENT_TONE[s] ?? 'bg-slate-500/15 text-slate-300';
}
