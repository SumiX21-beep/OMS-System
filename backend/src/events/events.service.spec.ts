import { firstValueFrom, take, toArray } from 'rxjs';
import { EventsService, DomainEvent } from './events.service';
import { RedisService } from '../common/redis/redis.service';

/** Minimal RedisService double capturing publishes and exposing the sub handler. */
function fakeRedis() {
  const published: string[] = [];
  let messageHandler: ((ch: string, payload: string) => void) | undefined;
  const client = {
    publish: (_ch: string, payload: string) => {
      published.push(payload);
      return Promise.resolve(1);
    },
    duplicate: () => ({
      on: (ev: string, h: (ch: string, payload: string) => void) => {
        if (ev === 'message') messageHandler = h;
      },
      subscribe: () => Promise.resolve(),
      quit: () => Promise.resolve(),
    }),
  };
  return {
    redis: { client } as unknown as RedisService,
    published,
    deliver: (payload: string) => messageHandler?.('oms:events', payload),
  };
}

describe('EventsService', () => {
  it('delivers a published event to a same-tenant subscriber', async () => {
    const svc = new EventsService();
    const first = firstValueFrom(svc.streamFor('t1'));
    svc.publish({ tenantId: 't1', type: 'order.status', subjectId: 'o1', data: { status: 'VALIDATED' } });
    const msg = await first;
    expect(msg.data.type).toBe('order.status');
    expect(msg.data.subjectId).toBe('o1');
    expect(msg.data.data).toEqual({ status: 'VALIDATED' });
    expect(typeof msg.data.at).toBe('string');
  });

  it('does not leak events across tenants', async () => {
    const svc = new EventsService();
    // Collect the first event t2 actually sees; t1's publish must be filtered out.
    const t2first = firstValueFrom(svc.streamFor('t2'));
    svc.publish({ tenantId: 't1', type: 'inventory.atp', subjectId: 'skuA' });
    svc.publish({ tenantId: 't2', type: 'inventory.atp', subjectId: 'skuB' });
    const msg = await t2first;
    expect(msg.data.subjectId).toBe('skuB');
  });

  it('fans out one event to multiple subscribers', async () => {
    const svc = new EventsService();
    const a = firstValueFrom(svc.streamFor('t1'));
    const b = firstValueFrom(svc.streamFor('t1'));
    svc.publish({ tenantId: 't1', type: 'shipment.status', subjectId: 's1' });
    const [ma, mb] = await Promise.all([a, b]);
    expect(ma.data.subjectId).toBe('s1');
    expect(mb.data.subjectId).toBe('s1');
  });

  it('preserves event order for a tenant', async () => {
    const svc = new EventsService();
    const collected = firstValueFrom(svc.streamFor('t1').pipe(take(3), toArray()));
    const ids = ['a', 'b', 'c'];
    ids.forEach((id) =>
      svc.publish({ tenantId: 't1', type: 'order.status', subjectId: id } as DomainEvent),
    );
    const msgs = await collected;
    expect(msgs.map((m) => m.data.subjectId)).toEqual(ids);
  });

  describe('cross-process Redis bridge', () => {
    it('fans a published event out to Redis with an origin tag', () => {
      const { redis, published } = fakeRedis();
      const svc = new EventsService(redis);
      svc.onModuleInit();
      svc.publish({ tenantId: 't1', type: 'order.status', subjectId: 'o1' });
      expect(published).toHaveLength(1);
      const wire = JSON.parse(published[0]);
      expect(wire.subjectId).toBe('o1');
      expect(typeof wire._src).toBe('string');
    });

    it('delivers an event arriving from another process', async () => {
      const { redis, deliver } = fakeRedis();
      const svc = new EventsService(redis);
      svc.onModuleInit();
      const got = firstValueFrom(svc.streamFor('t1'));
      deliver(
        JSON.stringify({
          tenantId: 't1',
          type: 'inventory.atp',
          subjectId: 'skuFromWorker',
          _src: 'another-process',
        }),
      );
      const msg = await got;
      expect(msg.data.subjectId).toBe('skuFromWorker');
    });

    it('drops its own echo so a same-process event is delivered once', async () => {
      const { redis, published, deliver } = fakeRedis();
      const svc = new EventsService(redis);
      svc.onModuleInit();
      const seen: string[] = [];
      const sub = svc.streamFor('t1').subscribe((m) => seen.push(m.data.subjectId));
      svc.publish({ tenantId: 't1', type: 'order.status', subjectId: 'local' });
      // Redis echoes the same payload back to the origin process; must be ignored.
      deliver(published[published.length - 1]);
      await new Promise((r) => setImmediate(r));
      expect(seen.filter((s) => s === 'local')).toHaveLength(1);
      sub.unsubscribe();
    });
  });
});
