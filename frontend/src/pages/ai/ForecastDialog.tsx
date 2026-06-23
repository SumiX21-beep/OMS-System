import { useQuery } from '@tanstack/react-query';
import { ErrorBox, Loading } from '@/components/common';
import { Badge } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api';
import type { Forecast } from '@/lib/types';

export function ForecastDialog({
  skuId,
  skuCode,
  onClose,
}: {
  skuId: string;
  skuCode: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['forecast', skuId],
    queryFn: () => api.get<Forecast>('/ai/forecast', { skuId, horizonDays: 14 }),
  });

  return (
    <Modal open onClose={onClose} title={`Demand forecast — ${skuCode}`}>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data ? (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Avg daily demand" value={`${q.data.avgDailyDemand}/day`} />
            <Metric label="Available now" value={q.data.available} />
            <Metric
              label="Days of cover"
              value={q.data.daysOfCover === null ? '∞' : `${q.data.daysOfCover}d`}
            />
            <Metric
              label={`Forecast (${q.data.horizonDays}d)`}
              value={`${q.data.forecastDemand} units`}
            />
          </div>
          <div className="rounded-md border border-border p-3">
            {q.data.reorderSuggested ? (
              <div className="flex items-center justify-between">
                <span className="font-medium text-amber-300">Reorder suggested</span>
                <Badge className="bg-amber-500/15 text-amber-300">
                  +{q.data.suggestedReorderQty} units
                </Badge>
              </div>
            ) : (
              <span className="text-green-300">Stock healthy — no reorder needed</span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Based on {q.data.totalShipped} units shipped over the last{' '}
            {q.data.lookbackDays} days (moving average from the inventory ledger).
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
