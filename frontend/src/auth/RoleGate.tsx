import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { Role } from '@/lib/types';

const RANK: Record<Role, number> = { READ_ONLY: 0, OPERATOR: 1, ADMIN: 2 };

/** Renders children only if the current role meets the minimum required. */
export function RoleGate({
  min,
  children,
  fallback = null,
}: {
  min: Role;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { creds } = useAuth();
  const role = creds?.role ?? 'READ_ONLY';
  return RANK[role] >= RANK[min] ? <>{children}</> : <>{fallback}</>;
}

export function useCan(min: Role): boolean {
  const { creds } = useAuth();
  return RANK[creds?.role ?? 'READ_ONLY'] >= RANK[min];
}
