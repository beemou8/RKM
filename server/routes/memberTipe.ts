import { Router } from 'express';
import { queryLocal, getDbStatus } from '../lib/db.js';
import { fetchSupabase, updateSupabase } from '../lib/supabase.js';
import { sendWorkbook, styleHeaderRow } from '../lib/excel.js';
import ExcelJS from 'exceljs';

export const memberTipeRouter = Router();

export type MemberTipe = 'Aktif' | 'Sleeper' | 'Belum Aktivasi' | 'Tidak Aktif';
export type MemberTipeFilter = 'butuh_visit' | 'Sleeper' | 'Belum Aktivasi' | 'Tidak Aktif' | 'Member Pilihan' | 'semua';

export interface MemberTipeRow {
  kode_member: string;
  nama_member: string;
  advisor?: string | null;
  belanja_pertama?: string | null;
  belanja_terakhir?: string | null;
  tipe: MemberTipe;
  member_pilihan?: boolean;
}

export interface MemberTipeTotals {
  aktif: number;
  sleeper: number;
  belum_aktivasi: number;
  tidak_aktif: number;
  member_pilihan: number;
  total: number;
}

function parseLimit(value: unknown): number {
  const parsed = Number(value ?? 250);
  if (!Number.isFinite(parsed)) return 250;
  return Math.min(Math.max(Math.trunc(parsed), 1), 1000);
}

function parseTipe(value: unknown): MemberTipeFilter {
  const tipe = String(value ?? 'butuh_visit');
  const allowed: MemberTipeFilter[] = ['butuh_visit', 'Sleeper', 'Belum Aktivasi', 'Tidak Aktif', 'Member Pilihan', 'semua'];
  return allowed.includes(tipe as MemberTipeFilter) ? (tipe as MemberTipeFilter) : 'butuh_visit';
}

function parsePeriode(req: any) {
  const now = new Date();
  const bulan = Math.min(Math.max(parseInt(String(req.query.bulan || now.getMonth() + 1), 10), 1), 12);
  const tahun = parseInt(String(req.query.tahun || now.getFullYear()), 10);
  return { bulan, tahun };
}

const KLASIFIKASI_CTE = `
  WITH klas AS (
    SELECT
      cust.cus_kodemember   AS kode_member,
      cust.cus_namamember   AS nama_member,
      cust.cus_nosalesman   AS advisor,
      TO_CHAR(b.belanja_pertama, 'YYYY-MM-DD')  AS belanja_pertama,
      TO_CHAR(b.belanja_terakhir, 'YYYY-MM-DD') AS belanja_terakhir,
      CASE
        WHEN cust.cus_recordid = '1' THEN 'Tidak Aktif'
        WHEN b.belanja_pertama IS NULL THEN 'Belum Aktivasi'
        WHEN b.belanja_terakhir < CURRENT_DATE - INTERVAL '3 months' THEN 'Sleeper'
        ELSE 'Aktif'
      END AS tipe
    FROM tbmaster_customer cust
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
      AND cust.cus_namamember <> 'NEW'
  )
`;

async function getPilihanCodes(cabang: string): Promise<string[]> {
  const rows = await fetchSupabase<any>(
    `tbtr_member_pilihan?select=kode_member&cabang=eq.${encodeURIComponent(cabang)}&order=advisor.asc,kode_member.asc`
  ).catch(() => []);
  return Array.from(new Set((rows || []).map((r: any) => String(r.kode_member || '').trim().toUpperCase()).filter(Boolean)));
}

async function queryMemberRows(cabang: string, tipe: MemberTipeFilter, limit: number, pilihanCodes: string[], search: string = ''): Promise<MemberTipeRow[]> {
  const searchPattern = search.trim() ? `%${search.trim().toLowerCase()}%` : '';
  if (tipe === 'Member Pilihan') {
    if (pilihanCodes.length === 0) return [];
    const rows = await queryLocal<MemberTipeRow>(
      `${KLASIFIKASI_CTE}
       SELECT kode_member, nama_member, advisor, belanja_pertama, belanja_terakhir, tipe
       FROM klas
       WHERE UPPER(kode_member) = ANY($2::text[])
         AND ($4 = '' OR LOWER(kode_member) LIKE $4 OR LOWER(nama_member) LIKE $4 OR LOWER(COALESCE(advisor, '')) LIKE $4)
       ORDER BY advisor ASC NULLS LAST, nama_member ASC
       LIMIT $3`,
      [cabang, pilihanCodes, limit, searchPattern]
    );
    return rows.map((r) => ({ ...r, member_pilihan: true }));
  }

  const rows = await queryLocal<MemberTipeRow>(
    `${KLASIFIKASI_CTE}
     SELECT kode_member, nama_member, advisor, belanja_pertama, belanja_terakhir, tipe
     FROM klas
     WHERE (($2 = 'semua')
        OR ($2 = 'butuh_visit' AND tipe IN ('Sleeper', 'Belum Aktivasi'))
        OR (tipe = $2))
       AND ($4 = '' OR LOWER(kode_member) LIKE $4 OR LOWER(nama_member) LIKE $4 OR LOWER(COALESCE(advisor, '')) LIKE $4)
     ORDER BY belanja_terakhir ASC NULLS FIRST
     LIMIT $3`,
    [cabang, tipe, limit, searchPattern]
  );
  const pilihanSet = new Set(pilihanCodes);
  return rows.map((r) => ({ ...r, member_pilihan: pilihanSet.has(String(r.kode_member || '').trim().toUpperCase()) }));
}

async function queryTotals(cabang: string, memberPilihan: number): Promise<MemberTipeTotals> {
  const rows = await queryLocal<any>(
    `${KLASIFIKASI_CTE}
     SELECT
       COUNT(*) FILTER (WHERE tipe = 'Aktif')           AS aktif,
       COUNT(*) FILTER (WHERE tipe = 'Sleeper')         AS sleeper,
       COUNT(*) FILTER (WHERE tipe = 'Belum Aktivasi')  AS belum_aktivasi,
       COUNT(*) FILTER (WHERE tipe = 'Tidak Aktif')     AS tidak_aktif,
       COUNT(*)                                          AS total
     FROM klas`,
    [cabang]
  );
  const r = rows[0] || {};
  return {
    aktif: Number(r.aktif) || 0,
    sleeper: Number(r.sleeper) || 0,
    belum_aktivasi: Number(r.belum_aktivasi) || 0,
    tidak_aktif: Number(r.tidak_aktif) || 0,
    member_pilihan: memberPilihan,
    total: Number(r.total) || 0,
  };
}

memberTipeRouter.get('/', async (req, res) => {
  try {
    const cabang = String(req.query.cabang || '2T').trim() || '2T';
    const tipe = parseTipe(req.query.tipe);
    const limit = parseLimit(req.query.limit);
    const search = String(req.query.search || '').trim();
    const { bulan, tahun } = parsePeriode(req);
    const pilihanCodes = await getPilihanCodes(cabang);
    const [data, totals] = await Promise.all([
      queryMemberRows(cabang, tipe, limit, pilihanCodes, search),
      queryTotals(cabang, pilihanCodes.length),
    ]);
    res.json({ data, totals, bulan, tahun, db_lokal_connected: getDbStatus().connected });
  } catch (err: any) {
    console.error('[member-tipe] GET error:', err);
    res.status(500).json({ error: err?.message || 'Gagal mengambil data member tipe' });
  }
});

memberTipeRouter.get('/export', async (req, res) => {
  try {
    const cabang = String(req.query.cabang || '2T').trim() || '2T';
    const { bulan, tahun } = parsePeriode(req);
    const pilihanCodes = await getPilihanCodes(cabang);
    const data = await queryMemberRows(cabang, 'semua', 500, pilihanCodes);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Member Tipe');
    ws.addRow([`Dashboard Member - Cabang ${cabang}`]);
    ws.addRow([`Member Pilihan aktif cabang ${cabang}`]);
    ws.addRow([]);
    const header = ws.addRow(['Kode Member', 'Nama Member', 'Advisor', 'Belanja Pertama', 'Belanja Terakhir', 'Tipe', 'Member Pilihan']);
    styleHeaderRow(header);
    for (const row of data) {
      ws.addRow([
        row.kode_member,
        row.nama_member,
        row.advisor || '-',
        row.belanja_pertama || '-',
        row.belanja_terakhir || '-',
        row.tipe,
        row.member_pilihan ? 'YA' : '-',
      ]);
    }
    ws.columns.forEach((c) => (c.width = 22));
    await sendWorkbook(res, wb, `Dashboard_Member_${cabang}_${tahun}_${String(bulan).padStart(2, '0')}.xlsx`);
  } catch (err: any) {
    console.error('[member-tipe] export error:', err);
    res.status(500).json({ error: err?.message || 'Gagal export data member tipe' });
  }
});

memberTipeRouter.post('/apply-tipe', async (req, res) => {
  try {
    const items: Array<{ kode_member: string; tipe: string }> = req.body?.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Tidak ada member yang dipilih.' });
      return;
    }

    const gagal: string[] = [];
    let count = 0;
    for (const item of items) {
      const kode = String(item.kode_member || '').trim().toUpperCase();
      const tipe = String(item.tipe || '').trim();
      if (!kode || !tipe) continue;
      try {
        await updateSupabase('tbtr_jadwal_bulanan', `kode_member=eq.${encodeURIComponent(kode)}&tipe_member=neq.Member%20Pilihan`, { tipe_member: tipe });
        count++;
      } catch {
        gagal.push(kode);
      }
    }
    res.json({ success: true, count, gagal });
  } catch (err: any) {
    console.error('[member-tipe] apply-tipe error:', err);
    res.status(500).json({ error: err?.message || 'Gagal menerapkan tipe member' });
  }
});
