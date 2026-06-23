import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorBox, Loading } from '@/components/common';
import { RoleGate } from '@/auth/RoleGate';
import { Badge, Button, Card, CardHeader, Input, Label, Select } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { Page, SourcingRule } from '@/lib/types';

const STRATEGIES = ['BALANCED', 'NEAREST', 'PRIORITY', 'FEWEST_SPLITS'];
const CHANNELS = ['', 'WEB', 'POS', 'MARKETPLACE', 'PHONE', 'B2B'];

export function SourcingRulesPage() {
  const [edit, setEdit] = useState<SourcingRule | null | undefined>(undefined);
  const rules = useQuery({
    queryKey: ['sourcing-rules'],
    queryFn: () => api.get<Page<SourcingRule>>('/sourcing-rules', { pageSize: 100 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sourcing rules</h1>
        <RoleGate min="OPERATOR">
          <Button size="sm" onClick={() => setEdit(null)}>
            <Plus size={15} /> New rule
          </Button>
        </RoleGate>
      </div>

      <Card>
        <CardHeader title={`${rules.data?.total ?? 0} rules (evaluated by priority)`} />
        {rules.isLoading ? (
          <Loading />
        ) : rules.error ? (
          <div className="p-4"><ErrorBox error={rules.error} /></div>
        ) : (
          <Table>
            <THead cols={['Priority', 'Name', 'Strategy', 'Channel', 'Region', 'Split', 'Active', '']} />
            <tbody>
              {rules.data?.items.map((r) => (
                <TRow key={r.id}>
                  <TCell>{r.priority}</TCell>
                  <TCell className="font-medium">{r.name}</TCell>
                  <TCell>{r.strategy.replace(/_/g, ' ')}</TCell>
                  <TCell>{r.channel ?? 'any'}</TCell>
                  <TCell>{r.region ?? 'any'}</TCell>
                  <TCell>{r.allowSplit ? 'yes' : 'no'}</TCell>
                  <TCell>
                    <Badge className={r.active ? 'bg-green-500/15 text-green-300' : 'bg-slate-500/15 text-slate-500'}>
                      {r.active ? 'active' : 'inactive'}
                    </Badge>
                  </TCell>
                  <TCell>
                    <RoleGate min="OPERATOR">
                      <Button size="sm" variant="outline" onClick={() => setEdit(r)}>
                        Edit
                      </Button>
                    </RoleGate>
                  </TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {edit !== undefined && <RuleDialog existing={edit} onClose={() => setEdit(undefined)} />}
    </div>
  );
}

function RuleDialog({ existing, onClose }: { existing: SourcingRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [strategy, setStrategy] = useState<string>(existing?.strategy ?? 'BALANCED');
  const [channel, setChannel] = useState<string>(existing?.channel ?? '');
  const [region, setRegion] = useState<string>(existing?.region ?? '');
  const [priority, setPriority] = useState(String(existing?.priority ?? 100));
  const [allowSplit, setAllowSplit] = useState(existing?.allowSplit ?? true);
  const [active, setActive] = useState(existing?.active ?? true);

  const body = () => ({
    name,
    strategy,
    channel: channel || undefined,
    region: region || undefined,
    priority: Number(priority),
    allowSplit,
    active,
  });

  const m = useMutation({
    mutationFn: () =>
      existing
        ? api.patch(`/sourcing-rules/${existing.id}`, body())
        : api.post('/sourcing-rules', body()),
    onSuccess: () => {
      toast(existing ? 'Rule updated' : 'Rule created');
      qc.invalidateQueries({ queryKey: ['sourcing-rules'] });
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Edit "${existing.name}"` : 'New sourcing rule'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!name || m.isPending}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label>Strategy</Label>
          <Select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {STRATEGIES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Channel (optional)</Label>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c || 'any'}</option>)}
            </Select>
          </div>
          <div>
            <Label>Region (optional)</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Priority (lower evaluated first)</Label>
          <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allowSplit} onChange={(e) => setAllowSplit(e.target.checked)} />
          Allow split shipments
        </label>
        {existing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        )}
      </div>
    </Modal>
  );
}
