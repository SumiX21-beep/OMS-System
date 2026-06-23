import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  ChannelConnector,
  GenericConnector,
  ShopifyConnector,
} from './connectors/channel-connector';

/** Resolves the connector implementation for a given channel type. */
@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<ChannelType, ChannelConnector>();

  constructor(shopify: ShopifyConnector, generic: GenericConnector) {
    this.connectors.set(ChannelType.SHOPIFY, shopify);
    this.connectors.set(ChannelType.MARKETPLACE, generic.make(ChannelType.MARKETPLACE));
    this.connectors.set(ChannelType.POS, generic.make(ChannelType.POS));
    this.connectors.set(ChannelType.OTHER, generic.make(ChannelType.OTHER));
  }

  get(type: ChannelType): ChannelConnector {
    const c = this.connectors.get(type);
    if (!c) throw new Error(`No connector for channel type ${type}`);
    return c;
  }
}
