import { InventoryEventType } from '@prisma/client';

/** Signed deltas applied to the snapshot buckets by a single movement. */
export interface BucketDeltas {
  onHand?: number;
  reserved?: number;
  allocated?: number;
  inTransit?: number;
  damaged?: number;
}

export interface MovementParams {
  tenantId: string;
  skuId: string;
  locationId: string;
  eventType: InventoryEventType;
  deltas: BucketDeltas;
  /**
   * When true, the movement is rejected unless availability stays >= 0 after
   * applying the deltas. Set for events that consume promisable stock
   * (RESERVE / ALLOCATE) to guarantee no oversell.
   */
  requireAvailable?: boolean;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
}

/** A row of the InventorySnapshot table, as read under a row lock. */
export interface SnapshotRow {
  id: string;
  onHand: number;
  reserved: number;
  allocated: number;
  inTransit: number;
  damaged: number;
  safetyStock: number;
  version: number;
}

export interface AvailabilityView {
  skuId: string;
  locationId: string | null; // null => network rollup
  onHand: number;
  reserved: number;
  allocated: number;
  inTransit: number;
  damaged: number;
  safetyStock: number;
  /** What we can promise right now (clamped at 0). */
  available: number;
  /** available + inbound expected within the configured horizon. */
  availableToPromise: number;
}
