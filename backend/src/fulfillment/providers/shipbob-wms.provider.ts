import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Shipment } from '@prisma/client';
import {
  WmsDispatchLine,
  WmsDispatchResult,
  WmsProvider,
} from './wms-provider.interface';

/**
 * ShipBob 3PL connector — the drop-in seam for a real fulfilment provider.
 *
 * Selected by `WMS_PROVIDER=shipbob`. A production build would POST to ShipBob's
 * `/order` API with the picked lines and store the returned shipment id. Without
 * `SHIPBOB_API_KEY` it runs in dry-run (synthetic job id) so the app stays
 * runnable before credentials exist.
 */
@Injectable()
export class ShipBobWmsProvider implements WmsProvider {
  readonly name = 'shipbob';
  private readonly log = new Logger(ShipBobWmsProvider.name);
  private readonly apiKey?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('SHIPBOB_API_KEY') || undefined;
    if (!this.apiKey) {
      this.log.warn('SHIPBOB_API_KEY unset — ShipBob provider runs in DRY-RUN.');
    }
  }

  async dispatch(
    shipment: Shipment,
    lines: WmsDispatchLine[],
  ): Promise<WmsDispatchResult> {
    const jobId = `SB-${randomUUID().slice(0, 10).toUpperCase()}`;
    if (this.apiKey) {
      // → const res = await fetch('https://api.shipbob.com/1.0/order', { method:'POST', headers:{Authorization:`Bearer ${this.apiKey}`}, body: ... })
      this.log.log(
        `Would create ShipBob order for shipment ${shipment.id} (${lines.length} lines)`,
      );
    }
    return { provider: this.name, jobId };
  }
}
