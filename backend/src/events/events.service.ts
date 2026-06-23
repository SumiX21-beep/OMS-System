import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, map, merge, interval } from 'rxjs';

export type DomainEventType =
  | 'order.status'
  | 'inventory.atp'
  | 'shipment.status';

export interface DomainEvent {
  tenantId: string;
  type: DomainEventType;
  /** The affected entity id (order id, sku id, shipment id). */
  subjectId: string;
  data?: Record<string, unknown>;
}

/** Shape pushed over the SSE wire (Nest serialises `data` to JSON). */
export interface SseMessage {
  data: {
    type: DomainEventType | 'heartbeat';
    subjectId: string;
    at: string;
    data?: Record<string, unknown>;
  };
}

const HEARTBEAT_MS = 25_000;

/**
 * In-process pub/sub for real-time domain events, surfaced to the UI over SSE.
 * Services call publish(); the SSE controller subscribes per tenant. A periodic
 * heartbeat keeps proxies from closing idle connections.
 *
 * Single-process scope: events only reach SSE clients connected to the SAME
 * process. The API serves SSE and the domain writes that emit (orders,
 * inventory) happen in the API process, so this holds today. Fan-out across
 * processes (worker/scheduler) would need a Redis pub/sub bridge — noted.
 */
@Injectable()
export class EventsService {
  private readonly subject = new Subject<DomainEvent>();

  publish(event: DomainEvent): void {
    this.subject.next(event);
  }

  /** SSE stream for one tenant: matching domain events plus heartbeats. */
  streamFor(tenantId: string): Observable<SseMessage> {
    const events = this.subject.pipe(
      filter((e) => e.tenantId === tenantId),
      map(
        (e): SseMessage => ({
          data: {
            type: e.type,
            subjectId: e.subjectId,
            at: new Date().toISOString(),
            ...(e.data ? { data: e.data } : {}),
          },
        }),
      ),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map(
        (): SseMessage => ({
          data: { type: 'heartbeat', subjectId: '', at: new Date().toISOString() },
        }),
      ),
    );
    return merge(events, heartbeat);
  }
}
