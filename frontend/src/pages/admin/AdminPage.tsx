import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { ErrorBox, Loading } from '@/components/common';
import { Badge, Button, Card, CardHeader, Input, Label, Select } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { relativeDate } from '@/lib/format';
import type { ApiKeyRow, ReconciliationReport, Role } from '@/lib/types';

export function AdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<ApiKeyRow[]>('/admin/api-keys'),
  });
  const [creating, setCreating] = useState(false);

  const setActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      api.patch(`/admin/api-keys/${v.id}`, { active: v.active }),
    onSuccess: () => {
      toast('Key updated');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>

      <Card>
        <CardHeader
          title="API keys"
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={15} /> Mint key
            </Button>
          }
        />
        {keys.isLoading ? (
          <Loading />
        ) : keys.error ? (
          <div className="p-4"><ErrorBox error={keys.error} /></div>
        ) : (
          <Table>
            <THead cols={['Name', 'Prefix', 'Role', 'Active', 'Last used', '']} />
            <tbody>
              {keys.data?.map((k) => (
                <TRow key={k.id}>
                  <TCell className="font-medium">{k.name}</TCell>
                  <TCell className="font-mono text-xs">{k.prefix}…</TCell>
                  <TCell>
                    <Badge className="bg-accent/10 text-accent">{k.role}</Badge>
                  </TCell>
                  <TCell>
                    <Badge className={k.active ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}>
                      {k.active ? 'active' : 'revoked'}
                    </Badge>
                  </TCell>
                  <TCell className="text-slate-400">
                    {k.lastUsedAt ? relativeDate(k.lastUsedAt) : 'never'}
                  </TCell>
                  <TCell>
                    <Button
                      size="sm"
                      variant={k.active ? 'danger' : 'outline'}
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: k.id, active: !k.active })}
                    >
                      {k.active ? 'Revoke' : 'Reactivate'}
                    </Button>
                  </TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ReconciliationCard />

      {creating && <MintKeyDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function ReconciliationCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const report = useQuery({
    queryKey: ['reconciliation'],
    queryFn: () => api.get<ReconciliationReport>('/admin/reconciliation'),
  });
  const repair = useMutation({
    mutationFn: () => api.post<ReconciliationReport>('/admin/reconciliation/repair'),
    onSuccess: (r) => {
      toast(`Repaired ${r.repaired} snapshot(s)`);
      qc.invalidateQueries({ queryKey: ['reconciliation'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <Card>
      <CardHeader
        title="Inventory reconciliation (ledger vs snapshot)"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => report.refetch()}>
              <RefreshCw size={14} /> Re-check
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={repair.isPending || (report.data?.drifted ?? 0) === 0}
              onClick={() => repair.mutate()}
            >
              Repair drift
            </Button>
          </div>
        }
      />
      <div className="p-4">
        {report.isLoading ? (
          <Loading />
        ) : report.error ? (
          <ErrorBox error={report.error} />
        ) : (
          <>
            <div className="mb-3 text-sm">
              Checked <b>{report.data?.checked}</b> snapshots ·{' '}
              <span className={report.data?.drifted ? 'text-red-400' : 'text-green-400'}>
                {report.data?.drifted} drifted
              </span>
            </div>
            {!!report.data?.entries.length && (
              <Table>
                <THead cols={['SKU', 'Location', 'Diff (needed)']} />
                <tbody>
                  {report.data.entries.map((e, i) => (
                    <TRow key={i}>
                      <TCell className="font-mono text-xs">{e.skuId.slice(-8)}</TCell>
                      <TCell className="font-mono text-xs">{e.locationId.slice(-8)}</TCell>
                      <TCell className="text-xs">{JSON.stringify(e.diff)}</TCell>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function MintKeyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('OPERATOR');
  const [secret, setSecret] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => api.post<{ secret: string }>('/admin/api-keys', { name, role }),
    onSuccess: (r) => {
      setSecret(r.secret);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Mint API key"
      footer={
        secret ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => m.mutate()} disabled={!name || m.isPending}>Create</Button>
          </>
        )
      }
    >
      {secret ? (
        <div className="space-y-2">
          <p className="text-sm">Copy this key now — it won't be shown again:</p>
          <code className="block break-all rounded-md bg-muted p-3 text-xs">{secret}</code>
        </div>
      ) : (
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="ADMIN">Admin</option>
              <option value="OPERATOR">Operator</option>
              <option value="READ_ONLY">Read only</option>
            </Select>
          </div>
        </div>
      )}
    </Modal>
  );
}
