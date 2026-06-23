import { Controller, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags } from '@nestjs/swagger';
import { TenantId } from '../common/tenant/tenant.decorator';
import { EventsService, SseMessage } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Server-Sent Events stream of live domain events for the caller's tenant.
   * EventSource cannot send headers, so authenticate via query string:
   *   /events/stream?tenant=demo            (dev, AUTH_REQUIRED=false)
   *   /events/stream?apiKey=oms_demo_..._key (with auth enabled)
   */
  @Sse('stream')
  stream(@TenantId() tenantId: string): Observable<SseMessage> {
    return this.events.streamFor(tenantId);
  }
}
