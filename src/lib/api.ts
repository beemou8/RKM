import type {
  DashboardResponse,
  TrackingResponse,
  ScheduleResponse,
  MemberResponse,
  DbStatus,
  StatusToko,
  JadwalBulanan,
  MemberLookupResponse,
  MemberTipeResponse,
  RiwayatResponse,
  BelumTerkunjungiResponse,
  SurveiHargaResponse,
  MemberStatusResponse,
  DashboardSpvResponse,
} from '../types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request gagal (${res.status})`);
  return body as T;
}

export function fetchDbStatus(): Promise<DbStatus> {
  return getJson('/api/db-status');
}

export function fetchCabangList(): Promise<{ cabang: string[]; default: string; source: 'env' | 'supabase' }> {
  return getJson('/api/dashboard/cabang-list');
}

export type DashboardMemberFilter = 'semua' | 'member_pilihan' | 'sleeper' | 'belum_aktivasi';

export function fetchDashboard(
  tglDari: string,
  tglSampai: string,
  petugas: string,
  cabang: string,
  memberFilter: DashboardMemberFilter = 'semua'
): Promise<DashboardResponse> {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
    member_filter: memberFilter,
    ...(petugas ? { petugas } : {}),
  });
  return getJson(`/api/dashboard?${q}`);
}

export function exportDashboardUrl(
  tglDari: string,
  tglSampai: string,
  petugas: string,
  cabang: string,
  memberFilter: DashboardMemberFilter = 'semua'
): string {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
    member_filter: memberFilter,
    ...(petugas ? { petugas } : {}),
  });
  return `/api/dashboard/export?${q}`;
}

export function fetchDashboardByCall(
  tglDari: string,
  tglSampai: string,
  petugas: string,
  cabang: string,
  memberFilter: DashboardMemberFilter = 'semua'
): Promise<DashboardResponse> {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
    member_filter: memberFilter,
    ...(petugas ? { petugas } : {}),
  });
  return getJson(`/api/dashboard/by-call?${q}`);
}

export function exportDashboardByCallUrl(
  tglDari: string,
  tglSampai: string,
  petugas: string,
  cabang: string,
  memberFilter: DashboardMemberFilter = 'semua'
): string {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
    member_filter: memberFilter,
    ...(petugas ? { petugas } : {}),
  });
  return `/api/dashboard/by-call/export?${q}`;
}

export function exportBulananUrl(
  bulan: string,
  tahun: string,
  advisors: string[],
  cabang: string,
  source: 'rkm' | 'by_call' = 'rkm'
): string {
  const q = new URLSearchParams({ bulan, tahun, cabang, advisor: advisors.join(','), ...(source === 'by_call' ? { source: 'by_call' } : {}) });
  return `/api/dashboard/export-bulanan?${q}`;
}

export function fetchMemberStatus(
  cabang: string,
  source: 'rkm' | 'by_call',
  petugas: string = ''
): Promise<MemberStatusResponse> {
  const q = new URLSearchParams({ cabang, source, ...(petugas ? { petugas } : {}) });
  return getJson(`/api/member-status?${q}`);
}

export function exportMemberStatusUrl(
  cabang: string,
  source: 'rkm' | 'by_call',
  petugas: string = ''
): string {
  const q = new URLSearchParams({ cabang, source, ...(petugas ? { petugas } : {}) });
  return `/api/member-status/export?${q}`;
}

export function fetchTracking(tgl: string, petugas: string, cabang: string): Promise<TrackingResponse & { advisor_list: any[] }> {
  const q = new URLSearchParams({ tgl, cabang, ...(petugas ? { petugas } : {}) });
  return getJson(`/api/tracking?${q}`);
}

export function fetchScheduleAdvisors(cabang: string): Promise<{ advisors: string[]; db_lokal_connected: boolean }> {
  return getJson(`/api/schedule/advisors?cabang=${encodeURIComponent(cabang)}`);
}

export function fetchScheduleGenerate(params: {
  bulan: string;
  tahun: string;
  petugas: string;
  mode: string;
  tglDari: string;
  tglSampai: string;
  cabang: string;
  maksPerHari?: string;
}): Promise<ScheduleResponse> {
  const q = new URLSearchParams({
    bulan: params.bulan,
    tahun: params.tahun,
    cabang: params.cabang,
    ...(params.petugas ? { petugas: params.petugas } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.tglDari ? { tgl_dari: params.tglDari } : {}),
    ...(params.tglSampai ? { tgl_sampai: params.tglSampai } : {}),
    ...(params.maksPerHari ? { maks_per_hari: params.maksPerHari } : {}),
  });
  return getJson(`/api/schedule/generate?${q}`);
}

export async function pushSchedule(items: any[]): Promise<{ success: boolean; count: number }> {
  const res = await fetch('/api/schedule/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Push gagal');
  return body;
}

export async function exportSchedule(rows: any[]): Promise<Blob> {
  const res = await fetch('/api/schedule/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error('Export gagal');
  return res.blob();
}

export function fetchMember(tglDari: string, tglSampai: string, petugas: string, cabang: string): Promise<MemberResponse> {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
    ...(petugas ? { petugas } : {}),
  });
  return getJson(`/api/member?${q}`);
}

export function exportMemberUrl(tglDari: string, tglSampai: string, petugas: string, cabang: string): string {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
    ...(petugas ? { petugas } : {}),
  });
  return `/api/member/export?${q}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export function fetchStatusToko(cabang: string, search?: string): Promise<{ data: StatusToko[]; jadwal_dihapus: number }> {
  const q = new URLSearchParams();
  if (cabang) q.set('cabang', cabang);
  if (search) q.set('search', search);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return getJson(`/api/schedule/status-toko${qs}`);
}

export function exportStatusTokoUrl(cabang: string): string {
  const q = cabang ? `?cabang=${encodeURIComponent(cabang)}` : '';
  return `/api/schedule/status-toko/export${q}`;
}

export async function addStatusToko(payload: {
  username: string;
  cabang: string;
  nama_toko: string;
  kode_member: string;
  status: string;
  keterangan_lainnya?: string;
  deskripsi?: string;
}): Promise<{ success: boolean; jadwal_dihapus: number }> {
  const res = await fetch('/api/schedule/status-toko', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menyimpan status toko');
  return body;
}

export async function updateStatusToko(id: number, payload: Partial<StatusToko>): Promise<{ success: boolean }> {
  const res = await fetch(`/api/schedule/status-toko/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal mengubah status toko');
  return body;
}

export async function deleteStatusToko(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`/api/schedule/status-toko/${id}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus data');
  return body;
}

export function fetchMemberLookup(kodeMember: string, cabang: string): Promise<MemberLookupResponse> {
  const q = new URLSearchParams({ kode_member: kodeMember, cabang });
  return getJson(`/api/schedule/member-lookup?${q}`);
}

export function fetchExistingDay(
  username: string,
  tanggal: string,
  cabang: string
): Promise<{ data: JadwalBulanan[]; count: number; penuh: boolean }> {
  const q = new URLSearchParams({ username, tanggal, cabang });
  return getJson(`/api/schedule/existing-day?${q}`);
}

// ============================================================
// Jadwal Aktif / Riwayat Jadwal (baca & hapus dari tbtr_jadwal_bulanan)
// ============================================================

export function fetchRiwayatJadwal(bulan: string, tahun: string, petugas: string, cabang: string): Promise<RiwayatResponse> {
  const q = new URLSearchParams({ bulan, tahun, cabang, ...(petugas ? { petugas } : {}) });
  return getJson(`/api/schedule/riwayat?${q}`);
}

export async function deleteRiwayatByTanggal(username: string, tanggal: string, cabang: string): Promise<{ success: boolean }> {
  const q = new URLSearchParams({ username, tanggal, cabang });
  const res = await fetch(`/api/schedule/riwayat?${q}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus jadwal');
  return body;
}

export async function deleteRiwayatById(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`/api/schedule/riwayat/${id}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus jadwal');
  return body;
}

export async function deleteRiwayatBulk(ids: number[]): Promise<{ success: boolean; count: number; skipped?: number }> {
  const res = await fetch('/api/schedule/riwayat/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus jadwal terpilih');
  return body;
}

// ============================================================
// Jadwal Belum Terkunjungi (status_visit = Pending & tanggal sudah lewat)
// ============================================================

export function fetchBelumTerkunjungi(petugas: string, cabang: string): Promise<BelumTerkunjungiResponse> {
  const q = new URLSearchParams({ cabang, ...(petugas ? { petugas } : {}) });
  return getJson(`/api/schedule/belum-terkunjungi?${q}`);
}

export async function rescheduleJadwal(ids: number[], tanggal: string): Promise<{ success: boolean; count: number; tanggal: string }> {
  const res = await fetch('/api/schedule/reschedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, tanggal }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menjadwalkan ulang');
  return body;
}

export async function deleteRiwayatByAdvisor(username: string, bulan: string, tahun: string, cabang: string): Promise<{ success: boolean }> {
  const q = new URLSearchParams({ username, bulan, tahun, cabang });
  const res = await fetch(`/api/schedule/riwayat/advisor?${q}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus jadwal advisor ini');
  return body;
}

export async function deleteRiwayatAll(bulan: string, tahun: string, cabang: string, petugas: string): Promise<{ success: boolean }> {
  const q = new URLSearchParams({ bulan, tahun, cabang, ...(petugas ? { petugas } : {}) });
  const res = await fetch(`/api/schedule/riwayat/all?${q}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus semua jadwal');
  return body;
}


export function importScheduleTemplateUrl(cabang: string): string {
  const q = new URLSearchParams({ cabang });
  return `/api/schedule/import-template?${q}`;
}

export interface ImportScheduleResult {
  success: boolean;
  total_baris: number;
  inserted: number;
  skipped_count: number;
  skipped: Array<{ row: number; reason: string }>;
}

export async function importSchedule(file: File, cabang: string): Promise<ImportScheduleResult> {
  const fileBase64 = await fileToBase64(file);
  const res = await fetch('/api/schedule/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64, cabang }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Import gagal');
  return body;
}


// ============================================================
// Member Pilihan bulanan
// ============================================================

export function memberPilihanTemplateUrl(): string {
  return '/api/schedule/member-pilihan-template';
}

export interface MemberPilihanUploadResult {
  success: boolean;
  cabang: string;
  bulan: number;
  tahun: number;
  total_baris: number;
  inserted: number;
  replaced: number;
  skipped_count: number;
  skipped: Array<{ row: number; reason: string }>;
  per_advisor: Record<string, number>;
}

export async function uploadMemberPilihan(file: File, cabang: string, bulan: string, tahun: string): Promise<MemberPilihanUploadResult> {
  const fileBase64 = await fileToBase64(file);
  const res = await fetch('/api/schedule/member-pilihan-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64, cabang, bulan: Number(bulan), tahun: Number(tahun) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Upload Member Pilihan gagal');
  return body;
}

export function fetchMemberPilihan(cabang: string, bulan: string, tahun: string): Promise<{
  data: Array<{ username: string; kode_member: string; nama_toko?: string; latitude?: number; longitude?: number }>;
  total: number;
  per_advisor: Record<string, number>;
}> {
  const q = new URLSearchParams({ cabang, bulan, tahun });
  return getJson(`/api/schedule/member-pilihan?${q}`);
}

// ============================================================
// Upload "Tipe Member" saja (update tipe_member pada jadwal yang sudah ada)
// ============================================================

export function tipeMemberUploadTemplateUrl(): string {
  return '/api/schedule/tipe-member-template';
}

export interface TipeMemberUploadResult {
  success: boolean;
  total_baris: number;
  diproses: number;
  skipped_count: number;
  skipped: Array<{ row: number; reason: string }>;
}

export async function uploadTipeMember(file: File): Promise<TipeMemberUploadResult> {
  const fileBase64 = await fileToBase64(file);
  const res = await fetch('/api/schedule/tipe-member-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64 }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Upload gagal');
  return body;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Gagal membaca file.'));
    reader.readAsDataURL(file);
  });
}

// ============================================================
// Member Sleeper & Nonaktif (klasifikasi dari riwayat belanja DB lokal)
// ============================================================

export type MemberTipeFilter =
  | 'butuh_visit'
  | 'Sleeper'
  | 'Belum Aktivasi'
  | 'Tidak Aktif'
  | 'Member Pilihan'
  | 'semua';

export interface FetchMemberTipeOptions {
  tipe?: MemberTipeFilter | string;
  limit?: number;
  bulan?: string;
  tahun?: string;
  search?: string;
}

/**
 * Ambil data Member Sleeper/Nonaktif.
 *
 * Mendukung cara baru:
 *   fetchMemberTipe(cabang, { tipe: 'Sleeper', limit: 50 })
 *
 * Tetap kompatibel dengan cara lama:
 *   fetchMemberTipe(cabang, 'Sleeper')
 */
export function fetchMemberTipe(
  cabang: string,
  options?: FetchMemberTipeOptions | string
): Promise<MemberTipeResponse> {
  const tipe = typeof options === 'string' ? options : options?.tipe;
  const requestedLimit = typeof options === 'string' ? undefined : options?.limit;
  const bulan = typeof options === 'string' ? undefined : options?.bulan;
  const tahun = typeof options === 'string' ? undefined : options?.tahun;
  const search = typeof options === 'string' ? undefined : options?.search;

  // Batasi nilai yang dikirim agar request tidak bisa meminta data terlalu besar.
  const limit =
    requestedLimit !== undefined && Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 1000)
      : undefined;

  const q = new URLSearchParams({ cabang });

  if (tipe) q.set('tipe', tipe);
  if (limit !== undefined) q.set('limit', String(limit));
  if (bulan) q.set('bulan', bulan);
  if (tahun) q.set('tahun', tahun);
  if (search) q.set('search', search);

  return getJson(`/api/member-tipe?${q.toString()}`);
}

export function exportMemberTipeUrl(cabang: string, bulan?: string, tahun?: string): string {
  const q = new URLSearchParams({ cabang });
  if (bulan) q.set('bulan', bulan);
  if (tahun) q.set('tahun', tahun);
  return `/api/member-tipe/export?${q}`;
}

export async function applyTipeMember(items: Array<{ kode_member: string; tipe: string }>): Promise<{ success: boolean; count: number; gagal: string[] }> {
  const res = await fetch('/api/member-tipe/apply-tipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menerapkan tipe member');
  return body;
}


// ============================================================
// Survei Harga Kompetitor (tbtr_survei_header + tbtr_survei_detail)
// ============================================================

export function fetchSurveiHarga(
  tglDari: string,
  tglSampai: string,
  petugas: string,
  kompetitor: string,
  cabang: string
): Promise<SurveiHargaResponse> {
  const q = new URLSearchParams({
    cabang,
    ...(tglDari ? { tgl_dari: tglDari } : {}),
    ...(tglSampai ? { tgl_sampai: tglSampai } : {}),
    ...(petugas ? { petugas } : {}),
    ...(kompetitor ? { kompetitor } : {}),
  });
  return getJson(`/api/survei-harga?${q}`);
}

export function exportSurveiHargaUrl(
  tglDari: string,
  tglSampai: string,
  petugas: string,
  kompetitor: string,
  cabang: string
): string {
  const q = new URLSearchParams({
    cabang,
    ...(tglDari ? { tgl_dari: tglDari } : {}),
    ...(tglSampai ? { tgl_sampai: tglSampai } : {}),
    ...(petugas ? { petugas } : {}),
    ...(kompetitor ? { kompetitor } : {}),
  });
  return `/api/survei-harga/export?${q}`;
}

// ============================================================
// Master Alasan Menolak
// ============================================================

export function fetchMasterAlasan(cabang: string, tipe: 'GET_MEMBER' | 'RKM'): Promise<{ data: import('../types').MasterAlasanMenolak[] }> {
  const q = new URLSearchParams({ cabang, tipe });
  return getJson(`/api/master/alasan-menolak?${q}`);
}

export async function addMasterAlasan(payload: { cabang: string; tipe: 'GET_MEMBER' | 'RKM'; kategori_alasan: string }): Promise<{ success: boolean }> {
  const res = await fetch('/api/master/alasan-menolak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menambahkan alasan');
  return body;
}

export async function updateMasterAlasan(id: number, kategori_alasan: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/master/alasan-menolak/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kategori_alasan }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal mengubah alasan');
  return body;
}

export async function deleteMasterAlasan(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`/api/master/alasan-menolak/${id}`, {
    method: 'DELETE',
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus alasan');
  return body;
}

// ============================================================
// Member Belum Belanja Item Pareto
// ============================================================

export function fetchMasterItemPareto(cabang?: string): Promise<{ data: import('../types').MasterItemPareto[]; from_fallback: boolean }> {
  const q = new URLSearchParams();
  if (cabang) q.set('cabang', cabang);
  return getJson(`/api/member-pareto/master-items?${q}`);
}

export async function createMasterItemPareto(payload: {
  cabang?: string;
  prd_prdcd: string;
  nama_barang?: string;
  keterangan?: string;
}): Promise<{ success: boolean; item: import('../types').MasterItemPareto }> {
  const res = await fetch('/api/member-pareto/master-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menambahkan item master pareto');
  return body;
}

export async function deleteMasterItemPareto(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`/api/member-pareto/master-items/${id}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Gagal menghapus item master pareto');
  return body;
}

export function lookupProductPlu(plu: string): Promise<{ found: boolean; product?: import('../types').ParetoProductItem }> {
  return getJson(`/api/member-pareto/lookup-product/${encodeURIComponent(plu)}`);
}

export function fetchParetoProducts(plus?: string[]): Promise<{ data: import('../types').ParetoProductItem[]; db_lokal_connected: boolean }> {
  const q = new URLSearchParams();
  if (plus && plus.length > 0) q.set('plus', plus.join(','));
  return getJson(`/api/member-pareto/products?${q}`);
}

export function fetchMemberParetoAnalisis(
  cabang: string,
  tglDari?: string,
  tglSampai?: string,
  petugas?: string,
  pluList?: string[],
  kodeMember?: string
): Promise<import('../types').MemberParetoResponse> {
  const q = new URLSearchParams({ cabang });
  if (tglDari) q.set('tgl_dari', tglDari);
  if (tglSampai) q.set('tgl_sampai', tglSampai);
  if (petugas) q.set('petugas', petugas);
  if (kodeMember) q.set('kode_member', kodeMember);
  if (pluList && pluList.length > 0) q.set('plu', pluList.join(','));
  return getJson(`/api/member-pareto/analisis?${q}`);
}

export async function uploadMemberPareto(payload: {
  cabang: string;
  periode_dari: string;
  periode_sampai: string;
  items: import('../types').MemberParetoRow[];
}): Promise<{ success: boolean; inserted_count: number }> {
  const res = await fetch('/api/member-pareto/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Upload target pareto gagal');
  return body;
}

export function fetchMemberParetoMonitoring(
  cabang: string,
  options?: {
    periode_dari?: string;
    periode_sampai?: string;
    petugas?: string;
    status?: string;
    kode_member?: string;
    plu?: string;
  }
): Promise<import('../types').MemberParetoMonitoringResponse> {
  const q = new URLSearchParams({ cabang });
  if (options?.periode_dari) q.set('periode_dari', options.periode_dari);
  if (options?.periode_sampai) q.set('periode_sampai', options.periode_sampai);
  if (options?.petugas) q.set('petugas', options.petugas);
  if (options?.status) q.set('status', options.status);
  if (options?.kode_member) q.set('kode_member', options.kode_member);
  if (options?.plu) q.set('plu', options.plu);
  return getJson(`/api/member-pareto/monitoring?${q}`);
}

export async function updateMemberParetoStatus(
  id: number,
  payload: { status_followup: string; catatan?: string }
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/member-pareto/status/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Update status target gagal');
  return body;
}

export async function deleteMemberPareto(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`/api/member-pareto/${id}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Hapus target gagal');
  return body;
}

export async function bulkDeleteMemberPareto(ids: number[]): Promise<{ success: boolean; count: number }> {
  const res = await fetch('/api/member-pareto/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Hapus massal gagal');
  return body;
}

export function exportMemberParetoUrl(
  cabang: string,
  mode: 'analisis' | 'monitoring' = 'analisis',
  params?: { tglDari?: string; tglSampai?: string; petugas?: string; kodeMember?: string; plu?: string }
): string {
  const q = new URLSearchParams({ cabang, mode });
  if (params?.tglDari) q.set('tgl_dari', params.tglDari);
  if (params?.tglSampai) q.set('tgl_sampai', params.tglSampai);
  if (params?.petugas) q.set('petugas', params.petugas);
  if (params?.kodeMember) q.set('kode_member', params.kodeMember);
  if (params?.plu) q.set('plu', params.plu);
  return `/api/member-pareto/export?${q}`;
}

// ============================================================
// Penjadwalan Khusus SPV
// ============================================================

export interface SpvUser {
  username: string;
  nama_lengkap: string;
  role: string;
  cabang: string;
  is_active: boolean;
}

export interface SpvCandidate {
  kode_member: string;
  nama_toko: string;
  advisor: string;
  cabang: string;
  lat: number | null;
  lng: number | null;
  crm_koordinat: string;
  sudah_dikunjungi: boolean;
  sudah_dijadwalkan_spv: boolean;
}

export interface SpvCandidatesResponse {
  candidates: SpvCandidate[];
  visited: SpvCandidate[];
  stats: {
    total_pilihan: number;
    sudah_dikunjungi: number;
    belum_dikunjungi: number;
    tanpa_koordinat: number;
    diblokir: number;
  };
}

export interface SpvGenerateResponse {
  success: boolean;
  matrix: Record<string, Array<{ tanggal: string; toko: any[] }>>;
  message?: string;
  stats: {
    total_candidates: number;
    scheduled_count: number;
    sisa_belum_terjadwal: number;
    days_used: number;
    working_days_available: number;
  };
}

export async function fetchSpvUsers(cabang: string): Promise<{ users: SpvUser[] }> {
  return getJson(`/api/schedule/spv-users?cabang=${encodeURIComponent(cabang)}`);
}

export async function fetchSpvCandidates(params: {
  cabang: string;
  bulan: string;
  tahun: string;
  spv?: string;
}): Promise<SpvCandidatesResponse> {
  const q = new URLSearchParams({
    cabang: params.cabang,
    bulan: params.bulan,
    tahun: params.tahun,
    ...(params.spv ? { spv: params.spv } : {}),
  });
  return getJson(`/api/schedule/spv-candidates?${q}`);
}

export async function generateSpvSchedule(payload: {
  spvUsername: string;
  cabang: string;
  bulan: string;
  tahun: number;
  tglDari?: string;
  tglSampai?: string;
  maksPerHari: number;
}): Promise<SpvGenerateResponse> {
  const res = await fetch('/api/schedule/spv-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Generate jadwal SPV gagal');
  return body;
}

export function getSpvStoragePhotoUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  const trimmed = String(pathOrUrl).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const cleanPath = trimmed.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `https://slgsfvfkjkpqourladqi.supabase.co/storage/v1/object/public/RKM%20SPV/${cleanPath}`;
}

export function fetchDashboardSpv(
  tglDari: string,
  tglSampai: string,
  spv: string,
  cabang: string
): Promise<DashboardSpvResponse> {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
  });
  if (spv) q.set('spv', spv);
  return getJson(`/api/dashboard/spv?${q}`);
}

export function exportDashboardSpvUrl(
  tglDari: string,
  tglSampai: string,
  spv: string,
  cabang: string
): string {
  const q = new URLSearchParams({
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    cabang,
  });
  if (spv) q.set('spv', spv);
  return `/api/dashboard/spv/export?${q}`;
}


