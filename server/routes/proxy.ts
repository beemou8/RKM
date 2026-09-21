import crypto from 'crypto';
import { Router } from 'express';

// ============================================================
// Secure PostgREST relay.
// Mount point: /api/relay
// Client base URL: https://domain-relay/api/relay
// Client requests: /api/relay/rest/v1/<table>?...
// ============================================================

export const proxyRouter = Router();

function normalizeBaseUrl(value: string): string {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Gunakan nama ORIGIN pada server relay agar tidak tertukar dengan SUPABASE_RELAY_URL.
// Fallback SUPABASE_URL/SUPABASE_KEY dipertahankan untuk kompatibilitas config lama.
const ORIGIN_URL = normalizeBaseUrl(process.env.SUPABASE_ORIGIN_URL || process.env.SUPABASE_URL || '');
const ORIGIN_KEY = process.env.SUPABASE_ORIGIN_KEY || process.env.SUPABASE_KEY || '';
const RELAY_SHARED_SECRET = process.env.RELAY_SHARED_SECRET || '';
const RELAY_TIMEOUT_MS = Math.max(2_000, parseInt(process.env.RELAY_TIMEOUT_MS || '15000', 10) || 15_000);
const RELAY_GET_CACHE_TTL_MS = Math.max(0, parseInt(process.env.RELAY_GET_CACHE_TTL_MS || '5000', 10) || 5_000);
const relayGetCache = new Map<string, { expiresAt: number; status: number; headers: Record<string, string>; body: string }>();

interface TokenInfo {
  label: string;
  cabang: string | null;
}

// Legacy per-branch token masih didukung sebagai alternatif shared secret.
const PROXY_TOKENS: Record<string, TokenInfo> = {};
(process.env.PROXY_TOKENS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .forEach((entry) => {
    const [token, label, cabang] = entry.split(':');
    if (token) PROXY_TOKENS[token] = { label: label || token, cabang: cabang || null };
  });

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function enabled(): boolean {
  return !!ORIGIN_URL && !!ORIGIN_KEY && (!!RELAY_SHARED_SECRET || Object.keys(PROXY_TOKENS).length > 0);
}

proxyRouter.use((req, res, next) => {
  if (!enabled()) {
    res.status(503).json({ error: 'Relay belum dikonfigurasi: set SUPABASE_ORIGIN_URL, SUPABASE_ORIGIN_KEY, dan RELAY_SHARED_SECRET.' });
    return;
  }

  const shared = String(req.header('x-rkm-relay-secret') || '');
  if (RELAY_SHARED_SECRET && shared && safeEqual(shared, RELAY_SHARED_SECRET)) {
    next();
    return;
  }

  const auth = String(req.header('authorization') || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token && PROXY_TOKENS[token]) {
    next();
    return;
  }

  res.status(403).json({ error: 'Relay secret/token tidak valid.' });
});

proxyRouter.get('/whoami', (req, res) => {
  const auth = String(req.header('authorization') || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const info = token ? PROXY_TOKENS[token] : undefined;
  res.json({ relay: true, label: info?.label || 'shared-secret', cabang: info?.cabang || null });
});

proxyRouter.all('/rest/v1/*', async (req, res) => {
  const target = req.url.replace(/^\/rest\/v1\//, '');
  const pathOnly = target.split('?')[0] || '';
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(pathOnly);
  } catch {
    res.status(400).json({ error: 'Path relay tidak valid.' });
    return;
  }
  if (!decodedPath || decodedPath.includes('..') || decodedPath.includes('\\') || decodedPath.startsWith('/') || !/^[A-Za-z0-9_.\/-]+$/.test(decodedPath)) {
    res.status(400).json({ error: 'Path relay ditolak.' });
    return;
  }

  const method = req.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    res.status(405).json({ error: 'Method tidak diizinkan oleh relay.' });
    return;
  }

  const cacheable = method === 'GET' && RELAY_GET_CACHE_TTL_MS > 0;
  const cacheKey = `${method}:${target}`;
  if (cacheable) {
    const cached = relayGetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      for (const [h, value] of Object.entries(cached.headers)) res.setHeader(h, value);
      res.setHeader('X-Relay-Cache', 'HIT');
      res.status(cached.status).send(cached.body);
      return;
    }
    if (cached) relayGetCache.delete(cacheKey);
  }

  try {
    const outgoingHeaders: Record<string, string> = {
      apikey: ORIGIN_KEY,
      Authorization: `Bearer ${ORIGIN_KEY}`,
      'Content-Type': 'application/json',
    };
    for (const h of ['range', 'range-unit', 'prefer', 'accept']) {
      const value = req.header(h);
      if (value) outgoingHeaders[h] = value;
    }

    const init: RequestInit = {
      method,
      headers: outgoingHeaders,
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    };
    if (!['GET', 'HEAD'].includes(method)) init.body = JSON.stringify(req.body ?? {});

    const upstream = await fetch(`${ORIGIN_URL}/rest/v1/${target}`, init);
    const body = method === 'HEAD' ? '' : await upstream.text();

    const cacheHeaders: Record<string, string> = {};
    for (const h of ['content-type', 'content-range', 'range-unit', 'preference-applied']) {
      const value = upstream.headers.get(h);
      if (value) {
        res.setHeader(h, value);
        cacheHeaders[h] = value;
      }
    }
    res.setHeader('X-Relay-Cache', cacheable ? 'MISS' : 'OFF');
    if (cacheable && upstream.ok) {
      relayGetCache.set(cacheKey, { expiresAt: Date.now() + RELAY_GET_CACHE_TTL_MS, status: upstream.status, headers: cacheHeaders, body });
      if (relayGetCache.size > 200) {
        const first = relayGetCache.keys().next().value;
        if (first) relayGetCache.delete(first);
      }
    }
    if (!cacheable && method !== 'GET' && method !== 'HEAD') relayGetCache.clear();
    res.status(upstream.status).send(body);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Relay gagal menghubungi origin.' });
  }
});
