import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  ShoppingCart,
  Truck,
  Undo2,
  Plug,
  Tags,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  LogOut,
  Building2,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { cn } from '@/components/ui/cn';
import { Badge } from '@/components/ui/primitives';
import { useRealtime } from '@/lib/realtime';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: Boxes, end: false },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, end: false },
  { to: '/assistant', label: 'Assistant', icon: Sparkles, end: false },
  { to: '/fulfillment', label: 'Fulfilment', icon: Truck, end: false },
  { to: '/returns', label: 'Returns', icon: Undo2, end: false },
  { to: '/catalog', label: 'Catalog', icon: Tags, end: false },
  { to: '/sourcing-rules', label: 'Sourcing rules', icon: RouteIcon, end: false },
  { to: '/channels', label: 'Channels', icon: Plug, end: false },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, end: false },
];

export function AppShell() {
  const { creds, logout } = useAuth();
  useRealtime(); // live cache invalidation via SSE
  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2 px-5 py-4 text-lg font-bold">
          <Building2 className="text-accent" size={20} />
          OMS-omni
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-accent/10 text-accent' : 'text-slate-400 hover:bg-muted',
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-slate-400">
          OMS Operations Console
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="font-medium text-slate-300">Tenant:</span>
            {creds?.tenant}
            <Badge className="bg-accent/10 text-accent">{creds?.role}</Badge>
            <span
              className="flex items-center gap-1.5 text-xs text-slate-400"
              title="Live updates via server-sent events"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Live
            </span>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-200"
          >
            <LogOut size={16} /> Sign out
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                Loading…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
