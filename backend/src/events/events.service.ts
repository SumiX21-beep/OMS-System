import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { Observable, Subject, filter, map, merge, interval } from 'rxjs';
import { RedisService } from '../common/redis/redis.service';

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

/** Redis pub/sub channel that fans domain events across processes. */
const REDIS_CHANNEL = 'oms:events';
const HEARTBEAT_MS = 25_000;

/** Wire shape on Redis: a DomainEvent tagged with its origin process. */
interface WireEvent extends DomainEvent {
  _src: string;
}

/**
 * Pub/sub for real-time domain events, surfaced to the UI over SSE.
 *
 * Two delivery paths keep this correct across the API / worker / scheduler split:
 *   1. In-process: publish() pushes straight onto the local Subject, so SSE
 *      clients on the same process see events with zero latency (the common
 *      case — the API both publishes order/inventory changes and serves SSE).
 *   2. Cross-process: publish() also PUBLISHes to a Redis channel. Every process
 *      subscribes; an inbound message from ANOTHER process is replayed onto the
 *      local Subject. So a write in the worker (e.g. reservation TTL expiry
 *      releasing stock) now reaches SSE clients connected to the API.
 *
 * Each event carries its origin process id (`_src`); the subscriber drops its
 * own echoes so a same-process event is delivered exactly once.
 *
 * Redis is optional: without it (unit tests, single-process dev) the service
 * degrades to path (1) only and still works.
 */
@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EventsService.name);
  private readonly subject = new Subject<DomainEvent>();
  /** Unique per process, so the subscriber can ignore its own published echoes. */
  private readonly instanceId = randomUUID();
  private subscriber?: Redis;

  constructor(@Optional() private readonly redis?: RedisService) {}

  onModuleInit(): void {
    if (!this.redis) return;
    // A dedicated connection: a subscribed ioredis client can't issue PUBLISH.
    this.subscriber = this.redis.client.duplicate();
    this.subscriber.on('message', (_channel: string, payload: string) =>
      this.onRedisMessage(payload),
    );
    this.subscriber.subscribe(REDIS_CHANNEL).catch((err) =>
      this.log.error(`Failed to subscribe to ${REDIS_CHANNEL}: ${err}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch {
        /* connection already closing */
      }
    }
  }

  publish(event: DomainEvent): void {
    // Path 1 — deliver to same-process subscribers immediately.
    this.subject.next(event);
    // Path 2 — fan out to other processes (best-effort).
    if (this.redis) {
      const wire: WireEvent = { ...event, _src: this.instanceId };
      void this.redis.client
        .publish(REDIS_CHANNEL, JSON.stringify(wire))
        .catch((err) => this.log.warn(`Event fan-out failed: ${err}`));
    }
  }

  private onRedisMessage(payload: string): void {
    let wire: WireEvent;
    try {
      wire = JSON.parse(payload) as WireEvent;
    } catch {
      this.log.warn('Dropped malformed event from Redis');
      return;
    }
    // Ignore our own echo — it was already delivered locally in publish().
    if (wire._src === this.instanceId) return;
    const { _src, ...event } = wire;
    void _src;
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
