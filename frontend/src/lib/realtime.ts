import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BASE } from './api';
import { getCredentials } from './auth-store';

type ServerEventType =
  | 'order.status'
  | 'inventory.atp'
  | 'shipment.status'
  | 'heartbeat';

interface ServerEvent {
  type: ServerEventType;
  subjectId: string;
  at: string;
  data?: Record<string, unknown>;
}

// Which query-key prefixes to refresh per event type. React Query matches by
// prefix, so ['orders'] also invalidates ['orders', params].
const INVALIDATIONS: Record<ServerEventType, string[][]> = {
  'order.status': [['orders'], ['order'], ['shipments'], ['report']],
  'inventory.atp': [['snapshots'], ['inbound'], ['outbox'], ['report']],
  'shipment.status': [['shipments'], ['orders'], ['order'], ['report']],
  heartbeat: [],
};

/**
 * Subscribe to the backend SSE stream and invalidate the affected React Query
 * caches when domain events arrive, so open views refresh live. EventSource
 * can't send headers, so tenant/apiKey go on the query string. It auto-
 * reconnects with backoff; we just rebuild it when credentials change.
 */
export function useRealtime(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const creds = getCredentials();
    if (!creds?.tenant && !creds?.apiKey) return;

    const url = new URL(`${BASE}/events/stream`);
    if (creds.tenant) url.searchParams.set('tenant', creds.tenant);
    if (creds.apiKey) url.searchParams.set('apiKey', creds.apiKey);

    const es = new EventSource(url.toString());
    es.onmessage = (ev) => {
      let evt: ServerEvent;
      try {
        evt = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return;
      }
      for (const queryKey of INVALIDATIONS[evt.type] ?? []) {
        void qc.invalidateQueries({ queryKey });
      }
    };
    // EventSource reconnects automatically on transient errors; nothing to do.
    return () => es.close();
  }, [qc]);
}
