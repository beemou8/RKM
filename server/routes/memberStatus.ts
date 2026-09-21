import { Router } from 'express';
import ExcelJS from 'exceljs';
import { fetchSupabase } from '../lib/supabase.js';
import { queryLocal, getDbStatus } from '../lib/db.js';
import { sendWorkbook, styleHeaderRow } from '../lib/excel.js';

export const memberStatusRouter = Router();

type MemberStatusSource = 'rkm' | 'by_call';

function normalizeSource(value: unknown): MemberStatusSource {
  return String(value || '').toLowerCase() === 'by_call' ? 'by_call' : 'rkm';
}

function sourceTable(source: MemberStatusSource): string {
  return source === 'by_call' ? 'tbtr_kunjungan_by_call' : 'tbtr_kunjungan_rkm';
}

const MEMBER_STATUS_SELECT = 'kode_member,username,berhasil_order,status_detail,no_trx,kategori_tidak_order,alasan_tidak_order,created_at';
const memberVisitsCache = new Map<string, { expiresAt: number; visits: any[] }>();

async function fetchAllVisits(cabang: string, source: MemberStatusSource, petugas = '') {
  const cacheKey = `${cabang}::${source}::${petugas}`;
  const now = Date.now();
  const cached = memberVisitsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.visits;
  }

  const table = sourceTable(source);
  const rows: any[] = [];
  const pageSize = 1000;
  const maxRows = 5000;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let q = `${table}?select=${MEMBER_STATUS_SELECT}&cabang=eq.${encodeURIComponent(cabang)}` +
      `&kode_member=not.is.null&order=created_at.desc.nullslast&limit=${pageSize}&offset=${offset}`;
    if (source === 'by_call') q += '&berhasil_order=eq.true';
    if (petugas) q += `&username=eq.${encodeURIComponent(petugas)}`;

    const page = await fetchSupabase<any>(q).catch(() => []);
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  memberVisitsCache.set(cacheKey, { expiresAt: now + 45_000, visits: rows });
  return rows;
}

async function buildMemberStatus(cabang: string, petugas: string, source: MemberStatusSource) {
  const visits = await fetchAllVisits(cabang, source, petugas);
  const visitByCode = new Map<string, any>();

  // Query kunjungan sudah diurutkan terbaru -> lama, jadi simpan visit terbaru per member.
  for (const row of visits) {
    const kode = String(row.kode_member || '').trim().toUpperCase();
    if (!kode || visitByCode.has(kode)) continue;
    visitByCode.set(kode, row);
  }

  try {
    const params: any[] = [cabang];
    let advisorWhere = '';
    if (petugas) {
      params.push(petugas);
      advisorWhere = ` AND LOWER(TRIM(COALESCE(cust.cus_nosalesman, ''))) = LOWER(TRIM($2))`;
    }

    const customers = await queryLocal<any>(
      `SELECT cust.cus_kodemember AS kode_member,
              cust.cus_namamember AS nama_member,
              cust.cus_nosalesman AS advisor
       FROM tbmaster_customer cust
       WHERE cust.cus_kodeigr = $1
         AND cust.cus_namamember <> 'NEW'
         AND (cust.cus_recordid != '1' OR cust.cus_recordid IS NULL)
         ${advisorWhere}
       ORDER BY cust.cus_nosalesman ASC NULLS LAST, cust.cus_namamember ASC`,
      params
    );

    const advisorSet = new Set<string>();
    const sudah: any[] = [];
    const belum: any[] = [];

    for (const cust of customers || []) {
      const kode = String(cust.kode_member || '').trim().toUpperCase();
      const advisor = String(cust.advisor || '').trim();
      if (advisor) advisorSet.add(advisor);

      const visit = visitByCode.get(kode);
      const base = {
        kode_member: cust.kode_member,
        nama_member: cust.nama_member,
        advisor: cust.advisor || null,
      };

      if (visit) {
        sudah.push({
          ...base,
          username_kunjungan: visit.username || null,
          berhasil_order: visit.berhasil_order === true || visit.berhasil_order === 't',
          status_detail: visit.status_detail || null,
          no_trx: visit.no_trx || null,
          kategori_tidak_order: visit.kategori_tidak_order || null,
          alasan_tidak_order: visit.alasan_tidak_order || null,
          waktu_kunjungan: visit.created_at || visit.tanggal || null,
        });
      } else {
        belum.push(base);
      }
    }

    // Saat advisor sedang difilter, frontend tetap butuh seluruh pilihan advisor cabang.
    let advisorList = Array.from(advisorSet).sort();
    if (petugas) {
      const allAdvisors = await queryLocal<any>(
        `SELECT DISTINCT TRIM(cust.cus_nosalesman) AS advisor
         FROM tbmaster_customer cust
         WHERE cust.cus_kodeigr = $1
           AND cust.cus_namamember <> 'NEW'
           AND (cust.cus_recordid != '1' OR cust.cus_recordid IS NULL)
           AND NULLIF(TRIM(COALESCE(cust.cus_nosalesman, '')), '') IS NOT NULL
         ORDER BY advisor ASC`,
        [cabang]
      );
      advisorList = (allAdvisors || []).map((r: any) => String(r.advisor || '').trim()).filter(Boolean);
    }

    return {
      source,
      source_label: source === 'by_call' ? 'BY CALL' : 'RKM',
      sudah,
      belum,
      totals: { total_member: customers.length, sudah: sudah.length, belum: belum.length },
      advisor_list: advisorList,
      db_lokal_connected: getDbStatus().connected,
    };
  } catch {
    return {
      source,
      source_label: source === 'by_call' ? 'BY CALL' : 'RKM',
      sudah: [],
      belum: [],
      totals: { total_member: 0, sudah: 0, belum: 0 },
      advisor_list: [],
      db_lokal_connected: false,
    };
  }
}

memberStatusRouter.get('/', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '2T';
    const petugas = (req.query.petugas as string) || '';
    const source = normalizeSource(req.query.source);
    res.json(await buildMemberStatus(cabang, petugas, source));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

memberStatusRouter.get('/export', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string) || '2T';
    const petugas = (req.query.petugas as string) || '';
    const source = normalizeSource(req.query.source);
    const data = await buildMemberStatus(cabang, petugas, source);

    const wb = new ExcelJS.Workbook();
    const labelSudah = source === 'by_call' ? 'Sudah Belanja' : 'Sudah Dikunjungi';
    const labelBelum = source === 'by_call' ? 'Belum Belanja' : 'Belum Dikunjungi';

    const wsSummary = wb.addWorksheet('Ringkasan');
    wsSummary.addRow([`STATUS KUNJUNGAN MEMBER - ${data.source_label}`]);
    wsSummary.addRow([`Cabang: ${cabang}${petugas ? ` | Advisor: ${petugas.toUpperCase()}` : ''}`]);
    wsSummary.addRow([]);
    const hSummary = wsSummary.addRow(['Total Member', labelSudah, labelBelum]);
    styleHeaderRow(hSummary);
    wsSummary.addRow([data.totals.total_member, data.totals.sudah, data.totals.belum]);
    wsSummary.columns.forEach((c) => (c.width = 22));

    const wsSudah = wb.addWorksheet(labelSudah.substring(0, 31));
    const hSudah = source === 'by_call'
      ? wsSudah.addRow(['No', 'Kode Member', 'Nama Member', 'Advisor Master', 'Petugas By Call', 'No Trx', 'Waktu'])
      : wsSudah.addRow(['No', 'Kode Member', 'Nama Member', 'Advisor Master', 'Petugas Kunjungan', 'Berhasil Order', 'No Trx', 'Kategori Tidak Order', 'Alasan Tidak Order', 'Waktu Kunjungan']);
    styleHeaderRow(hSudah);
    data.sudah.forEach((r: any, i: number) => {
      if (source === 'by_call') {
        wsSudah.addRow([i + 1, r.kode_member, r.nama_member, r.advisor || '', r.username_kunjungan || '', r.no_trx || '', r.waktu_kunjungan || '']);
      } else {
        wsSudah.addRow([i + 1, r.kode_member, r.nama_member, r.advisor || '', r.username_kunjungan || '', r.berhasil_order ? 'YA' : 'TIDAK', r.no_trx || '', r.kategori_tidak_order || '', r.alasan_tidak_order || '', r.waktu_kunjungan || '']);
      }
    });
    wsSudah.columns.forEach((c) => (c.width = 20));

    const wsBelum = wb.addWorksheet(labelBelum.substring(0, 31));
    const hBelum = wsBelum.addRow(['No', 'Kode Member', 'Nama Member', 'Advisor Master']);
    styleHeaderRow(hBelum);
    data.belum.forEach((r: any, i: number) => wsBelum.addRow([i + 1, r.kode_member, r.nama_member, r.advisor || '']));
    wsBelum.columns.forEach((c, i) => (c.width = [7, 16, 38, 18][i] || 18));

    await sendWorkbook(res, wb, `Status_Kunjungan_Member_${data.source_label}_${cabang}.xlsx`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
