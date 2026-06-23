/** Central registry of BullMQ queues and job names shared across processes. */
export const QUEUES = {
  RESERVATION: 'reservation',
  SYNC: 'sync',
  RECONCILIATION: 'reconciliation',
} as const;

export const RESERVATION_JOBS = {
  /** One-shot delayed job that releases a single reservation when its TTL hits. */
  EXPIRE_ONE: 'expire-one',
  /** Safety-net sweep that releases any reservation already past its expiry. */
  SWEEP: 'sweep-expired',
} as const;

export const SYNC_JOBS = {
  /** Drain pending outbox events and publish them to sales channels. */
  DRAIN_OUTBOX: 'drain-outbox',
} as const;

export const RECONCILIATION_JOBS = {
  /** Re-derive snapshots from the ledger and report/repair drift. */
  RECONCILE: 'reconcile',
} as const;

export interface ExpireOneJobData {
  reservationId: string;
  tenantId: string;
}
