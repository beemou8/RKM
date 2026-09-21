// ============================================================
// Types matching the real data sources (Supabase + local Postgres)
// ============================================================

/** tbmaster_user (Supabase) */
export interface MasterUser {
  username: string;
  nama_lengkap: string;
  cabang: string;
  role: string;
  is_active: boolean;
  target_member?: number;
}

/** tbtr_kunjungan_rkm (Supabase) */
export interface KunjunganRkm {
  id?: number;
  username: string;
  kode_member: string;
  nama_toko?: string;
  cabang?: string;
  created_at: string;
  berhasil_order: boolean | 't' | 'f';
  alasan_tidak_order?: string;
  kategori_tidak_order?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_in_radius?: boolean | 't' | 'f';
}

/** tbtr_tracking (Supabase) */
export interface TrackingPoint {
  id?: number;
  username: string;
  latitude: number;
  longitude: number;
  created_at: string;
  lama_diam_menit?: number;
}

/** tbtr_jadwal_bulanan (Supabase) */
export interface JadwalBulanan {
  id?: number;
  tanggal_jadwal: string;
  username: string;
  kode_member: string;
  cabang: string;
  status_visit: string;
  latitude: number | null;
  longitude: number | null;
  nama_toko: string;
  tipe_member?: TipeMember | string | null;
  /** Flag runtime UI, bukan kolom tbtr_jadwal_bulanan. */
  member_pilihan?: boolean;
}

/** Klasifikasi member berdasarkan riwayat belanja (tbtr_jualheader). */
export type TipeMember = 'Aktif' | 'Sleeper' | 'Belum Aktivasi' | 'Tidak Aktif' | 'Member Pilihan';

/** Baris hasil query klasifikasi member sleeper/nonaktif (dari DB lokal). */
export interface MemberTipeRow {
  kode_member: string;
  nama_member: string;
  advisor: string | null;
  cabang: string;
  belanja_pertama: string | null;
  belanja_terakhir: string | null;
  tipe: TipeMember;
  member_pilihan?: boolean;
  lat: number | null;
  lng: number | null;
}

export interface MemberTipeResponse {
  data: MemberTipeRow[];
  totals: { aktif: number; sleeper: number; belum_aktivasi: number; tidak_aktif: number; member_pilihan: number; total: number };
  db_lokal_connected: boolean;
}

/** tbtr_status_toko (Supabase) */
export interface StatusToko {
  id: number;
  username: string;
  tanggal: string | null;
  cabang: string | null;
  nama_toko: string;
  kode_member: string | null;
  status: string;
  keterangan_lainnya?: string | null;
  deskripsi?: string | null;
  created_at?: string;
}

/** tbtr_member_baru (Supabase) */
export interface MemberBaru {
  id?: number;
  tanggal: string;
  username: string;
  nama_toko: string;
  kode_member?: string;
  mau_jadi_member: boolean | 't' | 'f';
  alasan_menolak?: string | null;
  kategori_menolak?: string | null;
  lanjut_belanja?: boolean | 't' | 'f';
  no_trx_pertama?: string | null;
  alasan_tidak_belanja?: string | null;
  created_at?: string;
}

/** Result row from local Postgres tbmaster_customer (cluster/schedule candidate) */
export interface CustomerCandidate {
  cus_kodemember: string;
  cus_namamember: string;
  cus_nosalesman: string;
  cus_kodeigr: string;
  crm_koordinat: string;
  lat: number;
  lng: number;
  tipe_member?: TipeMember | string | null;
  member_pilihan?: boolean;
}

export interface KategoriCount {
  kategori: string;
  jumlah: number;
}

// ============================================================
// API response shapes
// ============================================================

export interface AdvisorSummary {
  username: string;
  nama_lengkap: string;
  kunjungan: number;
  belanja: number;
  gagal: number;
  rph: number;
}

export interface MemberStatusRow {
  kode_member: string;
  nama_member: string;
  advisor: string | null;
  username_kunjungan?: string | null;
  berhasil_order?: boolean;
  status_detail?: string | null;
  no_trx?: string | null;
  kategori_tidak_order?: string | null;
  alasan_tidak_order?: string | null;
  waktu_kunjungan?: string | null;
}


export interface MemberStatusResponse {
  source: 'rkm' | 'by_call';
  source_label: 'RKM' | 'BY CALL';
  sudah: MemberStatusRow[];
  belum: MemberStatusRow[];
  totals: { total_member: number; sudah: number; belum: number };
  advisor_list: string[];
  db_lokal_connected: boolean;
}

export interface DashboardResponse {
  tgl_dari: string;
  tgl_sampai: string;
  tgl_filter: string;
  tgl_kemarin: string;
  summary: AdvisorSummary[];
  data_berhasil: Array<KunjunganRkm & { rp: number; nama: string }>;
  data_gagal: KunjunganRkm[];
  totals: { kunjungan: number; belanja: number; gagal: number; rph: number; avg_strike: number };
  breakdown_kategori_tidak_order: KategoriCount[];
  breakdown_kategori_menolak: KategoriCount[];
  source: 'rkm' | 'by_call';
  source_label: 'RKM' | 'BY CALL';
  member_filter: 'semua' | 'member_pilihan' | 'sleeper' | 'belum_aktivasi';
  member_filter_counts: { semua: number; member_pilihan: number; sleeper: number; belum_aktivasi: number };
  db_lokal_connected: boolean;
  advisor_list: Array<{ username: string; nama_lengkap: string; user_type?: string }>;
}

export interface EnrichedVisit extends KunjunganRkm {
  nama_toko_customer: string;
  crm_koordinat_text: string;
  crm_lat: number | null;
  crm_lng: number | null;
  jarak_meter: number | null;
  status_kunjungan: 'valid' | 'luar_radius' | 'tidak_ada_gps';
}

export interface TrackingResponse {
  is_single_view: boolean;
  petugas_tidak_aktif?: boolean;
  tgl_filter: string;
  petugas_filter: string;
  last_update: string;
  tracking_points: TrackingPoint[];
  visits: EnrichedVisit[];
  totals: {
    advisor_dipantau: number;
    advisor_online: number;
    kunjungan: number;
    valid: number;
    luar_radius: number;
    tanpa_gps: number;
  };
  breakdown_kategori_tidak_order: KategoriCount[];
  db_lokal_connected: boolean;
  advisor_no_login?: Array<{ username: string; nama_lengkap: string }>;
}

export interface ScheduleDay {
  tanggal: string;
  toko: CustomerCandidate[];
}

export interface ScheduleResponse {
  advisor_list: string[];
  matrix: Record<string, ScheduleDay[]>;
  db_lokal_connected: boolean;
  hari_libur_dilewati?: { tanggal: string; nama: string }[];
  member_pilihan_info?: Record<string, { uploaded: number; already_scheduled: number; generated: number; unresolved: number }>;
}

/** Baris jadwal aktif (sudah tersimpan di tbtr_jadwal_bulanan), dipakai di
 *  halaman Jadwal Aktif / Riwayat Jadwal. Bentuknya mirip CustomerCandidate
 *  supaya bisa dipakai ulang di komponen peta & preview rute yang sama. */
export interface RiwayatCandidate extends CustomerCandidate {
  id: number;
  status_visit: string;
}

export interface RiwayatDay {
  tanggal: string;
  toko: RiwayatCandidate[];
}

export interface RiwayatResponse {
  advisor_list: string[];
  matrix: Record<string, RiwayatDay[]>;
}

/** Jadwal dengan status_visit masih 'Pending' tapi tanggal_jadwal-nya
 *  sudah lewat dari hari ini — dipakai di halaman Jadwal Belum Terkunjungi. */
export interface BelumTerkunjungiResponse {
  advisor_list: string[];
  matrix: Record<string, RiwayatDay[]>;
  hari_ini: string;
  bulan_berjalan?: string;
}

export interface MemberSummary {
  username: string;
  total_kunjungan: number;
  mau_jadi_member: number;
  menolak: number;
  lanjut_belanja: number;
  pending: number;
}

export interface MemberResponse {
  advisors: string[];
  summary: MemberSummary[];
  data_berhasil: MemberBaru[];
  data_ditolak: MemberBaru[];
  data_pending: MemberBaru[];
  breakdown_kategori_menolak: KategoriCount[];
}

export interface DbStatus {
  connected: boolean;
  host: string;
  database: string;
  error: string | null;
}


export interface MemberLookupResponse {
  found: boolean;
  blocked: boolean;
  message?: string;
  nama_toko?: string;
  cabang?: string;
  username_pemilik?: string;
  lat?: number | null;
  lng?: number | null;
  tipe_member?: TipeMember | string | null;
}

// ============================================================
// Survei Harga Kompetitor (Supabase + harga produk lokal)
// ============================================================

export type SurveiCompareStatus = 'MENANG' | 'KALAH' | 'SERI' | 'TIDAK_ADA_HARGA';

export interface SurveiHargaHistoryItem {
  detail_id: number;
  header_id: number;
  plu: string;
  nama_barang: string;
  nama_barang_input: string;
  frac: string | null;
  unit: string | null;
  frac_master: number;
  harga_kompetitor: number;
  harga_kita: number;
  harga_normal: number;
  harga_promo: number;
  status: SurveiCompareStatus;
  selisih: number;
  selisih_persen: number;
  produk_ditemukan: boolean;
  nama_kompetitor: string;
  tanggal_struk: string;
  foto_struk: string | null;
  nama_user: string;
  cabang: string | null;
  created_at: string | null;
}

export interface SurveiHargaProduct {
  plu: string;
  nama_barang: string;
  unit: string | null;
  frac: string | null;
  frac_master: number;
  harga_kita: number;
  harga_normal: number;
  harga_promo: number;
  produk_ditemukan: boolean;
  total_survei: number;
  total_kompetitor: number;
  menang: number;
  kalah: number;
  seri: number;
  latest: SurveiHargaHistoryItem;
  history: SurveiHargaHistoryItem[];
}

export interface SurveiHargaStruk {
  id: number;
  nama_kompetitor: string;
  tanggal_struk: string;
  foto_struk: string | null;
  nama_user: string;
  cabang: string | null;
  created_at: string | null;
  jumlah_item: number;
  detail: SurveiHargaHistoryItem[];
}

export interface SurveiHargaResponse {
  cabang: string;
  tgl_dari: string | null;
  tgl_sampai: string | null;
  petugas: string;
  kompetitor: string;
  users: string[];
  competitors: string[];
  totals: {
    total_struk: number;
    total_item: number;
    total_produk: number;
    total_kompetitor: number;
    menang: number;
    kalah: number;
    seri: number;
    tidak_ada_harga: number;
  };
  products: SurveiHargaProduct[];
  struk: SurveiHargaStruk[];
}

export interface MasterAlasanMenolak {
  id?: number;
  cabang: string;
  tipe: 'GET_MEMBER' | 'RKM';
  kategori_alasan: string;
  created_at?: string;
}

// ============================================================
// Member Belum Belanja Item Pareto
// ============================================================

export interface ParetoProductItem {
  prd_prdcd: string;
  prd_deskripsipanjang: string;
  prd_unit?: string | null;
  prd_frac?: number | string | null;
}

export interface MemberParetoRow {
  kode_member: string;
  nama_member: string;
  username: string; // cus_nosalesman
  belanja_pertama: string | null;
  belanja_terakhir: string | null;
  prd_prdcd: string;
  nama_barang: string;
}

export interface MemberParetoResponse {
  cabang: string;
  tgl_dari: string;
  tgl_sampai: string;
  target_plus: string[];
  petugas_filter: string;
  data: MemberParetoRow[];
  totals: {
    total_baris: number;
    total_member: number;
    total_advisor: number;
    total_produk: number;
  };
  advisor_list: string[];
  db_lokal_connected: boolean;
}

export interface MemberParetoMonitoringRow {
  id: number;
  cabang: string;
  username: string;
  kode_member: string;
  nama_member: string;
  belanja_pertama: string | null;
  belanja_terakhir: string | null;
  prd_prdcd: string;
  nama_barang: string;
  periode_dari: string;
  periode_sampai: string;
  status_followup: string;
  catatan?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberParetoMonitoringResponse {
  cabang: string;
  data: MemberParetoMonitoringRow[];
  totals: {
    total: number;
    pending: number;
    sudah_ditawari: number;
    berhasil_beli: number;
    menolak: number;
  };
  advisor_list: string[];
}

export interface MasterItemPareto {
  id?: number;
  cabang?: string;
  prd_prdcd: string;
  nama_barang: string;
  keterangan?: string | null;
  is_active?: boolean;
  created_at?: string;
}

export interface DashboardSpvItem {
  id: number;
  username: string;
  nama_lengkap: string;
  tanggal: string;
  cabang: string;
  kode_member: string;
  nama_toko: string;
  berhasil_order: boolean;
  no_trx: string | null;
  kategori_tidak_order: string | null;
  alasan_tidak_order: string | null;
  catatan_spv: string | null;
  foto_kunjungan: string | null;
  foto_url: string | null;
  latitude: number | null;
  longitude: number | null;
  is_in_radius: boolean;
  created_at: string;
  rp?: number;
}

export interface DashboardSpvSummary {
  username: string;
  nama_lengkap: string;
  kunjungan: number;
  belanja: number;
  gagal: number;
  rph: number;
  strike_rate: number;
  in_radius: number;
  out_radius: number;
}

export interface DashboardSpvResponse {
  cabang: string;
  tgl_dari: string;
  tgl_sampai: string;
  spv_list: Array<{ username: string; nama_lengkap: string; role: string }>;
  totals: {
    kunjungan: number;
    belanja: number;
    gagal: number;
    rph: number;
    avg_strike: number;
    in_radius: number;
    out_radius: number;
    pct_in_radius: number;
  };
  summary: DashboardSpvSummary[];
  summary_spv: DashboardSpvSummary[];
  data_berhasil: Array<{
    id: number;
    username: string;
    nama_lengkap: string;
    kode_member: string;
    nama_toko: string;
    nama?: string;
    rp: number;
    no_trx: string | null;
    tanggal: string;
    foto_url?: string | null;
  }>;
  data_gagal: Array<{
    id: number;
    username: string;
    nama_lengkap: string;
    kode_member: string;
    nama_toko: string;
    kategori_tidak_order: string | null;
    alasan_tidak_order: string | null;
    catatan_spv?: string | null;
    tanggal: string;
    foto_url?: string | null;
  }>;
  breakdown_kategori_tidak_order: Array<{ kategori: string; jumlah: number }>;
  kunjungan: DashboardSpvItem[];
  db_lokal_connected: boolean;
}




