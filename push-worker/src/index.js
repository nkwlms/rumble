// Rumble push notification worker
// Handles VAPID JWT signing and RFC 8291 (aes128gcm) Web Push encryption.
// Deploy with: cd push-worker && wrangler deploy
// Set secret: wrangler secret put VAPID_PRIVATE_KEY_JWK

const VAPID_SUBJECT = 'mailto:rumble-push@example.com';

// ── Helpers ───────────────────────────────────────────────────────────────────

function base64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBytes(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
  return new Uint8Array([...atob(padded)].map(c => c.charCodeAt(0)));
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a instanceof Uint8Array ? a : new Uint8Array(a), off);
    off += a.byteLength;
  }
  return out;
}

// ── VAPID JWT (ES256) ─────────────────────────────────────────────────────────

async function buildVapidJwt(audience, privateKeyJwkStr) {
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: VAPID_SUBJECT,
  })));

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(privateKeyJwkStr),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${base64url(sig)}`;
}

// ── RFC 8291 aes128gcm payload encryption ────────────────────────────────────

async function encryptPayload(payloadStr, subscription) {
  const enc = new TextEncoder();
  const p256dh = base64urlToBytes(subscription.keys.p256dh);
  const auth   = base64urlToBytes(subscription.keys.auth);

  // Server ephemeral ECDH key pair
  const serverPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const serverPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverPair.publicKey),
  );

  // ECDH shared secret
  const receiverKey = await crypto.subtle.importKey(
    'raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey }, serverPair.privateKey, 256,
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Phase 1: extract IKM (HKDF with auth as salt)
  const sharedKey = await crypto.subtle.importKey(
    'raw', sharedSecret, 'HKDF', false, ['deriveBits'],
  );
  const info1 = concat(enc.encode('WebPush: info\0'), p256dh, serverPubRaw);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: auth, info: info1 }, sharedKey, 256,
  ));

  // Phase 2: derive CEK and nonce (HKDF with random salt)
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const cek = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\0') },
    ikmKey, 128,
  ));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\0') },
    ikmKey, 96,
  ));

  // Encrypt (payload + 0x02 padding delimiter)
  const plaintext = concat(enc.encode(payloadStr), new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext),
  );

  // aes128gcm header: salt (16) | rs (4) | idlen (1) | server public key (65)
  const hdr = new Uint8Array(86);
  hdr.set(salt, 0);
  new DataView(hdr.buffer).setUint32(16, 4096, false);
  hdr[20] = 65;
  hdr.set(serverPubRaw, 21);

  return concat(hdr, ciphertext);
}

// ── Request handler ───────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    const { subscription, title, message, gameId } = body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return new Response('Invalid subscription', { status: 400 });
    }

    try {
      const payload = JSON.stringify({ title, body: message, gameId });
      const encrypted = await encryptPayload(payload, subscription);

      const audience = new URL(subscription.endpoint).origin;
      const jwt = await buildVapidJwt(audience, env.VAPID_PRIVATE_KEY_JWK);

      const pushRes = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'TTL': '86400',
        },
        body: encrypted,
      });

      return new Response(
        JSON.stringify({ ok: pushRes.ok, status: pushRes.status }),
        { headers: { 'Content-Type': 'application/json', ...CORS } },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: err.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } },
      );
    }
  },
};
