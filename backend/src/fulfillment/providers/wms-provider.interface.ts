import { Shipment } from '@prisma/client';

export interface WmsDispatchLine {
  skuId: string;
  quantity: number;
}

export interface WmsDispatchResult {
  /** Which connector handled the dispatch (recorded on the shipment). */
  provider: string;
  /** The provider-side fulfilment job/order id. */
  jobId: string;
}

/**
 * A warehouse / 3PL fulfilment connector. A real implementation calls the
 * provider's API (ShipBob, Deliverr, a DC's WMS, …) to create a fulfilment job
 * and later receives an async shipped/tracking confirmation (delivered back via
 * the existing ship endpoint, which the provider's webhook would call).
 */
export interface WmsProvider {
  readonly name: string;
  dispatch(
    shipment: Shipment,
    lines: WmsDispatchLine[],
  ): Promise<WmsDispatchResult>;
}

/** DI token for the array of registered WMS providers (the registry). */
export const WMS_PROVIDERS = Symbol('WMS_PROVIDERS');
