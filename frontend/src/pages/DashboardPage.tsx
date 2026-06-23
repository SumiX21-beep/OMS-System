import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErrorBox, KpiCard, Loading } from '@/components/common';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

interface OrdersReport {
  total: number;
  byStatus: Record<string, number>;
}
interface InventoryReport {
  totals: { onHand: number; reserved: number; allocated: number; available: number };
  lowStockCount: number;
  lowStock: { sku: string; location: string; available: number }[];
}
interface FulfillmentReport {
  fulfilledCount: number;
  avgFulfillmentHours: number;
}
interface SourcingReport {
  sourcedOrders: number;
  splitOrders: number;
  splitRate: number;
}

export function DashboardPage() {
  const orders = useQuery({
    queryKey: ['report', 'orders'],
    queryFn: () => api.get<OrdersReport>('/reports/orders'),
    refetchInterval: 15_000,
  });
  const inventory = useQuery({
    queryKey: ['report', 'inventory'],
    queryFn: () => api.get<InventoryReport>('/reports/inventory'),
    refetchInterval: 15_000,
  });
  const fulfillment = useQuery({
    queryKey: ['report', 'fulfillment'],
    queryFn: () => api.get<FulfillmentReport>('/reports/fulfillment'),
  });
  const sourcing = useQuery({
    queryKey: ['report', 'sourcing'],
    queryFn: () => api.get<SourcingReport>('/reports/sourcing'),
  });

  if (orders.isLoading || inventory.isLoading) return <Loading />;
  if (orders.error) return <ErrorBox error={orders.error} />;

  const statusData = Object.entries(orders.data?.byStatus ?? {}).map(
    ([status, count]) => ({ status, count }),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total orders" value={orders.data?.total ?? 0} />
        <KpiCard
          label="Network available"
          value={inventory.data?.totals.available ?? 0}
          hint={`${inventory.data?.totals.onHand ?? 0} on hand`}
        />
        <KpiCard
          label="Avg fulfilment"
          value={`${fulfillment.data?.avgFulfillmentHours ?? 0}h`}
          hint={`${fulfillment.data?.fulfilledCount ?? 0} shipped`}
        />
        <KpiCard
          label="Split-shipment rate"
          value={`${Math.round((sourcing.data?.splitRate ?? 0) * 100)}%`}
          hint={`${sourcing.data?.splitOrders ?? 0}/${sourcing.data?.sourcedOrders ?? 0} orders`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Orders by status" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 24% 17%)" vertical={false} />
                <XAxis
                  dataKey="status"
                  tick={{ fontSize: 11, fill: 'hsl(215 18% 60%)' }}
                  tickLine={{ stroke: 'hsl(220 24% 17%)' }}
                  axisLine={{ stroke: 'hsl(220 24% 17%)' }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'hsl(215 18% 60%)' }}
                  tickLine={{ stroke: 'hsl(220 24% 17%)' }}
                  axisLine={{ stroke: 'hsl(220 24% 17%)' }}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(239 84% 67% / 0.08)' }}
                  contentStyle={{
                    background: 'hsl(222 40% 8%)',
                    border: '1px solid hsl(220 24% 17%)',
                    borderRadius: 8,
                    color: 'hsl(210 40% 98%)',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'hsl(215 18% 60%)' }}
                />
                <Bar dataKey="count" fill="hsl(239 84% 67%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={`Low stock (${inventory.data?.lowStockCount ?? 0})`}
          />
          <Table>
            <THead cols={['SKU', 'Location', 'Available']} />
            <tbody>
              {(inventory.data?.lowStock ?? []).slice(0, 8).map((r, i) => (
                <TRow key={i}>
                  <TCell className="font-medium">{r.sku}</TCell>
                  <TCell>{r.location}</TCell>
                  <TCell className={r.available === 0 ? 'text-red-400' : ''}>
                    {r.available}
                  </TCell>
                </TRow>
              ))}
              {!inventory.data?.lowStock.length && (
                <TRow>
                  <TCell className="text-slate-400">All stock healthy</TCell>
                </TRow>
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      <div className="text-xs text-slate-400">
        Totals in units; currency values shown as {money(0)} elsewhere. Auto-refresh 15s.
      </div>
    </div>
  );
}
