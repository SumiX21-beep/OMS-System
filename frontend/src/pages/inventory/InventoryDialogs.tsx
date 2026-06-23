import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Input, Label, Select } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useLocations, useSkus } from './catalog-hooks';

type Kind = 'receipt' | 'adjust' | 'inbound' | 'safety';

const TITLES: Record<Kind, string> = {
  receipt: 'Receive stock',
  adjust: 'Adjust stock',
  inbound: 'Create inbound',
  safety: 'Set safety stock',
};

function endpointFor(kind: Kind): string {
  return {
    receipt: '/inventory/receipts',
    adjust: '/inventory/adjustments',
    inbound: '/inventory/inbound',
    safety: '/inventory/safety-stock',
  }[kind];
}

export function InventoryActionModal({
  kind,
  onClose,
}: {
  kind: Kind | null;
  onClose: () => void;
}) {
  const skus = useSkus();
  const locations = useLocations();
  const toast = useToast();
  const qc = useQueryClient();

  const [skuId, setSkuId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [expectedAt, setExpectedAt] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const k = kind!;
      const body: Record<string, unknown> = { skuId, locationId };
      if (k === 'adjust') body.delta = Number(quantity);
      else if (k === 'safety') body.safetyStock = Number(quantity);
      else body.quantity = Number(quantity);
      if (k === 'inbound' && expectedAt)
        body.expectedAt = new Date(expectedAt).toISOString();
      return api.post(endpointFor(k), body);
    },
    onSuccess: () => {
      toast(`${TITLES[kind!]} done`);
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      qc.invalidateQueries({ queryKey: ['inbound'] });
      qc.invalidateQueries({ queryKey: ['report'] });
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  if (!kind) return null;
  const numberLabel =
    kind === 'adjust' ? 'Delta (+/-)' : kind === 'safety' ? 'Safety stock' : 'Quantity';

  return (
    <Modal
      open
      onClose={onClose}
      title={TITLES[kind]}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!skuId || !locationId || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>SKU</Label>
          <Select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            <option value="">Select SKU…</option>
            {skus.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Location</Label>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Select location…</option>
            {locations.data?.items.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{numberLabel}</Label>
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        {kind === 'inbound' && (
          <div>
            <Label>Expected at (ETA)</Label>
            <Input
              type="datetime-local"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

export function TransferDialog({ onClose }: { onClose: () => void }) {
  const skus = useSkus();
  const locations = useLocations();
  const toast = useToast();
  const qc = useQueryClient();
  const [skuId, setSkuId] = useState('');
  const [fromLocationId, setFrom] = useState('');
  const [toLocationId, setTo] = useState('');
  const [quantity, setQuantity] = useState('1');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/inventory/transfers', {
        skuId,
        fromLocationId,
        toLocationId,
        quantity: Number(quantity),
      }),
    onSuccess: () => {
      toast('Transfer complete');
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      qc.invalidateQueries({ queryKey: ['report'] });
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  const valid =
    skuId && fromLocationId && toLocationId && fromLocationId !== toLocationId;

  return (
    <Modal
      open
      onClose={onClose}
      title="Transfer stock"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? 'Transferring…' : 'Transfer'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>SKU</Label>
          <Select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            <option value="">Select SKU…</option>
            {skus.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>From</Label>
            <Select value={fromLocationId} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Source…</option>
              {locations.data?.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={toLocationId} onChange={(e) => setTo(e.target.value)}>
              <option value="">Destination…</option>
              {locations.data?.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label>Quantity</Label>
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
