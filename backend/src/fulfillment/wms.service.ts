import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Shipment } from '@prisma/client';

export interface WmsDispatchResult {
  provider: string;
  jobId: string;
}

/**
 * WMS / 3PL handoff adapter. A real implementation would call the warehouse's
 * fulfilment API (ShipBob, Deliverr, a DC's WMS, …) and receive an async
 * shipped/tracking confirmation (delivered here via the existing ship endpoint,
 * which a 3PL webhook would call). This stub returns a synthetic job id.
 */
@Injectable()
export class WmsService {
  private readonly log = new Logger(WmsService.name);

  async dispatch(
    shipment: Shipment,
    lines: { skuId: string; quantity: number }[],
  ): Promise<WmsDispatchResult> {
    const provider = this.providerFor(shipment.locationId);
    const jobId = `WMS-${randomUUID().slice(0, 10).toUpperCase()}`;
    this.log.log(
      `Dispatched shipment ${shipment.id} to ${provider} (job ${jobId}): ` +
        lines.map((l) => `${l.skuId.slice(-6)}×${l.quantity}`).join(', '),
    );
    return { provider, jobId };
  }

  // A real registry would map locations → their WMS/3PL connector.
  private providerFor(_locationId: string): string {
    return 'STUB-WMS';
  }
}
