import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorBox, Loading } from '@/components/common';
import { RoleGate } from '@/auth/RoleGate';
import { Badge, Button, Card, CardHeader, Input, Label, Select } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { Table, TCell, THead, TRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { Location, Sku } from '@/lib/types';
import { useLocations, useSkus } from '@/pages/inventory/catalog-hooks';

const LOCATION_TYPES = ['WAREHOUSE', 'STORE', 'THIRD_PARTY_LOGISTICS', 'DROP_SHIP_VENDOR'];

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge className={active ? 'bg-green-500/15 text-green-300' : 'bg-slate-500/15 text-slate-500'}>
      {active ? 'active' : 'inactive'}
    </Badge>
  );
}

export function CatalogPage() {
  const skus = useSkus();
  const locations = useLocations();
  const [skuEdit, setSkuEdit] = useState<Sku | null | undefined>(undefined); // undefined=closed, null=new
  const [locEdit, setLocEdit] = useState<Location | null | undefined>(undefined);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Catalog</h1>

      <Card>
        <CardHeader
          title={`SKUs (${skus.data?.total ?? 0})`}
          action={
            <RoleGate min="OPERATOR">
              <Button size="sm" onClick={() => setSkuEdit(null)}>
                <Plus size={15} /> New SKU
              </Button>
            </RoleGate>
          }
        />
        {skus.isLoading ? (
          <Loading />
        ) : skus.error ? (
          <div className="p-4"><ErrorBox error={skus.error} /></div>
        ) : (
          <Table>
            <THead cols={['Code', 'Name', 'Active', '']} />
            <tbody>
              {skus.data?.items.map((s) => (
                <TRow key={s.id}>
                  <TCell className="font-medium">{s.code}</TCell>
                  <TCell>{s.name}</TCell>
                  <TCell><ActiveBadge active={s.active} /></TCell>
                  <TCell>
                    <RoleGate min="OPERATOR">
                      <Button size="sm" variant="outline" onClick={() => setSkuEdit(s)}>
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

      <Card>
        <CardHeader
          title={`Locations (${locations.data?.total ?? 0})`}
          action={
            <RoleGate min="OPERATOR">
              <Button size="sm" onClick={() => setLocEdit(null)}>
                <Plus size={15} /> New location
              </Button>
            </RoleGate>
          }
        />
        {locations.isLoading ? (
          <Loading />
        ) : (
          <Table>
            <THead cols={['Code', 'Name', 'Type', 'Priority', 'Active', '']} />
            <tbody>
              {locations.data?.items.map((l) => (
                <TRow key={l.id}>
                  <TCell className="font-medium">{l.code}</TCell>
                  <TCell>{l.name}</TCell>
                  <TCell>{l.type.replace(/_/g, ' ')}</TCell>
                  <TCell>{l.fulfillmentPriority}</TCell>
                  <TCell><ActiveBadge active={l.active} /></TCell>
                  <TCell>
                    <RoleGate min="OPERATOR">
                      <Button size="sm" variant="outline" onClick={() => setLocEdit(l)}>
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

      {skuEdit !== undefined && (
        <SkuDialog existing={skuEdit} onClose={() => setSkuEdit(undefined)} />
      )}
      {locEdit !== undefined && (
        <LocationDialog existing={locEdit} onClose={() => setLocEdit(undefined)} />
      )}
    </div>
  );
}

function SkuDialog({ existing, onClose }: { existing: Sku | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [active, setActive] = useState(existing?.active ?? true);

  const m = useMutation({
    mutationFn: () =>
      existing
        ? api.patch(`/skus/${existing.id}`, { name, active })
        : api.post('/skus', { code, name }),
    onSuccess: () => {
      toast(existing ? 'SKU updated' : 'SKU created');
      qc.invalidateQueries({ queryKey: ['skus'] });
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Edit ${existing.code}` : 'New SKU'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!code || !name || m.isPending}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!existing} />
        </div>
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
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

function LocationDialog({ existing, onClose }: { existing: Location | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState(existing?.type ?? 'WAREHOUSE');
  const [priority, setPriority] = useState(String(existing?.fulfillmentPriority ?? 100));
  const [active, setActive] = useState(existing?.active ?? true);

  const m = useMutation({
    mutationFn: () =>
      existing
        ? api.patch(`/locations/${existing.id}`, {
            name,
            fulfillmentPriority: Number(priority),
            active,
          })
        : api.post('/locations', { code, name, type, fulfillmentPriority: Number(priority) }),
    onSuccess: () => {
      toast(existing ? 'Location updated' : 'Location created');
      qc.invalidateQueries({ queryKey: ['locations'] });
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Edit ${existing.code}` : 'New location'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!code || !name || m.isPending}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!existing} />
        </div>
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label>Type</Label>
          <Select value={type} onChange={(e) => setType(e.target.value)} disabled={!!existing}>
            {LOCATION_TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </div>
        <div>
          <Label>Fulfilment priority (lower = preferred)</Label>
          <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
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
