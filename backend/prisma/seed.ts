import { createHash } from 'crypto';
import {
  ApiRole,
  LocationType,
  OrderChannel,
  PrismaClient,
  SourcingStrategy,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex');

/** Seeds a demo tenant with two SKUs, three nodes, stock, and a sourcing rule. */
async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    create: { name: 'Demo Retailer', slug: 'demo' },
    update: {},
  });

  const skus = await Promise.all(
    [
      { code: 'TSHIRT-BLK-M', name: 'Black T-Shirt (M)' },
      { code: 'MUG-WHT', name: 'White Mug' },
    ].map((s) =>
      prisma.sku.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: s.code } },
        create: { tenantId: tenant.id, ...s },
        update: {},
      }),
    ),
  );

  const locations = await Promise.all(
    [
      {
        code: 'DC-EAST',
        name: 'East Distribution Center',
        type: LocationType.WAREHOUSE,
        latitude: 40.71,
        longitude: -74.0,
        fulfillmentPriority: 10,
      },
      {
        code: 'DC-WEST',
        name: 'West Distribution Center',
        type: LocationType.WAREHOUSE,
        latitude: 34.05,
        longitude: -118.24,
        fulfillmentPriority: 20,
      },
      {
        code: 'STORE-CHI',
        name: 'Chicago Store',
        type: LocationType.STORE,
        latitude: 41.88,
        longitude: -87.63,
        fulfillmentPriority: 30,
        pickupEnabled: true,
      },
    ].map((l) =>
      prisma.location.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: l.code } },
        create: { tenantId: tenant.id, ...l },
        update: {},
      }),
    ),
  );

  // Stock matrix: receive on-hand into each (sku, location).
  const stock: Record<string, Record<string, number>> = {
    'TSHIRT-BLK-M': { 'DC-EAST': 100, 'DC-WEST': 50, 'STORE-CHI': 8 },
    'MUG-WHT': { 'DC-EAST': 0, 'DC-WEST': 30, 'STORE-CHI': 12 },
  };

  for (const sku of skus) {
    for (const loc of locations) {
      const qty = stock[sku.code]?.[loc.code] ?? 0;
      await prisma.inventorySnapshot.upsert({
        where: {
          tenantId_skuId_locationId: {
            tenantId: tenant.id,
            skuId: sku.id,
            locationId: loc.id,
          },
        },
        create: {
          tenantId: tenant.id,
          skuId: sku.id,
          locationId: loc.id,
          onHand: qty,
        },
        update: { onHand: qty },
      });
      if (qty > 0) {
        await prisma.inventoryLedger.create({
          data: {
            tenantId: tenant.id,
            skuId: sku.id,
            locationId: loc.id,
            eventType: 'RECEIPT',
            onHandDelta: qty,
            reason: 'seed',
          },
        });
      }
    }
  }

  await prisma.salesChannel.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Main Shopify' } },
    create: {
      tenantId: tenant.id,
      type: 'SHOPIFY',
      name: 'Main Shopify',
      config: { shopDomain: 'demo.myshopify.com' },
    },
    update: {},
  });

  await prisma.sourcingRule.upsert({
    where: { id: `${tenant.id}-default` },
    create: {
      id: `${tenant.id}-default`,
      tenantId: tenant.id,
      name: 'Default balanced sourcing',
      channel: null,
      region: null,
      strategy: SourcingStrategy.BALANCED,
      priority: 100,
    },
    update: {},
  });

  // Deterministic demo API keys (so they can be used in tests/docs).
  const demoKeys: { secret: string; name: string; role: ApiRole }[] = [
    { secret: 'oms_demo_admin_key', name: 'demo-admin', role: ApiRole.ADMIN },
    { secret: 'oms_demo_operator_key', name: 'demo-operator', role: ApiRole.OPERATOR },
    { secret: 'oms_demo_readonly_key', name: 'demo-readonly', role: ApiRole.READ_ONLY },
  ];
  for (const k of demoKeys) {
    const keyHash = sha256(k.secret);
    await prisma.apiKey.upsert({
      where: { keyHash },
      create: {
        tenantId: tenant.id,
        name: k.name,
        role: k.role,
        keyHash,
        prefix: k.secret.slice(0, 12),
      },
      update: {},
    });
  }

  // Demo console users (email/password → JWT login). Password: demo1234.
  const demoUsers: { email: string; name: string; role: ApiRole }[] = [
    { email: 'admin@demo.test', name: 'Demo Admin', role: ApiRole.ADMIN },
    { email: 'operator@demo.test', name: 'Demo Operator', role: ApiRole.OPERATOR },
    { email: 'viewer@demo.test', name: 'Demo Viewer', role: ApiRole.READ_ONLY },
  ];
  const passwordHash = await bcrypt.hash('demo1234', 10);
  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      create: { tenantId: tenant.id, ...u, passwordHash },
      update: {},
    });
  }

  console.log('Seed complete.');
  console.log(
    `  Console users (POST /auth/login, password demo1234):  ${demoUsers
      .map((u) => `${u.email}(${u.role})`)
      .join('  ')}`,
  );
  console.log(
    `  API keys (header  Authorization: Bearer <secret>):  admin=oms_demo_admin_key  operator=oms_demo_operator_key  readonly=oms_demo_readonly_key`,
  );
  console.log(`  tenant slug: demo  (use header  x-tenant-id: demo)`);
  console.log(`  SKUs:        ${skus.map((s) => `${s.code}=${s.id}`).join(', ')}`);
  console.log(
    `  Locations:   ${locations.map((l) => `${l.code}=${l.id}`).join(', ')}`,
  );
  console.log(`  Channels:    ${Object.values(OrderChannel).join(', ')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
