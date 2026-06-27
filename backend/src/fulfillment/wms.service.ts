import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Shipment } from '@prisma/client';
import {
  WMS_PROVIDERS,
  WmsDispatchLine,
  WmsDispatchResult,
  WmsProvider,
} from './providers/wms-provider.interface';

export { WmsDispatchResult } from './providers/wms-provider.interface';

/**
 * WMS / 3PL handoff. Resolves the right fulfilment connector for a shipment and
 * delegates the dispatch. The registry is keyed by provider name; today the
 * choice is driven by env `WMS_PROVIDER` (default `mock`), and `providerFor()`
 * is the seam where a per-location mapping (store → in-house WMS, DC → 3PL)
 * would live.
 */
@Injectable()
export class WmsService {
  private readonly log = new Logger(WmsService.name);
  private readonly byName: Map<string, WmsProvider>;
  private readonly defaultName: string;

  constructor(
    @Inject(WMS_PROVIDERS) providers: WmsProvider[],
    config: ConfigService,
  ) {
    this.byName = new Map(providers.map((p) => [p.name, p]));
    this.defaultName = config
      .get<string>('WMS_PROVIDER', 'mock')
      .toLowerCase();
    this.log.log(
      `WMS providers: [${[...this.byName.keys()].join(', ')}] (default: ${this.defaultName})`,
    );
  }

  async dispatch(
    shipment: Shipment,
    lines: WmsDispatchLine[],
  ): Promise<WmsDispatchResult> {
    return this.providerFor(shipment.locationId).dispatch(shipment, lines);
  }

  /** A real registry would map a location to its WMS/3PL connector. */
  private providerFor(_locationId: string): WmsProvider {
    return (
      this.byName.get(this.defaultName) ?? this.byName.get('mock')!
    );
  }
}
