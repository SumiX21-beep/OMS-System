import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Input, Label, Select } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';
import { useSkus } from '@/pages/inventory/catalog-hooks';

interface Line {
  skuId: string;
  quantity: string;
  unitPrice: string;
}

export function CreateOrderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const skus = useSkus();
  const toast = useToast();
  const qc = useQueryClient();
  const [channel, setChannel] = useState('WEB');
  const [externalRef, setExternalRef] = useState('');
  const [reserveOnCreate, setReserve] = useState(true);
  const [lines, setLines] = useState<Line[]>([{ skuId: '', quantity: '1', unitPrice: '0' }]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<OrderDetail>('/orders', {
        channel,
        externalRef: externalRef || undefined,
        reserveOnCreate,
        lines: lines
          .filter((l) => l.skuId)
          .map((l) => ({
            skuId: l.skuId,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
          })),
      }),
    onSuccess: (order) => {
      toast('Order created');
      qc.invalidateQueries({ queryKey: ['orders'] });
      onCreated(order.id);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New order"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !lines.some((l) => l.skuId)}
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Channel</Label>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {['WEB', 'POS', 'MARKETPLACE', 'PHONE', 'B2B'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>External ref</Label>
            <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reserveOnCreate}
            onChange={(e) => setReserve(e.target.checked)}
          />
          Reserve stock on create
        </label>

        <div className="space-y-2">
          <Label>Lines</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Select value={l.skuId} onChange={(e) => setLine(i, { skuId: e.target.value })}>
                  <option value="">SKU…</option>
                  {skus.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                className="w-20"
                type="number"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
                placeholder="Qty"
              />
              <Input
                className="w-24"
                type="number"
                value={l.unitPrice}
                onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                placeholder="Price ¢"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((ls) => [...ls, { skuId: '', quantity: '1', unitPrice: '0' }])
            }
          >
            Add line
          </Button>
        </div>
      </div>
    </Modal>
  );
}
