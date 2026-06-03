// Web Push utilities for Cloudflare Workers runtime.
// Implements VAPID JWT signing (ES256) and push payload encryption (RFC 8291)
// using only the Web Crypto API (crypto.subtle) — no Node.js crypto needed.
//
// Usage:
//   import { sendPushNotification } from './_push-utils.js';
//   await sendPushNotification(subscription, { title, body, url }, env);

// --- Base64URL helpers ---
function base64urlEncode(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function textEncode(str) {
  return new TextEncoder().encode(str);
}

function concatBuffers(...buffers) {
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    result.set(new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer || b), offset);
    offset += b.byteLength;
  }
  return result;
}

// --- VAPID JWT (ES256) ---
async function createVapidJwt(audience, subject, publicKeyB64, privateKeyB64) {
  // Import the VAPID private key as ECDSA P-256
  const privateKeyBytes = base64urlDecode(privateKeyB64);
  const publicKeyBytes = base64urlDecode(publicKeyB64);

  // Build the JWK from the raw key bytes
  // VAPID keys: public = 65 bytes (uncompressed point), private = 32 bytes (d)
  const x = base64urlEncode(publicKeyBytes.slice(1, 33));
  const y = base64urlEncode(publicKeyBytes.slice(33, 65));
  const d = base64urlEncode(privateKeyBytes);

  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x, y, d, ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  // JWT header + payload
  const header = base64urlEncode(textEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(textEncode(JSON.stringify({
    aud: audience,
    exp: now + 12 * 3600,
    sub: subject,
  })));
  const unsignedToken = `${header}.${payload}`;

  // Sign with ECDSA P-256
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    textEncode(unsignedToken)
  );

  // ECDSA signature from WebCrypto is DER-encoded; JWT needs raw r||s (64 bytes).
  const sigBytes = new Uint8Array(signature);
  let r, s;
  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  } else {
    // DER decode
    const derDecode = (der) => {
      let offset = 2; // skip SEQUENCE tag + length
      if (der[1] & 0x80) offset += (der[1] & 0x7f);
      // r
      const rLen = der[offset + 1];
      offset += 2;
      let rBytes = der.slice(offset, offset + rLen);
      if (rBytes.length > 32) rBytes = rBytes.slice(rBytes.length - 32);
      if (rBytes.length < 32) { const pad = new Uint8Array(32); pad.set(rBytes, 32 - rBytes.length); rBytes = pad; }
      offset += rLen;
      // s
      const sLen = der[offset + 1];
      offset += 2;
      let sBytes = der.slice(offset, offset + sLen);
      if (sBytes.length > 32) sBytes = sBytes.slice(sBytes.length - 32);
      if (sBytes.length < 32) { const pad = new Uint8Array(32); pad.set(sBytes, 32 - sBytes.length); sBytes = pad; }
      return { r: rBytes, s: sBytes };
    };
    const decoded = derDecode(sigBytes);
    r = decoded.r;
    s = decoded.s;
  }
  const rawSig = base64urlEncode(concatBuffers(r, s));
  return `${unsignedToken}.${rawSig}`;
}

// --- Push message encryption (RFC 8291 / aes128gcm) ---
async function encryptPayload(subscriptionKeys, payloadText) {
  const clientPublicKeyBytes = base64urlDecode(subscriptionKeys.p256dh);
  const authSecretBytes = base64urlDecode(subscriptionKeys.auth);

  // Generate ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, ['deriveBits']
  );
  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);

  // Import the subscription's public key
  const clientPublicKey = await crypto.subtle.importKey(
    'raw', clientPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  // ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    localKeyPair.privateKey, 256
  );

  // HKDF-based key derivation per RFC 8291
  const hkdfSalt = await crypto.subtle.importKey('raw', authSecretBytes, { name: 'HKDF' }, false, ['deriveBits']);
  const ikm = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(sharedSecret), info: textEncode('WebPush: info\0').buffer ? concatBuffers(textEncode('WebPush: info\0'), clientPublicKeyBytes, new Uint8Array(localPublicKeyRaw)) : concatBuffers(textEncode('WebPush: info\0'), clientPublicKeyBytes, new Uint8Array(localPublicKeyRaw)) },
    hkdfSalt, 256
  );

  const ikmKey = await crypto.subtle.importKey('raw', new Uint8Array(ikm), { name: 'HKDF' }, false, ['deriveBits']);

  // Salt for the content encryption
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive CEK (Content Encryption Key) and nonce
  const cekInfo = concatBuffers(textEncode('Content-Encoding: aes128gcm\0'));
  const nonceInfo = concatBuffers(textEncode('Content-Encoding: nonce\0'));

  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HKDF' }, false, ['deriveBits']);
  // Actually, for aes128gcm the PRK is derived from salt + IKM
  const prkBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: new Uint8Array(0) },
    ikmKey, 256
  );
  const prkKey = await crypto.subtle.importKey('raw', new Uint8Array(prkBits), { name: 'HKDF' }, false, ['deriveBits']);

  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: cekInfo },
    prkKey, 128
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: nonceInfo },
    prkKey, 96
  );

  // Encrypt with AES-128-GCM
  const cek = await crypto.subtle.importKey('raw', new Uint8Array(cekBits), { name: 'AES-GCM' }, false, ['encrypt']);
  const paddedPayload = concatBuffers(new Uint8Array([2]), textEncode(payloadText)); // 1-byte padding delimiter + payload
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonceBits), tagLength: 128 },
    cek, paddedPayload
  );

  // Build the aes128gcm content coding header:
  // salt (16) + record size (4, big-endian uint32) + key ID length (1) + key ID (65 = uncompressed point)
  const rs = new ArrayBuffer(4);
  new DataView(rs).setUint32(0, 4096, false); // record size
  const localPubBytes = new Uint8Array(localPublicKeyRaw);
  const header = concatBuffers(salt, new Uint8Array(rs), new Uint8Array([localPubBytes.length]), localPubBytes);

  return concatBuffers(header, new Uint8Array(encrypted));
}

// --- Send a push notification ---
export async function sendPushNotification(subscription, payload, env) {
  const payloadStr = JSON.stringify(payload);
  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin;

  // Create VAPID Authorization header
  const jwt = await createVapidJwt(
    audience,
    env.VAPID_SUBJECT || 'mailto:admin@example.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  const vapidPublicKeyBytes = base64urlDecode(env.VAPID_PUBLIC_KEY);
  const authHeader = `vapid t=${jwt}, k=${base64urlEncode(vapidPublicKeyBytes)}`;

  // Encrypt the payload
  const body = await encryptPayload(subscription.keys, payloadStr);

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'normal',
    },
    body: body,
  });

  return { status: resp.status, ok: resp.ok };
}
