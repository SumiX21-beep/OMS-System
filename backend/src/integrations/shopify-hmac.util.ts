import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a Shopify *webhook* delivery: base64(HMAC-SHA256(rawBody, secret))
 * compared constant-time with the X-Shopify-Hmac-Sha256 header. The raw,
 * unparsed body must be used or the digest won't match.
 */
export function verifyWebhookHmac(
  rawBody: Buffer,
  hmacHeader: string | undefined,
  secret: string,
): boolean {
  if (!hmacHeader || !secret) return false;
  const computed = createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(hmacHeader, 'utf8');
  // Length check first: timingSafeEqual throws on unequal lengths.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a Shopify *OAuth* request (install/callback). The hmac is hex over the
 * remaining query params, sorted and joined as key=value&… (the hmac param
 * itself removed). Distinct from the webhook scheme above.
 */
export function verifyQueryHmac(
  query: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const provided = query['hmac'];
  if (typeof provided !== 'string' || !secret) return false;

  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => {
      const v = query[k];
      return `${k}=${Array.isArray(v) ? v.join(',') : (v ?? '')}`;
    })
    .join('&');

  const computed = createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Generic signed-webhook check for non-Shopify channels: base64 HMAC-SHA256. */
export function verifyGenericHmac(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  return verifyWebhookHmac(rawBody, signature, secret);
}
