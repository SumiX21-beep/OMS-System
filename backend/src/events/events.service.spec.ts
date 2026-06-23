import { firstValueFrom, take, toArray } from 'rxjs';
import { EventsService, DomainEvent } from './events.service';

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
});
