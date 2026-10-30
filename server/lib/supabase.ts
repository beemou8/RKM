// Wrapper PostgREST langsung ke Supabase Cloud (Direct Mode Tanpa Relay)
// Dilengkapi proteksi Stale-While-Revalidate, Request Deduplication, dan Retry Cerdas.

function normalizeBaseUrl(value: string): string {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const SUPABASE_DIRECT_URL = normalizeBaseUrl(process.env.SUPABASE_URL || 'https://slgsfvfkjkpqourladqi.supabase.co');
const API_BASE_URL = SUPABASE_DIRECT_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const REQUEST_TIMEOUT_MS = Math.max(8_000, parseInt(process.env.SUPABASE_TIMEOUT_MS || '20000', 10) || 20_000);
const GET_CACHE_TTL_MS = Math.max(10_000, parseInt(process.env.SUPABASE_GET_CACHE_TTL_MS || '30000', 10) || 30_000);

// In-Memory Cache dengan Stale-While-Revalidate
type CacheRecord = {
  expiresAt: number;
  staleUntil: number;
  value: unknown;
};
const getCache = new Map<string, CacheRecord>();
const tableVersions = new Map<string, number>();

// In-Flight Request Deduplication: mencegah ratusan panggilan HTTP paralel untuk query yang sama persis
const inFlightRequests = new Map<string, Promise<any>>();

/** Versi tabel: naik setiap ada tulis (insert/update/delete). Dipakai cache di luar modul ini. */
export function getTableVersion(table: string): number {
  return tableVersions.get(table.split('?')[0].trim()) || 0;
}

function assertConfig() {
  if (!API_BASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL dan SUPABASE_KEY belum diset untuk direct Supabase');
  }
}

function headers(extra: Record<string, string> = {}) {
  assertConfig();
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Connection': 'keep-alive',
    ...extra,
  };
}

async function doFetch(url: string, init: RequestInit = {}, maxRetries = 3): Promise<Response> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      // Jika server proxy/relay mengembalikan status error sementara (502/503/504)
      if (res.status >= 502 && res.status <= 504 && attempt <= maxRetries) {
        const backoffMs = Math.round(400 * Math.pow(1.8, attempt - 1) + Math.random() * 200);
        console.warn(`[supabase] ${url} returned ${res.status} (attempt ${attempt}/${maxRetries + 1}). Retrying in ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
      if (attempt <= maxRetries) {
        const backoffMs = Math.round(400 * Math.pow(1.8, attempt - 1) + Math.random() * 200);
        console.warn(`[supabase] Fetch error on ${url} (attempt ${attempt}/${maxRetries + 1}): ${err.message}. Retrying in ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastError;
}

/** GET satu halaman PostgREST. */
export async function fetchSupabase<T = any>(query: string): Promise<T[]> {
  assertConfig();
  const url = `${API_BASE_URL}/rest/v1/${query}`;

  // Cek apakah ada request identik yang sedang berjalan (In-flight deduplication)
  if (inFlightRequests.has(url)) {
    return inFlightRequests.get(url)!;
  }

  const fetchPromise = (async () => {
    try {
      const res = await doFetch(url, { headers: headers() });
      if (res.status === 416) {
        return [] as T[];
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Supabase GET gagal (${res.status}): ${body || res.statusText}`);
      }
      return (await res.json()) as T[];
    } finally {
      inFlightRequests.delete(url);
    }
  })();

  inFlightRequests.set(url, fetchPromise);
  return fetchPromise;
}

/**
 * Cached GET dengan Stale-While-Revalidate & Fault Tolerance.
 * Untuk tabel master (seperti tbmaster_user), otomatis menggunakan TTL lebih panjang (5 menit).
 * Jika jaringan gagal, otomatis fallback ke data cache sebelumnya agar aplikasi tidak crash.
 */
export async function fetchSupabaseCached<T = any>(query: string, ttlMs?: number): Promise<T[]> {
  assertConfig();
  const isMasterTable = query.startsWith('tbmaster_') || query.includes('/tbmaster_');
  const defaultTtl = isMasterTable ? 300_000 : GET_CACHE_TTL_MS; // 5 menit untuk master data
  const effectiveTtl = ttlMs !== undefined ? Math.max(0, ttlMs) : defaultTtl;

  if (effectiveTtl <= 0) return fetchSupabase<T>(query);

  const now = Date.now();
  const cached = getCache.get(query);

  // Jika cache masih segar, langsung kembalikan dalam 0 ms
  if (cached && cached.expiresAt > now) {
    return cached.value as T[];
  }

  // Jika cache expired tapi ada data lama (stale), coba refresh di latar belakang
  try {
    const value = await fetchSupabase<T>(query);
    getCache.set(query, {
      expiresAt: now + effectiveTtl,
      staleUntil: now + Math.max(effectiveTtl * 4, 3_600_000), // fallback tahan s/d 1 jam
      value,
    });

    if (getCache.size > 800) {
      const first = getCache.keys().next().value;
      if (first) getCache.delete(first);
    }
    return value;
  } catch (err: any) {
    // Toleransi kegagalan: jika ada cache lama (meskipun expired), pakai cache lama sebagai penyelamat
    if (cached && cached.staleUntil > now) {
      console.warn(`[supabase] Peringatan: Gagal memperbarui ${query}. Menggunakan cadangan cache RAM lokal.`);
      return cached.value as T[];
    }
    throw err;
  }
}

/** Hapus seluruh entri cache yang berkaitan dengan tabel tertentu. */
export function invalidateTableCache(table: string): void {
  const prefix = table.split('?')[0].trim();
  if (!prefix) return;
  tableVersions.set(prefix, (tableVersions.get(prefix) || 0) + 1);
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

  // 1. Ambil halaman pertama (0..pageSize-1).
  const firstPage = await loadPage(0);
  if (firstPage.length < pageSize || firstPage.length >= maxRows) {
    return firstPage;
  }

  // 2. Jika halaman pertama penuh (>= 1000 baris), lanjutkan ambil halaman selanjutnya
  const out: T[] = [...firstPage];
  let currentStart = pageSize;

  while (currentStart < maxRows) {
    const page = await loadPage(currentStart);
    out.push(...page);
    if (page.length < pageSize) break;
    currentStart += pageSize;
  }
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
 * Versi cached dari fetchSupabaseAll dengan proteksi Stale Fallback.
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

  if (cached && cached.expiresAt > now) {
    return cached.value as T[];
  }

  try {
    const value = await fetchSupabaseAll<T>(query, options);
    getCache.set(cacheKey, {
      expiresAt: now + ttlMs,
      staleUntil: now + Math.max(ttlMs * 4, 1_800_000),
      value,
    });

    if (getCache.size > 800) {
      const first = getCache.keys().next().value;
      if (first) getCache.delete(first);
    }
    return value;
  } catch (err: any) {
    if (cached && cached.staleUntil > now) {
      console.warn(`[supabase] Peringatan: Gagal memperbarui ${cacheKey}. Menggunakan cadangan cache RAM lokal.`);
      return cached.value as T[];
    }
    throw err;
  }
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

/** Bulk insert (array of rows) dipecah otomatis per batch 150 agar tidak membebani reverse proxy. */
export async function insertManySupabase(table: string, rows: Record<string, any>[]): Promise<void> {
  if (rows.length === 0) return;
  assertConfig();
  const CHUNK_SIZE = 150;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const res = await doFetch(`${API_BASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase BULK INSERT gagal (${res.status}): ${body || res.statusText}`);
    }
  }
  invalidateTableCache(table);
}

/** Bulk upsert dipecah otomatis per batch 150 agar tidak timeout. */
export async function upsertManySupabase(table: string, rows: Record<string, any>[]): Promise<void> {
  if (rows.length === 0) return;
  assertConfig();
  const CHUNK_SIZE = 150;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const res = await doFetch(`${API_BASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase BULK UPSERT gagal (${res.status}): ${body || res.statusText}`);
    }
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
