import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button, Card, Input, Label } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';

/**
 * Sign-in for the console. The server (/auth/me) decides the role from the
 * presented credentials: dev mode (API AUTH_REQUIRED=false) returns ADMIN for a
 * valid tenant; with an API key the key's real role is used.
 */
export function LoginScreen() {
  const { signIn } = useAuth();
  const [tenant, setTenant] = useState('demo');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(tenant, apiKey || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-7 shadow-glow">
        <div className="mb-1 flex items-center gap-2.5 text-xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 ring-1 ring-inset ring-accent/30">
            <Building2 className="text-accent" size={20} />
          </span>
          OMS-omni
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Omnichannel Order &amp; Inventory Console
        </p>
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <Label>Tenant</Label>
            <Input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="demo" />
          </div>
          <div>
            <Label>API key (optional in dev)</Label>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="oms_..."
              type="password"
            />
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
