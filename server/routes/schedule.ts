import { Router } from 'express';
import { queryLocal, getDbStatus } from '../lib/db.js';
import { fetchSupabase, fetchSupabaseCached, fetchSupabaseAll, insertSupabase, insertManySupabase, updateSupabase, deleteSupabase } from '../lib/supabase.js';
import { distanceKm, bearing } from '../lib/geo.js';
import { sendWorkbook, styleHeaderRow } from '../lib/excel.js';
import { todayJakarta } from '../lib/dateUtil.js';
import { getHolidayInfo } from '../lib/holidays.js';
import ExcelJS from 'exceljs';

export const scheduleRouter = Router();

const JADWAL_SELECT = 'id,kode_member,nama_toko,username,cabang,latitude,longitude,tipe_member,status_visit,tanggal_jadwal';

const MAX_PER_DAY = 15;
const MAKS_PER_HARI_MIN = 1;
const MAKS_PER_HARI_MAX = 50;

function daysInMonth(bulan: number, tahun: number) {
  return new Date(tahun, bulan, 0).getDate();
}

/** Semua kode member (uppercased) yang PUNYA baris di tbtr_status_toko —
 *  dipakai untuk memblokir toko itu dari penjadwalan (baik hasil generate
 *  otomatis maupun input manual). Cukup TERDAFTAR di tabel ini, apapun isi
 *  kolom status/cabang-nya, toko langsung diblokir.
 *
 *  CATATAN: sengaja TIDAK difilter per cabang di sini. Kolom `cabang` di
 *  tbtr_status_toko boleh null / bisa saja tidak persis sama formatnya
 *  dengan cabang yang dipakai di penjadwalan, dan itu sebelumnya bikin
 *  blokir gagal kepasang secara diam-diam. kode_member sudah unik, jadi
 *  cukup itu saja yang dicocokkan. */
export async function getBlockedMemberCodes(): Promise<Set<string>> {
  const rows = await fetchSupabaseAll<any>(`tbtr_status_toko?select=kode_member`, { pageSize: 1000, maxRows: 50000 }).catch(() => []);
  const set = new Set<string>();
  for (const r of rows || []) {
    if (r.kode_member) set.add(String(r.kode_member).trim().toUpperCase());
  }
  return set;
}

/** Self-healing cleanup: hapus jadwal (hari ini & ke depan) di tbtr_jadwal_bulanan
 *  untuk SEMUA kode_member yang saat ini terdaftar di tbtr_status_toko. Dipanggil
 *  setiap kali daftar Toko Tutup dibuka/diubah, supaya toko yang diblokir lewat
 *  cara apa pun (termasuk yang sempat lolos sebelum perbaikan ini) tetap
 *  langsung hilang dari jadwal — bukan cuma dicegah masuk jadwal baru. */
async function purgeJadwalForBlockedStores(): Promise<number> {
  const blocked = await getBlockedMemberCodes();
  if (blocked.size === 0) return 0;
  const hariIni = new Date().toISOString().slice(0, 10);
  const codesArray = Array.from(blocked);
  const chunkSize = 100;
  let totalDeleted = 0;

  for (let i = 0; i < codesArray.length; i += chunkSize) {
    const chunk = codesArray.slice(i, i + chunkSize);
    const codes = chunk.map((c) => `"${c}"`).join(',');
    const existing = await fetchSupabase<any>(
      `tbtr_jadwal_bulanan?select=id&kode_member=in.(${codes})&tanggal_jadwal=gte.${hariIni}`
    ).catch(() => []);
    if (existing && existing.length > 0) {
      await deleteSupabase('tbtr_jadwal_bulanan', `kode_member=in.(${codes})&tanggal_jadwal=gte.${hariIni}`).catch(() => {});
      totalDeleted += existing.length;
    }
  }
  return totalDeleted;
}

scheduleRouter.get('/advisors', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '2T';
    const rows = await queryLocal(
      `SELECT DISTINCT cus_nosalesman FROM tbmaster_customer
       WHERE cus_kodeigr = $1 AND cus_recordid IS NULL
  AND cus_namamember <>'NEW' and cus_nosalesman IS NOT NULL AND cus_nosalesman != ''
       ORDER BY cus_nosalesman ASC`,
      [cabang]
    );
    res.json({ advisors: rows.map((r) => r.cus_nosalesman), db_lokal_connected: getDbStatus().connected });
  } catch (err: any) {
    res.status(500).json({ error: err.message, db_lokal_connected: false });
  }
});

interface MemberPilihanRecord {
  id?: number;
  kode_member: string;
  nama_toko?: string | null;
  advisor: string;
  cabang: string;
  catatan?: string | null;
  created_at?: string;
  /** Alias runtime agar kode generator lama tetap sederhana. Tidak disimpan ke DB. */
  username?: string;
}

function normCode(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

/**
 * tbtr_member_pilihan adalah master daftar Member Pilihan aktif.
 * Tidak ada bulan/tahun di tabel ini. Saat generate, daftar ini dicross-check
 * terhadap tbtr_jadwal_bulanan pada bulan yang sedang digenerate.
 */
async function getMemberPilihanPeriode(cabang: string, _tahun: number, _bulan: number, username = ''): Promise<MemberPilihanRecord[]> {
  let q = `tbtr_member_pilihan?select=*&cabang=eq.${encodeURIComponent(cabang)}&order=advisor.asc,kode_member.asc`;
  if (username) q += `&advisor=eq.${encodeURIComponent(username)}`;
  const rows = await fetchSupabase<MemberPilihanRecord>(q).catch(() => []);
  return (rows || []).map((r: any) => ({ ...r, username: String(r.advisor || '').trim() }));
}

function dateDay(dateStr: string): number {
  return Number(dateStr.slice(8, 10)) || 1;
}

function nearestAnchorKm(member: any, anchors: Array<{ lat: number; lng: number }>): number {
  if (anchors.length === 0) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const a of anchors) {
    const d = distanceKm(member.lat, member.lng, a.lat, a.lng);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : 0;
}

function routeSort(items: any[], seed: Array<{ lat: number; lng: number }> = []): any[] {
  if (items.length <= 1) return items;
  const remaining = [...items];
  const ordered: any[] = [];
  let current = seed.length > 0
    ? seed[seed.length - 1]
    : { lat: remaining[0].lat, lng: remaining[0].lng };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    current = { lat: next.lat, lng: next.lng };
  }
  return ordered;
}

async function generateMatrix(params: {
  bulan: string;
  tahun: number;
  petugas: string;
  mode: string;
  tglDari: string;
  tglSampai: string;
  cabang: string;
  maksPerHari: number;
}) {
  const { bulan, tahun, petugas, mode, tglDari, tglSampai, cabang, maksPerHari } = params;
  const modeFull = mode === 'full';
  const bulanNum = parseInt(bulan, 10);
  const jumlahHari = daysInMonth(bulanNum, tahun);
  const blockedCodes = await getBlockedMemberCodes();
  const liburInfo = await getHolidayInfo(tahun);
  const liburDilewati = new Set<string>();

  let advisorToProcess: string[] = [];
  if (modeFull) {
    const rows = await queryLocal(
      `SELECT DISTINCT cus_nosalesman FROM tbmaster_customer
       WHERE cus_kodeigr = $1 AND cus_recordid IS NULL
         AND cus_namamember <> 'NEW' AND cus_nosalesman IS NOT NULL AND cus_nosalesman != ''
       ORDER BY cus_nosalesman ASC`,
      [cabang]
    );
    advisorToProcess = rows.map((r) => r.cus_nosalesman);
  } else if (petugas) {
    advisorToProcess = [petugas];
  } else {
    const rows = await queryLocal(
      `SELECT DISTINCT cus_nosalesman FROM tbmaster_customer
       WHERE cus_kodeigr = $1 AND cus_recordid IS NULL
         AND cus_namamember <> 'NEW' AND cus_nosalesman IS NOT NULL AND cus_nosalesman != ''
       ORDER BY cus_nosalesman ASC`,
      [cabang]
    );
    advisorToProcess = rows.map((r) => r.cus_nosalesman);
  }

  // Daftar ini sudah divalidasi saat upload. Diambil sekali untuk seluruh advisor.
  const allPilihan = await getMemberPilihanPeriode(cabang, tahun, bulanNum);
  const pilihanByAdvisor = new Map<string, MemberPilihanRecord[]>();
  for (const row of allPilihan) {
    const key = String(row.username || '').trim();
    if (!key) continue;
    const arr = pilihanByAdvisor.get(key) || [];
    arr.push(row);
    pilihanByAdvisor.set(key, arr);
  }

  const matrix: Record<string, { tanggal: string; toko: any[] }[]> = {};
  const memberPilihanInfo: Record<string, { uploaded: number; already_scheduled: number; generated: number; unresolved: number }> = {};

  for (const u of advisorToProcess) {
    const pilihanRows = pilihanByAdvisor.get(u) || [];
    const pilihanCodes = new Set(pilihanRows.map((r) => normCode(r.kode_member)));

    const custRows = await queryLocal(
      `SELECT cust.cus_kodemember, cust.cus_namamember, cust.cus_nosalesman, cust.cus_kodeigr, crm.crm_koordinat,
              CASE
                  WHEN b.belanja_pertama IS NULL THEN 'Belum Aktivasi'
                  WHEN b.belanja_terakhir < CURRENT_DATE - INTERVAL '3 months' THEN 'Sleeper'
                  ELSE 'Aktif'
              END AS tipe_member
       FROM tbmaster_customer cust
       INNER JOIN tbmaster_customercrm crm ON cust.cus_kodemember = crm.crm_kodemember
       LEFT JOIN (
         SELECT
           jh_cus_kodemember,
           DATE_TRUNC('day', MIN(jh_transactiondate)) AS belanja_pertama,
           DATE_TRUNC('day', MAX(jh_transactiondate)) AS belanja_terakhir
         FROM tbtr_jualheader
         WHERE jh_cus_kodemember IS NOT NULL
         GROUP BY jh_cus_kodemember
       ) b ON cust.cus_kodemember = b.jh_cus_kodemember
       WHERE cust.cus_kodeigr = $1
         AND cust.cus_nosalesman = $2
         AND (cust.cus_recordid != '1' OR cust.cus_recordid IS NULL)`,
      [cabang, u]
    );

    const rawPool: any[] = [];
    let latTotal = 0;
    let lngTotal = 0;
    let totalTokoAda = 0;

    for (const row of custRows) {
      const kode = normCode(row.cus_kodemember);
      if (blockedCodes.has(kode)) continue;
      if (!row.crm_koordinat) continue;
      const parts = String(row.crm_koordinat).split(',');
      if (parts.length !== 2) continue;
      const lat = parseFloat(parts[0].trim());
      const lng = parseFloat(parts[1].trim());
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      rawPool.push({
        ...row,
        lat,
        lng,
        tipe_member: row.tipe_member,
        member_pilihan: pilihanCodes.has(kode),
      });
      latTotal += lat;
      lngTotal += lng;
      totalTokoAda++;
    }

    if (totalTokoAda === 0) {
      memberPilihanInfo[u] = { uploaded: pilihanRows.length, already_scheduled: 0, generated: 0, unresolved: pilihanRows.length };
      continue;
    }

    const latPusat = latTotal / totalTokoAda;
    const lngPusat = lngTotal / totalTokoAda;

    const withBearing = rawPool.map((t) => ({ ...t, sudut: bearing(latPusat, lngPusat, t.lat, t.lng) }));
    // PENTING: dulu member RKM biasa dibatasi radius 15km dari titik pusat (rata-rata
    // koordinat SELURUH toko advisor tsb). Kalau toko advisor tersebar (mis. dua
    // kelompok toko yang jauh terpisah), titik pusatnya jadi berada di "tengah" yang
    // kosong, dan banyak toko yang sebenarnya valid ikut terbuang karena jaraknya ke
    // titik pusat itu > 15km — toko tsb TIDAK PERNAH masuk pool dan jadi terlewat
    // selamanya (tidak pernah kejadwal di bulan manapun). Member Pilihan sudah tidak
    // dibatasi radius seperti ini, jadi sekarang Member RKM biasa juga disamakan:
    // semua toko dengan koordinat valid tetap masuk pool (tidak ada yang dibuang),
    // dan urutan kunjungan tetap dijaga searah lewat pengurutan sudut (bearing) di
    // bawah ini + routeSort (nearest-neighbour) saat mengisi tiap hari.
    const pilihanPool = withBearing.filter((t) => pilihanCodes.has(normCode(t.cus_kodemember)));
    let poolToko = withBearing
      .filter((t) => !pilihanCodes.has(normCode(t.cus_kodemember)))
      .sort((a, b) => a.sudut - b.sudut);

    const awalBulan = `${tahun}-${bulan}-01`;
    const akhirBulan = `${tahun}-${bulan}-${String(jumlahHari).padStart(2, '0')}`;
    const jadwalAktifRows = await fetchSupabase<any>(
      `tbtr_jadwal_bulanan?select=id,kode_member,tanggal_jadwal,latitude,longitude,tipe_member&username=eq.${encodeURIComponent(
        u
      )}&cabang=eq.${encodeURIComponent(cabang)}&tanggal_jadwal=gte.${awalBulan}&tanggal_jadwal=lte.${akhirBulan}`
    ).catch(() => []);

    // Cross-check Member Pilihan terhadap jadwal bulan yang sedang digenerate.
    // Kalau kode sudah pernah muncul 1/2 kali sebelumnya, baris yang sudah ada
    // langsung diberi tipe_member = 'Member Pilihan' dan tetap dihitung sebagai
    // kemunculan bulan ini. Generator hanya membuat kekurangannya sampai 2x.
    const existingPilihanIds = (jadwalAktifRows || [])
      .filter((r: any) => pilihanCodes.has(normCode(r.kode_member)) && r.tipe_member !== 'Member Pilihan')
      .map((r: any) => Number(r.id))
      .filter((id: number) => Number.isFinite(id));
    if (existingPilihanIds.length > 0) {
      for (let i = 0; i < existingPilihanIds.length; i += 100) {
        const chunk = existingPilihanIds.slice(i, i + 100);
        await updateSupabase('tbtr_jadwal_bulanan', `id=in.(${chunk.join(',')})`, { tipe_member: 'Member Pilihan' }).catch(() => undefined);
      }
    }

    const existingCodes = new Set((jadwalAktifRows || []).map((r: any) => normCode(r.kode_member)));
    if (existingCodes.size > 0) {
      poolToko = poolToko.filter((t) => !existingCodes.has(normCode(t.cus_kodemember)));
    }

    const eligibleDates: string[] = [];
    for (let hari = 1; hari <= jumlahHari; hari++) {
      const currentDate = `${tahun}-${bulan}-${String(hari).padStart(2, '0')}`;
      if (!modeFull) {
        if (tglDari && currentDate < tglDari) continue;
        if (tglSampai && currentDate > tglSampai) continue;
      }
      const dow = new Date(currentDate + 'T00:00:00').getDay();
      if (dow === 0) continue;
      if (liburInfo.dates.has(currentDate)) {
        liburDilewati.add(currentDate);
        continue;
      }
      eligibleDates.push(currentDate);
    }

    if (eligibleDates.length === 0) {
      memberPilihanInfo[u] = { uploaded: pilihanRows.length, already_scheduled: 0, generated: 0, unresolved: pilihanRows.length };
      continue;
    }

    const existingLoad = new Map<string, number>();
    const existingAnchors = new Map<string, Array<{ lat: number; lng: number }>>();
    const existingDatesByCode = new Map<string, Set<string>>();
    for (const row of jadwalAktifRows || []) {
      const date = String(row.tanggal_jadwal || '');
      const code = normCode(row.kode_member);
      if (date) existingLoad.set(date, (existingLoad.get(date) || 0) + 1);
      if (date && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) {
        const arr = existingAnchors.get(date) || [];
        arr.push({ lat: Number(row.latitude), lng: Number(row.longitude) });
        existingAnchors.set(date, arr);
      }
      if (code && date) {
        const set = existingDatesByCode.get(code) || new Set<string>();
        set.add(date);
        existingDatesByCode.set(code, set);
      }
    }

    const assignedSpecial = new Map<string, any[]>();
    const assignedDatesByCode = new Map<string, Set<string>>();
    const pilihanByCode = new Map(pilihanPool.map((p) => [normCode(p.cus_kodemember), p]));
    type SpecialReq = { member: any; preferredHalf: 1 | 2 };
    const requests: SpecialReq[] = [];
    let alreadyScheduled = 0;

    for (const row of pilihanRows) {
      const code = normCode(row.kode_member);
      const member = pilihanByCode.get(code);
      if (!member) continue;
      const existingDates = Array.from(existingDatesByCode.get(code) || []).sort();
      alreadyScheduled += Math.min(existingDates.length, 2);
      const missing = Math.max(0, 2 - existingDates.length);
      if (missing === 0) continue;

      if (existingDates.length === 1) {
        const halfExisting: 1 | 2 = dateDay(existingDates[0]) <= Math.ceil(jumlahHari / 2) ? 1 : 2;
        requests.push({ member, preferredHalf: halfExisting === 1 ? 2 : 1 });
      } else {
        if (missing >= 1) requests.push({ member, preferredHalf: 1 });
        if (missing >= 2) requests.push({ member, preferredHalf: 2 });
      }
    }

    requests.sort((a, b) => a.preferredHalf - b.preferredHalf || a.member.sudut - b.member.sudut);

    let generatedSpecial = 0;
    for (const req of requests) {
      const code = normCode(req.member.cus_kodemember);
      const blockedDates = new Set<string>([
        ...Array.from(existingDatesByCode.get(code) || []),
        ...Array.from(assignedDatesByCode.get(code) || []),
      ]);
      const preferred = eligibleDates.filter((d) => (dateDay(d) <= Math.ceil(jumlahHari / 2) ? 1 : 2) === req.preferredHalf);
      const pools = [preferred, eligibleDates];
      let chosenDate = '';
      let chosenScore = Number.POSITIVE_INFINITY;

      for (const candidates of pools) {
        for (let idx = 0; idx < candidates.length; idx++) {
          const d = candidates[idx];
          if (blockedDates.has(d)) continue;
          const load = (existingLoad.get(d) || 0) + (assignedSpecial.get(d)?.length || 0);
          if (load >= maksPerHari) continue;

          const anchors = [
            ...(existingAnchors.get(d) || []),
            ...((assignedSpecial.get(d) || []).map((x) => ({ lat: x.lat, lng: x.lng }))),
          ];
          const geo = anchors.length > 0
            ? nearestAnchorKm(req.member, anchors)
            : Math.abs((req.member.sudut / 360) - (idx / Math.max(candidates.length - 1, 1))) * 12;
          let separationPenalty = 0;
          for (const other of blockedDates) {
            const gap = Math.abs(dateDay(d) - dateDay(other));
            if (gap < 7) separationPenalty += (7 - gap) * 20;
          }
          const score = geo + load * 2 + separationPenalty;
          if (score < chosenScore) {
            chosenScore = score;
            chosenDate = d;
          }
        }
        if (chosenDate) break;
      }

      if (!chosenDate) continue;
      const arr = assignedSpecial.get(chosenDate) || [];
      arr.push({ ...req.member, tipe_member: 'Member Pilihan', member_pilihan: true });
      assignedSpecial.set(chosenDate, arr);
      const dateSet = assignedDatesByCode.get(code) || new Set<string>();
      dateSet.add(chosenDate);
      assignedDatesByCode.set(code, dateSet);
      generatedSpecial++;
    }

    // Setelah Member Pilihan ditempatkan, isi sisa slot dengan RKM biasa yang paling dekat
    // terhadap anchor hari tersebut. Dengan begitu Member Pilihan tidak membuat rute memutar jauh.
    for (const currentDate of eligibleDates) {
      const special = assignedSpecial.get(currentDate) || [];
      const existingCount = existingLoad.get(currentDate) || 0;
      let slots = Math.max(0, maksPerHari - existingCount - special.length);
      const anchors: Array<{ lat: number; lng: number }> = [
        ...(existingAnchors.get(currentDate) || []),
        ...special.map((x) => ({ lat: x.lat, lng: x.lng })),
      ];
      const regular: any[] = [];

      while (slots > 0 && poolToko.length > 0) {
        let idx = 0;
        if (anchors.length > 0) {
          let best = Number.POSITIVE_INFINITY;
          for (let i = 0; i < poolToko.length; i++) {
            const d = nearestAnchorKm(poolToko[i], anchors);
            if (d < best) {
              best = d;
              idx = i;
            }
          }
        }
        const next = poolToko.splice(idx, 1)[0];
        regular.push({ ...next, member_pilihan: false });
        anchors.push({ lat: next.lat, lng: next.lng });
        slots--;
      }

      const generatedDay = routeSort([...special, ...regular], existingAnchors.get(currentDate) || []);
      if (generatedDay.length > 0) {
        matrix[u] = matrix[u] || [];
        matrix[u].push({ tanggal: currentDate, toko: generatedDay });
      }
    }

    const resolvedChoiceCodes = new Set(pilihanPool.map((p) => normCode(p.cus_kodemember)));
    memberPilihanInfo[u] = {
      uploaded: pilihanRows.length,
      already_scheduled: alreadyScheduled,
      generated: generatedSpecial,
      unresolved: pilihanRows.filter((p) => !resolvedChoiceCodes.has(normCode(p.kode_member))).length + Math.max(0, requests.length - generatedSpecial),
    };
  }

  return {
    advisor_list: advisorToProcess,
    matrix,
    member_pilihan_info: memberPilihanInfo,
    hari_libur_dilewati: Array.from(liburDilewati)
      .sort()
      .map((tgl) => ({ tanggal: tgl, nama: liburInfo.names.get(tgl) || 'Hari Libur' })),
  };
}

scheduleRouter.get('/generate', async (req, res) => {
  try {
    const bulan = ((req.query.bulan as string) || String(new Date().getMonth() + 1)).padStart(2, '0');
    const tahun = parseInt((req.query.tahun as string) || String(new Date().getFullYear()), 10);
    const petugas = (req.query.petugas as string) || '';
    const mode = (req.query.mode as string) || '';
    const tglDari = (req.query.tgl_dari as string) || '';
    const tglSampai = (req.query.tgl_sampai as string) || '';
    const cabang = (req.query.cabang as string) || '2T';

    // Jumlah member per hari bisa diatur dari frontend (mis. field "Jumlah
    // Member per Hari" di halaman Penjadwalan). Kalau kosong/tidak valid,
    // fallback ke default MAX_PER_DAY, dan tetap dibatasi ke rentang wajar
    // supaya tidak ada yang isi angka aneh (0, negatif, atau ribuan).
    const maksPerHariRaw = parseInt((req.query.maks_per_hari as string) || '', 10);
    const maksPerHari = Number.isFinite(maksPerHariRaw)
      ? Math.min(Math.max(maksPerHariRaw, MAKS_PER_HARI_MIN), MAKS_PER_HARI_MAX)
      : MAX_PER_DAY;

    const result = await generateMatrix({ bulan, tahun, petugas, mode, tglDari, tglSampai, cabang, maksPerHari });
    res.json({ ...result, db_lokal_connected: getDbStatus().connected });
  } catch (err: any) {
    res.status(500).json({ error: err.message, db_lokal_connected: false });
  }
});

scheduleRouter.post('/push', async (req, res) => {
  try {
    const items: Array<{
      tanggal: string;
      username: string;
      kode_member: string;
      cabang: string;
      lat: number | null;
      lng: number | null;
      nama_toko: string;
      tipe_member?: string | null;
      member_pilihan?: boolean;
      replace_id?: number; 
    }> = req.body.items || [];

    if (items.length === 0) {
      res.status(400).json({ error: 'Tidak ada jadwal yang dipilih untuk di-push.' });
      return;
    }

    const blockedCodes = await getBlockedMemberCodes();
    const blocked = items.filter((it) => blockedCodes.has(String(it.kode_member || '').trim().toUpperCase()));
    if (blocked.length > 0) {
      res.status(400).json({
        error: `${blocked.length} toko terdaftar di tabel Status Toko dan diblokir dari penjadwalan: ${blocked
          .map((b) => b.kode_member)
          .join(', ')}`,
      });
      return;
    }

    const replaceIds = items.map((it) => it.replace_id).filter((id): id is number => !!id);
    for (const id of replaceIds) {
      await deleteSupabase('tbtr_jadwal_bulanan', `id=eq.${id}`);
    }

    // Jangan hanya percaya flag dari frontend. Untuk input manual/replacement,
    // cek lagi daftar Member Pilihan berdasarkan periode tanggal jadwal agar
    // badge tetap benar walaupun jadwal tidak berasal dari hasil Generate.
    const pilihanByPeriod = new Map<string, Set<string>>();
    const periodKeys = Array.from(new Set(items.map((it) => `${it.cabang}|${it.tanggal.slice(0, 7)}`)));
    await Promise.all(periodKeys.map(async (key) => {
      const [cab, ym] = key.split('|');
      const [y, m] = ym.split('-').map(Number);
      const rows = await getMemberPilihanPeriode(cab, y, m);
      pilihanByPeriod.set(key, new Set(rows.map((r) => normCode(r.kode_member))));
    }));

    const payload = items.map((it) => {
      const periodKey = `${it.cabang}|${it.tanggal.slice(0, 7)}`;
      const isPilihan = !!it.member_pilihan || !!pilihanByPeriod.get(periodKey)?.has(normCode(it.kode_member));
      return {
        tanggal_jadwal: it.tanggal,
        username: it.username,
        kode_member: it.kode_member,
        cabang: it.cabang,
        status_visit: 'Pending',
        latitude: it.lat,
        longitude: it.lng,
        nama_toko: it.nama_toko,
        tipe_member: isPilihan ? 'Member Pilihan' : (it.tipe_member || null),
      };
    });

    await insertManySupabase('tbtr_jadwal_bulanan', payload);
    res.json({ success: true, count: payload.length, replaced: replaceIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.post('/export', async (req, res) => {
  try {
    const rows: Array<{ tanggal: string; username: string; kode_member: string; cabang: string; tipe_member?: string | null; member_pilihan?: boolean }> = req.body.rows || [];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Jadwal');
    const header = ws.addRow(['Tanggal Penjadwalan', 'Advisor (User)', 'Kode Member', 'Cabang', 'Tipe Member', 'Keterangan']);
    styleHeaderRow(header);
    for (const r of rows) {
      ws.addRow([r.tanggal, (r.username || '').toUpperCase(), r.kode_member, r.cabang, r.tipe_member || '-', r.member_pilihan ? 'MEMBER PILIHAN' : '-']);
    }
    ws.columns.forEach((c) => (c.width = 22));
    await sendWorkbook(res, wb, 'Jadwal_RKM_Filtered.xlsx');
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Toko Tutup (tbtr_status_toko)
// ============================================================

scheduleRouter.get('/status-toko', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '';
    const search = String(req.query.search || '').trim();
    let query = 'tbtr_status_toko?select=*&order=created_at.desc';
    if (cabang) query += `&cabang=eq.${encodeURIComponent(cabang)}`;
    if (search) {
      const cleanSearch = search.replace(/[,()]/g, ' ').trim();
      if (cleanSearch) {
        const s = encodeURIComponent(cleanSearch);
        query += `&or=(nama_toko.ilike.*${s}*,kode_member.ilike.*${s}*,username.ilike.*${s}*,keterangan_lainnya.ilike.*${s}*,deskripsi.ilike.*${s}*,status.ilike.*${s}*)`;
      }
    }
    const data = await fetchSupabaseAll<any>(query, { pageSize: 1000, maxRows: 50000 });
    const jadwalDihapus = await purgeJadwalForBlockedStores().catch(() => 0);
    res.json({ data, jadwal_dihapus: jadwalDihapus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.post('/status-toko', async (req, res) => {
  try {
    const { username, cabang, nama_toko, kode_member, status, keterangan_lainnya, deskripsi } = req.body || {};
    if (!username || !nama_toko || !status || !kode_member) {
      res.status(400).json({ error: 'username, kode_member, nama_toko, dan status wajib diisi.' });
      return;
    }
    const kodeMemberUpper = String(kode_member).trim().toUpperCase();

    await insertSupabase('tbtr_status_toko', {
      username,
      cabang: cabang || null,
      nama_toko,
      kode_member: kodeMemberUpper,
      status,
      keterangan_lainnya: keterangan_lainnya || null,
      deskripsi: deskripsi || null,
      tanggal: new Date().toISOString().slice(0, 10),
    });

    const jadwalDihapus = await purgeJadwalForBlockedStores();

    res.json({ success: true, jadwal_dihapus: jadwalDihapus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.patch('/status-toko/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { status, keterangan_lainnya, deskripsi } = req.body || {};
    const payload: Record<string, any> = {};
    if (status !== undefined) payload.status = status;
    if (keterangan_lainnya !== undefined) payload.keterangan_lainnya = keterangan_lainnya;
    if (deskripsi !== undefined) payload.deskripsi = deskripsi;
    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'Tidak ada field yang diubah.' });
      return;
    }
    await updateSupabase('tbtr_status_toko', `id=eq.${id}`, payload);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.delete('/status-toko/:id', async (req, res) => {
  try {
    await deleteSupabase('tbtr_status_toko', `id=eq.${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/schedule/status-toko/export
 * Export daftar toko tutup (tbtr_status_toko) ke Excel, untuk cabang terpilih.
 */
scheduleRouter.get('/status-toko/export', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '';
    let query = 'tbtr_status_toko?select=*&order=created_at.desc';
    if (cabang) query += `&cabang=eq.${encodeURIComponent(cabang)}`;
    const data = await fetchSupabaseAll<any>(query, { pageSize: 1000, maxRows: 50000 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Toko Tutup');
    ws.addRow([`Daftar Toko Tutup${cabang ? ` - Cabang ${cabang}` : ''}`]);
    ws.addRow([]);
    const header = ws.addRow(['Tanggal', 'Dicatat Oleh', 'Kode Member', 'Nama Toko', 'Cabang', 'Status', 'Keterangan']);
    styleHeaderRow(header);
    for (const row of data || []) {
      ws.addRow([
        row.tanggal || '-',
        (row.username || '').toUpperCase(),
        row.kode_member || '-',
        row.nama_toko || '-',
        row.cabang || '-',
        row.status || '-',
        row.keterangan_lainnya || row.deskripsi || '-',
      ]);
    }
    ws.columns.forEach((c) => (c.width = 22));

    await sendWorkbook(res, wb, `Toko_Tutup${cabang ? `_${cabang}` : ''}.xlsx`);
  } catch (err: any) {
    console.error('[status-toko] export error:', err);
    res.status(500).json({ error: err?.message || 'Gagal export data toko tutup' });
  }
});

// ============================================================
// Fitur input manual
// ============================================================

scheduleRouter.get('/member-lookup', async (req, res) => {
  try {
    const kodeMember = ((req.query.kode_member as string) || '').trim();
    const cabang = (req.query.cabang as string) || '2T';
    if (!kodeMember) {
      res.status(400).json({ error: 'kode_member wajib diisi.' });
      return;
    }

    const blocked = await getBlockedMemberCodes();
    if (blocked.has(kodeMember.toUpperCase())) {
      res.json({
        found: false,
        blocked: true,
        message: 'Toko ini terdaftar di tabel Status Toko dan diblokir dari penjadwalan.',
      });
      return;
    }

    // Klasifikasi SQL langsung untuk lookup manual
    // DITAMBAHKAN FILTER: (cust.cus_recordid != '1' OR cust.cus_recordid IS NULL)
    const rows = await queryLocal(
      `SELECT cust.cus_kodemember, cust.cus_namamember, cust.cus_nosalesman, cust.cus_kodeigr, crm.crm_koordinat,
              CASE
                  WHEN b.belanja_pertama IS NULL THEN 'Belum Aktivasi'
                  WHEN b.belanja_terakhir < CURRENT_DATE - INTERVAL '3 months' THEN 'Sleeper'
                  ELSE 'Aktif'
              END AS tipe_member
       FROM tbmaster_customer cust
       LEFT JOIN tbmaster_customercrm crm ON cust.cus_kodemember = crm.crm_kodemember
       LEFT JOIN (
         SELECT
           jh_cus_kodemember,
           DATE_TRUNC('day', MIN(jh_transactiondate)) AS belanja_pertama,
           DATE_TRUNC('day', MAX(jh_transactiondate)) AS belanja_terakhir
         FROM tbtr_jualheader
         WHERE jh_cus_kodemember IS NOT NULL
         GROUP BY jh_cus_kodemember
       ) b ON cust.cus_kodemember = b.jh_cus_kodemember
       WHERE cust.cus_kodeigr = $1 AND cust.cus_kodemember = $2 AND (cust.cus_recordid != '1' OR cust.cus_recordid IS NULL)
       LIMIT 1`,
      [cabang, kodeMember]
    ).catch(() => []);

    if (rows.length === 0) {
      res.json({ found: false, blocked: false, message: 'Kode member tidak ditemukan (atau nonaktif) di database toko lokal.' });
      return;
    }

    const row = rows[0];
    let lat: number | null = null;
    let lng: number | null = null;
    if (row.crm_koordinat) {
      const parts = String(row.crm_koordinat).split(',');
      if (parts.length === 2) {
        const la = parseFloat(parts[0].trim());
        const lo = parseFloat(parts[1].trim());
        if (!Number.isNaN(la) && !Number.isNaN(lo)) {
          lat = la;
          lng = lo;
        }
      }
    }

    res.json({
      found: true,
      blocked: false,
      nama_toko: row.cus_namamember,
      cabang: row.cus_kodeigr,
      username_pemilik: row.cus_nosalesman,
      lat,
      lng,
      tipe_member: row.tipe_member, // Mengambil hasil dari SQL
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, db_lokal_connected: false });
  }
});

scheduleRouter.get('/existing-day', async (req, res) => {
  try {
    const username = (req.query.username as string) || '';
    const tanggal = (req.query.tanggal as string) || '';
    if (!username || !tanggal) {
      res.status(400).json({ error: 'username dan tanggal wajib diisi.' });
      return;
    }
    const rows = await fetchSupabase<any>(
      `tbtr_jadwal_bulanan?select=id,tanggal_jadwal,username,kode_member,nama_toko,cabang,status_visit,tipe_member&username=eq.${encodeURIComponent(
        username
      )}&tanggal_jadwal=eq.${tanggal}&order=id.asc`
    );
    res.json({ data: rows, count: rows.length, penuh: rows.length >= MAX_PER_DAY });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Jadwal Aktif / Riwayat Jadwal (baca & hapus dari tbtr_jadwal_bulanan)
// ============================================================

/** Sama seperti generateMatrix, tapi datanya diambil dari jadwal yang SUDAH
 *  tersimpan di tbtr_jadwal_bulanan (bukan hasil generate baru), supaya
 *  tampilan di halaman Jadwal Aktif persis sama dengan Penjadwalan. */
scheduleRouter.get('/riwayat', async (req, res) => {
  try {
    const bulan = ((req.query.bulan as string) || String(new Date().getMonth() + 1)).padStart(2, '0');
    const tahun = parseInt((req.query.tahun as string) || String(new Date().getFullYear()), 10);
    const petugas = (req.query.petugas as string) || '';
    const cabang = (req.query.cabang as string) || '2T';

    const awal = `${tahun}-${bulan}-01`;
    const akhir = `${tahun}-${bulan}-${String(daysInMonth(parseInt(bulan, 10), tahun)).padStart(2, '0')}`;

    let query = `tbtr_jadwal_bulanan?select=${JADWAL_SELECT}&cabang=eq.${encodeURIComponent(
      cabang
    )}&tanggal_jadwal=gte.${awal}&tanggal_jadwal=lte.${akhir}&order=tanggal_jadwal.asc,username.asc`;
    if (petugas) query += `&username=eq.${encodeURIComponent(petugas)}`;
    const rows = await fetchSupabaseCached<any>(query, 30_000).catch(() => []);

    const matrix: Record<string, { tanggal: string; toko: any[] }[]> = {};
    const advisorSet = new Set<string>();
    for (const r of rows || []) {
      advisorSet.add(r.username);
      matrix[r.username] = matrix[r.username] || [];
      let dayGroup = matrix[r.username].find((d) => d.tanggal === r.tanggal_jadwal);
      if (!dayGroup) {
        dayGroup = { tanggal: r.tanggal_jadwal, toko: [] };
        matrix[r.username].push(dayGroup);
      }
      dayGroup.toko.push({
        id: r.id,
        cus_kodemember: r.kode_member,
        cus_namamember: r.nama_toko,
        cus_nosalesman: r.username,
        cus_kodeigr: r.cabang,
        crm_koordinat: r.latitude && r.longitude ? `${r.latitude}, ${r.longitude}` : '',
        lat: r.latitude,
        lng: r.longitude,
        tipe_member: r.tipe_member,
        member_pilihan: String(r.tipe_member || '').trim() === 'Member Pilihan',
        status_visit: r.status_visit,
      });
    }

    res.json({ advisor_list: Array.from(advisorSet), matrix });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Jadwal Belum Terkunjungi (jadwal yang status_visit-nya masih Pending
// tapi tanggal_jadwal-nya sudah lewat dari hari ini) — dan aksi
// "Jadwalkan Ulang" untuk memindahkannya ke tanggal baru.
// ============================================================

/** Ambil semua baris tbtr_jadwal_bulanan dengan status_visit = Pending DAN
 *  tanggal_jadwal < hari ini (waktu Jakarta). Tidak dibatasi bulan/tahun,
 *  karena tujuannya justru menangkap semua jadwal terlewat dari kapan pun. */
scheduleRouter.get('/belum-terkunjungi', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '2T';
    const petugas = (req.query.petugas as string) || '';
    const hariIni = todayJakarta();
    // Hanya bulan berjalan: dari tanggal 1 bulan ini sampai hari ini (tidak
    // menampilkan jadwal terlewat dari bulan-bulan sebelumnya).
    const awalBulanIni = `${hariIni.slice(0, 7)}-01`;

    let query = `tbtr_jadwal_bulanan?select=${JADWAL_SELECT}&cabang=eq.${encodeURIComponent(
      cabang
    )}&status_visit=eq.Pending&tanggal_jadwal=gte.${awalBulanIni}&tanggal_jadwal=lt.${hariIni}&order=tanggal_jadwal.asc,username.asc`;
    if (petugas) query += `&username=eq.${encodeURIComponent(petugas)}`;
    const rows = await fetchSupabaseCached<any>(query, 30_000).catch(() => []);

    const matrix: Record<string, { tanggal: string; toko: any[] }[]> = {};
    const advisorSet = new Set<string>();
    for (const r of rows || []) {
      advisorSet.add(r.username);
      matrix[r.username] = matrix[r.username] || [];
      let dayGroup = matrix[r.username].find((d) => d.tanggal === r.tanggal_jadwal);
      if (!dayGroup) {
        dayGroup = { tanggal: r.tanggal_jadwal, toko: [] };
        matrix[r.username].push(dayGroup);
      }
      dayGroup.toko.push({
        id: r.id,
        cus_kodemember: r.kode_member,
        cus_namamember: r.nama_toko,
        cus_nosalesman: r.username,
        cus_kodeigr: r.cabang,
        crm_koordinat: r.latitude && r.longitude ? `${r.latitude}, ${r.longitude}` : '',
        lat: r.latitude,
        lng: r.longitude,
        tipe_member: r.tipe_member,
        member_pilihan: String(r.tipe_member || '').trim() === 'Member Pilihan',
        status_visit: r.status_visit,
      });
    }

    res.json({ advisor_list: Array.from(advisorSet), matrix, hari_ini: hariIni, bulan_berjalan: hariIni.slice(0, 7) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Pindahkan (jadwalkan ulang) sejumlah baris jadwal yang terlewat ke
 *  tanggal baru. Dipakai popup "Jadwalkan Ulang" di halaman Jadwal Belum
 *  Terkunjungi — user centang baris yang mau dipindah, pilih tanggal baru,
 *  lalu upload. status_visit dikembalikan/dipastikan 'Pending' di tanggal
 *  yang baru supaya langsung tampil lagi di Jadwal Aktif. */
scheduleRouter.post('/reschedule', async (req, res) => {
  try {
    const ids: number[] = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x: any) => Number.isFinite(Number(x))).map(Number)
      : [];
    const tanggal = (req.body?.tanggal as string) || '';

    if (ids.length === 0) {
      res.status(400).json({ error: 'Tidak ada jadwal yang dicentang untuk dijadwalkan ulang.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
      res.status(400).json({ error: 'Tanggal baru wajib diisi dengan format yang benar.' });
      return;
    }
    const hariIni = todayJakarta();
    if (tanggal < hariIni) {
      res.status(400).json({ error: 'Tanggal baru tidak boleh tanggal yang sudah lewat.' });
      return;
    }

    await updateSupabase('tbtr_jadwal_bulanan', `id=in.(${ids.join(',')})`, {
      tanggal_jadwal: tanggal,
      status_visit: 'Pending',
    });

    res.json({ success: true, count: ids.length, tanggal });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Hapus SEMUA jadwal milik satu advisor pada satu tanggal tertentu
 *  (dipakai tombol "Hapus" per tanggal di halaman Jadwal Aktif).
 *  Jadwal yang tanggalnya sudah lewat tidak boleh dihapus dari sini. */
scheduleRouter.delete('/riwayat', async (req, res) => {
  try {
    const username = (req.query.username as string) || '';
    const tanggal = (req.query.tanggal as string) || '';
    const cabang = (req.query.cabang as string) || '';
    if (!username || !tanggal || !cabang) {
      res.status(400).json({ error: 'username, tanggal, dan cabang wajib diisi.' });
      return;
    }
    if (tanggal < todayJakarta()) {
      res.status(400).json({ error: 'Jadwal dengan tanggal yang sudah lewat tidak bisa dihapus.' });
      return;
    }
    await deleteSupabase(
      'tbtr_jadwal_bulanan',
      `username=eq.${encodeURIComponent(username)}&tanggal_jadwal=eq.${encodeURIComponent(tanggal)}&cabang=eq.${encodeURIComponent(cabang)}`
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Hapus SEMUA jadwal milik satu advisor pada periode bulan/tahun tertentu
 *  (lintas semua tanggal) — dipakai tombol "Hapus Semua" per MR/advisor.
 *  PENTING: didefinisikan SEBELUM '/riwayat/:id' supaya path '/advisor' dan
 *  '/all' tidak ketangkep sebagai parameter :id. */
scheduleRouter.delete('/riwayat/advisor', async (req, res) => {
  try {
    const username = (req.query.username as string) || '';
    const cabang = (req.query.cabang as string) || '';
    const bulan = ((req.query.bulan as string) || '').padStart(2, '0');
    const tahun = parseInt((req.query.tahun as string) || '', 10);
    if (!username || !cabang || !bulan || !tahun) {
      res.status(400).json({ error: 'username, cabang, bulan, dan tahun wajib diisi.' });
      return;
    }
    const awal = `${tahun}-${bulan}-01`;
    const akhir = `${tahun}-${bulan}-${String(daysInMonth(parseInt(bulan, 10), tahun)).padStart(2, '0')}`;
    // tanggal_jadwal=gte.hariIni memastikan jadwal yang tanggalnya sudah
    // lewat tidak ikut terhapus, meski ada dalam rentang bulan/tahun yang sama.
    const batasAwal = awal > todayJakarta() ? awal : todayJakarta();
    await deleteSupabase(
      'tbtr_jadwal_bulanan',
      `username=eq.${encodeURIComponent(username)}&cabang=eq.${encodeURIComponent(cabang)}&tanggal_jadwal=gte.${batasAwal}&tanggal_jadwal=lte.${akhir}`
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Hapus SEMUA jadwal pada periode bulan/tahun & cabang tertentu, lintas
 *  semua advisor sekaligus — dipakai tombol "Hapus Semua (Blast)". */
scheduleRouter.delete('/riwayat/all', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '';
    const bulan = ((req.query.bulan as string) || '').padStart(2, '0');
    const tahun = parseInt((req.query.tahun as string) || '', 10);
    const petugas = (req.query.petugas as string) || '';
    if (!cabang || !bulan || !tahun) {
      res.status(400).json({ error: 'cabang, bulan, dan tahun wajib diisi.' });
      return;
    }
    const awal = `${tahun}-${bulan}-01`;
    const akhir = `${tahun}-${bulan}-${String(daysInMonth(parseInt(bulan, 10), tahun)).padStart(2, '0')}`;
    // Jadwal yang tanggalnya sudah lewat tidak boleh ikut terhapus oleh "blast".
    const batasAwal = awal > todayJakarta() ? awal : todayJakarta();
    let filter = `cabang=eq.${encodeURIComponent(cabang)}&tanggal_jadwal=gte.${batasAwal}&tanggal_jadwal=lte.${akhir}`;
    if (petugas) filter += `&username=eq.${encodeURIComponent(petugas)}`;
    await deleteSupabase('tbtr_jadwal_bulanan', filter);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Hapus satu baris jadwal spesifik (dipakai tombol hapus per baris toko).
 *  Jadwal yang tanggalnya sudah lewat tidak boleh dihapus. */
scheduleRouter.delete('/riwayat/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const rows = await fetchSupabase<any>(`tbtr_jadwal_bulanan?select=id,tanggal_jadwal&id=eq.${id}`).catch(() => []);
    if (rows.length > 0 && rows[0].tanggal_jadwal < todayJakarta()) {
      res.status(400).json({ error: 'Jadwal dengan tanggal yang sudah lewat tidak bisa dihapus.' });
      return;
    }
    await deleteSupabase('tbtr_jadwal_bulanan', `id=eq.${id}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Hapus banyak baris jadwal sekaligus berdasarkan daftar id (dipakai untuk
 *  tombol "Hapus Terpilih" ketika user centang beberapa baris manual, lintas
 *  tanggal maupun lintas advisor). Baris yang tanggalnya sudah lewat otomatis
 *  di-skip (tidak ikut terhapus), bukan menggagalkan seluruh permintaan. */
scheduleRouter.post('/riwayat/bulk-delete', async (req, res) => {
  try {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => Number.isFinite(Number(x))) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Tidak ada id yang dikirim untuk dihapus.' });
      return;
    }
    const hariIni = todayJakarta();
    const rows = await fetchSupabase<any>(`tbtr_jadwal_bulanan?select=id,tanggal_jadwal&id=in.(${ids.join(',')})`).catch(
      () => []
    );
    const blockedIds = new Set((rows || []).filter((r: any) => r.tanggal_jadwal < hariIni).map((r: any) => r.id));
    const deletableIds = ids.filter((id) => !blockedIds.has(id));

    if (deletableIds.length === 0) {
      res.status(400).json({ error: 'Semua jadwal yang dicentang tanggalnya sudah lewat, tidak bisa dihapus.' });
      return;
    }
    // Hapus per PRIMARY KEY secara eksplisit. Ini sengaja tidak memakai filter
    // tanggal/advisor sehingga endpoint bulk tidak mungkin menghapus baris lain
    // di luar checkbox yang dikirim frontend.
    for (const id of deletableIds) {
      await deleteSupabase('tbtr_jadwal_bulanan', `id=eq.${id}`);
    }
    res.json({ success: true, count: deletableIds.length, skipped: blockedIds.size });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Import Jadwal via Excel
// ============================================================

const TEMPLATE_HEADERS = [
  'Tanggal (YYYY-MM-DD)',
  'Advisor (Username)',
  'Kode Member',
  'Nama Toko',
  'Cabang',
  'Latitude',
  'Longitude',
  'Tipe Member',
];

scheduleRouter.get('/import-template', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '2T';
    const wb = new ExcelJS.Workbook();

    const ws = wb.addWorksheet('Template Jadwal');
    const header = ws.addRow(TEMPLATE_HEADERS);
    styleHeaderRow(header);
    ws.addRow([
      '2025-01-15',
      'ADVISOR1',
      '2T000123',
      '(opsional, auto-terisi jika kosong & ditemukan)',
      cabang,
      '(opsional, auto-terisi jika kosong & ditemukan)',
      '(opsional, auto-terisi jika kosong & ditemukan)',
      '(opsional: Aktif / Sleeper / Belum Aktivasi)',
    ]);
    ws.columns = [
      { width: 22 },
      { width: 20 },
      { width: 18 },
      { width: 40 },
      { width: 12 },
      { width: 16 },
      { width: 16 },
      { width: 20 },
    ];
    ws.getColumn(1).numFmt = '@';

    const ws2 = wb.addWorksheet('Petunjuk');
    const titleRow = ws2.addRow(['Petunjuk Pengisian Template Import Jadwal']);
    titleRow.getCell(1).font = { bold: true, size: 13 };
    ws2.addRow([]);
    const petunjuk = [
      '1. Jangan mengubah urutan atau nama kolom di sheet "Template Jadwal".',
      '2. Kolom Tanggal wajib diisi format YYYY-MM-DD, contoh: 2025-01-15.',
      '3. Kolom Advisor (Username) wajib diisi sesuai username advisor/MR yang terdaftar.',
      '4. Kolom Kode Member wajib diisi. Nama Toko & koordinat akan otomatis diambil dari database lokal kalau kode member ditemukan.',
      '5. Kolom Nama Toko boleh dikosongkan JIKA kode member ditemukan di database lokal. Kalau tidak ditemukan, kolom ini wajib diisi manual.',
      '6. Kolom Cabang boleh dikosongkan, defaultnya memakai cabang yang aktif saat upload.',
      '7. Kolom Latitude & Longitude boleh dikosongkan JIKA kode member ditemukan di database lokal (koordinat akan otomatis terisi dari sana). Kalau diisi manual, nilai di file akan dipakai dan TIDAK ditimpa oleh data database lokal.',
      '8. Format Latitude & Longitude harus angka desimal, contoh: -6.914744 untuk latitude dan 107.60981 untuk longitude.',
      '9. Toko yang terdaftar di menu "Toko Tutup" otomatis ditolak (tidak akan masuk jadwal), meskipun ada di file.',
      '10. Kolom Tipe Member boleh dikosongkan. Kalau diisi, gunakan salah satu: Aktif, Sleeper, atau Belum Aktivasi.',
      '11. Baris pertama (header) jangan dihapus. Hapus baris contoh sebelum diisi data asli.',
    ];
    petunjuk.forEach((p) => {
      const row = ws2.addRow([p]);
      row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    });
    ws2.getColumn(1).width = 100;

    await sendWorkbook(res, wb, 'Template_Import_Jadwal_RKM.xlsx');
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeTipeMember(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('sleep')) return 'Sleeper';
  if (v.startsWith('belum') || v.includes('nonaktif') || v.includes('non-aktif')) return 'Belum Aktivasi';
  if (v.startsWith('aktif')) return 'Aktif';
  return raw.trim(); 
}

function excelCellToString(cell: ExcelJS.CellValue): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    return cell.toISOString().slice(0, 10);
  }
  if (typeof cell === 'object' && 'text' in (cell as any)) {
    return String((cell as any).text || '').trim();
  }
  if (typeof cell === 'object' && 'result' in (cell as any)) {
    return String((cell as any).result ?? '').trim();
  }
  return String(cell).trim();
}


// ============================================================
// Member Pilihan bulanan (upload sebelum generate otomatis)
// ============================================================

scheduleRouter.get('/member-pilihan-template', async (_req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Member Pilihan');
    const header = ws.addRow(['Kode Member']);
    styleHeaderRow(header);
    ws.addRow(['2T000123']);
    ws.getColumn(1).width = 24;
    ws.getColumn(1).numFmt = '@';

    const petunjuk = wb.addWorksheet('Petunjuk');
    const title = petunjuk.addRow(['Petunjuk Upload Member Pilihan']);
    title.getCell(1).font = { bold: true, size: 13 };
    petunjuk.addRow([]);
    [
      '1. Isi hanya Kode Member. Nama toko, advisor/MR, dan koordinat dibaca otomatis dari database kantor.',
      '2. Kode Member wajib SUDAH ada di tbmaster_customer pada cabang yang sedang dipilih.',
      '3. Member nonaktif, tanpa advisor, tanpa koordinat CRM, atau terdaftar di Toko Tutup akan dilewati.',
      '4. Jumlah member unik per MR pada daftar Member Pilihan aktif tidak dibatasi (bebas berapa pun).',
      '5. Upload ini bersifat REPLACE untuk cabang yang dipilih. Daftar Member Pilihan aktif cabang tersebut diganti file terbaru.',
      '6. Saat Generate Full untuk bulan apa pun, setiap Member Pilihan aktif ditargetkan muncul 2 kali pada bulan itu. Sistem menghitung dulu jumlah yang sudah ada di tbtr_jadwal_bulanan, lalu hanya membuat kekurangannya.',
      '7. Baris contoh harus dihapus sebelum file asli diupload.',
    ].forEach((text) => {
      const row = petunjuk.addRow([text]);
      row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    });
    petunjuk.getColumn(1).width = 110;

    await sendWorkbook(res, wb, 'Template_Member_Pilihan.xlsx');
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.get('/member-pilihan', async (req, res) => {
  try {
    const cabang = String(req.query.cabang || '2T').trim() || '2T';
    const bulan = Math.min(Math.max(parseInt(String(req.query.bulan || new Date().getMonth() + 1), 10), 1), 12);
    const tahun = parseInt(String(req.query.tahun || new Date().getFullYear()), 10);
    const data = await getMemberPilihanPeriode(cabang, tahun, bulan);
    const perAdvisor: Record<string, number> = {};
    for (const row of data) { const adv = String(row.advisor || row.username || '').trim(); if (adv) perAdvisor[adv] = (perAdvisor[adv] || 0) + 1; }
    res.json({ data, total: data.length, per_advisor: perAdvisor, bulan, tahun, cabang });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.post('/member-pilihan-upload', async (req, res) => {
  try {
    const { fileBase64 } = req.body || {};
    const cabang = String(req.body?.cabang || '2T').trim() || '2T';
    const bulan = Math.min(Math.max(parseInt(String(req.body?.bulan || new Date().getMonth() + 1), 10), 1), 12);
    const tahun = parseInt(String(req.body?.tahun || new Date().getFullYear()), 10);
    if (!fileBase64) {
      res.status(400).json({ error: 'File tidak ditemukan. Silakan pilih file .xlsx untuk diupload.' });
      return;
    }

    const buffer = Buffer.from(String(fileBase64).split(',').pop() || '', 'base64');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      res.status(400).json({ error: 'File tidak valid. Pastikan file berformat .xlsx.' });
      return;
    }
    const ws = wb.worksheets[0];
    if (!ws) {
      res.status(400).json({ error: 'Sheet data tidak ditemukan di file.' });
      return;
    }

    const input: Array<{ row: number; kode: string }> = [];
    const skipped: Array<{ row: number; reason: string }> = [];
    const seen = new Set<string>();
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const kode = normCode(excelCellToString(row.getCell(1).value));
      if (!kode) return;
      if (seen.has(kode)) {
        skipped.push({ row: rowNumber, reason: `Kode ${kode} duplikat di file.` });
        return;
      }
      seen.add(kode);
      input.push({ row: rowNumber, kode });
    });

    if (input.length === 0) {
      res.status(400).json({ error: 'Tidak ada Kode Member yang bisa diproses di file.' });
      return;
    }

    const codes = input.map((x) => x.kode);
    const localRows = await queryLocal<any>(
      `SELECT cust.cus_kodemember, cust.cus_namamember, cust.cus_nosalesman, cust.cus_recordid, crm.crm_koordinat
       FROM tbmaster_customer cust
       LEFT JOIN tbmaster_customercrm crm ON crm.crm_kodemember = cust.cus_kodemember
       WHERE cust.cus_kodeigr = $1
         AND UPPER(cust.cus_kodemember) = ANY($2::text[])
         AND cust.cus_namamember <> 'NEW'`,
      [cabang, codes]
    );
    const localMap = new Map(localRows.map((r: any) => [normCode(r.cus_kodemember), r]));
    const blocked = await getBlockedMemberCodes();
    const advisorCount = new Map<string, number>();
    const payload: Record<string, any>[] = [];

    for (const item of input) {
      const row = localMap.get(item.kode);
      if (!row) {
        skipped.push({ row: item.row, reason: `Kode ${item.kode} tidak ditemukan di tbmaster_customer cabang ${cabang}.` });
        continue;
      }
      if (String(row.cus_recordid || '') === '1') {
        skipped.push({ row: item.row, reason: `Kode ${item.kode} berstatus Tidak Aktif.` });
        continue;
      }
      if (blocked.has(item.kode)) {
        skipped.push({ row: item.row, reason: `Kode ${item.kode} terdaftar di Toko Tutup.` });
        continue;
      }
      const username = String(row.cus_nosalesman || '').trim();
      if (!username) {
        skipped.push({ row: item.row, reason: `Kode ${item.kode} belum memiliki advisor/MR.` });
        continue;
      }
      const coord = String(row.crm_koordinat || '').split(',');
      const lat = coord.length === 2 ? parseFloat(coord[0].trim()) : Number.NaN;
      const lng = coord.length === 2 ? parseFloat(coord[1].trim()) : Number.NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        skipped.push({ row: item.row, reason: `Kode ${item.kode} belum memiliki koordinat CRM yang valid.` });
        continue;
      }
      const used = advisorCount.get(username) || 0;
      advisorCount.set(username, used + 1);
      payload.push({
        kode_member: item.kode,
        nama_toko: row.cus_namamember || item.kode,
        advisor: username,
        cabang,
        catatan: null,
      });
    }

    if (payload.length === 0) {
      res.status(400).json({ error: 'Semua baris dilewati. Daftar Member Pilihan lama tidak diubah.', skipped });
      return;
    }

    const existing = await getMemberPilihanPeriode(cabang, tahun, bulan);
    await deleteSupabase('tbtr_member_pilihan', `cabang=eq.${encodeURIComponent(cabang)}`);
    await insertManySupabase('tbtr_member_pilihan', payload);


    res.json({
      success: true,
      cabang,
      bulan,
      tahun,
      total_baris: input.length,
      inserted: payload.length,
      replaced: existing.length,
      skipped_count: skipped.length,
      skipped,
      per_advisor: Object.fromEntries(advisorCount.entries()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.post('/import', async (req, res) => {
  try {
    const { fileBase64, cabang } = req.body || {};
    if (!fileBase64) {
      res.status(400).json({ error: 'File tidak ditemukan. Silakan pilih file .xlsx untuk diupload.' });
      return;
    }
    const cabangDefault = cabang || '2T';

    const buffer = Buffer.from(String(fileBase64).split(',').pop() || '', 'base64');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      res.status(400).json({ error: 'File tidak valid. Pastikan file berformat .xlsx.' });
      return;
    }

    const ws = wb.worksheets[0];
    if (!ws) {
      res.status(400).json({ error: 'Sheet data tidak ditemukan di file.' });
      return;
    }

    const blockedCodes = await getBlockedMemberCodes();

    type ParsedRow = {
      rowNum: number;
      tanggal: string;
      username: string;
      kode_member: string;
      nama_toko: string;
      cabang: string;
      latitude: number | null;
      longitude: number | null;
      tipe_member: string | null;
    };
    const parsedRows: ParsedRow[] = [];
    const skipped: Array<{ row: number; reason: string }> = [];

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const tanggalRaw = excelCellToString(row.getCell(1).value);
      const username = excelCellToString(row.getCell(2).value);
      const kodeMember = excelCellToString(row.getCell(3).value).toUpperCase();
      const namaTokoRaw = excelCellToString(row.getCell(4).value);
      const cabangRaw = excelCellToString(row.getCell(5).value) || cabangDefault;
      const latRaw = excelCellToString(row.getCell(6).value);
      const lngRaw = excelCellToString(row.getCell(7).value);
      const tipeMemberRaw = excelCellToString(row.getCell(8).value);

      if (!tanggalRaw && !username && !kodeMember) return; 

      const tanggal = tanggalRaw.length === 10 ? tanggalRaw : tanggalRaw.slice(0, 10);
      const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(tanggal);

      if (!isValidDate || !username || !kodeMember) {
        skipped.push({ row: rowNumber, reason: 'Tanggal, Advisor, atau Kode Member kosong / format tanggal salah.' });
        return;
      }
      if (blockedCodes.has(kodeMember)) {
        skipped.push({ row: rowNumber, reason: `Kode member ${kodeMember} terdaftar di Toko Tutup, ditolak.` });
        return;
      }

      const latParsed = latRaw ? parseFloat(latRaw.replace(',', '.')) : NaN;
      const lngParsed = lngRaw ? parseFloat(lngRaw.replace(',', '.')) : NaN;
      const latitude = !Number.isNaN(latParsed) ? latParsed : null;
      const longitude = !Number.isNaN(lngParsed) ? lngParsed : null;
      let tipeMember = normalizeTipeMember(tipeMemberRaw);

      parsedRows.push({
        rowNum: rowNumber,
        tanggal,
        username,
        kode_member: kodeMember,
        nama_toko: namaTokoRaw,
        cabang: cabangRaw,
        latitude,
        longitude,
        tipe_member: tipeMember,
      });
    });

    if (parsedRows.length === 0) {
      res.status(400).json({ error: 'Tidak ada baris valid untuk diimport.', skipped });
      return;
    }

    const payload: Array<{
      tanggal_jadwal: string;
      username: string;
      kode_member: string;
      cabang: string;
      status_visit: string;
      latitude: number | null;
      longitude: number | null;
      nama_toko: string;
      tipe_member: string | null;
    }> = [];

    for (const r of parsedRows) {
      let namaToko = r.nama_toko;
      let lat: number | null = r.latitude;
      let lng: number | null = r.longitude;
      let tipeMember: string | null = r.tipe_member;

      try {
        // Klasifikasi SQL langsung untuk import Excel jika tipe_member di excel kosong
        // DITAMBAHKAN FILTER: (cust.cus_recordid != '1' OR cust.cus_recordid IS NULL)
        const rows = await queryLocal(
          `SELECT cust.cus_namamember, crm.crm_koordinat,
                  CASE
                      WHEN b.belanja_pertama IS NULL THEN 'Belum Aktivasi'
                      WHEN b.belanja_terakhir < CURRENT_DATE - INTERVAL '3 months' THEN 'Sleeper'
                      ELSE 'Aktif'
                  END AS tipe_member
           FROM tbmaster_customer cust
           LEFT JOIN tbmaster_customercrm crm ON cust.cus_kodemember = crm.crm_kodemember
           LEFT JOIN (
             SELECT
               jh_cus_kodemember,
               DATE_TRUNC('day', MIN(jh_transactiondate)) AS belanja_pertama,
               DATE_TRUNC('day', MAX(jh_transactiondate)) AS belanja_terakhir
             FROM tbtr_jualheader
             WHERE jh_cus_kodemember IS NOT NULL
             GROUP BY jh_cus_kodemember
           ) b ON cust.cus_kodemember = b.jh_cus_kodemember
           WHERE cust.cus_kodeigr = $1 AND cust.cus_kodemember = $2 AND (cust.cus_recordid != '1' OR cust.cus_recordid IS NULL)
           LIMIT 1`,
          [r.cabang, r.kode_member]
        );

        if (rows.length > 0) {
          if (!namaToko) namaToko = rows[0].cus_namamember;
          if ((lat === null || lng === null) && rows[0].crm_koordinat) {
            const parts = String(rows[0].crm_koordinat).split(',');
            if (parts.length === 2) {
              const la = parseFloat(parts[0].trim());
              const lo = parseFloat(parts[1].trim());
              if (!Number.isNaN(la) && !Number.isNaN(lo)) {
                lat = la;
                lng = lo;
              }
            }
          }
          if (!tipeMember) {
            tipeMember = rows[0].tipe_member; // Mengambil hasil dari SQL
          }
        }
      } catch {
        // Ignore DB connection errors, proceed with whatever data we have
      }

      if (!namaToko) {
        skipped.push({ row: r.rowNum, reason: `Kode member ${r.kode_member} tidak ditemukan (atau nonaktif) di database lokal dan Nama Toko di file kosong.` });
        continue;
      }

      payload.push({
        tanggal_jadwal: r.tanggal,
        username: r.username,
        kode_member: r.kode_member,
        cabang: r.cabang,
        status_visit: 'Pending',
        latitude: lat,
        longitude: lng,
        nama_toko: namaToko,
        tipe_member: tipeMember,
      });
    }

    if (payload.length === 0) {
      res.status(400).json({ error: 'Tidak ada baris valid untuk diimport.', skipped });
      return;
    }

    const pilihanCache = new Map<string, Set<string>>();
    for (const row of payload) {
      const [y, m] = row.tanggal_jadwal.slice(0, 7).split('-').map(Number);
      const key = `${row.cabang}|${y}|${m}`;
      if (!pilihanCache.has(key)) {
        const pilihan = await getMemberPilihanPeriode(row.cabang, y, m);
        pilihanCache.set(key, new Set(pilihan.map((p) => normCode(p.kode_member))));
      }
      const isPilihan = pilihanCache.get(key)?.has(normCode(row.kode_member)) || false;
      if (isPilihan) row.tipe_member = 'Member Pilihan';
    }

    await insertManySupabase('tbtr_jadwal_bulanan', payload);

    res.json({
      success: true,
      total_baris: parsedRows.length,
      inserted: payload.length,
      skipped_count: skipped.length,
      skipped,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Upload "Tipe Member" saja
// ============================================================

scheduleRouter.get('/tipe-member-template', async (_req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tipe Member');
    const header = ws.addRow(['Kode Member', 'Tipe Member']);
    styleHeaderRow(header);
    ws.addRow(['2T000123', 'Sleeper']);
    ws.columns = [{ width: 18 }, { width: 20 }];

    const ws2 = wb.addWorksheet('Petunjuk');
    const title = ws2.addRow(['Petunjuk Upload Tipe Member']);
    title.getCell(1).font = { bold: true, size: 13 };
    ws2.addRow([]);
    [
      '1. Gunakan file ini untuk mengisi/mengubah Tipe Member pada jadwal yang SUDAH ada, tanpa perlu upload ulang seluruh jadwal.',
      '2. Kolom Kode Member wajib diisi, harus sama dengan kode member yang sudah ada di jadwal.',
      '3. Kolom Tipe Member wajib diisi salah satu dari: Aktif, Sleeper, atau Belum Aktivasi.',
      '4. Update berlaku untuk SEMUA baris jadwal milik kode member tsb (semua tanggal, termasuk yang sudah lewat).',
      '5. Kalau kode member punya beberapa baris jadwal ke depan (beberapa tanggal), SEMUA baris tersebut akan ikut ter-update.',
    ].forEach((p) => {
      const row = ws2.addRow([p]);
      row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    });
    ws2.getColumn(1).width = 100;

    await sendWorkbook(res, wb, 'Template_Upload_Tipe_Member.xlsx');
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.post('/tipe-member-upload', async (req, res) => {
  try {
    const { fileBase64 } = req.body || {};
    if (!fileBase64) {
      res.status(400).json({ error: 'File tidak ditemukan. Silakan pilih file .xlsx untuk diupload.' });
      return;
    }
    const buffer = Buffer.from(String(fileBase64).split(',').pop() || '', 'base64');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      res.status(400).json({ error: 'File tidak valid. Pastikan file berformat .xlsx.' });
      return;
    }
    const ws = wb.worksheets[0];
    if (!ws) {
      res.status(400).json({ error: 'Sheet data tidak ditemukan di file.' });
      return;
    }

    const pairs: Array<{ kode_member: string; tipe_member: string }> = [];
    const skipped: Array<{ row: number; reason: string }> = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const kodeMember = excelCellToString(row.getCell(1).value).toUpperCase();
      const tipeRaw = excelCellToString(row.getCell(2).value);
      if (!kodeMember && !tipeRaw) return; 
      const tipe = normalizeTipeMember(tipeRaw);
      if (!kodeMember || !tipe || !['Aktif', 'Sleeper', 'Belum Aktivasi'].includes(tipe)) {
        skipped.push({ row: rowNumber, reason: 'Kode Member atau Tipe Member kosong/tidak valid.' });
        return;
      }
      pairs.push({ kode_member: kodeMember, tipe_member: tipe });
    });

    if (pairs.length === 0) {
      res.status(400).json({ error: 'Tidak ada baris valid untuk diupdate.', skipped });
      return;
    }

    let totalUpdated = 0;
    for (const p of pairs) {
      const updated = await updateSupabase(
        'tbtr_jadwal_bulanan',
        `kode_member=eq.${encodeURIComponent(p.kode_member)}`,
        { tipe_member: p.tipe_member }
      ).catch(() => null);
      if (updated !== null) totalUpdated++;
    }

    res.json({ success: true, total_baris: pairs.length, diproses: totalUpdated, skipped_count: skipped.length, skipped });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Penjadwalan Khusus SPV
// ============================================================

scheduleRouter.get('/spv-users', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '2T';
    const cleanCabang = cabang.trim().toUpperCase();

    // Ambil semua user dari tbmaster_user, lalu filter SPV & Admin
    const rows = await fetchSupabase<any>(
      `tbmaster_user?select=username,nama_lengkap,role,cabang,is_active&order=nama_lengkap.asc`
    ).catch(() => []);

    const filtered = (rows || []).filter((u: any) => {
      const role = String(u.role || '').toLowerCase();
      const isSpvOrAdmin = role.includes('spv') || role.includes('admin');
      if (!isSpvOrAdmin) return false;

      // User harus aktif jika is_active diset
      if (u.is_active === false) return false;

      // Filter cabang jika kolom cabang user terisi
      if (u.cabang) {
        return String(u.cabang).trim().toUpperCase() === cleanCabang;
      }
      return true;
    });

    res.json({
      users: filtered.map((u: any) => ({
        username: u.username,
        nama_lengkap: u.nama_lengkap || u.username,
        role: u.role,
        cabang: u.cabang || cabang,
        is_active: u.is_active !== false,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveCandidateCoords(
  cabang: string,
  rawCandidates: Array<{ kode_member: string; nama_toko?: string | null; advisor?: string }>
) {
  const codes = rawCandidates.map((c) => normCode(c.kode_member));
  const coordMap = new Map<string, { lat: number; lng: number; nama_toko?: string }>();

  // 1. Cek database lokal Postgres bila terhubung
  if (codes.length > 0 && getDbStatus().connected) {
    const custRows = await queryLocal(
      `SELECT cust.cus_kodemember, cust.cus_namamember, crm.crm_koordinat
       FROM tbmaster_customer cust
       LEFT JOIN tbmaster_customercrm crm ON cust.cus_kodemember = crm.crm_kodemember
       WHERE cust.cus_kodeigr = $1 AND cust.cus_kodemember = ANY($2)`,
      [cabang, codes]
    ).catch(() => []);

    for (const r of custRows || []) {
      const code = normCode(r.cus_kodemember);
      if (r.crm_koordinat) {
        const parts = String(r.crm_koordinat).split(',');
        if (parts.length === 2) {
          const lat = parseFloat(parts[0].trim());
          const lng = parseFloat(parts[1].trim());
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
            coordMap.set(code, { lat, lng, nama_toko: r.cus_namamember });
          }
        }
      }
    }
  }

  // 2. Fallback ke tbtr_jadwal_bulanan jika ada kode yang belum dapat koordinat
  const missingCodes = codes.filter((c) => !coordMap.has(c));
  if (missingCodes.length > 0) {
    const fbRows = await fetchSupabase<any>(
      `tbtr_jadwal_bulanan?select=kode_member,latitude,longitude,nama_toko&cabang=eq.${encodeURIComponent(
        cabang
      )}&latitude=not.is.null&order=id.desc`
    ).catch(() => []);

    for (const r of fbRows || []) {
      const code = normCode(r.kode_member);
      if (!coordMap.has(code) && r.latitude && r.longitude) {
        coordMap.set(code, {
          lat: parseFloat(r.latitude),
          lng: parseFloat(r.longitude),
          nama_toko: r.nama_toko,
        });
      }
    }
  }

  return coordMap;
}

scheduleRouter.get('/spv-candidates', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '2T';
    const bulan = ((req.query.bulan as string) || String(new Date().getMonth() + 1)).padStart(2, '0');
    const tahun = parseInt((req.query.tahun as string) || String(new Date().getFullYear()), 10);
    const spvUsername = (req.query.spv as string) || '';

    const jumlahHari = daysInMonth(parseInt(bulan, 10), tahun);
    const awalBulan = `${tahun}-${bulan}-01`;
    const akhirBulan = `${tahun}-${bulan}-${String(jumlahHari).padStart(2, '0')}`;

    // A. Semua Member Pilihan di cabang tersebut
    const pilihanRows = await fetchSupabase<any>(
      `tbtr_member_pilihan?select=*&cabang=eq.${encodeURIComponent(cabang)}&order=advisor.asc,kode_member.asc`
    ).catch(() => []);

    const blockedCodes = await getBlockedMemberCodes();

    // B. Cari yang sudah dikunjungi di bulan ini
    const [kunjunganRows, jadwalSelesaiRows, existingSpvJadwal] = await Promise.all([
      fetchSupabase<any>(
        `tbtr_kunjungan_rkm?select=kode_member,created_at&cabang=eq.${encodeURIComponent(
          cabang
        )}&created_at=gte.${awalBulan}T00:00:00%2B07:00&created_at=lte.${akhirBulan}T23:59:59%2B07:00`
      ).catch(() => []),
      fetchSupabase<any>(
        `tbtr_jadwal_bulanan?select=kode_member,status_visit&cabang=eq.${encodeURIComponent(
          cabang
        )}&tanggal_jadwal=gte.${awalBulan}&tanggal_jadwal=lte.${akhirBulan}&status_visit=neq.Pending`
      ).catch(() => []),
      spvUsername
        ? fetchSupabase<any>(
            `tbtr_jadwal_bulanan?select=kode_member,tanggal_jadwal&username=eq.${encodeURIComponent(
              spvUsername
            )}&cabang=eq.${encodeURIComponent(cabang)}&tanggal_jadwal=gte.${awalBulan}&tanggal_jadwal=lte.${akhirBulan}`
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    const visitedCodes = new Set<string>();
    for (const r of kunjunganRows || []) {
      if (r.kode_member) visitedCodes.add(normCode(r.kode_member));
    }
    for (const r of jadwalSelesaiRows || []) {
      if (r.kode_member) visitedCodes.add(normCode(r.kode_member));
    }

    const scheduledBySpvCodes = new Set<string>();
    for (const r of existingSpvJadwal || []) {
      if (r.kode_member) scheduledBySpvCodes.add(normCode(r.kode_member));
    }

    // C. Resolusi koordinat
    const coordMap = await resolveCandidateCoords(cabang, pilihanRows || []);

    const candidates: any[] = [];
    const visited: any[] = [];
    let blockedCount = 0;
    let tanpaKoordinat = 0;

    for (const row of pilihanRows || []) {
      const code = normCode(row.kode_member);
      if (blockedCodes.has(code)) {
        blockedCount++;
        continue;
      }
      const coords = coordMap.get(code);
      if (!coords) tanpaKoordinat++;

      const item = {
        kode_member: row.kode_member,
        nama_toko: row.nama_toko || coords?.nama_toko || 'Toko ' + row.kode_member,
        advisor: row.advisor || '-',
        cabang: row.cabang || cabang,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        crm_koordinat: coords ? `${coords.lat}, ${coords.lng}` : '',
        sudah_dikunjungi: visitedCodes.has(code),
        sudah_dijadwalkan_spv: scheduledBySpvCodes.has(code),
      };

      if (visitedCodes.has(code)) {
        visited.push(item);
      } else {
        candidates.push(item);
      }
    }

    res.json({
      candidates,
      visited,
      stats: {
        total_pilihan: (pilihanRows || []).length,
        sudah_dikunjungi: visited.length,
        belum_dikunjungi: candidates.length,
        tanpa_koordinat: tanpaKoordinat,
        diblokir: blockedCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

scheduleRouter.post('/spv-generate', async (req, res) => {
  try {
    const {
      spvUsername,
      cabang = '2T',
      bulan = String(new Date().getMonth() + 1).padStart(2, '0'),
      tahun = new Date().getFullYear(),
      tglDari,
      tglSampai,
      maksPerHari = 5,
    } = req.body || {};

    if (!spvUsername) {
      res.status(400).json({ error: 'SPV (username) wajib dipilih.' });
      return;
    }

    const limit = Math.max(1, Math.min(50, parseInt(String(maksPerHari), 10) || 5));
    const bulanNum = parseInt(String(bulan), 10);
    const tahunNum = parseInt(String(tahun), 10);
    const jumlahHari = daysInMonth(bulanNum, tahunNum);

    const awalBulan = `${tahunNum}-${String(bulanNum).padStart(2, '0')}-01`;
    const akhirBulan = `${tahunNum}-${String(bulanNum).padStart(2, '0')}-${String(jumlahHari).padStart(2, '0')}`;

    // 1. Ambil Member Pilihan cabang
    const pilihanRows = await fetchSupabase<any>(
      `tbtr_member_pilihan?select=*&cabang=eq.${encodeURIComponent(cabang)}&order=advisor.asc,kode_member.asc`
    ).catch(() => []);

    const blockedCodes = await getBlockedMemberCodes();

    // 2. Kunjungan yang sudah selesai bulan ini
    const [kunjunganRows, jadwalSelesaiRows] = await Promise.all([
      fetchSupabase<any>(
        `tbtr_kunjungan_rkm?select=kode_member&cabang=eq.${encodeURIComponent(
          cabang
        )}&created_at=gte.${awalBulan}T00:00:00%2B07:00&created_at=lte.${akhirBulan}T23:59:59%2B07:00`
      ).catch(() => []),
      fetchSupabase<any>(
        `tbtr_jadwal_bulanan?select=kode_member&cabang=eq.${encodeURIComponent(
          cabang
        )}&tanggal_jadwal=gte.${awalBulan}&tanggal_jadwal=lte.${akhirBulan}&status_visit=neq.Pending`
      ).catch(() => []),
    ]);

    const visitedCodes = new Set<string>();
    for (const r of kunjunganRows || []) if (r.kode_member) visitedCodes.add(normCode(r.kode_member));
    for (const r of jadwalSelesaiRows || []) if (r.kode_member) visitedCodes.add(normCode(r.kode_member));

    // 3. Filter kandidat yang belum dikunjungi dan tidak diblokir
    const unvisitedRows = (pilihanRows || []).filter((r: any) => {
      const code = normCode(r.kode_member);
      return !blockedCodes.has(code) && !visitedCodes.has(code);
    });

    if (unvisitedRows.length === 0) {
      res.json({
        success: true,
        matrix: { [spvUsername]: [] },
        message: 'Semua Member Pilihan di cabang ini sudah dikunjungi pada bulan ini.',
        stats: { total_candidates: 0, scheduled_count: 0, days_used: 0, working_days_available: 0 },
      });
      return;
    }

    // 4. Resolusi koordinat
    const coordMap = await resolveCandidateCoords(cabang, unvisitedRows);

    const candidatesWithCoords: any[] = [];
    const candidatesWithoutCoords: any[] = [];

    for (const r of unvisitedRows) {
      const code = normCode(r.kode_member);
      const coords = coordMap.get(code);
      const item = {
        cus_kodemember: r.kode_member,
        cus_namamember: r.nama_toko || coords?.nama_toko || 'Toko ' + r.kode_member,
        cus_nosalesman: spvUsername,
        cus_kodeigr: cabang,
        crm_koordinat: coords ? `${coords.lat}, ${coords.lng}` : '',
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        tipe_member: 'Member Pilihan',
        member_pilihan: true,
        status_visit: 'Pending',
        advisor_asli: r.advisor,
      };

      if (coords?.lat && coords?.lng) {
        candidatesWithCoords.push(item);
      } else {
        candidatesWithoutCoords.push(item);
      }
    }

    // 5. Tentukan hari kerja yang valid (skip Minggu & hari libur)
    const liburInfo = await getHolidayInfo(tahunNum);
    const eligibleDates: string[] = [];
    for (let hari = 1; hari <= jumlahHari; hari++) {
      const dateStr = `${tahunNum}-${String(bulanNum).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
      if (tglDari && dateStr < tglDari) continue;
      if (tglSampai && dateStr > tglSampai) continue;

      const dow = new Date(dateStr + 'T00:00:00').getDay();
      if (dow === 0) continue; // Minggu libur
      if (liburInfo.dates.has(dateStr)) continue; // Hari libur nasional
      eligibleDates.push(dateStr);
    }

    if (eligibleDates.length === 0) {
      res.status(400).json({ error: 'Tidak ada hari kerja yang tersedia dalam periode tanggal yang dipilih.' });
      return;
    }

    // 6. Urutkan kandidat berkoordinat secara spasial (sudut bearing dari centroid)
    let pool = [...candidatesWithCoords];
    if (pool.length > 0) {
      const avgLat = pool.reduce((acc, c) => acc + c.lat, 0) / pool.length;
      const avgLng = pool.reduce((acc, c) => acc + c.lng, 0) / pool.length;
      pool = pool
        .map((c) => ({ ...c, sudut: bearing(avgLat, avgLng, c.lat, c.lng) }))
        .sort((a, b) => a.sudut - b.sudut);
    }

    // Tambahkan kandidat tanpa koordinat di akhir
    const allPool = [...pool, ...candidatesWithoutCoords];

    // 7. Bagi ke dalam hari-hari kerja sesuai limit kuota per hari
    const scheduleDays: Array<{ tanggal: string; toko: any[] }> = [];
    let poolIndex = 0;

    for (const dateStr of eligibleDates) {
      if (poolIndex >= allPool.length) break;

      const dayBatch: any[] = [];
      while (dayBatch.length < limit && poolIndex < allPool.length) {
        dayBatch.push(allPool[poolIndex]);
        poolIndex++;
      }

      // Optimalkan urutan rute dalam hari tersebut (nearest-neighbor)
      const withCoords = dayBatch.filter((t) => t.lat !== null && t.lng !== null);
      const withoutCoords = dayBatch.filter((t) => t.lat === null || t.lng === null);
      const sortedWithCoords = routeSort(withCoords);
      const sortedDay = [...sortedWithCoords, ...withoutCoords];

      scheduleDays.push({
        tanggal: dateStr,
        toko: sortedDay,
      });
    }

    const totalScheduled = scheduleDays.reduce((acc, d) => acc + d.toko.length, 0);

    res.json({
      success: true,
      matrix: {
        [spvUsername]: scheduleDays,
      },
      stats: {
        total_candidates: unvisitedRows.length,
        scheduled_count: totalScheduled,
        sisa_belum_terjadwal: unvisitedRows.length - totalScheduled,
        days_used: scheduleDays.length,
        working_days_available: eligibleDates.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

