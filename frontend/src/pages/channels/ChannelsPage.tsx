import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { ErrorBox, Loading } from '@/components/common';
import { useAuth } from '@/auth/AuthContext';
import { RoleGate } from '@/auth/RoleGate';
import { Badge, Button, Card, CardHeader, Input, Label, Select } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { relativeDate } from '@/lib/format';
import type { Channel, Page, ShopifyImportResult } from '@/lib/types';

interface OutboxEvent {
  id: string;
  seq: string;
  type: string;
  subjectId: string;
  status: string;
  attempts: number;
  createdAt: string;
}

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TYPES = ['SHOPIFY', 'MARKETPLACE', 'POS', 'OTHER'];

export function ChannelsPage() {
  const { creds } = useAuth();
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState('');

  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<Channel[]>('/channels'),
  });
  const qc = useQueryClient();
  const toast = useToast();
  const importShopify = useMutation({
    mutationFn: (channelId: string) =>
      api.post<ShopifyImportResult>(`/channels/${channelId}/import-shopify`),
    onSuccess: (r) => {
      toast(
        `Imported ${r.skusImported} SKU(s), ${r.inventoryLevelsImported} inventory level(s)`,
      );
      qc.invalidateQueries({ queryKey: ['channels'] });
      qc.invalidateQueries({ queryKey: ['skus'] });
      qc.invalidateQueries({ queryKey: ['locations'] });
      qc.invalidateQueries({ queryKey: ['snapshots'] });
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Import failed', 'error'),
  });

  const connectShopify = () => {
    if (!shop) return;
    const url = `${API}/oauth/shopify/install?shop=${encodeURIComponent(shop)}&tenant=${encodeURIComponent(creds?.tenant ?? '')}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Channels</h1>
        <RoleGate min="ADMIN">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus size={15} /> Add channel
          </Button>
        </RoleGate>
      </div>

      <RoleGate min="ADMIN">
        <Card className="p-4">
          <Label>Connect a Shopify store (OAuth)</Label>
          <div className="flex gap-2">
            <Input
              placeholder="your-store.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.target.value)}
            />
            <Button variant="outline" onClick={connectShopify} disabled={!shop}>
              <ExternalLink size={15} /> Connect
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Opens Shopify's consent screen; on approval the store is linked to tenant{' '}
            <b>{creds?.tenant}</b>. Requires SHOPIFY_API_KEY configured on the API.
          </p>
        </Card>
      </RoleGate>

      <Card>
        <CardHeader title={`${channels.data?.length ?? 0} channels`} />
        {channels.isLoading ? (
          <Loading />
        ) : channels.error ? (
          <div className="p-4"><ErrorBox error={channels.error} /></div>
        ) : (
          <Table>
            <THead cols={['Name', 'Type', 'External ref', 'Active', 'Actions']} />
            <tbody>
              {channels.data?.map((c) => (
                <TRow key={c.id}>
                  <TCell className="font-medium">{c.name}</TCell>
                  <TCell>{c.type}</TCell>
                  <TCell className="text-xs">{c.externalRef ?? '—'}</TCell>
                  <TCell>
                    <Badge className={c.active ? 'bg-green-500/15 text-green-300' : 'bg-slate-500/15 text-slate-500'}>
                      {c.active ? 'active' : 'inactive'}
                    </Badge>
                  </TCell>
                  <TCell>
                    {c.type === 'SHOPIFY' && c.externalRef ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={importShopify.isPending}
                        onClick={() => importShopify.mutate(c.id)}
                      >
                        <Download size={14} /> Import
                      </Button>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </TCell>
                </TRow>
              ))}
              {!channels.data?.length && (
                <TRow><TCell className="text-slate-400">No channels yet</TCell></TRow>
              )}
            </tbody>
          </Table>
        )}
      </Card>

      <OutboxCard />

      {open && <ChannelDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function OutboxCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const outbox = useQuery({
    queryKey: ['outbox'],
    queryFn: () => api.get<Page<OutboxEvent>>('/sync/outbox', { pageSize: 10 }),
    refetchInterval: 10_000,
  });
  const drain = useMutation({
    mutationFn: () => api.post<{ published: number }>('/sync/drain'),
    onSuccess: (r) => {
      toast(`Drained ${r.published} event(s)`);
      qc.invalidateQueries({ queryKey: ['outbox'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  const pending = outbox.data?.items.filter((e) => e.status === 'PENDING').length ?? 0;

  return (
    <Card>
      <CardHeader
        title={`Sync outbox${pending ? ` · ${pending} pending (shown)` : ''}`}
        action={
          <RoleGate min="OPERATOR">
            <Button size="sm" variant="outline" disabled={drain.isPending} onClick={() => drain.mutate()}>
              <RefreshCw size={14} /> Drain now
            </Button>
          </RoleGate>
        }
      />
      {outbox.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <THead cols={['Seq', 'Type', 'Subject', 'Status', 'Attempts', 'Created']} />
          <tbody>
            {outbox.data?.items.map((e) => (
              <TRow key={e.id}>
                <TCell className="font-mono text-xs">{e.seq}</TCell>
                <TCell>{e.type.replace(/_/g, ' ')}</TCell>
                <TCell className="font-mono text-xs">{e.subjectId.slice(-8)}</TCell>
                <TCell>
                  <Badge
                    className={
                      e.status === 'PUBLISHED'
                        ? 'bg-green-500/15 text-green-300'
                        : e.status === 'FAILED'
                          ? 'bg-red-500/15 text-red-300'
                          : 'bg-amber-500/15 text-amber-300'
                    }
                  >
                    {e.status}
                  </Badge>
                </TCell>
                <TCell>{e.attempts}</TCell>
                <TCell className="text-slate-400">{relativeDate(e.createdAt)}</TCell>
              </TRow>
            ))}
            {!outbox.data?.items.length && (
              <TRow>
                <TCell className="text-slate-400">Outbox empty</TCell>
              </TRow>
            )}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function ChannelDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState('MARKETPLACE');
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/channels', { type, name }),
    onSuccess: () => {
      toast('Channel added');
      qc.invalidateQueries({ queryKey: ['channels'] });
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add channel"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!name || m.isPending}>Create</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Type</Label>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </div>
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
