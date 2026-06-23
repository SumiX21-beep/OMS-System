import type { ReactNode } from 'react';
import { Badge, Card, Spinner } from './ui/primitives';
import { orderTone, shipmentTone } from '@/lib/format';
import type { OrderStatus, ShipmentStatus } from '@/lib/types';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge className={orderTone(status)}>{status}</Badge>;
}

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  return <Badge className={shipmentTone(status)}>{status.replace(/_/g, ' ')}</Badge>;
}

export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="tnum mt-1.5 text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {message}
    </div>
  );
}
