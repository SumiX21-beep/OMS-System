import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Plus,
  PackagePlus,
  SlidersHorizontal,
  ShieldCheck,
  ArrowLeftRight,
} from 'lucide-react';
import { LineChart } from 'lucide-react';
import { ErrorBox, Loading } from '@/components/common';
import { RoleGate } from '@/auth/RoleGate';
import { Button, Card, CardHeader, Input } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { relativeDate } from '@/lib/format';
import type { Inbound, Page, SnapshotRow } from '@/lib/types';
import { InventoryActionModal, TransferDialog } from './InventoryDialogs';
import { ForecastDialog } from '@/pages/ai/ForecastDialog';

type Kind = 'receipt' | 'adjust' | 'inbound' | 'safety';

export function InventoryPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Kind | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [forecast, setForecast] = useState<{ skuId: string; skuCode: string } | null>(null);

  const snapshots = useQuery({
    queryKey: ['snapshots', search, page],
    queryFn: () =>
      api.get<Page<SnapshotRow>>('/inventory/snapshots', {
        search,
        page,
        pageSize: 25,
      }),
  });
  const inbound = useQuery({
    queryKey: ['inbound'],
    queryFn: () =>
      api.get<Page<Inbound>>('/inventory/inbound', { status: 'EXPECTED', pageSize: 50 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <RoleGate min="OPERATOR">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setModal('receipt')}>
              <Plus size={15} /> Receive
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModal('adjust')}>
              <SlidersHorizontal size={15} /> Adjust
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModal('inbound')}>
              <PackagePlus size={15} /> Inbound
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModal('safety')}>
              <ShieldCheck size={15} /> Safety
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight size={15} /> Transfer
            </Button>
          </div>
        </RoleGate>
      </div>

      <Card>
        <CardHeader
          title="Stock by SKU / location"
          action={
            <Input
              placeholder="Search SKU…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-48"
            />
          }
        />
        {snapshots.isLoading ? (
          <Loading />
        ) : snapshots.error ? (
          <div className="p-4">
            <ErrorBox error={snapshots.error} />
          </div>
        ) : (
          <Table>
            <THead
              cols={['SKU', 'Location', 'On hand', 'Reserved', 'Allocated', 'In transit', 'Safety', 'Available', '']}
            />
            <tbody>
              {snapshots.data?.items.map((s) => (
                <TRow key={s.id}>
                  <TCell className="font-medium">{s.sku.code}</TCell>
                  <TCell>{s.location.code}</TCell>
                  <TCell>{s.onHand}</TCell>
                  <TCell>{s.reserved}</TCell>
                  <TCell>{s.allocated}</TCell>
                  <TCell>{s.inTransit}</TCell>
                  <TCell>{s.safetyStock}</TCell>
                  <TCell
                    className={
                      s.available === 0 ? 'font-semibold text-red-400' : 'font-semibold'
                    }
                  >
                    {s.available}
                  </TCell>
                  <TCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setForecast({ skuId: s.skuId, skuCode: s.sku.code })}
                      title="Demand forecast"
                    >
                      <LineChart size={15} />
                    </Button>
                  </TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
        {snapshots.data && (
          <Pagination
            page={snapshots.data.page}
            pageCount={snapshots.data.pageCount}
            total={snapshots.data.total}
            onPage={setPage}
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Expected inbound" />
        <Table>
          <THead cols={['SKU', 'Location', 'Qty', 'Received', 'ETA', 'Status']} />
          <tbody>
            {inbound.data?.items.map((i) => (
              <TRow key={i.id}>
                <TCell className="font-medium">{i.sku?.code ?? i.skuId}</TCell>
                <TCell>{i.location?.code ?? i.locationId}</TCell>
                <TCell>{i.quantity}</TCell>
                <TCell>{i.receivedQty}</TCell>
                <TCell>{relativeDate(i.expectedAt)}</TCell>
                <TCell>{i.status}</TCell>
              </TRow>
            ))}
            {!inbound.data?.items.length && (
              <TRow>
                <TCell className="text-slate-400">No expected inbound</TCell>
              </TRow>
            )}
          </tbody>
        </Table>
      </Card>

      <InventoryActionModal kind={modal} onClose={() => setModal(null)} />
      {transferOpen && <TransferDialog onClose={() => setTransferOpen(false)} />}
      {forecast && (
        <ForecastDialog
          skuId={forecast.skuId}
          skuCode={forecast.skuCode}
          onClose={() => setForecast(null)}
        />
      )}
    </div>
  );
}
