import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Envelope encryption for secrets at rest (channel access tokens, webhook
 * secrets). AES-256-GCM with a key derived from SECRET_ENCRYPTION_KEY.
 *
 * Stored format: `enc:v1:<base64(iv)>:<base64(tag)>:<base64(ciphertext)>`.
 * Decrypt is backward compatible — any value lacking the `enc:v1:` prefix is
 * assumed legacy plaintext and returned unchanged, so existing rows keep
 * working and get re-sealed the next time they are written.
 *
 * When SECRET_ENCRYPTION_KEY is unset (dev), encryption is a no-op pass-through
 * and a one-time warning is logged. Set a 32-byte key (hex/base64) in prod.
 */
@Injectable()
export class CryptoService {
  private readonly log = new Logger(CryptoService.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('SECRET_ENCRYPTION_KEY');
    this.key = raw ? this.deriveKey(raw) : null;
    if (!this.key) {
      this.log.warn(
        'SECRET_ENCRYPTION_KEY is not set — secrets are stored in PLAINTEXT. ' +
          'Set a 32-byte key (hex or base64) before production.',
      );
    }
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  /** Encrypt a plaintext string. Returns the value unchanged if no key is set. */
  encrypt(plaintext: string): string {
    if (!this.key || plaintext === '') return plaintext;
    if (plaintext.startsWith(PREFIX)) return plaintext; // already sealed
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return (
      PREFIX +
      [iv, tag, ct].map((b) => b.toString('base64')).join(':')
    );
  }

  /** Decrypt a sealed value. Legacy plaintext (no prefix) is returned as-is. */
  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) return value; // legacy plaintext
    if (!this.key) {
      throw new Error(
        'Found encrypted secret but SECRET_ENCRYPTION_KEY is not set',
      );
    }
    const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv(
      ALGO,
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Accept a 32-byte key as hex or base64; otherwise derive a stable 32-byte
   * key from the passphrase via SHA-256 so any non-empty value is usable.
   */
  private deriveKey(raw: string): Buffer {
    for (const enc of ['hex', 'base64'] as const) {
      try {
        const buf = Buffer.from(raw, enc);
        if (buf.length === 32) return buf;
      } catch {
        /* try next encoding */
      }
    }
    return createHash('sha256').update(raw, 'utf8').digest();
  }
}
