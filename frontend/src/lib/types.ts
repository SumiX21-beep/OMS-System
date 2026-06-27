// Shapes mirrored from the OMS API (kept minimal — only what the UI consumes).

export type Role = 'ADMIN' | 'OPERATOR' | 'READ_ONLY';

export type OrderStatus =
  | 'CREATED'
  | 'VALIDATED'
  | 'ALLOCATED'
  | 'RELEASED'
  | 'PICKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED';

export type OrderChannel = 'WEB' | 'POS' | 'MARKETPLACE' | 'PHONE' | 'B2B';

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'DECLINED'
  | 'REFUNDED'
  | 'VOIDED';

export type ShipmentStatus =
  | 'PENDING'
  | 'PICKED'
  | 'READY_FOR_PICKUP'
  | 'SHIPPED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface Sku {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface Location {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
  fulfillmentPriority: number;
}

export interface SnapshotRow {
  id: string;
  skuId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  allocated: number;
  inTransit: number;
  safetyStock: number;
  available: number;
  sku: { code: string; name: string };
  location: { code: string; name: string };
}

export interface Availability {
  skuId: string;
  locationId: string | null;
  onHand: number;
  reserved: number;
  allocated: number;
  inTransit: number;
  safetyStock: number;
  available: number;
  availableToPromise: number;
}

export interface OrderLine {
  id: string;
  skuId: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderEvent {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: string;
}

export interface Shipment {
  id: string;
  orderId: string;
  locationId: string;
  status: ShipmentStatus;
  fulfillmentType: string;
  trackingNumber: string | null;
  carrier: string | null;
  allocations?: { skuId: string; quantity: number }[];
  location?: { code: string; name: string };
}

export interface OrderSummary {
  id: string;
  channel: OrderChannel;
  externalRef: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  taxTotal: number;
  createdAt: string;
  lines: OrderLine[];
  _count?: { shipments: number };
}

export interface OrderDetail extends OrderSummary {
  customerRef: string | null;
  currency: string;
  paymentReference: string | null;
  reservations: { id: string; skuId: string; locationId: string; quantity: number; status: string }[];
  allocations: { id: string; skuId: string; locationId: string; quantity: number; status: string }[];
  shipments: Shipment[];
  events: OrderEvent[];
}

export interface Channel {
  id: string;
  type: string;
  name: string;
  active: boolean;
  externalRef: string | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  role: Role;
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface SourcingRule {
  id: string;
  name: string;
  channel: OrderChannel | null;
  region: string | null;
  strategy: string;
  allowSplit: boolean;
  priority: number;
  active: boolean;
}

export interface ReconciliationReport {
  checked: number;
  drifted: number;
  repaired: number;
  entries: {
    skuId: string;
    locationId: string;
    diff: Record<string, number>;
  }[];
}

export interface Forecast {
  skuId: string;
  skuCode: string;
  lookbackDays: number;
  horizonDays: number;
  totalShipped: number;
  avgDailyDemand: number;
  available: number;
  daysOfCover: number | null;
  forecastDemand: number;
  reorderSuggested: boolean;
  suggestedReorderQty: number;
}

export interface AskResult {
  answer: string;
  toolsUsed: string[];
  steps: number;
}

export interface ReturnLine {
  id: string;
  skuId: string;
  quantity: number;
  restock: boolean;
}

export interface Rma {
  id: string;
  rma: string;
  orderId: string;
  status: string;
  reason: string | null;
  createdAt: string;
  lines: ReturnLine[];
}

export interface Inbound {
  id: string;
  skuId: string;
  locationId: string;
  quantity: number;
  receivedQty: number;
  expectedAt: string;
  status: string;
  sku?: { code: string };
  location?: { code: string };
}
