import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const svcWith = (key?: string) =>
  new CryptoService({
    get: (k: string) => (k === 'SECRET_ENCRYPTION_KEY' ? key : undefined),
  } as unknown as ConfigService);

describe('CryptoService', () => {
  it('round-trips a secret with a configured key', () => {
    const svc = svcWith('test-passphrase-for-aes');
    const sealed = svc.encrypt('shpat_supersecret');
    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain('shpat_supersecret');
    expect(svc.decrypt(sealed)).toBe('shpat_supersecret');
  });

  it('produces a fresh IV each call (ciphertexts differ)', () => {
    const svc = svcWith('test-passphrase-for-aes');
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('treats legacy plaintext (no prefix) as-is on decrypt', () => {
    const svc = svcWith('test-passphrase-for-aes');
    expect(svc.decrypt('legacy-plain-token')).toBe('legacy-plain-token');
  });

  it('is a no-op pass-through when no key is configured', () => {
    const svc = svcWith(undefined);
    expect(svc.enabled).toBe(false);
    expect(svc.encrypt('tok')).toBe('tok');
    expect(svc.decrypt('tok')).toBe('tok');
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const svc = svcWith('test-passphrase-for-aes');
    const sealed = svc.encrypt('secret');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('accepts a 32-byte base64 key directly', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const svc = svcWith(key);
    expect(svc.decrypt(svc.encrypt('x'))).toBe('x');
  });
});
