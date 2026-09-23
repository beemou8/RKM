// Wrapper PostgREST.
// Production default RELAY_ONLY=true: instance aplikasi/cabang hanya tahu URL relay
// + shared secret. URL/key origin Supabase tidak perlu disimpan di instance cabang.

const IS_PROD = process.env.NODE_ENV === 'production';
const RELAY_ONLY = process.env.RELAY_ONLY !== undefined
  ? process.env.RELAY_ONLY === 'true'
  : IS_PROD;

function normalizeBaseUrl(value: string): string {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const SUPABASE_RELAY_URL = normalizeBaseUrl(process.env.SUPABASE_RELAY_URL || '');
const LEGACY_URL = normalizeBaseUrl(process.env.SUPABASE_URL || '');
const API_BASE_URL = RELAY_ONLY ? SUPABASE_RELAY_URL : (SUPABASE_RELAY_URL || LEGACY_URL);
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const RELAY_CLIENT_KEY = process.env.RELAY_CLIENT_KEY || '';
const RELAY_SHARED_SECRET = process.env.RELAY_SHARED_SECRET || '';
const REQUEST_TIMEOUT_MS = Math.max(2_000, parseInt(process.env.SUPABASE_TIMEOUT_MS || '15000', 10) || 15_000);
const GET_CACHE_TTL_MS = Math.max(0, parseInt(process.env.SUPABASE_GET_CACHE_TTL_MS || '15000', 10) || 15_000);
const getCache = new Map<string, { expiresAt: number; value: unknown }>();

function assertConfig() {
  if (RELAY_ONLY) {
    if (!SUPABASE_RELAY_URL) throw new Error('Relay wajib aktif: set SUPABASE_RELAY_URL di .env');
    if (!RELAY_SHARED_SECRET) throw new Error('RELAY_SHARED_SECRET wajib diset saat RELAY_ONLY=true');
    return;
  }
  if (!API_BASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL dan SUPABASE_KEY belum diset untuk mode direct/development');
  }
}

function headers(extra: Record<string, string> = {}) {
  assertConfig();
  const authHeaders: Record<string, string> = {};

  if (RELAY_ONLY) {
    // Tidak mengirim key origin Supabase dari instance cabang.
    if (RELAY_CLIENT_KEY) {
      authHeaders.apikey = RELAY_CLIENT_KEY;
      authHeaders.Authorization = `Bearer ${RELAY_CLIENT_KEY}`;
    }
  } else {
    authHeaders.apikey = SUPABASE_KEY;
    authHeaders.Authorization = `Bearer ${SUPABASE_KEY}`;
  }

  return {
    ...authHeaders,
    'Content-Type': 'application/json',
    ...(RELAY_SHARED_SECRET ? { 'x-rkm-relay-secret': RELAY_SHARED_SECRET } : {}),
    ...extra,
  };
}

async function doFetch(url: string, init: RequestInit = {}) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal });
}

/** GET satu halaman PostgREST. */
export async function fetchSupabase<T = any>(query: string): Promise<T[]> {
  assertConfig();
  const res = await doFetch(`${API_BASE_URL}/rest/v1/${query}`, { headers: headers() });
  if (res.status === 416) {
    return [] as T[];
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase GET gagal (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * Cached GET for read-heavy dashboard/master data.
 * Cache key is the exact PostgREST query, so branch/user/date filters stay isolated.
 */
export async function fetchSupabaseCached<T = any>(query: string, ttlMs = GET_CACHE_TTL_MS): Promise<T[]> {
  assertConfig();
  if (ttlMs <= 0) return fetchSupabase<T>(query);

  const now = Date.now();
  const cached = getCache.get(query);
  if (cached && cached.expiresAt > now) return cached.value as T[];
  if (cached) getCache.delete(query);

  const value = await fetchSupabase<T>(query);
  getCache.set(query, { expiresAt: now + ttlMs, value });

  if (getCache.size > 500) {
    const first = getCache.keys().next().value;
    if (first) getCache.delete(first);
  }
  return value;
}

/** Hapus seluruh entri cache yang berkaitan dengan tabel tertentu. */
export function invalidateTableCache(table: string): void {
  const prefix = table.split('?')[0].trim();
  if (!prefix) return;
  for (const key of getCache.keys()) {
    if (key === prefix || key.startsWith(`${prefix}?`) || key.includes(`/${prefix}?`)) {
      getCache.delete(key);
    }
  }
}

/**
 * GET seluruh hasil dengan pagination Range agar export tidak diam-diam terpotong.
 * maxRows adalah hard cap untuk menjaga RAM/CPU server.
 */
export async function fetchSupabaseAll<T = any>(
  query: string,
  options: { pageSize?: number; maxRows?: number; concurrency?: number } = {}
): Promise<T[]> {
  assertConfig();
  const pageSize = Math.min(Math.max(options.pageSize || 1000, 100), 1000);
  const maxRows = Math.min(Math.max(options.maxRows || 10_000, pageSize), 50_000);
  const concurrency = Math.min(Math.max(options.concurrency || 3, 1), 5);
  const pageStarts = Array.from({ length: Math.ceil(maxRows / pageSize) }, (_, i) => i * pageSize);

  async function loadPage(start: number): Promise<T[]> {
    const end = Math.min(start + pageSize - 1, maxRows - 1);
    const res = await doFetch(`${API_BASE_URL}/rest/v1/${query}`, {
      headers: headers({ Range: `${start}-${end}`, 'Range-Unit': 'items' }),
    });
    if (res.status === 416) {
      return [] as T[];
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase GET paginated gagal (${res.status}): ${body || res.statusText}`);
    }
    return (await res.json()) as T[];
  }

  const pages: T[][] = [];
  for (let i = 0; i < pageStarts.length; i += concurrency) {
    const batch = pageStarts.slice(i, i + concurrency);
    const loaded = await Promise.all(batch.map(loadPage));
    pages.push(...loaded);
    // PostgREST may return a short page once the dataset ends. No need to keep
    // hitting later ranges after that point.
    if (loaded.some((page) => page.length < pageSize)) break;
  }

  const out = pages.flat();
  if (out.length < maxRows) return out;

  // Probe one row after the cap to distinguish "exactly maxRows" from more data.
  const probe = await doFetch(`${API_BASE_URL}/rest/v1/${query}`, {
    headers: headers({ Range: `${maxRows}-${maxRows}`, 'Range-Unit': 'items' }),
  });
  if (probe.status === 416) return out;
  if (probe.ok) {
    const extra = (await probe.json()) as T[];
    if (extra.length === 0) return out;
  }

  throw new Error(`Data melebihi batas export ${maxRows.toLocaleString('id-ID')} baris. Persempit filter/periode agar server tetap stabil.`);
}

/**
 * Versi cached dari fetchSupabaseAll. Menghindari berulang kali menembak Supabase
 * dengan pagination Range untuk query yang identik dalam jendela waktu ttlMs.
 */
export async function fetchSupabaseAllCached<T = any>(
  query: string,
  options: { pageSize?: number; maxRows?: number; concurrency?: number; ttlMs?: number } = {}
): Promise<T[]> {
  const ttlMs = options.ttlMs !== undefined ? options.ttlMs : GET_CACHE_TTL_MS;
  if (ttlMs <= 0) return fetchSupabaseAll<T>(query, options);

  const now = Date.now();
  const cacheKey = `ALL::${query}::${options.maxRows || 10000}`;
  const cached = getCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value as T[];
  if (cached) getCache.delete(cacheKey);

  const value = await fetchSupabaseAll<T>(query, options);
  getCache.set(cacheKey, { expiresAt: now + ttlMs, value });

  if (getCache.size > 500) {
    const first = getCache.keys().next().value;
    if (first) getCache.delete(first);
  }
  return value;
}

/** POST (insert) one row into a PostgREST table. */
export async function insertSupabase(table: string, payload: Record<string, any>): Promise<void> {
  assertConfig();
  const res = await doFetch(`${API_BASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase INSERT gagal (${res.status}): ${body || res.statusText}`);
  }
  invalidateTableCache(table);
}

/** Bulk insert (array of rows) in a single request. */
export async function insertManySupabase(table: string, rows: Record<string, any>[]): Promise<void> {
  if (rows.length === 0) return;
  assertConfig();
  const res = await doFetch(`${API_BASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase BULK INSERT gagal (${res.status}): ${body || res.statusText}`);
  }
  invalidateTableCache(table);
}

/** Bulk upsert (merge duplicates based on unique constraints) in a single request. */
export async function upsertManySupabase(table: string, rows: Record<string, any>[]): Promise<void> {
  if (rows.length === 0) return;
  assertConfig();
  const res = await doFetch(`${API_BASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase BULK UPSERT gagal (${res.status}): ${body || res.statusText}`);
  }
  invalidateTableCache(table);
}

export async function updateSupabase(table: string, filterQuery: string, payload: Record<string, any>): Promise<void> {
  assertConfig();
  const res = await doFetch(`${API_BASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase UPDATE gagal (${res.status}): ${body || res.statusText}`);
  }
  invalidateTableCache(table);
}

export async function deleteSupabase(table: string, filterQuery: string): Promise<void> {
  assertConfig();
  const res = await doFetch(`${API_BASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: headers({ Prefer: 'return=minimal' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase DELETE gagal (${res.status}): ${body || res.statusText}`);
  }
  invalidateTableCache(table);
}

export function urlEnc(v: string) {
  return encodeURIComponent(v);
}
