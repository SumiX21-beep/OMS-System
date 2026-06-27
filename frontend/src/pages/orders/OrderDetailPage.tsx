import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  ErrorBox,
  Loading,
  OrderStatusBadge,
  PaymentStatusBadge,
  ShipmentStatusBadge,
} from '@/components/common';
import { RoleGate } from '@/auth/RoleGate';
import { Button, Card, CardHeader } from '@/components/ui/primitives';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { dateTime, money } from '@/lib/format';
import type { OrderDetail, Shipment } from '@/lib/types';
import { useAction, useOrder } from './order-hooks';
import { ReturnDialog } from './ReturnDialog';

function orderActions(o: OrderDetail): { label: string; path: string }[] {
  const id = o.id;
  switch (o.status) {
    case 'CREATED':
      return [
        { label: 'Validate', path: `/orders/${id}/validate` },
        { label: 'Reserve', path: `/orders/${id}/reserve` },
        { label: 'Cancel', path: `/orders/${id}/cancel` },
      ];
    case 'VALIDATED':
      return [
        { label: 'Source', path: `/orders/${id}/source` },
        { label: 'Cancel', path: `/orders/${id}/cancel` },
      ];
    case 'ALLOCATED':
      return [
        { label: 'Release', path: `/orders/${id}/release` },
        { label: 'Cancel', path: `/orders/${id}/cancel` },
      ];
    case 'RELEASED':
    case 'PICKED':
      return [{ label: 'Cancel', path: `/orders/${id}/cancel` }];
    default:
      return [];
  }
}

function shipmentActions(s: Shipment): { label: string; path: string }[] {
  const id = s.id;
  switch (s.status) {
    case 'PENDING':
      return [{ label: 'Pick', path: `/shipments/${id}/pick` }];
    case 'PICKED':
      return [
        { label: 'Dispatch', path: `/shipments/${id}/dispatch` },
        { label: 'Ship', path: `/shipments/${id}/ship` },
        { label: 'Ready (pickup)', path: `/shipments/${id}/ready` },
      ];
    case 'READY_FOR_PICKUP':
      return [{ label: 'Picked up', path: `/shipments/${id}/pickup` }];
    case 'SHIPPED':
      return [{ label: 'Deliver', path: `/shipments/${id}/deliver` }];
    default:
      return [];
  }
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const order = useOrder(id);
  const action = useAction(id);
  const [returning, setReturning] = useState(false);

  if (order.isLoading) return <Loading />;
  if (order.error) return <ErrorBox error={order.error} />;
  const o = order.data!;

  return (
    <div className="space-y-6">
      <button
        onClick={() => nav('/orders')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-200"
      >
        <ArrowLeft size={15} /> Orders
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{o.externalRef ?? o.id.slice(-8)}</h1>
          <OrderStatusBadge status={o.status} />
        </div>
        <RoleGate min="OPERATOR">
          <div className="flex gap-2">
            {orderActions(o).map((a) => (
              <Button
                key={a.label}
                size="sm"
                variant={a.label === 'Cancel' ? 'danger' : 'primary'}
                disabled={action.isPending}
                onClick={() => action.mutate(a)}
              >
                {a.label}
              </Button>
            ))}
            {o.status === 'DELIVERED' && (
              <Button size="sm" variant="outline" onClick={() => setReturning(true)}>
                Create return
              </Button>
            )}
          </div>
        </RoleGate>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 text-sm">
        <Card className="p-3">
          <div className="text-xs text-slate-400">Channel</div>
          <div className="font-medium">{o.channel}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-slate-400">Payment</div>
          <div className="mt-0.5">
            <PaymentStatusBadge status={o.paymentStatus} />
          </div>
          {o.paymentReference && (
            <div
              className="mt-1 truncate font-mono text-xs text-slate-500"
              title={o.paymentReference}
            >
              {o.paymentReference}
            </div>
          )}
        </Card>
        <Card className="p-3">
          <div className="text-xs text-slate-400">Tax</div>
          <div className="font-medium">{money(o.taxTotal, o.currency)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-slate-400">Created</div>
          <div className="font-medium">{dateTime(o.createdAt)}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Lines" />
          <Table>
            <THead cols={['SKU', 'Qty', 'Unit price']} />
            <tbody>
              {o.lines.map((l) => (
                <TRow key={l.id}>
                  <TCell className="font-mono text-xs">{l.skuId.slice(-8)}</TCell>
                  <TCell>{l.quantity}</TCell>
                  <TCell>{money(l.unitPrice, o.currency)}</TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Lifecycle" />
          <ol className="space-y-3 p-4">
            {o.events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <div className="mt-1 h-2 w-2 rounded-full bg-accent" />
                <div>
                  <div className="font-medium">{e.toStatus}</div>
                  <div className="text-xs text-slate-400">
                    {dateTime(e.createdAt)}
                    {e.note ? ` · ${e.note}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card>
        <CardHeader title={`Shipments (${o.shipments.length})`} />
        <Table>
          <THead cols={['Shipment', 'Type', 'Status', 'Items', 'Tracking', 'Actions']} />
          <tbody>
            {o.shipments.map((s) => (
              <TRow key={s.id}>
                <TCell className="font-mono text-xs">{s.id.slice(-8)}</TCell>
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
                      {shipmentActions(s).map((a) => (
                        <Button
                          key={a.label}
                          size="sm"
                          variant="outline"
                          disabled={action.isPending}
                          onClick={() => action.mutate(a)}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  </RoleGate>
                </TCell>
              </TRow>
            ))}
            {!o.shipments.length && (
              <TRow>
                <TCell className="text-slate-400">Not yet sourced</TCell>
              </TRow>
            )}
          </tbody>
        </Table>
      </Card>

      {returning && <ReturnDialog order={o} onClose={() => setReturning(false)} />}
    </div>
  );
}
