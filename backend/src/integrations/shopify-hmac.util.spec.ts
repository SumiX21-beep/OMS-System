import { createHmac } from 'crypto';
import {
  verifyGenericHmac,
  verifyQueryHmac,
  verifyWebhookHmac,
} from './shopify-hmac.util';

const SECRET = 'testsecret123';
const sign = (body: string) =>
  createHmac('sha256', SECRET).update(body).digest('base64');

describe('verifyWebhookHmac', () => {
  it('accepts a correctly signed body', () => {
    const body = Buffer.from('{"id":1}', 'utf8');
    expect(verifyWebhookHmac(body, sign('{"id":1}'), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from('{"id":2}', 'utf8');
    expect(verifyWebhookHmac(tampered, sign('{"id":1}'), SECRET)).toBe(false);
  });

  it('rejects when the header is missing', () => {
    expect(verifyWebhookHmac(Buffer.from('x'), undefined, SECRET)).toBe(false);
  });

  it('rejects a signature of a different length without throwing', () => {
    expect(verifyWebhookHmac(Buffer.from('x'), 'short', SECRET)).toBe(false);
  });

  it('rejects with the wrong secret', () => {
    const body = Buffer.from('{"id":1}', 'utf8');
    expect(verifyWebhookHmac(body, sign('{"id":1}'), 'wrong')).toBe(false);
  });
});

describe('verifyQueryHmac (OAuth)', () => {
  const secret = 'appsecret';
  function signQuery(params: Record<string, string>): string {
    const msg = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return createHmac('sha256', secret).update(msg).digest('hex');
  }

  it('accepts a valid OAuth query', () => {
    const base = { shop: 'test.myshopify.com', code: 'abc', state: 'xyz' };
    const hmac = signQuery(base);
    expect(verifyQueryHmac({ ...base, hmac }, secret)).toBe(true);
  });

  it('rejects when a param is altered', () => {
    const base = { shop: 'test.myshopify.com', code: 'abc', state: 'xyz' };
    const hmac = signQuery(base);
    expect(verifyQueryHmac({ ...base, code: 'evil', hmac }, secret)).toBe(false);
  });

  it('rejects when hmac is absent', () => {
    expect(verifyQueryHmac({ shop: 'x' }, secret)).toBe(false);
  });
});

describe('verifyGenericHmac', () => {
  it('matches the webhook scheme (base64)', () => {
    const body = Buffer.from('payload', 'utf8');
    expect(verifyGenericHmac(body, sign('payload'), SECRET)).toBe(true);
    expect(verifyGenericHmac(body, sign('other'), SECRET)).toBe(false);
  });
});
