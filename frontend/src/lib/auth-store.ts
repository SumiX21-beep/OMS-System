import type { Role } from './types';

export interface Credentials {
  tenant: string;
  apiKey?: string; // optional: dev mode uses x-tenant-id only
  role: Role;
}

const KEY = 'oms.credentials';
let current: Credentials | null = load();

function load(): Credentials | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

export function getCredentials(): Credentials | null {
  return current;
}

export function setCredentials(c: Credentials): void {
  current = c;
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function clearCredentials(): void {
  current = null;
  localStorage.removeItem(KEY);
}
