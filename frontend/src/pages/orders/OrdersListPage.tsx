import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { ErrorBox, Loading, OrderStatusBadge } from '@/components/common';
import { RoleGate } from '@/auth/RoleGate';
import { Button, Card, CardHeader, Input, Select } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { money, relativeDate } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';
import { useOrders } from './order-hooks';
import { CreateOrderDialog } from './CreateOrderDialog';

const STATUSES: OrderStatus[] = [
  'CREATED', 'VALIDATED', 'ALLOCATED', 'RELEASED', 'PICKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED',
];

export function OrdersListPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const orders = useOrders({
    status: status || undefined,
    search: search || undefined,
    page,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Orders</h1>
        <RoleGate min="OPERATOR">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={15} /> New order
          </Button>
        </RoleGate>
      </div>

      <Card>
        <CardHeader
          title={`${orders.data?.total ?? 0} orders`}
          action={
            <div className="flex gap-2">
              <Input
                placeholder="Search ref…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-44"
              />
              <Select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="w-40"
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
          }
        />
        {orders.isLoading ? (
          <Loading />
        ) : orders.error ? (
          <div className="p-4">
            <ErrorBox error={orders.error} />
          </div>
        ) : (
          <Table>
            <THead cols={['Ref', 'Channel', 'Status', 'Lines', 'Shipments', 'Tax', 'Created']} />
            <tbody>
              {orders.data?.items.map((o) => (
                <TRow key={o.id}>
                  <TCell className="cursor-pointer font-medium text-accent" >
                    <button onClick={() => nav(`/orders/${o.id}`)}>
                      {o.externalRef ?? o.id.slice(-8)}
                    </button>
                  </TCell>
                  <TCell>{o.channel}</TCell>
                  <TCell>
                    <OrderStatusBadge status={o.status} />
                  </TCell>
                  <TCell>{o.lines.length}</TCell>
                  <TCell>{o._count?.shipments ?? 0}</TCell>
                  <TCell>{money(o.taxTotal)}</TCell>
                  <TCell className="text-slate-400">{relativeDate(o.createdAt)}</TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
        {orders.data && (
          <Pagination
            page={orders.data.page}
            pageCount={orders.data.pageCount}
            total={orders.data.total}
            onPage={setPage}
          />
        )}
      </Card>

      <CreateOrderDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          nav(`/orders/${id}`);
        }}
      />
    </div>
  );
}
