import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Shipment } from '@prisma/client';
import {
  WmsDispatchLine,
  WmsDispatchResult,
  WmsProvider,
} from './wms-provider.interface';

/**
 * In-process WMS stub for dev/tests/demo — returns a synthetic fulfilment job
 * id and logs the picked lines, standing in for a real warehouse API.
 */
@Injectable()
export class MockWmsProvider implements WmsProvider {
  readonly name = 'mock';
  private readonly log = new Logger(MockWmsProvider.name);

  async dispatch(
    shipment: Shipment,
    lines: WmsDispatchLine[],
  ): Promise<WmsDispatchResult> {
    const jobId = `WMS-${randomUUID().slice(0, 10).toUpperCase()}`;
    this.log.log(
      `Dispatched shipment ${shipment.id} to ${this.name} (job ${jobId}): ` +
        lines.map((l) => `${l.skuId.slice(-6)}×${l.quantity}`).join(', '),
    );
    return { provider: this.name, jobId };
  }
}
