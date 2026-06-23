import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Structured request logging with a correlation id (echoed as x-request-id),
 * plus http_requests_total / http_request_duration counters for /metrics.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');

  constructor(private readonly metrics: MetricsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const requestId = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    const route = `${req.method} ${req.route?.path ?? req.path}`;

    return next.handle().pipe(
      tap({
        next: () => this.record(route, req.method, res.statusCode, start, requestId),
        error: (err) => {
          const status = (err?.status as number) ?? 500;
          this.record(route, req.method, status, start, requestId, true);
        },
      }),
    );
  }

  private record(
    route: string,
    method: string,
    status: number,
    start: number,
    requestId: string,
    isError = false,
  ): void {
    const ms = Date.now() - start;
    this.metrics.inc('http_requests_total', {
      method,
      status: String(status),
    });
    this.metrics.inc('http_request_duration_ms_sum', { method }, ms);
    const msg = `${route} ${status} ${ms}ms rid=${requestId}`;
    if (isError) this.log.warn(msg);
    else this.log.log(msg);
  }
}
