import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Button, Input, Label } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';

export function ReturnDialog({
  order,
  onClose,
}: {
  order: OrderDetail;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(order.lines.map((l) => [l.id, String(l.quantity)])),
  );

  const m = useMutation({
    mutationFn: () =>
      api.post('/returns', {
        orderId: order.id,
        reason: reason || undefined,
        lines: order.lines
          .map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id] ?? 0), restock: true }))
          .filter((l) => l.quantity > 0),
      }),
    onSuccess: () => {
      toast('Return created');
      qc.invalidateQueries({ queryKey: ['order', order.id] });
      qc.invalidateQueries({ queryKey: ['returns'] });
      onClose();
      nav('/returns');
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Create return (RMA)"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? 'Creating…' : 'Create RMA'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Reason</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="defective, unwanted…" />
        </div>
        <div className="space-y-2">
          <Label>Return quantities</Label>
          {order.lines.map((l) => (
            <div key={l.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1 font-mono text-xs">{l.skuId.slice(-8)}</span>
              <span className="text-slate-400">of {l.quantity}</span>
              <Input
                className="w-20"
                type="number"
                value={qty[l.id] ?? '0'}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">Received units are restocked to ATP.</p>
      </div>
    </Modal>
  );
}
