import { Injectable, Logger } from '@nestjs/common';

export interface ShopifyCreds {
  shopDomain: string; // e.g. "demo.myshopify.com"
  accessToken: string;
  apiVersion: string; // e.g. "2026-04"
}

interface GraphqlResult<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Thin Shopify Admin GraphQL client. Uses the global `fetch` (Node 18+).
 * Validated operations (against the 2026-04 schema):
 *   • productVariants(query:"sku:…") → inventoryItem.id   (read_products, read_inventory)
 *   • inventorySetQuantities                              (write_inventory)
 */
@Injectable()
export class ShopifyAdminClient {
  private readonly log = new Logger(ShopifyAdminClient.name);

  async graphql<T>(
    creds: ShopifyCreds,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://${creds.shopDomain}/admin/api/${creds.apiVersion}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': creds.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as GraphqlResult<T>;
    if (body.errors?.length) {
      throw new Error(
        `Shopify GraphQL errors: ${body.errors.map((e) => e.message).join('; ')}`,
      );
    }
    if (!body.data) throw new Error('Shopify GraphQL: empty data');
    return body.data;
  }

  /** Resolve a SKU code to its InventoryItem gid (null if not found). */
  async findInventoryItemBySku(
    creds: ShopifyCreds,
    sku: string,
  ): Promise<{ inventoryItemId: string; variantId: string } | null> {
    const query = `query FindVariantBySku($q: String!) {
      productVariants(first: 1, query: $q) {
        edges { node { id sku inventoryItem { id } } }
      }
    }`;
    const data = await this.graphql<{
      productVariants: {
        edges: { node: { id: string; inventoryItem: { id: string } } }[];
      };
    }>(creds, query, { q: `sku:${sku}` });

    const node = data.productVariants.edges[0]?.node;
    if (!node?.inventoryItem?.id) return null;
    return { inventoryItemId: node.inventoryItem.id, variantId: node.id };
  }

  /** Set the absolute available quantity for an inventory item at a location. */
  async setAvailable(
    creds: ShopifyCreds,
    inventoryItemId: string,
    locationGid: string,
    quantity: number,
  ): Promise<void> {
    const mutation = `mutation SetAvailable($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup { reason changes { name delta } }
        userErrors { code field message }
      }
    }`;
    const input = {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true, // set absolute value; skip CAS check
      referenceDocumentUri: 'oms://oms-omni/sync',
      quantities: [{ inventoryItemId, locationId: locationGid, quantity }],
    };
    const data = await this.graphql<{
      inventorySetQuantities: {
        userErrors: { code: string; field: string[]; message: string }[];
      };
    }>(creds, mutation, { input });

    const errs = data.inventorySetQuantities.userErrors;
    if (errs?.length) {
      throw new Error(
        `inventorySetQuantities userErrors: ${errs
          .map((e) => `${e.code}:${e.message}`)
          .join('; ')}`,
      );
    }
  }

  /** Exchange an OAuth authorization code for a permanent admin access token. */
  async exchangeCodeForToken(
    shopDomain: string,
    apiKey: string,
    apiSecret: string,
    code: string,
  ): Promise<{ access_token: string; scope: string }> {
    const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code,
      }),
    });
    if (!res.ok) {
      throw new Error(`OAuth token exchange ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as { access_token: string; scope: string };
  }
}
