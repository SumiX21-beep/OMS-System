import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorBox, Loading, ShipmentStatusBadge } from '@/components/common';
import { RoleGate } from '@/auth/RoleGate';
import { Button, Card, CardHeader, Select } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { Page, Shipment, ShipmentStatus } from '@/lib/types';

const STATUSES: ShipmentStatus[] = [
  'PENDING', 'PICKED', 'READY_FOR_PICKUP', 'SHIPPED', 'PICKED_UP', 'DELIVERED', 'CANCELLED',
];

function actions(s: Shipment): { label: string; path: string }[] {
  const id = s.id;
  switch (s.status) {
    case 'PENDING':
      return [{ label: 'Pick', path: `/shipments/${id}/pick` }];
    case 'PICKED':
      return [
        { label: 'Dispatch', path: `/shipments/${id}/dispatch` },
        { label: 'Ship', path: `/shipments/${id}/ship` },
        { label: 'Ready', path: `/shipments/${id}/ready` },
      ];
    case 'READY_FOR_PICKUP':
      return [{ label: 'Picked up', path: `/shipments/${id}/pickup` }];
    case 'SHIPPED':
      return [{ label: 'Deliver', path: `/shipments/${id}/deliver` }];
    default:
      return [];
  }
}

export function FulfillmentPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const toast = useToast();

  const shipments = useQuery({
    queryKey: ['shipments', status, page],
    queryFn: () =>
      api.get<Page<Shipment>>('/shipments', {
        status: status || undefined,
        page,
        pageSize: 25,
      }),
    refetchInterval: 10_000,
  });

  const act = useMutation({
    mutationFn: (path: string) => api.post(path),
    onSuccess: () => {
      toast('Done');
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['report'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fulfilment</h1>
      <Card>
        <CardHeader
          title={`${shipments.data?.total ?? 0} shipments`}
          action={
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-44"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          }
        />
        {shipments.isLoading ? (
          <Loading />
        ) : shipments.error ? (
          <div className="p-4">
            <ErrorBox error={shipments.error} />
          </div>
        ) : (
          <Table>
            <THead cols={['Shipment', 'Location', 'Type', 'Status', 'Items', 'Tracking', 'Actions']} />
            <tbody>
              {shipments.data?.items.map((s) => (
                <TRow key={s.id}>
                  <TCell className="font-mono text-xs">{s.id.slice(-8)}</TCell>
                  <TCell>{s.location?.code ?? s.locationId.slice(-6)}</TCell>
                  <TCell>{s.fulfillmentType.replace(/_/g, ' ')}</TCell>
                  <TCell>
                    <ShipmentStatusBadge status={s.status} />
                  </TCell>
                  <TCell>
                    {(s.allocations ?? []).reduce((sum, a) => sum + a.quantity, 0)}
                  </TCell>
                  <TCell className="text-xs">{s.trackingNumber ?? '—'}</TCell>
                  <TCell>
                    <RoleGate min="OPERATOR">
                      <div className="flex gap-1">
                        {actions(s).map((a) => (
                          <Button
                            key={a.label}
                            size="sm"
                            variant="outline"
                            disabled={act.isPending}
                            onClick={() => act.mutate(a.path)}
                          >
                            {a.label}
                          </Button>
                        ))}
                      </div>
                    </RoleGate>
                  </TCell>
                </TRow>
              ))}
              {!shipments.data?.items.length && (
                <TRow>
                  <TCell className="text-slate-400">No shipments</TCell>
                </TRow>
              )}
            </tbody>
          </Table>
        )}
        {shipments.data && (
          <Pagination
            page={shipments.data.page}
            pageCount={shipments.data.pageCount}
            total={shipments.data.total}
            onPage={setPage}
          />
        )}
      </Card>
    </div>
  );
}
