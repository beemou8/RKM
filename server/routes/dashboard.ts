import { Router } from 'express';
import { fetchSupabase, fetchSupabaseAllCached, fetchSupabaseCached } from '../lib/supabase.js';
import { queryLocal, getDbStatus } from '../lib/db.js';
import { sendWorkbook, styleHeaderRow } from '../lib/excel.js';
import { buildMemberData } from './member.js';
import ExcelJS from 'exceljs';
import { resolveCabang } from '../lib/cabang.js';

export const dashboardRouter = Router();

// In-memory cache singkat (20s) untuk respon dashboard yang identik
const dashboardResponseCache = new Map<string, { expiresAt: number; data: any }>();

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const HARI_ABBR = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function getWIBDate(dateVal: string | number | Date): Date {
  return new Date(new Date(dateVal).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
}

function getTodayWIB(): string {
  const d = getWIBDate(new Date());
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateStr: string, days: number): string {
  const d = getWIBDate(dateStr + 'T12:00:00+07:00');
  d.setDate(d.getDate() + days);
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatWIBDateTime(value: any): string {
  if (!value) return '';
  const d = getWIBDate(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

type DashboardMemberFilter = 'semua' | 'member_pilihan' | 'sleeper' | 'belum_aktivasi';

function normalizeDashboardMemberFilter(value: string | undefined): DashboardMemberFilter {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'member_pilihan' || v === 'sleeper' || v === 'belum_aktivasi') return v;
  return 'semua';
}

async function getDashboardMemberClassification(codes: string[], tglDari: string, tglSampai: string, cabang: string) {
  const normalizedCodes = Array.from(new Set(codes.map((k) => String(k || '').trim().toUpperCase()).filter(Boolean)));
  const tipeMap: Record<string, string> = {};
  const pilihanSet = new Set<string>();

  if (normalizedCodes.length === 0) return { tipeMap, pilihanSet };

  // Jadwal harian dipakai sebagai fallback klasifikasi dan sumber flag Member Pilihan.
  const scheduleRows = await fetchSupabaseCached<any>(
    `tbtr_jadwal_bulanan?select=kode_member,tipe_member&cabang=eq.${encodeURIComponent(
      cabang
    )}&tanggal_jadwal=gte.${tglDari}&tanggal_jadwal=lte.${tglSampai}&kode_member=in.(${normalizedCodes.join(',')})`
  ).catch(() => []);

  for (const row of scheduleRows || []) {
    const kode = String(row.kode_member || '').trim().toUpperCase();
    if (!kode) continue;
    const tipe = String(row.tipe_member || '').trim();
    if (tipe && tipe !== 'Member Pilihan') tipeMap[kode] = tipe;
    if (tipe === 'Member Pilihan') pilihanSet.add(kode);
  }

  // Master Member Pilihan aktif pada cabang.
  const pilihanRows = await fetchSupabaseCached<any>(
    `tbtr_member_pilihan?select=kode_member&cabang=eq.${encodeURIComponent(cabang)}&kode_member=in.(${normalizedCodes.join(',')})`
  ).catch(() => []);
  for (const row of pilihanRows || []) {
    const kode = String(row.kode_member || '').trim().toUpperCase();
    if (kode) pilihanSet.add(kode);
  }

  // Sleeper / Belum Aktivasi selalu dihitung dari DB lokal agar Member Pilihan
  // yang tipe_member-nya ditulis "Member Pilihan" di jadwal masih bisa difilter
  // berdasarkan status dasarnya.
  try {
    const rows = await queryLocal(
      `SELECT UPPER(c.cus_kodemember) AS kode_member,
              CASE
                WHEN c.cus_recordid = '1' THEN 'Tidak Aktif'
                WHEN b.belanja_pertama IS NULL THEN 'Belum Aktivasi'
                WHEN b.belanja_terakhir < CURRENT_DATE - INTERVAL '3 months' THEN 'Sleeper'
                ELSE 'Aktif'
              END AS tipe_member
       FROM tbmaster_customer c
       LEFT JOIN (
         SELECT jh_cus_kodemember,
                DATE_TRUNC('day', MIN(jh_transactiondate)) AS belanja_pertama,
                DATE_TRUNC('day', MAX(jh_transactiondate)) AS belanja_terakhir
         FROM tbtr_jualheader
         WHERE jh_cus_kodemember IS NOT NULL
         GROUP BY jh_cus_kodemember
       ) b ON c.cus_kodemember = b.jh_cus_kodemember
       WHERE c.cus_kodeigr = $1 AND UPPER(c.cus_kodemember) = ANY($2::text[])`,
      [cabang, normalizedCodes]
    );
    for (const row of rows || []) {
      const kode = String(row.kode_member || '').trim().toUpperCase();
      if (kode) tipeMap[kode] = row.tipe_member;
    }
  } catch {
    // Jika DB lokal offline, fallback ke tipe_member yang tersimpan di jadwal.
  }

  return { tipeMap, pilihanSet };
}

type DashboardVisitSource = 'rkm' | 'by_call';

function dashboardVisitTable(source: DashboardVisitSource): string {
  return source === 'by_call' ? 'tbtr_kunjungan_by_call' : 'tbtr_kunjungan_rkm';
}

function dashboardSourceLabel(source: DashboardVisitSource): string {
  return source === 'by_call' ? 'BY CALL' : 'RKM';
}

async function buildDashboard(
  tglDari: string,
  tglSampai: string,
  petugasFilter: string,
  cabang: string,
  roleFilter?: string,
  memberFilter: DashboardMemberFilter = 'semua',
  source: DashboardVisitSource = 'rkm'
) {
  const tglKemarin = addDays(tglDari, -1);

  // Sumber user/cabang sengaja dibuat identik dengan Tracking:
  // hanya user aktif + user_type terisi pada cabang yang sedang dipantau.
  let userUrl = `tbmaster_user?select=username,nama_lengkap,user_type,cabang,is_active&cabang=eq.${encodeURIComponent(cabang)}&is_active=eq.true&user_type=not.is.null`;
  if (roleFilter) userUrl += `&role=eq.${encodeURIComponent(roleFilter)}`;
  const listUsers = await fetchSupabaseCached<any>(userUrl).catch(() => []);
  
  const namaMap: Record<string, string> = {};
  for (const u of listUsers || []) namaMap[u.username] = u.nama_lengkap || u.username;

  const usernamesCabangIni = new Set((listUsers || []).map((u: any) => u.username).filter(Boolean));

  // PERBAIKAN: Dashboard Laporan Harian HANYA menarik data untuk tipe "RKM"
  const rkmIds = (listUsers || [])
    .filter((u: any) => u.user_type?.toUpperCase() === 'RKM')
    .map((u: any) => u.username)
    .filter(Boolean);

  // Kalau petugasFilter dikirim tapi usernamenya bukan milik cabang yang sedang
  // dibuka (mis-match cabang <-> username), abaikan filternya supaya tidak
  // "nyasar" narik data advisor cabang lain — fallback ke daftar advisor cabang ini.
  const petugasValid = petugasFilter && usernamesCabangIni.has(petugasFilter) ? petugasFilter : '';

  // Filter ganda: cabang DAN username, biar tidak timpang kalau ada baris
  // tbtr_kunjungan_rkm yang kolom cabang-nya keliru/tidak sinkron dengan
  // cabang advisor di tbmaster_user.
  const visitTable = dashboardVisitTable(source);
  // Rentang tanggal inklusif (BETWEEN secara logika): [tglDari 00:00:00, tglSampai 23:59:59] WIB.
  let url = `${visitTable}?select=username,kode_member,nama_toko,created_at,berhasil_order,kategori_tidak_order,alasan_tidak_order,no_trx,cabang&cabang=eq.${encodeURIComponent(
    cabang
  )}&created_at=gte.${tglDari}T00:00:00%2B07:00&created_at=lte.${tglSampai}T23:59:59%2B07:00&order=created_at.asc`;
  if (petugasValid) {
    url += `&username=eq.${encodeURIComponent(petugasValid)}`;
  } else if (rkmIds.length > 0) {
    url += `&username=in.(${rkmIds.join(',')})`;
  } else {
    // Jika tidak ada user RKM sama sekali, cegah penarikan seluruh data
    url += `&username=is.null`;
  }
  
  const fetchedKunjunganRaw = (rkmIds.length > 0 || petugasValid)
    ? await fetchSupabaseAllCached<any>(url, { maxRows: 5000, ttlMs: 30_000 })
    : [];
  // BY CALL hanya mengakui member yang benar-benar belanja. Baris false/null
  // tidak ikut dashboard, coverage, statistik, maupun export.
  const allKunjunganRaw = source === 'by_call'
    ? (fetchedKunjunganRaw || []).filter((r: any) => r.berhasil_order === true || r.berhasil_order === 't')
    : (fetchedKunjunganRaw || []);

  const kodeKunjungan = (allKunjunganRaw || []).map((r: any) => r.kode_member).filter(Boolean);
  const classificationPromise = getDashboardMemberClassification(kodeKunjungan, tglDari, tglSampai, cabang);
  const memberDataPromise = source === 'by_call'
    ? Promise.resolve(null)
    : buildMemberData(tglDari, tglSampai, petugasValid, cabang, listUsers).catch(() => null);
  const [{ tipeMap, pilihanSet }, memberData] = await Promise.all([classificationPromise, memberDataPromise]);
  const matchMemberFilter = (row: any, filter: DashboardMemberFilter) => {
    if (filter === 'semua') return true;
    const kode = String(row.kode_member || '').trim().toUpperCase();
    if (!kode) return false;
    if (filter === 'member_pilihan') return pilihanSet.has(kode);
    if (filter === 'sleeper') return tipeMap[kode] === 'Sleeper';
    if (filter === 'belum_aktivasi') return tipeMap[kode] === 'Belum Aktivasi';
    return true;
  };

  const filterCounts = {
    semua: (allKunjunganRaw || []).length,
    member_pilihan: (allKunjunganRaw || []).filter((r: any) => matchMemberFilter(r, 'member_pilihan')).length,
    sleeper: (allKunjunganRaw || []).filter((r: any) => matchMemberFilter(r, 'sleeper')).length,
    belum_aktivasi: (allKunjunganRaw || []).filter((r: any) => matchMemberFilter(r, 'belum_aktivasi')).length,
  };

  const allKunjungan = (allKunjunganRaw || []).filter((row: any) => matchMemberFilter(row, memberFilter));

  const summary: Record<string, { kunjungan: number; belanja: number; gagal: number; rph: number }> = {};
  const dataBerhasil: Record<string, any> = {};
  const dataGagal: any[] = [];
  const kdOrderList = new Set<string>();

  for (const row of allKunjungan || []) {
    const adv = row.username;
    const kdMem = String(row.kode_member || '').trim().toUpperCase();
    if (!summary[adv]) summary[adv] = { kunjungan: 0, belanja: 0, gagal: 0, rph: 0 };
    summary[adv].kunjungan++;

    const berhasil = row.berhasil_order === true || row.berhasil_order === 't';
    if (berhasil && kdMem) {
      if (!dataBerhasil[kdMem]) {
        dataBerhasil[kdMem] = row;
        summary[adv].belanja++;
        kdOrderList.add(kdMem);
      }
    } else if (source !== 'by_call') {
      summary[adv].gagal++;
      dataGagal.push(row);
    }
  }

  const detailRp: Record<string, { rp: number; nama: string }> = {};

  if (kdOrderList.size > 0) {
    try {
      const rows = await queryLocal(
        `SELECT H.OBI_KDMEMBER, C.CUS_NAMAMEMBER,
                SUM(H.OBI_TTLORDER + H.OBI_TTLPPN - COALESCE(P.CASHBACK_ORDER, 0)) AS TOTAL_RP
         FROM tbtr_obi_h H
         INNER JOIN tbmaster_customer C ON H.OBI_KDMEMBER = C.CUS_KODEMEMBER
         LEFT JOIN (SELECT NO_PB, SUM(CASHBACK_ORDER) AS CASHBACK_ORDER FROM PROMO_KLIKIGR GROUP BY NO_PB) P
                ON P.NO_PB = H.OBI_NOPB
         WHERE C.CUS_KODEIGR = $1 AND H.OBI_KDMEMBER = ANY($2::text[])
           AND H.OBI_TGLPB BETWEEN $3 AND $4
         GROUP BY H.OBI_KDMEMBER, C.CUS_NAMAMEMBER`,
        [cabang, Array.from(kdOrderList), `${tglKemarin} 00:00:00`, `${tglSampai} 23:59:59`]
      );
      for (const r of rows) {
        const kd = String(r.obi_kdmember || '').trim().toUpperCase();
        detailRp[kd] = { rp: parseFloat(r.total_rp) || 0, nama: r.cus_namamember };
        const advForMember = dataBerhasil[kd]?.username;
        if (advForMember && summary[advForMember]) {
          summary[advForMember].rph += parseFloat(r.total_rp) || 0;
        }
      }
    } catch {
      // Local DB unreachable
    }
  }

  const summaryArr = Object.entries(summary)
    .map(([username, v]) => ({ username, nama_lengkap: namaMap[username] || username, ...v }))
    .sort((a, b) => b.belanja - a.belanja);

  const berhasilArr = Object.entries(dataBerhasil).map(([kd, row]: [string, any]) => ({
    ...row,
    rp: detailRp[kd]?.rp ?? 0,
    nama: detailRp[kd]?.nama ?? row.nama_toko ?? kd,
  }));

  const totalKunjungan = summaryArr.reduce((s, a) => s + a.kunjungan, 0);
  const totalBelanja = summaryArr.reduce((s, a) => s + a.belanja, 0);
  const totalRph = summaryArr.reduce((s, a) => s + a.rph, 0);
  const totalGagal = source === 'by_call' ? 0 : summaryArr.reduce((s, a) => s + a.gagal, 0);
  // Persentase Effective Call hanya milik dashboard RKM. BY CALL murni hitung belanja.
  const avgStrike = source === 'by_call' ? 0 : (totalKunjungan > 0 ? (totalBelanja / totalKunjungan) * 100 : 0);

  // Rangkuman alasan "tidak order" (RKM) untuk diagram batang evaluasi di Dashboard.
  // Dihitung dari data_gagal yang sudah difilter tanggal/advisor/cabang yang sama
  // dengan sisa dashboard, supaya konsisten dengan angka Effective Call di atasnya.
  const kategoriTidakOrderCount: Record<string, number> = {};
  for (const row of dataGagal) {
    const kategori = (row.kategori_tidak_order || '').trim() || 'Tidak dikategorikan';
    kategoriTidakOrderCount[kategori] = (kategoriTidakOrderCount[kategori] || 0) + 1;
  }
  const breakdownKategoriTidakOrder = Object.entries(kategoriTidakOrderCount)
    .map(([kategori, jumlah]) => ({ kategori, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah);

  // Rangkuman alasan "menolak jadi member" (GET_MEMBER) — ambil dari fitur Member
  // Baru pada tanggal & filter yang sama, supaya kedua diagram batang di Dashboard
  // menampilkan periode yang identik.
  const breakdownKategoriMenolak = source === 'by_call' ? [] : (memberData?.breakdown_kategori_menolak || []);

  const dataKunjungan = (allKunjungan || []).map((row: any) => {
    const kode = String(row.kode_member || '').trim().toUpperCase();
    const berhasil = row.berhasil_order === true || row.berhasil_order === 't';
    const countedOrder = berhasil && !!kode && dataBerhasil[kode] === row;
    return {
      ...row,
      dihitung_order: countedOrder,
      rp: countedOrder ? (detailRp[kode]?.rp ?? 0) : 0,
      nama: detailRp[kode]?.nama ?? row.nama_toko ?? kode,
    };
  });

  return {
    tgl_dari: tglDari,
    tgl_sampai: tglSampai,
    // compatibility fields for older frontend/export code
    tgl_filter: tglSampai,
    tgl_kemarin: tglKemarin,
    summary: summaryArr,
    data_kunjungan: dataKunjungan,
    data_berhasil: berhasilArr,
    data_gagal: dataGagal,
    totals: { kunjungan: totalKunjungan, belanja: totalBelanja, gagal: totalGagal, rph: totalRph, avg_strike: avgStrike },
    breakdown_kategori_tidak_order: breakdownKategoriTidakOrder,
    breakdown_kategori_menolak: breakdownKategoriMenolak,
    source,
    source_label: dashboardSourceLabel(source),
    member_filter: memberFilter,
    member_filter_counts: filterCounts,
    db_lokal_connected: getDbStatus().connected,
    // listUsers tetap dikirim semuanya agar frontend tahu siapa saja yang tipe GET & RKM
    advisor_list: (listUsers || []).map((u: any) => ({ 
      username: u.username, 
      nama_lengkap: u.nama_lengkap || u.username,
      user_type: u.user_type
    })),
  };
}

dashboardRouter.get('/', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || (req.query.tgl as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || (req.query.tgl as string) || tglDari;
    const petugas = (req.query.petugas as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const memberFilter = normalizeDashboardMemberFilter(req.query.member_filter as string | undefined);

    const cacheKey = `DASH::rkm::${cabang}::${tglDari}::${tglSampai}::${petugas}::${memberFilter}`;
    const now = Date.now();
    const cached = dashboardResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.json(cached.data);
      return;
    }

    const data = await buildDashboard(tglDari, tglSampai, petugas, cabang, undefined, memberFilter);
    dashboardResponseCache.set(cacheKey, { expiresAt: now + 20_000, data });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dashboardRouter.get('/by-call', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || (req.query.tgl as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || (req.query.tgl as string) || tglDari;
    const petugas = (req.query.petugas as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const memberFilter = normalizeDashboardMemberFilter(req.query.member_filter as string | undefined);

    const cacheKey = `DASH::by_call::${cabang}::${tglDari}::${tglSampai}::${petugas}::${memberFilter}`;
    const now = Date.now();
    const cached = dashboardResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.json(cached.data);
      return;
    }

    const data = await buildDashboard(tglDari, tglSampai, petugas, cabang, undefined, memberFilter, 'by_call');
    dashboardResponseCache.set(cacheKey, { expiresAt: now + 20_000, data });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dashboardRouter.get('/cabang-list', async (_req, res) => {
  try {
    const envList = (process.env.CABANG_LIST || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const envDefault = (process.env.CABANG_DEFAULT || '').trim();

    if (envList.length > 0) {
      res.json({ cabang: envList, default: envDefault || envList[0], source: 'env' });
      return;
    }

    // Setup 1-cabang-per-instance: cukup isi CABANG_DEFAULT saja di .env,
    // tanpa perlu CABANG_LIST. Sebelumnya baris ini terlewat kalau CABANG_LIST
    // kosong, jadi CABANG_DEFAULT diabaikan dan selalu jatuh ke fallback
    // Supabase di bawah (yang milih cabang pertama secara alfabetis).
    if (envDefault) {
      res.json({ cabang: [envDefault], default: envDefault, source: 'env' });
      return;
    }

    const rows = await fetchSupabase<any>(`tbmaster_user?select=cabang`).catch(() => []);
    const cabangSet = Array.from(new Set((rows || []).map((r: any) => r.cabang).filter(Boolean))).sort();
    res.json({ cabang: cabangSet, default: cabangSet[0] || '', source: 'supabase' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dashboardRouter.get('/export', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || (req.query.tgl as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || (req.query.tgl as string) || tglDari;
    const petugas = (req.query.petugas as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const memberFilter = normalizeDashboardMemberFilter(req.query.member_filter as string | undefined);
    const data = await buildDashboard(tglDari, tglSampai, petugas, cabang, undefined, memberFilter);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Kunjungan');
    ws.addRow([`SPI ${cabang} - DATA KUNJUNGAN RKM`]);
    ws.addRow([`Periode: ${data.tgl_dari} s/d ${data.tgl_sampai} | Filter Member: ${data.member_filter}`]);
    ws.addRow([]);
    const header = ws.addRow([
      'No', 'Waktu', 'Advisor', 'Kode Member', 'Nama Toko', 'Status',
      'Dihitung Order', 'Total RPH', 'Kategori Tidak Order', 'Alasan Tidak Order'
    ]);
    styleHeaderRow(header);

    (data.data_kunjungan || []).forEach((row: any, i: number) => {
      const berhasil = row.berhasil_order === true || row.berhasil_order === 't';
      ws.addRow([
        i + 1,
        formatWIBDateTime(row.created_at),
        row.username || '',
        row.kode_member || '',
        row.nama || row.nama_toko || '',
        berhasil ? 'Berhasil Order' : 'Tidak Berhasil',
        row.dihitung_order ? 'YA' : 'TIDAK',
        row.rp || 0,
        row.kategori_tidak_order || '',
        row.alasan_tidak_order || '',
      ]);
    });
    ws.getColumn(8).numFmt = '"Rp"#,##0';
    ws.columns.forEach((c, i) => (c.width = [7, 21, 16, 18, 32, 18, 16, 20, 28, 40][i] || 18));
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, ws.rowCount), column: 10 } };

    await sendWorkbook(res, wb, `SPI_${cabang}_RKM_${data.tgl_dari}_sd_${data.tgl_sampai}.xlsx`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dashboardRouter.get('/by-call/export', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || (req.query.tgl as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || (req.query.tgl as string) || tglDari;
    const petugas = (req.query.petugas as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const memberFilter = normalizeDashboardMemberFilter(req.query.member_filter as string | undefined);
    const data = await buildDashboard(tglDari, tglSampai, petugas, cabang, undefined, memberFilter, 'by_call');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Member Belanja');
    ws.addRow([`SPI ${cabang} - BY CALL MEMBER BELANJA`]);
    ws.addRow([`Periode: ${data.tgl_dari} s/d ${data.tgl_sampai} | Filter Member: ${data.member_filter}`]);
    ws.addRow([]);
    const header = ws.addRow(['No', 'Waktu', 'Advisor', 'Kode Member', 'Nama Toko', 'Dihitung Belanja', 'Total RPH', 'No Transaksi']);
    styleHeaderRow(header);
    (data.data_kunjungan || []).forEach((row: any, i: number) => {
      ws.addRow([
        i + 1,
        formatWIBDateTime(row.created_at),
        row.username || '',
        row.kode_member || '',
        row.nama || row.nama_toko || '',
        row.dihitung_order ? 'YA' : 'TIDAK',
        row.rp || 0,
        row.no_trx || '',
      ]);
    });
    ws.getColumn(7).numFmt = '"Rp"#,##0';
    ws.columns.forEach((c, i) => (c.width = [7, 21, 16, 18, 32, 18, 20, 22][i] || 18));
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, ws.rowCount), column: 8 } };

    await sendWorkbook(res, wb, `SPI_${cabang}_BY_CALL_${data.tgl_dari}_sd_${data.tgl_sampai}.xlsx`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Monthly matrix report ("LAPORAN HARIAN PRODUKTIFITAS TEAM MR")
// ============================================================
dashboardRouter.get('/export-bulanan', async (req, res) => {
  try {
    const nowWib = getWIBDate(new Date());
    const bulan = ((req.query.bulan as string) || String(nowWib.getMonth() + 1)).padStart(2, '0');
    const tahun = parseInt((req.query.tahun as string) || String(nowWib.getFullYear()), 10);
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const advisorParam = (req.query.advisor as string) || '';
    const advisorFilter = advisorParam ? advisorParam.split(',').map((s) => s.trim()) : [];
    const source: DashboardVisitSource = req.query.source === 'by_call' ? 'by_call' : 'rkm';
    const visitTable = dashboardVisitTable(source);
    const sourceLabel = dashboardSourceLabel(source);
    const bulanIdx = parseInt(bulan, 10) - 1;
    const namaBulan = NAMA_BULAN[bulanIdx];

    const tglAwal = `${tahun}-${bulan}-01`;
    const jmlHari = new Date(tahun, parseInt(bulan, 10), 0).getDate();
    const tglAkhir = `${tahun}-${bulan}-${String(jmlHari).padStart(2, '0')}`;

    const listUsers = await fetchSupabaseCached<any>(
      `tbmaster_user?select=username,nama_lengkap,user_type&cabang=eq.${encodeURIComponent(cabang)}`,
      60_000
    ).catch(() => []);
    
    const allUsers: Record<string, string> = {};
    const userTypes: Record<string, string> = {}; 

    for (const u of listUsers || []) {
      if (advisorFilter.length > 0 && !advisorFilter.includes(u.username)) continue;
      allUsers[u.username] = u.nama_lengkap || u.username;
      userTypes[u.username] = u.user_type?.toUpperCase() || ''; 
    }
    const activeKeys = Object.keys(allUsers);

    // ============================================================
    // PEMISAHAN KUNCI ADVISOR BERDASARKAN TIPE
    // ============================================================
    const rkmAdvisorKeys = activeKeys.filter(adv => userTypes[adv] === 'RKM');
    const gmAdvisorKeys = activeKeys.filter(adv => userTypes[adv] === 'GET' || userTypes[adv] === 'RKM');

    // BY CALL punya format bulanan sendiri: hanya member yang berhasil belanja.
    // Tidak ada Tidak Berhasil, Effective Call, konversi, maupun persentase.
    if (source === 'by_call') {
      const byCallRows = rkmAdvisorKeys.length > 0
        ? await fetchSupabaseAllCached<any>(
            `${visitTable}?select=username,created_at,berhasil_order,kode_member,nama_toko,cabang,no_trx&cabang=eq.${encodeURIComponent(
              cabang
            )}&berhasil_order=eq.true&created_at=gte.${tglAwal}T00:00:00%2B07:00&created_at=lte.${tglAkhir}T23:59:59%2B07:00&username=in.(${rkmAdvisorKeys.join(',')})&order=created_at.asc`,
            { maxRows: Math.max(1000, parseInt(process.env.MAX_EXPORT_ROWS || '20000', 10)), ttlMs: 60_000 }
          )
        : [];

      const dailyCodes: Record<string, Record<string, Set<string>>> = {};
      const memberDayAdvisor: Record<string, string> = {};
      for (const adv of rkmAdvisorKeys) {
        dailyCodes[adv] = {};
        for (let d = 1; d <= jmlHari; d++) dailyCodes[adv][String(d).padStart(2, '0')] = new Set<string>();
      }

      const byCallSeenByDay = new Set<string>();
      for (const row of byCallRows || []) {
        const adv = row.username;
        const kode = String(row.kode_member || '').trim().toUpperCase();
        if (!dailyCodes[adv] || !kode) continue;
        const dt = getWIBDate(row.created_at);
        const dd = String(dt.getDate()).padStart(2, '0');
        const orderKey = `${kode}|${dd}`;
        if (byCallSeenByDay.has(orderKey)) continue;
        byCallSeenByDay.add(orderKey);
        dailyCodes[adv][dd].add(kode);
        memberDayAdvisor[orderKey] = adv;
      }

      const dailyRph: Record<string, Record<string, number>> = {};
      for (const adv of rkmAdvisorKeys) {
        dailyRph[adv] = {};
        for (let d = 1; d <= jmlHari; d++) dailyRph[adv][String(d).padStart(2, '0')] = 0;
      }

      const kodeList = Array.from(new Set((byCallRows || []).map((r: any) => String(r.kode_member || '').trim().toUpperCase()).filter(Boolean)));
      if (kodeList.length > 0) {
        try {
          const tglAwalMinus1 = addDays(tglAwal, -1);
          const rows = await queryLocal(
            `SELECT H.OBI_KDMEMBER, DATE(H.OBI_TGLPB) AS TGL,
                    SUM(H.OBI_TTLORDER + H.OBI_TTLPPN - COALESCE(P.CASHBACK_ORDER, 0)) AS TOTAL_RP
             FROM tbtr_obi_h H
             INNER JOIN tbmaster_customer C ON H.OBI_KDMEMBER = C.CUS_KODEMEMBER
             LEFT JOIN (SELECT NO_PB, SUM(CASHBACK_ORDER) AS CASHBACK_ORDER FROM PROMO_KLIKIGR GROUP BY NO_PB) P
                    ON P.NO_PB = H.OBI_NOPB
             WHERE C.CUS_KODEIGR = $1 AND H.OBI_KDMEMBER = ANY($2::text[])
               AND H.OBI_TGLPB BETWEEN $3 AND $4
             GROUP BY H.OBI_KDMEMBER, DATE(H.OBI_TGLPB)`,
            [cabang, kodeList, `${tglAwalMinus1} 00:00:00`, `${tglAkhir} 23:59:59`]
          );
          const byMemberDate: Record<string, Record<string, number>> = {};
          for (const r of rows || []) {
            const dt = getWIBDate(r.tgl);
            const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            const kode = String(r.obi_kdmember || '').trim().toUpperCase();
            byMemberDate[kode] = byMemberDate[kode] || {};
            byMemberDate[kode][key] = (byMemberDate[kode][key] || 0) + (parseFloat(r.total_rp) || 0);
          }
          for (const [memberDay, adv] of Object.entries(memberDayAdvisor)) {
            const [kode, dd] = memberDay.split('|');
            const tglCall = `${tahun}-${bulan}-${dd}`;
            const prev = addDays(tglCall, -1);
            const rp = (byMemberDate[kode]?.[tglCall] || 0) + (byMemberDate[kode]?.[prev] || 0);
            dailyRph[adv][dd] = (dailyRph[adv][dd] || 0) + rp;
          }
        } catch {
          // DB lokal offline: jumlah member tetap tersedia, nilai RPH menjadi 0.
        }
      }

      const wbByCall = new ExcelJS.Workbook();
      // Summary bulanan dihapus; hanya data harian yang diexport agar tidak ada agregat ganda.
      const wsDaily = wbByCall.addWorksheet('Harian By Call');
      const dayHeaders = Array.from({ length: jmlHari }, (_, i) => String(i + 1).padStart(2, '0'));
      const hd = wsDaily.addRow(['Advisor', 'Metrik', 'Total', ...dayHeaders]);
      styleHeaderRow(hd);
      for (const adv of rkmAdvisorKeys) {
        const counts = dayHeaders.map((dd) => dailyCodes[adv][dd].size);
        const rphVals = dayHeaders.map((dd) => dailyRph[adv][dd] || 0);
        wsDaily.addRow([adv, 'Member Belanja', counts.reduce((a, b) => a + b, 0), ...counts]);
        wsDaily.addRow([adv, 'RPH', rphVals.reduce((a, b) => a + b, 0), ...rphVals]);
      }
      wsDaily.columns.forEach((c, i) => (c.width = i < 3 ? [18, 18, 14][i] : 8));

      await sendWorkbook(res, wbByCall, `SPI_${cabang}_BY_CALL_BELANJA_${tahun}_${bulan}.xlsx`);
      return;
    }

    // ============================================================
    // 1. DATA UNTUK SHEET 1 (LAPORAN) -> HANYA RKM
    // ============================================================
    const allKunjungan =
      rkmAdvisorKeys.length > 0
        ? await fetchSupabaseAllCached<any>(
            `${visitTable}?select=username,created_at,berhasil_order,kode_member,nama_toko,cabang,kategori_tidak_order,alasan_tidak_order&cabang=eq.${encodeURIComponent(
              cabang
            )}&created_at=gte.${tglAwal}T00:00:00%2B07:00&created_at=lte.${tglAkhir}T23:59:59%2B07:00&username=in.(${rkmAdvisorKeys.join(',')})&order=created_at.asc`,
            { maxRows: Math.max(1000, parseInt(process.env.MAX_EXPORT_ROWS || '20000', 10)), ttlMs: 60_000 }
          )
        : [];

    const dataHarian: Record<string, Record<string, { kunjungan: number; belanja: number; gagal: number; kode_members: string[] }>> = {};
    for (const adv of rkmAdvisorKeys) {
      dataHarian[adv] = {};
      for (let d = 1; d <= jmlHari; d++) {
        dataHarian[adv][String(d).padStart(2, '0')] = { kunjungan: 0, belanja: 0, gagal: 0, kode_members: [] };
      }
    }

    const kdHariAdv: Record<string, Record<string, string>> = {};
    const alasanRows: Array<{ tanggal: string; jenis: string; advisor: string; cabang: string; kode_member: string; nama_toko: string; kategori: string; alasan: string }> = [];
    // Dashboard harian hanya menghitung satu order unik per kode member per hari.
    // Export bulanan memakai aturan yang sama agar total per tanggal identik.
    const orderSeenByDay = new Set<string>();

    for (const row of allKunjungan || []) {
      const adv = row.username;
      if (!dataHarian[adv]) continue;
      
      const tglRow = getWIBDate(row.created_at);
      const dd = tglRow.getDate().toString().padStart(2, '0');
      
      dataHarian[adv][dd].kunjungan++;
      const berhasil = row.berhasil_order === true || row.berhasil_order === 't';
      const kodeNorm = String(row.kode_member || '').trim().toUpperCase();
      const orderKey = `${kodeNorm}|${dd}`;
      if (berhasil && kodeNorm && !orderSeenByDay.has(orderKey)) {
        orderSeenByDay.add(orderKey);
        dataHarian[adv][dd].belanja++;
        dataHarian[adv][dd].kode_members.push(kodeNorm);
        kdHariAdv[kodeNorm] = kdHariAdv[kodeNorm] || {};
        kdHariAdv[kodeNorm][dd] = adv;
      }
      if (!berhasil) {
        dataHarian[adv][dd].gagal++;
        const yyyy = tglRow.getFullYear();
        const mm = String(tglRow.getMonth() + 1).padStart(2, '0');
        const dStr = String(tglRow.getDate()).padStart(2, '0');

        alasanRows.push({
          tanggal: `${yyyy}-${mm}-${dStr}`,
          jenis: `Tidak Order (${sourceLabel})`,
          advisor: adv,
          cabang: row.cabang || cabang,
          kode_member: row.kode_member || '-',
          nama_toko: row.nama_toko || '-',
          kategori: row.kategori_tidak_order || '-',
          alasan: row.alasan_tidak_order || '-',
        });
      }
    }

    const dataRph: Record<string, Record<string, number>> = {};
    const rphByMemberVisit: Record<string, number> = {}; // key: KODE|DD, dipakai sheet kategori member
    for (const adv of rkmAdvisorKeys) dataRph[adv] = {};

    const kdList = Object.keys(kdHariAdv);
    if (kdList.length > 0) {
      try {
        const tglAwalMinus1Str = addDays(tglAwal, -1);

        const rows = await queryLocal(
          `SELECT H.OBI_KDMEMBER, DATE(H.OBI_TGLPB) AS TGL,
                  SUM(H.OBI_TTLORDER + H.OBI_TTLPPN - COALESCE(P.CASHBACK_ORDER, 0)) AS TOTAL_RP
           FROM tbtr_obi_h H
           INNER JOIN tbmaster_customer C ON H.OBI_KDMEMBER = C.CUS_KODEMEMBER
           LEFT JOIN (SELECT NO_PB, SUM(CASHBACK_ORDER) AS CASHBACK_ORDER FROM PROMO_KLIKIGR GROUP BY NO_PB) P
                  ON P.NO_PB = H.OBI_NOPB
           WHERE C.CUS_KODEIGR = $1 AND H.OBI_KDMEMBER = ANY($2::text[])
             AND H.OBI_TGLPB BETWEEN $3 AND $4
           GROUP BY H.OBI_KDMEMBER, DATE(H.OBI_TGLPB)`,
          [cabang, kdList, `${tglAwalMinus1Str} 00:00:00`, `${tglAkhir} 23:59:59`]
        );

        const rphByMemberTgl: Record<string, Record<string, number>> = {};
        for (const r of rows) {
          const dTgl = getWIBDate(r.tgl);
          const yyyy = dTgl.getFullYear();
          const mm = String(dTgl.getMonth() + 1).padStart(2, '0');
          const dd = String(dTgl.getDate()).padStart(2, '0');
          const tglKey = `${yyyy}-${mm}-${dd}`;
          
          const kode = String(r.obi_kdmember || '').trim().toUpperCase();
          rphByMemberTgl[kode] = rphByMemberTgl[kode] || {};
          rphByMemberTgl[kode][tglKey] = (rphByMemberTgl[kode][tglKey] || 0) + (parseFloat(r.total_rp) || 0);
        }

        for (const [kd, hariAdvMap] of Object.entries(kdHariAdv)) {
          for (const [dd, adv] of Object.entries(hariAdvMap)) {
            const tglH = `${tahun}-${bulan}-${dd}`;
            const tglH1 = addDays(tglH, -1);
            const rp = (rphByMemberTgl[kd]?.[tglH] ?? 0) + (rphByMemberTgl[kd]?.[tglH1] ?? 0);
            if (rp > 0) {
              dataRph[adv][dd] = (dataRph[adv][dd] ?? 0) + rp;
              rphByMemberVisit[`${kd}|${dd}`] = rp;
            }
          }
        }
      } catch {
        // local DB unreachable
      }
    }

    // ============================================================
    // 2. DATA UNTUK SHEET 2 (GET MEMBER) -> RKM DAN GET
    // ============================================================
    const allMember =
      gmAdvisorKeys.length > 0
        ? await fetchSupabaseAllCached<any>(
            `tbtr_member_baru?select=username,tanggal,mau_jadi_member,kategori_menolak,alasan_menolak,nama_toko,kode_member&cabang=eq.${encodeURIComponent(
              cabang
            )}&tanggal=gte.${tglAwal}T00:00:00%2B07:00&tanggal=lte.${tglAkhir}T23:59:59%2B07:00&username=in.(${gmAdvisorKeys.join(',')})&order=tanggal.asc`,
            { maxRows: Math.max(1000, parseInt(process.env.MAX_EXPORT_ROWS || '20000', 10)), ttlMs: 60_000 }
          )
        : [];

    const gmHarian: Record<string, Record<string, number>> = {}; // total kunjungan per hari
    const gmJadiHarian: Record<string, Record<string, number>> = {}; // mau_jadi_member=true per hari
    const gmTolakHarian: Record<string, Record<string, number>> = {}; // mau_jadi_member=false per hari
    const gmTotal: Record<string, { total: number; jadi: number; tolak: number }> = {};
    
    for (const adv of gmAdvisorKeys) {
      gmHarian[adv] = {};
      gmJadiHarian[adv] = {};
      gmTolakHarian[adv] = {};
      for (let d = 1; d <= jmlHari; d++) {
        gmHarian[adv][String(d).padStart(2, '0')] = 0;
        gmJadiHarian[adv][String(d).padStart(2, '0')] = 0;
        gmTolakHarian[adv][String(d).padStart(2, '0')] = 0;
      }
      gmTotal[adv] = { total: 0, jadi: 0, tolak: 0 };
    }
    
    for (const row of allMember || []) {
      const adv = row.username || '';
      if (!gmHarian[adv]) continue;
      
      const tglRow = getWIBDate(row.tanggal || Date.now());
      const dd = tglRow.getDate().toString().padStart(2, '0');
      
      // "Kunjungan" = SETIAP baris di tbtr_member_baru (semua prospek yang didatangi,
      // apapun hasilnya). "Jadi Member" = HANYA yang mau_jadi_member = true. Dua angka
      // ini beda dan harus ditampilkan terpisah, bukan dicampur jadi satu.
      gmHarian[adv][dd]++;
      gmTotal[adv].total++;
      const jadi = row.mau_jadi_member === true || row.mau_jadi_member === 't';
      const tolak = row.mau_jadi_member === false || row.mau_jadi_member === 'f';
      if (jadi) {
        gmTotal[adv].jadi++;
        gmJadiHarian[adv][dd]++;
      } else if (tolak) {
        gmTotal[adv].tolak++;
        gmTolakHarian[adv][dd]++;
        const tglRow2 = getWIBDate(row.tanggal || Date.now());
        alasanRows.push({
          tanggal: `${tglRow2.getFullYear()}-${String(tglRow2.getMonth() + 1).padStart(2, '0')}-${String(tglRow2.getDate()).padStart(2, '0')}`,
          jenis: 'Menolak Jadi Member',
          advisor: adv,
          cabang: row.cabang || cabang,
          kode_member: row.kode_member || '-',
          nama_toko: row.nama_toko || '-',
          kategori: row.kategori_menolak || '-',
          alasan: row.alasan_menolak || '-',
        });
      }
    }

    // ============================================================
    // 3. DATA UNTUK SHEET 4 (FOLLOW UP SLEEPER & BELUM AKTIVASI) -> HANYA RKM
    // Klasifikasi tipe_member dihitung langsung dari DB lokal (sama seperti
    // dashboard Member Sleeper), lalu dicocokkan ke setiap kunjungan RKM
    // bulan ini untuk menghitung berapa kali advisor follow up sleeper /
    // member belum aktivasi.
    // ============================================================
    const kodeMemberDikunjungi = Array.from(
      new Set((allKunjungan || []).map((r: any) => String(r.kode_member || '').trim().toUpperCase()).filter(Boolean))
    );
    const tipeMemberMap: Record<string, string> = {};
    if (kodeMemberDikunjungi.length > 0) {
      try {
        const tipeRows = await queryLocal(
          `SELECT
             c.cus_kodemember,
             CASE
                 WHEN b.belanja_pertama IS NULL THEN 'Belum Aktivasi'
                 WHEN b.belanja_terakhir < CURRENT_DATE - INTERVAL '3 months' THEN 'Sleeper'
                 ELSE 'Aktif'
             END AS tipe_member
           FROM tbmaster_customer c
           LEFT JOIN (
             SELECT
               jh_cus_kodemember,
               DATE_TRUNC('day', MIN(jh_transactiondate)) AS belanja_pertama,
               DATE_TRUNC('day', MAX(jh_transactiondate)) AS belanja_terakhir
             FROM tbtr_jualheader
             WHERE jh_cus_kodemember IS NOT NULL
             GROUP BY jh_cus_kodemember
           ) b ON c.cus_kodemember = b.jh_cus_kodemember
           WHERE c.cus_kodeigr = $1 AND c.cus_kodemember = ANY($2::text[])`,
          [cabang, kodeMemberDikunjungi]
        );
        for (const r of tipeRows) tipeMemberMap[String(r.cus_kodemember || '').trim().toUpperCase()] = r.tipe_member;
      } catch {
        // DB lokal tidak terhubung — sheet Follow Up akan kosong, sheet lain tetap jalan.
      }
    }

    // Member Pilihan adalah master aktif; satu member tetap bisa sekaligus Sleeper / Belum Aktivasi.
    const pilihanRowsBulan = await fetchSupabase<any>(
      `tbtr_member_pilihan?select=kode_member&cabang=eq.${encodeURIComponent(cabang)}&kode_member=in.(${kodeMemberDikunjungi.join(',')})`
    ).catch(() => []);
    const memberPilihanSet = new Set<string>();
    for (const r of pilihanRowsBulan || []) {
      const kode = String(r.kode_member || '').trim().toUpperCase();
      if (kode) memberPilihanSet.add(kode);
    }

    type CategoryCell = { kunjungan: number; belanja: number; gagal: number; rph: number; orderCodes: Set<string> };
    type CategoryMatrix = Record<string, Record<string, CategoryCell>>;

    const buildCategoryMatrix = (predicate: (kode: string) => boolean): CategoryMatrix => {
      const matrix: CategoryMatrix = {};
      const seenOrderByDay = new Set<string>();
      for (const adv of rkmAdvisorKeys) {
        matrix[adv] = {};
        for (let d = 1; d <= jmlHari; d++) {
          matrix[adv][String(d).padStart(2, '0')] = { kunjungan: 0, belanja: 0, gagal: 0, rph: 0, orderCodes: new Set<string>() };
        }
      }

      for (const row of allKunjungan || []) {
        const adv = row.username;
        const kode = String(row.kode_member || '').trim().toUpperCase();
        if (!matrix[adv] || !kode || !predicate(kode)) continue;
        const tglRow = getWIBDate(row.created_at);
        const dd = String(tglRow.getDate()).padStart(2, '0');
        const cell = matrix[adv][dd];
        cell.kunjungan++;
        const berhasil = row.berhasil_order === true || row.berhasil_order === 't';
        const orderKey = `${kode}|${dd}`;
        if (berhasil && !seenOrderByDay.has(orderKey)) {
          seenOrderByDay.add(orderKey);
          cell.orderCodes.add(kode);
          cell.belanja++;
          cell.rph += rphByMemberVisit[orderKey] || 0;
        } else if (!berhasil) {
          cell.gagal++;
        }
      }
      return matrix;
    };

    const sleeperMatrix = buildCategoryMatrix((kode) => tipeMemberMap[kode] === 'Sleeper');
    const belumAktivasiMatrix = buildCategoryMatrix((kode) => tipeMemberMap[kode] === 'Belum Aktivasi');
    const memberPilihanMatrix = buildCategoryMatrix((kode) => memberPilihanSet.has(kode));

    // ============================================================
    // Build workbook
    // ============================================================
    const wb = new ExcelJS.Workbook();
    const dicetak = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const lastCol = 4 + jmlHari; 
    const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
    const allBorders: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };

    // Ringkasan sengaja dihapus. Workbook langsung berisi laporan/detail agar
    // tidak ada perhitungan agregat kedua yang berpotensi berbeda dari dashboard.

    // ---------- Sheet 1: Laporan (HANYA RKM) ----------
    const wsLap = wb.addWorksheet('Laporan', { views: [{ state: 'frozen', xSplit: 3 }] });
    wsLap.getColumn(1).width = 22;
    wsLap.getColumn(2).width = 14;
    wsLap.getColumn(3).width = 14;
    wsLap.getColumn(4).width = 3;
    for (let d = 5; d <= lastCol; d++) wsLap.getColumn(d).width = 9;

    wsLap.mergeCells(1, 1, 1, lastCol);
    const titleCell = wsLap.getCell(1, 1);
    titleCell.value = 'LAPORAN HARIAN PRODUKTIFITAS TEAM MR';
    titleCell.font = { bold: true, size: 13 };

    wsLap.mergeCells(2, 1, 2, lastCol);
    const subCell = wsLap.getCell(2, 1);
    subCell.value = `Cabang: ${cabang} | Periode: ${namaBulan} ${tahun} | Dicetak: ${dicetak}`;
    subCell.font = { color: { argb: 'FF666666' } };

    let r = 4;
    // LOOP HANYA UNTUK ADVISOR RKM
    for (const adv of rkmAdvisorKeys) {
      const days = dataHarian[adv];
      let totalK = 0, totalB = 0, totalG = 0, totalR = 0, activeDays = 0;
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        totalK += days[dd].kunjungan;
        totalB += days[dd].belanja;
        totalG += days[dd].gagal;
        totalR += dataRph[adv][dd] ?? 0;
        if (days[dd].kunjungan > 0) activeDays++;
      }
      const denom = activeDays || 1;
      const avgK = Math.round(totalK / denom);
      const avgB = Math.round(totalB / denom);
      const avgR = Math.round(totalR / denom);
      const rataPerMember = totalB > 0 ? Math.round(totalR / totalB) : 0;
      const effTotal = totalK > 0 ? (totalB / totalK) * 100 : 0;

      wsLap.mergeCells(r, 1, r, 3);
      const advCell = wsLap.getCell(r, 1);
      advCell.value = `${adv.toUpperCase()} (${allUsers[adv]})`;
      advCell.font = { bold: true, size: 9 };
      advCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      const bulanCell = wsLap.getCell(r, 4);
      bulanCell.value = namaBulan.toUpperCase();
      bulanCell.font = { bold: true };
      bulanCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      bulanCell.alignment = { horizontal: 'center' };
      for (let d = 1; d <= jmlHari; d++) {
        const c = wsLap.getCell(r, 4 + d);
        c.value = d;
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        c.alignment = { horizontal: 'center' };
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      setCell(wsLap, r, 1, 'TANGGAL', { bold: true });
      setCell(wsLap, r, 2, 'AVG', { bold: true, center: true });
      setCell(wsLap, r, 3, 'TOTAL', { bold: true, center: true });
      greyCell(wsLap, r, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dow = new Date(`${tahun}-${bulan}-${String(d).padStart(2, '0')}T00:00:00`).getDay();
        setCell(wsLap, r, 4 + d, HARI_ABBR[dow], { center: true });
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      setCell(wsLap, r, 1, 'Kunjungan', { bold: true });
      setCell(wsLap, r, 2, avgK, { center: true });
      setCell(wsLap, r, 3, totalK, { bold: true, center: true });
      greyCell(wsLap, r, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const v = days[dd].kunjungan;
        setCell(wsLap, r, 4 + d, v > 0 ? v : null, { center: true });
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      setCell(wsLap, r, 1, 'Belanja (Order)', { bold: true });
      setCell(wsLap, r, 2, avgB, { center: true });
      setCell(wsLap, r, 3, totalB, { bold: true, center: true });
      greyCell(wsLap, r, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const v = days[dd].belanja;
        setCell(wsLap, r, 4 + d, v > 0 ? v : null, { center: true });
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      const redFillRkm = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } } as ExcelJS.Fill;
      setCell(wsLap, r, 1, 'Tidak Berhasil', { bold: true, fill: redFillRkm });
      setCell(wsLap, r, 2, activeDays > 0 ? Math.round(totalG / activeDays) : 0, { center: true, fill: redFillRkm });
      setCell(wsLap, r, 3, totalG, { bold: true, center: true, fill: redFillRkm });
      greyCell(wsLap, r, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const v = days[dd].gagal;
        setCell(wsLap, r, 4 + d, v > 0 ? v : null, { center: true });
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      const rupFmt = '"Rp"#,##0';
      setCell(wsLap, r, 1, 'TOTAL RPH', { bold: true });
      setCell(wsLap, r, 2, avgR, { center: true, numFmt: rupFmt });
      setCell(wsLap, r, 3, totalR, { bold: true, center: true, numFmt: rupFmt });
      greyCell(wsLap, r, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const v = dataRph[adv][dd] ?? 0;
        setCell(wsLap, r, 4 + d, v > 0 ? v : null, { center: true, numFmt: rupFmt });
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      setCell(wsLap, r, 1, 'Rata-rata per Member', { bold: true });
      setCell(wsLap, r, 2, rataPerMember, { center: true, numFmt: rupFmt });
      setCell(wsLap, r, 3, rataPerMember, { bold: true, center: true, numFmt: rupFmt });
      greyCell(wsLap, r, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const rphDay = dataRph[adv][dd] ?? 0;
        const belanjaDay = days[dd].belanja;
        const rata = belanjaDay > 0 ? Math.round(rphDay / belanjaDay) : 0;
        setCell(wsLap, r, 4 + d, rata > 0 ? rata : null, { center: true, numFmt: rupFmt });
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      const blueFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9BE7FF' } } as ExcelJS.Fill;
      setCell(wsLap, r, 1, 'Effektif call (%)', { bold: true, fill: blueFill });
      setCell(wsLap, r, 2, `${round1(effTotal)}%`, { bold: true, center: true, fill: blueFill });
      setCell(wsLap, r, 3, `${round1(effTotal)}%`, { bold: true, center: true, fill: blueFill });
      greyCell(wsLap, r, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const k = days[dd].kunjungan;
        const b = days[dd].belanja;
        const pct = k > 0 ? (b / k) * 100 : null;
        setCell(wsLap, r, 4 + d, pct !== null ? `${round1(pct)}%` : null, { center: true });
      }
      styleRowBorderAndAlign(wsLap, r, lastCol, allBorders);
      r++;

      r++; // spacer row
    }

    // ---------- Sheet 3: Get Member (GET & RKM) ----------
    // Format sama seperti sheet "Laporan": tiap advisor dapat blok sendiri
    // dengan baris terpisah untuk "Kunjungan" (SEMUA prospek yang didatangi,
    // apapun hasilnya) dan "Jadi Member" (HANYA yang mau_jadi_member = true)
    // + grid harian masing-masing — supaya dua angka ini tidak tercampur.
    const wsGm = wb.addWorksheet('Get Member', { views: [{ state: 'frozen', xSplit: 3 }] });
    const lastColGm = 4 + jmlHari;
    wsGm.getColumn(1).width = 22;
    wsGm.getColumn(2).width = 14;
    wsGm.getColumn(3).width = 14;
    wsGm.getColumn(4).width = 3;
    for (let d = 5; d <= lastColGm; d++) wsGm.getColumn(d).width = 9;

    wsGm.mergeCells(1, 1, 1, lastColGm);
    const gmTitle = wsGm.getCell(1, 1);
    gmTitle.value = `GET MEMBER — ${namaBulan.toUpperCase()} ${tahun}`;
    gmTitle.font = { bold: true, size: 13 };
    wsGm.mergeCells(2, 1, 2, lastColGm);
    const gmSub = wsGm.getCell(2, 1);
    gmSub.value = `Cabang: ${cabang} | Periode: ${namaBulan} ${tahun} | Dicetak: ${dicetak}`;
    gmSub.font = { color: { argb: 'FF666666' } };

    let gmRow = 4;

    // LOOP HANYA UNTUK ADVISOR GET DAN RKM
    for (const adv of gmAdvisorKeys) {
      const gm = gmTotal[adv] || { total: 0, jadi: 0, tolak: 0 };
      let activeDays = 0;
      for (let d = 1; d <= jmlHari; d++) if (gmHarian[adv][String(d).padStart(2, '0')] > 0) activeDays++;
      const denom = activeDays || 1;
      const avgKunjungan = Math.round(gm.total / denom);
      const avgJadi = Math.round(gm.jadi / denom);
      const avgTolak = Math.round(gm.tolak / denom);
      const konversi = gm.total > 0 ? (gm.jadi / gm.total) * 100 : 0;

      wsGm.mergeCells(gmRow, 1, gmRow, 3);
      const advCell = wsGm.getCell(gmRow, 1);
      advCell.value = `${adv.toUpperCase()} (${allUsers[adv]})`;
      advCell.font = { bold: true, size: 9 };
      advCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      const bulanCellGm = wsGm.getCell(gmRow, 4);
      bulanCellGm.value = namaBulan.toUpperCase();
      bulanCellGm.font = { bold: true };
      bulanCellGm.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      bulanCellGm.alignment = { horizontal: 'center' };
      for (let d = 1; d <= jmlHari; d++) {
        const c = wsGm.getCell(gmRow, 4 + d);
        c.value = d;
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        c.alignment = { horizontal: 'center' };
      }
      styleRowBorderAndAlign(wsGm, gmRow, lastColGm, allBorders);
      gmRow++;

      setCell(wsGm, gmRow, 1, 'TANGGAL', { bold: true });
      setCell(wsGm, gmRow, 2, 'AVG', { bold: true, center: true });
      setCell(wsGm, gmRow, 3, 'TOTAL', { bold: true, center: true });
      greyCell(wsGm, gmRow, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dow = new Date(`${tahun}-${bulan}-${String(d).padStart(2, '0')}T00:00:00`).getDay();
        setCell(wsGm, gmRow, 4 + d, HARI_ABBR[dow], { center: true });
      }
      styleRowBorderAndAlign(wsGm, gmRow, lastColGm, allBorders);
      gmRow++;

      // Baris "Kunjungan": SEMUA prospek yang didatangi bulan ini, apapun hasilnya.
      setCell(wsGm, gmRow, 1, 'Kunjungan', { bold: true });
      setCell(wsGm, gmRow, 2, avgKunjungan, { center: true });
      setCell(wsGm, gmRow, 3, gm.total, { bold: true, center: true });
      greyCell(wsGm, gmRow, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const v = gmHarian[adv][dd];
        setCell(wsGm, gmRow, 4 + d, v > 0 ? v : null, { center: true });
      }
      styleRowBorderAndAlign(wsGm, gmRow, lastColGm, allBorders);
      gmRow++;

      // Baris "Jadi Member": HANYA yang mau_jadi_member = true.
      const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } } as ExcelJS.Fill;
      setCell(wsGm, gmRow, 1, 'Jadi Member', { bold: true, fill: greenFill });
      setCell(wsGm, gmRow, 2, avgJadi, { center: true, fill: greenFill });
      setCell(wsGm, gmRow, 3, gm.jadi, { bold: true, center: true, fill: greenFill });
      greyCell(wsGm, gmRow, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const v = gmJadiHarian[adv][dd];
        setCell(wsGm, gmRow, 4 + d, v > 0 ? v : null, { center: true });
      }
      styleRowBorderAndAlign(wsGm, gmRow, lastColGm, allBorders);
      gmRow++;

      // Baris "Menolak": HANYA yang mau_jadi_member = false.
      const redFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } } as ExcelJS.Fill;
      setCell(wsGm, gmRow, 1, 'Menolak', { bold: true, fill: redFill });
      setCell(wsGm, gmRow, 2, avgTolak, { center: true, fill: redFill });
      setCell(wsGm, gmRow, 3, gm.tolak, { bold: true, center: true, fill: redFill });
      greyCell(wsGm, gmRow, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const v = gmTolakHarian[adv][dd];
        setCell(wsGm, gmRow, 4 + d, v > 0 ? v : null, { center: true });
      }
      styleRowBorderAndAlign(wsGm, gmRow, lastColGm, allBorders);
      gmRow++;

      // Baris "Konversi (%)": Jadi Member / Kunjungan.
      const blueFillGm = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9BE7FF' } } as ExcelJS.Fill;
      setCell(wsGm, gmRow, 1, 'Konversi Jadi Member (%)', { bold: true, fill: blueFillGm });
      setCell(wsGm, gmRow, 2, `${round1(konversi)}%`, { bold: true, center: true, fill: blueFillGm });
      setCell(wsGm, gmRow, 3, `${round1(konversi)}%`, { bold: true, center: true, fill: blueFillGm });
      greyCell(wsGm, gmRow, 4);
      for (let d = 1; d <= jmlHari; d++) {
        const dd = String(d).padStart(2, '0');
        const k = gmHarian[adv][dd];
        const j = gmJadiHarian[adv][dd];
        const pct = k > 0 ? (j / k) * 100 : null;
        setCell(wsGm, gmRow, 4 + d, pct !== null ? `${round1(pct)}%` : null, { center: true });
      }
      styleRowBorderAndAlign(wsGm, gmRow, lastColGm, allBorders);
      gmRow++;
      gmRow++; // spacer row

    }

    // Grand total/ringkasan dihapus sesuai kebutuhan export detail.

    // ---------- Sheet 4-6: Follow Up per kategori member (layout sama seperti Laporan) ----------
    const addCategoryReportSheet = (
      sheetName: string,
      title: string,
      matrix: CategoryMatrix,
      subtitleExtra = ''
    ) => {
      const wsCat = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', xSplit: 3 }] });
      wsCat.getColumn(1).width = 22;
      wsCat.getColumn(2).width = 14;
      wsCat.getColumn(3).width = 14;
      wsCat.getColumn(4).width = 3;
      for (let d = 5; d <= lastCol; d++) wsCat.getColumn(d).width = 9;

      wsCat.mergeCells(1, 1, 1, lastCol);
      const catTitle = wsCat.getCell(1, 1);
      catTitle.value = title;
      catTitle.font = { bold: true, size: 13 };

      wsCat.mergeCells(2, 1, 2, lastCol);
      const catSub = wsCat.getCell(2, 1);
      catSub.value = `Cabang: ${cabang} | Periode: ${namaBulan} ${tahun} | Dicetak: ${dicetak}${subtitleExtra}`;
      catSub.font = { color: { argb: 'FF666666' } };

      let row = 4;
      const rupFmt = '"Rp"#,##0';
      const blueFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9BE7FF' } } as ExcelJS.Fill;

      for (const adv of rkmAdvisorKeys) {
        const days = matrix[adv];
        if (!days) continue;

        let totalK = 0, totalB = 0, totalG = 0, totalR = 0, activeDays = 0;
        for (let d = 1; d <= jmlHari; d++) {
          const dd = String(d).padStart(2, '0');
          const cell = days[dd];
          totalK += cell.kunjungan;
          totalB += cell.belanja;
          totalG += cell.gagal;
          totalR += cell.rph;
          if (cell.kunjungan > 0) activeDays++;
        }
        const denom = activeDays || 1;
        const avgK = Math.round(totalK / denom);
        const avgB = Math.round(totalB / denom);
        const avgR = Math.round(totalR / denom);
        const rataPerMember = totalB > 0 ? Math.round(totalR / totalB) : 0;
        const effTotal = totalK > 0 ? (totalB / totalK) * 100 : 0;

        wsCat.mergeCells(row, 1, row, 3);
        const advCell = wsCat.getCell(row, 1);
        advCell.value = `${adv.toUpperCase()} (${allUsers[adv]})`;
        advCell.font = { bold: true, size: 9 };
        advCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        const bulanCell = wsCat.getCell(row, 4);
        bulanCell.value = namaBulan.toUpperCase();
        bulanCell.font = { bold: true };
        bulanCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        bulanCell.alignment = { horizontal: 'center' };
        for (let d = 1; d <= jmlHari; d++) {
          const c = wsCat.getCell(row, 4 + d);
          c.value = d;
          c.font = { bold: true };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
          c.alignment = { horizontal: 'center' };
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row++;

        setCell(wsCat, row, 1, 'TANGGAL', { bold: true });
        setCell(wsCat, row, 2, 'AVG', { bold: true, center: true });
        setCell(wsCat, row, 3, 'TOTAL', { bold: true, center: true });
        greyCell(wsCat, row, 4);
        for (let d = 1; d <= jmlHari; d++) {
          const dow = new Date(`${tahun}-${bulan}-${String(d).padStart(2, '0')}T00:00:00`).getDay();
          setCell(wsCat, row, 4 + d, HARI_ABBR[dow], { center: true });
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row++;

        setCell(wsCat, row, 1, 'Kunjungan', { bold: true });
        setCell(wsCat, row, 2, avgK, { center: true });
        setCell(wsCat, row, 3, totalK, { bold: true, center: true });
        greyCell(wsCat, row, 4);
        for (let d = 1; d <= jmlHari; d++) {
          const dd = String(d).padStart(2, '0');
          const v = days[dd].kunjungan;
          setCell(wsCat, row, 4 + d, v > 0 ? v : null, { center: true });
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row++;

        setCell(wsCat, row, 1, 'Belanja (Order)', { bold: true });
        setCell(wsCat, row, 2, avgB, { center: true });
        setCell(wsCat, row, 3, totalB, { bold: true, center: true });
        greyCell(wsCat, row, 4);
        for (let d = 1; d <= jmlHari; d++) {
          const dd = String(d).padStart(2, '0');
          const v = days[dd].belanja;
          setCell(wsCat, row, 4 + d, v > 0 ? v : null, { center: true });
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row++;

        const redFillCat = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } } as ExcelJS.Fill;
        setCell(wsCat, row, 1, 'Tidak Berhasil', { bold: true, fill: redFillCat });
        setCell(wsCat, row, 2, activeDays > 0 ? Math.round(totalG / activeDays) : 0, { center: true, fill: redFillCat });
        setCell(wsCat, row, 3, totalG, { bold: true, center: true, fill: redFillCat });
        greyCell(wsCat, row, 4);
        for (let d = 1; d <= jmlHari; d++) {
          const dd = String(d).padStart(2, '0');
          const v = days[dd].gagal;
          setCell(wsCat, row, 4 + d, v > 0 ? v : null, { center: true });
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row++;

        setCell(wsCat, row, 1, 'TOTAL RPH', { bold: true });
        setCell(wsCat, row, 2, avgR, { center: true, numFmt: rupFmt });
        setCell(wsCat, row, 3, totalR, { bold: true, center: true, numFmt: rupFmt });
        greyCell(wsCat, row, 4);
        for (let d = 1; d <= jmlHari; d++) {
          const dd = String(d).padStart(2, '0');
          const v = days[dd].rph;
          setCell(wsCat, row, 4 + d, v > 0 ? v : null, { center: true, numFmt: rupFmt });
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row++;

        setCell(wsCat, row, 1, 'Rata-rata per Member', { bold: true });
        setCell(wsCat, row, 2, rataPerMember, { center: true, numFmt: rupFmt });
        setCell(wsCat, row, 3, rataPerMember, { bold: true, center: true, numFmt: rupFmt });
        greyCell(wsCat, row, 4);
        for (let d = 1; d <= jmlHari; d++) {
          const dd = String(d).padStart(2, '0');
          const cell = days[dd];
          const rata = cell.belanja > 0 ? Math.round(cell.rph / cell.belanja) : 0;
          setCell(wsCat, row, 4 + d, rata > 0 ? rata : null, { center: true, numFmt: rupFmt });
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row++;

        setCell(wsCat, row, 1, 'Effektif call (%)', { bold: true, fill: blueFill });
        setCell(wsCat, row, 2, `${round1(effTotal)}%`, { bold: true, center: true, fill: blueFill });
        setCell(wsCat, row, 3, `${round1(effTotal)}%`, { bold: true, center: true, fill: blueFill });
        greyCell(wsCat, row, 4);
        for (let d = 1; d <= jmlHari; d++) {
          const dd = String(d).padStart(2, '0');
          const cell = days[dd];
          const pct = cell.kunjungan > 0 ? (cell.belanja / cell.kunjungan) * 100 : null;
          setCell(wsCat, row, 4 + d, pct !== null ? `${round1(pct)}%` : null, { center: true });
        }
        styleRowBorderAndAlign(wsCat, row, lastCol, allBorders);
        row += 2;
      }

      return wsCat;
    };

    addCategoryReportSheet(
      'Member Sleeper',
      `FOLLOW UP MEMBER SLEEPER — ${namaBulan.toUpperCase()} ${tahun}`,
      sleeperMatrix
    );
    addCategoryReportSheet(
      'Belum Aktivasi',
      `KUNJUNGAN MEMBER BELUM AKTIVASI — ${namaBulan.toUpperCase()} ${tahun}`,
      belumAktivasiMatrix
    );
    addCategoryReportSheet(
      'Member Pilihan',
      `MEMBER PILIHAN — ${namaBulan.toUpperCase()} ${tahun}`,
      memberPilihanMatrix,
      ` | Target kunjungan: 2x/member | Upload: ${memberPilihanSet.size} member`
    );

    // ---------- Sheet 7: Alasan ----------
    const wsAl = wb.addWorksheet('Alasan', { views: [{ state: 'frozen', ySplit: 4 }] });
    wsAl.mergeCells('A1:H1');
    const alTitle = wsAl.getCell('A1');
    alTitle.value = 'RINCIAN & EVALUASI ALASAN';
    alTitle.font = { bold: true, size: 14 };

    wsAl.mergeCells('A2:H2');
    const alSub = wsAl.getCell('A2');
    alSub.value = `Cabang: ${cabang} | Periode: ${namaBulan} ${tahun} | Dicetak: ${dicetak}`;
    alSub.font = { color: { argb: 'FF666666' } };

    const alHeaders = [
      'Tanggal',
      'Jenis',
      'Advisor',
      'Cabang',
      'Kode Member',
      'Nama Toko',
      'Kategori Tidak Order',
      'Alasan Tidak Order',
    ];
    const alHeaderRow = wsAl.getRow(4);
    alHeaders.forEach((h, i) => { alHeaderRow.getCell(i + 1).value = h; });
    styleHeaderRow(alHeaderRow);
    alHeaderRow.eachCell((c) => (c.border = allBorders));

    let alRowNo = 5;
    for (const a of alasanRows.sort((a, b) => a.tanggal.localeCompare(b.tanggal))) {
      const row = wsAl.getRow(alRowNo++);
      [a.tanggal, a.jenis, a.advisor.toUpperCase(), a.cabang, a.kode_member, a.nama_toko, a.kategori, a.alasan]
        .forEach((v, i) => { row.getCell(i + 1).value = v; });
      row.eachCell((c) => {
        c.border = allBorders;
        c.alignment = { vertical: 'top', wrapText: true };
      });
    }
    wsAl.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, alRowNo - 1), column: 8 } };
    wsAl.columns.forEach((c, i) => (c.width = [12, 22, 14, 10, 16, 30, 25, 38][i] || 16));

    // Rangkuman/chart alasan dihapus; sheet Alasan hanya berisi data detail.

    const filename = `Laporan_Produktifitas_${sourceLabel.replace(/\s+/g, '_')}_${namaBulan}_${tahun}.xlsx`;
    await sendWorkbook(res, wb, filename);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DASHBOARD KHUSUS SPV
// ============================================================

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

dashboardRouter.get('/spv', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || (req.query.tgl as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || (req.query.tgl as string) || tglDari;
    const spvFilter = (req.query.spv as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;

    // 1. Ambil nama lengkap user dari tbmaster_user untuk pelabelan
    const allUsers = await fetchSupabaseCached<any>(
      `tbmaster_user?select=username,nama_lengkap,role,cabang,is_active&order=nama_lengkap.asc`,
      60_000
    ).catch(() => []);

    const spvNamaMap: Record<string, string> = {};
    for (const u of allUsers || []) {
      spvNamaMap[u.username] = u.nama_lengkap || u.username;
    }

    // Ambil daftar SPV yang BENAR-BENAR memiliki riwayat kunjungan di tbtr_kunjungan_rkm_spv
    const spvWithData = await fetchSupabaseCached<any>(
      `tbtr_kunjungan_rkm_spv?select=username&cabang=eq.${encodeURIComponent(cabang)}&limit=2000`,
      30_000
    ).catch(() => []);
    const spvUsernamesWithData = new Set<string>();
    for (const r of spvWithData || []) {
      if (r.username) spvUsernamesWithData.add(String(r.username).trim());
    }

    const spvList = Array.from(spvUsernamesWithData)
      .map((uname) => ({
        username: uname,
        nama_lengkap: spvNamaMap[uname] || uname,
        role: 'spv',
      }))
      .sort((a, b) => a.username.localeCompare(b.username));

    // 2. Query kunjungan SPV
    let visitQuery = `tbtr_kunjungan_rkm_spv?select=id,username,tanggal,cabang,kode_member,nama_toko,berhasil_order,no_trx,kategori_tidak_order,alasan_tidak_order,catatan_spv,foto_kunjungan,latitude,longitude,is_in_radius,created_at&cabang=eq.${encodeURIComponent(
      cabang
    )}&tanggal=gte.${tglDari}T00:00:00%2B07:00&tanggal=lte.${tglSampai}T23:59:59%2B07:00&order=tanggal.desc`;

    if (spvFilter) {
      visitQuery += `&username=eq.${encodeURIComponent(spvFilter)}`;
    }

    const rawKunjungan = await fetchSupabase<any>(visitQuery).catch(() => []);

    // 3. Ambil RPH dari DB lokal jika ada yang berhasil order
    const orderMembers = new Set<string>();
    for (const k of rawKunjungan || []) {
      const berhasil = k.berhasil_order === true || k.berhasil_order === 't';
      const kode = String(k.kode_member || '').trim().toUpperCase();
      if (berhasil && kode) {
        orderMembers.add(kode);
      }
    }

    const memberRphMap: Record<string, { rp: number; nama: string }> = {};
    if (orderMembers.size > 0) {
      try {
        const tglKemarin = addDays(tglDari, -1);
        const rows = await queryLocal(
          `SELECT H.OBI_KDMEMBER, C.CUS_NAMAMEMBER,
                  SUM(H.OBI_TTLORDER + H.OBI_TTLPPN - COALESCE(P.CASHBACK_ORDER, 0)) AS TOTAL_RP
           FROM tbtr_obi_h H
           INNER JOIN tbmaster_customer C ON H.OBI_KDMEMBER = C.CUS_KODEMEMBER
           LEFT JOIN (SELECT NO_PB, SUM(CASHBACK_ORDER) AS CASHBACK_ORDER FROM PROMO_KLIKIGR GROUP BY NO_PB) P
                  ON P.NO_PB = H.OBI_NOPB
           WHERE C.CUS_KODEIGR = $1 AND H.OBI_KDMEMBER = ANY($2::text[])
             AND H.OBI_TGLPB BETWEEN $3 AND $4
           GROUP BY H.OBI_KDMEMBER, C.CUS_NAMAMEMBER`,
          [cabang, Array.from(orderMembers), `${tglKemarin} 00:00:00`, `${tglSampai} 23:59:59`]
        );
        for (const r of rows) {
          const kd = String(r.obi_kdmember || '').trim().toUpperCase();
          memberRphMap[kd] = { rp: parseFloat(r.total_rp) || 0, nama: r.cus_namamember };
        }
      } catch {
        // Local DB unreachable
      }
    }

    // 4. Hitung statistik dan summary per SPV (HANYA untuk SPV yang ADA datanya di tbtr_kunjungan_rkm_spv)
    const summarySpvMap: Record<string, {
      username: string;
      nama_lengkap: string;
      kunjungan: number;
      belanja: number;
      gagal: number;
      rph: number;
      in_radius: number;
      out_radius: number;
    }> = {};

    let totalKunjungan = 0;
    let totalBelanja = 0;
    let totalGagal = 0;
    let totalRph = 0;
    let totalInRadius = 0;
    let totalOutRadius = 0;

    const kategoriTidakOrderCount: Record<string, number> = {};

    const items = (rawKunjungan || []).map((row: any) => {
      const u = row.username;
      if (!summarySpvMap[u]) {
        summarySpvMap[u] = {
          username: u,
          nama_lengkap: spvNamaMap[u] || u,
          kunjungan: 0,
          belanja: 0,
          gagal: 0,
          rph: 0,
          in_radius: 0,
          out_radius: 0,
        };
      }

      totalKunjungan++;
      summarySpvMap[u].kunjungan++;

      const berhasil = row.berhasil_order === true || row.berhasil_order === 't';
      const kode = String(row.kode_member || '').trim().toUpperCase();
      const rp = (berhasil && kode) ? (memberRphMap[kode]?.rp || 0) : 0;

      if (berhasil) {
        totalBelanja++;
        summarySpvMap[u].belanja++;
        totalRph += rp;
        summarySpvMap[u].rph += rp;
      } else {
        totalGagal++;
        summarySpvMap[u].gagal++;
        const kat = (row.kategori_tidak_order || '').trim() || 'Tidak dikategorikan';
        kategoriTidakOrderCount[kat] = (kategoriTidakOrderCount[kat] || 0) + 1;
      }

      const inRadius = row.is_in_radius === true || row.is_in_radius === 't';
      if (inRadius) {
        totalInRadius++;
        summarySpvMap[u].in_radius++;
      } else {
        totalOutRadius++;
        summarySpvMap[u].out_radius++;
      }

      return {
        id: row.id,
        username: row.username,
        nama_lengkap: spvNamaMap[row.username] || row.username,
        tanggal: row.tanggal,
        cabang: row.cabang || cabang,
        kode_member: row.kode_member || '-',
        nama_toko: row.nama_toko || '-',
        berhasil_order: berhasil,
        no_trx: row.no_trx || null,
        kategori_tidak_order: row.kategori_tidak_order || null,
        alasan_tidak_order: row.alasan_tidak_order || null,
        catatan_spv: row.catatan_spv || null,
        foto_kunjungan: row.foto_kunjungan || null,
        foto_url: getSpvStoragePhotoUrl(row.foto_kunjungan),
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        is_in_radius: inRadius,
        created_at: row.created_at,
        rp,
      };
    });

    const summarySpvArr = Object.values(summarySpvMap)
      .filter((s) => s.kunjungan > 0 && (!spvFilter || s.username === spvFilter))
      .map((s) => ({
        ...s,
        strike_rate: s.kunjungan > 0 ? (s.belanja / s.kunjungan) * 100 : 0,
      }))
      .sort((a, b) => b.belanja - a.belanja || b.kunjungan - a.kunjungan);

    const breakdownKategoriTidakOrder = Object.entries(kategoriTidakOrderCount)
      .map(([kategori, jumlah]) => ({ kategori, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah);

    const dataBerhasilMap: Record<string, any> = {};
    for (const item of items) {
      if (item.berhasil_order) {
        const kode = String(item.kode_member || '').trim().toUpperCase();
        if (!dataBerhasilMap[kode]) {
          dataBerhasilMap[kode] = {
            ...item,
            nama: memberRphMap[kode]?.nama || item.nama_toko || kode,
          };
        }
      }
    }
    const dataBerhasil = Object.values(dataBerhasilMap);
    const dataGagal = items.filter((item) => !item.berhasil_order);

    const avgStrike = totalKunjungan > 0 ? (totalBelanja / totalKunjungan) * 100 : 0;
    const pctInRadius = totalKunjungan > 0 ? (totalInRadius / totalKunjungan) * 100 : 0;

    res.json({
      cabang,
      tgl_dari: tglDari,
      tgl_sampai: tglSampai,
      spv_list: spvList,
      totals: {
        kunjungan: totalKunjungan,
        belanja: totalBelanja,
        gagal: totalGagal,
        rph: totalRph,
        avg_strike: avgStrike,
        in_radius: totalInRadius,
        out_radius: totalOutRadius,
        pct_in_radius: pctInRadius,
      },
      summary: summarySpvArr,
      summary_spv: summarySpvArr,
      data_berhasil: dataBerhasil,
      data_gagal: dataGagal,
      breakdown_kategori_tidak_order: breakdownKategoriTidakOrder,
      kunjungan: items,
      db_lokal_connected: getDbStatus().connected,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dashboardRouter.get('/spv/export', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || (req.query.tgl as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || (req.query.tgl as string) || tglDari;
    const spvFilter = (req.query.spv as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;

    let visitQuery = `tbtr_kunjungan_rkm_spv?select=id,username,tanggal,cabang,kode_member,nama_toko,berhasil_order,no_trx,kategori_tidak_order,alasan_tidak_order,catatan_spv,foto_kunjungan,latitude,longitude,is_in_radius,created_at&cabang=eq.${encodeURIComponent(
      cabang
    )}&tanggal=gte.${tglDari}T00:00:00%2B07:00&tanggal=lte.${tglSampai}T23:59:59%2B07:00&order=tanggal.asc`;

    if (spvFilter) {
      visitQuery += `&username=eq.${encodeURIComponent(spvFilter)}`;
    }

    const rawKunjungan = await fetchSupabase<any>(visitQuery).catch(() => []);

    const allUsers = await fetchSupabaseCached<any>(
      `tbmaster_user?select=username,nama_lengkap,role,cabang,is_active`,
      60_000
    ).catch(() => []);
    const namaMap: Record<string, string> = {};
    for (const u of allUsers || []) namaMap[u.username] = u.nama_lengkap || u.username;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'RKM Visit Monitoring';
    const ws = wb.addWorksheet('Kunjungan SPV', { views: [{ state: 'frozen', ySplit: 4 }] });

    ws.mergeCells('A1:N1');
    const title = ws.getCell('A1');
    title.value = `LAPORAN KUNJUNGAN KHUSUS SPV — CABANG ${cabang}`;
    title.font = { bold: true, size: 14 };

    ws.mergeCells('A2:N2');
    const sub = ws.getCell('A2');
    sub.value = `Periode: ${tglDari} s/d ${tglSampai} | SPV: ${spvFilter || 'Semua SPV'} | Dicetak: ${formatWIBDateTime(new Date())}`;
    sub.font = { color: { argb: 'FF666666' } };

    const headers = [
      'No', 'Waktu (WIB)', 'SPV', 'Nama Lengkap', 'Kode Member', 'Nama Toko',
      'Status Order', 'No Trx', 'Kategori Tidak Order', 'Alasan Tidak Order',
      'Catatan SPV', 'In Radius', 'Koordinat GPS', 'Link Foto'
    ];
    const headerRow = ws.getRow(4);
    headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    styleHeaderRow(headerRow);

    const thinBorders: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    };

    let rowNo = 5;
    for (let i = 0; i < (rawKunjungan || []).length; i++) {
      const k = rawKunjungan[i];
      const berhasil = k.berhasil_order === true || k.berhasil_order === 't';
      const inRadius = k.is_in_radius === true || k.is_in_radius === 't';
      const fotoUrl = getSpvStoragePhotoUrl(k.foto_kunjungan);
      const row = ws.getRow(rowNo++);

      row.getCell(1).value = i + 1;
      row.getCell(2).value = formatWIBDateTime(k.tanggal || k.created_at);
      row.getCell(3).value = String(k.username || '').toUpperCase();
      row.getCell(4).value = namaMap[k.username] || k.username;
      row.getCell(5).value = k.kode_member || '-';
      row.getCell(6).value = k.nama_toko || '-';
      row.getCell(7).value = berhasil ? 'BERHASIL ORDER' : 'TIDAK ORDER';
      row.getCell(8).value = k.no_trx || '-';
      row.getCell(9).value = k.kategori_tidak_order || '-';
      row.getCell(10).value = k.alasan_tidak_order || '-';
      row.getCell(11).value = k.catatan_spv || '-';
      row.getCell(12).value = inRadius ? 'DALAM RADIUS' : 'DI LUAR RADIUS';
      row.getCell(13).value = k.latitude && k.longitude ? `${k.latitude}, ${k.longitude}` : '-';
      row.getCell(14).value = fotoUrl || '-';

      for (let c = 1; c <= 14; c++) {
        const cell = row.getCell(c);
        cell.border = thinBorders;
        cell.alignment = { vertical: 'top', wrapText: true };
      }
    }

    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, rowNo - 1), column: 14 } };
    ws.columns = [
      { width: 6 },  // No
      { width: 20 }, // Waktu
      { width: 14 }, // SPV
      { width: 22 }, // Nama Lengkap
      { width: 16 }, // Kode Member
      { width: 32 }, // Nama Toko
      { width: 16 }, // Status Order
      { width: 16 }, // No Trx
      { width: 22 }, // Kategori Tidak Order
      { width: 30 }, // Alasan Tidak Order
      { width: 35 }, // Catatan SPV
      { width: 16 }, // In Radius
      { width: 24 }, // Koordinat GPS
      { width: 45 }, // Link Foto
    ];

    const filename = `Laporan_Kunjungan_SPV_${cabang}_${tglDari}_sd_${tglSampai}.xlsx`;
    await sendWorkbook(res, wb, filename);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function setCell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: any,
  opts: { bold?: boolean; center?: boolean; numFmt?: string; color?: string; fill?: ExcelJS.Fill }
) {
  const c = ws.getCell(row, col);
  c.value = value;
  c.font = { bold: !!opts.bold, color: opts.color ? { argb: opts.color } : undefined };
  if (opts.center !== false) c.alignment = { horizontal: 'center' };
  if (opts.numFmt) c.numFmt = opts.numFmt;
  if (opts.fill) c.fill = opts.fill;
}

function greyCell(ws: ExcelJS.Worksheet, row: number, col: number) {
  const c = ws.getCell(row, col);
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
}

function styleRowBorderAndAlign(ws: ExcelJS.Worksheet, row: number, lastCol: number, border: Partial<ExcelJS.Borders>) {
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(row, c).border = border;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}