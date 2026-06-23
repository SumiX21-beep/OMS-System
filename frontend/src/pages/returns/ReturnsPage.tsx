import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorBox, Loading } from '@/components/common';
import { RoleGate } from '@/auth/RoleGate';
import { Badge, Button, Card, CardHeader, Select } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { relativeDate } from '@/lib/format';
import type { Page, Rma } from '@/lib/types';

const STATUSES = ['REQUESTED', 'RECEIVED', 'COMPLETED', 'CANCELLED'];

const tone: Record<string, string> = {
  REQUESTED: 'bg-amber-500/15 text-amber-300',
  RECEIVED: 'bg-blue-500/15 text-blue-300',
  COMPLETED: 'bg-green-500/15 text-green-300',
  CANCELLED: 'bg-red-500/15 text-red-300',
};

export function ReturnsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const toast = useToast();

  const returns = useQuery({
    queryKey: ['returns', status, page],
    queryFn: () =>
      api.get<Page<Rma>>('/returns', { status: status || undefined, page, pageSize: 25 }),
  });

  const receive = useMutation({
    mutationFn: (id: string) => api.post(`/returns/${id}/receive`),
    onSuccess: () => {
      toast('Return received & restocked');
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['report'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Returns</h1>
      <Card>
        <CardHeader
          title={`${returns.data?.total ?? 0} RMAs`}
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
        {returns.isLoading ? (
          <Loading />
        ) : returns.error ? (
          <div className="p-4">
            <ErrorBox error={returns.error} />
          </div>
        ) : (
          <Table>
            <THead cols={['RMA', 'Order', 'Status', 'Lines', 'Reason', 'Created', '']} />
            <tbody>
              {returns.data?.items.map((r) => (
                <TRow key={r.id}>
                  <TCell className="font-medium">{r.rma}</TCell>
                  <TCell className="font-mono text-xs">{r.orderId.slice(-8)}</TCell>
                  <TCell>
                    <Badge className={tone[r.status] ?? 'bg-slate-500/15 text-slate-400'}>
                      {r.status}
                    </Badge>
                  </TCell>
                  <TCell>{r.lines.reduce((s, l) => s + l.quantity, 0)}</TCell>
                  <TCell className="text-slate-500">{r.reason ?? '—'}</TCell>
                  <TCell className="text-slate-400">{relativeDate(r.createdAt)}</TCell>
                  <TCell>
                    {r.status === 'REQUESTED' && (
                      <RoleGate min="OPERATOR">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={receive.isPending}
                          onClick={() => receive.mutate(r.id)}
                        >
                          Receive
                        </Button>
                      </RoleGate>
                    )}
                  </TCell>
                </TRow>
              ))}
              {!returns.data?.items.length && (
                <TRow>
                  <TCell className="text-slate-400">No returns</TCell>
                </TRow>
              )}
            </tbody>
          </Table>
        )}
        {returns.data && (
          <Pagination
            page={returns.data.page}
            pageCount={returns.data.pageCount}
            total={returns.data.total}
            onPage={setPage}
          />
        )}
      </Card>
    </div>
  );
}
