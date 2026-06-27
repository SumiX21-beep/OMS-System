import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button, Card, Input, Label } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';

type Mode = 'password' | 'apikey';

/**
 * Sign-in for the console. Two paths:
 *   • Email & password → a JWT session (POST /auth/login).
 *   • API key / dev    → tenant + optional key; the server (/auth/me) decides
 *     the role (dev mode returns ADMIN; a key uses the key's real role).
 */
export function LoginScreen() {
  const { signIn, signInWithPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('password');
  const [tenant, setTenant] = useState('demo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'password') {
        await signInWithPassword(tenant, email, password);
      } else {
        await signIn(tenant, apiKey || undefined);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setError(null);
      }}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        mode === m
          ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/30'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-7 shadow-glow">
        <div className="mb-1 flex items-center gap-2.5 text-xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 ring-1 ring-inset ring-accent/30">
            <Building2 className="text-accent" size={20} />
          </span>
          OMS-omni
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          Omnichannel Order &amp; Inventory Console
        </p>

        <div className="mb-5 flex gap-1 rounded-lg bg-muted/40 p-1">
          {tab('password', 'Email & password')}
          {tab('apikey', 'API key / dev')}
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <div>
            <Label>Tenant</Label>
            <Input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="demo" />
          </div>

          {mode === 'password' ? (
            <>
              <div>
                <Label>Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@demo.test"
                  type="email"
                  autoComplete="username"
                />
              </div>
              <div>
                <Label>Password</Label>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : (
            <div>
              <Label>API key (optional in dev)</Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="oms_..."
                type="password"
              />
            </div>
          )}

          {error && <div className="text-sm text-red-400">{error}</div>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
