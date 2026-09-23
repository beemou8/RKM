import { Router } from 'express';
import ExcelJS from 'exceljs';
import { fetchSupabaseAll } from '../lib/supabase.js';
import { queryLocal } from '../lib/db.js';
import { FILL, sendWorkbook, styleHeaderRow, thinBorder } from '../lib/excel.js';

export const surveiHargaRouter = Router();

type SurveiDetailRow = {
  id: number;
  header_id: number | null;
  plu: string | null;
  nama_barang: string;
  harga: number | string | null;
  frac: string | null;
};

type SurveiHeaderRow = {
  id: number;
  nama_kompetitor: string;
  tanggal_struk: string;
  foto_struk: string | null;
  nama_user: string;
  cabang: string | null;
  created_at: string | null;
};

type ProductPriceRow = {
  prd_prdcd: string;
  prd_deskripsipanjang: string | null;
  prd_unit: string | null;
  prd_frac: number | string | null;
  harga_normal: number | string | null;
  harga_promo: number | string | null;
};

type CompareStatus = 'MENANG' | 'KALAH' | 'SERI' | 'TIDAK_ADA_HARGA';

type BuildParams = {
  cabang: string;
  petugas?: string;
  kompetitor?: string;
  tglDari?: string;
  tglSampai?: string;
};

function cleanDate(value: unknown): string {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function safeNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function normalizePlu(value: unknown): string {
  return String(value || '').trim();
}

function sameText(a: unknown, b: unknown): boolean {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function compareHarga(hargaKompetitor: number, hargaKita: number): CompareStatus {
  if (hargaKompetitor <= 0 || hargaKita <= 0) return 'TIDAK_ADA_HARGA';
  if (hargaKompetitor > hargaKita) return 'MENANG';
  if (hargaKompetitor < hargaKita) return 'KALAH';
  return 'SERI';
}

function sortHistoryDesc(a: any, b: any) {
  const da = `${a.tanggal_struk || ''}T${a.created_at || ''}`;
  const db = `${b.tanggal_struk || ''}T${b.created_at || ''}`;
  if (da !== db) return db.localeCompare(da);
  return Number(b.detail_id || 0) - Number(a.detail_id || 0);
}

async function buildSurveiHargaData(params: BuildParams) {
  const cabang = String(params.cabang || '2T').trim() || '2T';
  const petugas = String(params.petugas || '').trim();
  const kompetitor = String(params.kompetitor || '').trim();
  const tglDari = cleanDate(params.tglDari);
  const tglSampai = cleanDate(params.tglSampai);

  // Ambil header berdasarkan cabang + periode terlebih dahulu agar daftar
  // penginput dan kompetitor tetap tersedia saat salah satu filter dipilih.
  const headerQuery = new URLSearchParams();
  headerQuery.set('select', 'id,nama_kompetitor,tanggal_struk,foto_struk,nama_user,cabang,created_at');
  headerQuery.set('cabang', `eq.${cabang}`);
  if (tglDari) headerQuery.set('tanggal_struk', `gte.${tglDari}`);
  if (tglSampai) headerQuery.append('tanggal_struk', `lte.${tglSampai}`);
  headerQuery.set('order', 'tanggal_struk.desc,created_at.desc,id.desc');

  const baseHeaders = await fetchSupabaseAll<SurveiHeaderRow>(`tbtr_survei_header?${headerQuery.toString()}`, {
    pageSize: 1000,
    maxRows: 50000,
  }).catch((err) => {
    console.error('[survei-harga] Gagal memuat header survei:', err.message);
    return [];
  });

  const users = Array.from(
    new Set(baseHeaders.map((h) => String(h.nama_user || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const headersByUser = petugas
    ? baseHeaders.filter((h) => sameText(h.nama_user, petugas))
    : baseHeaders;

  const competitors = Array.from(
    new Set(headersByUser.map((h) => String(h.nama_kompetitor || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const headers = kompetitor
    ? headersByUser.filter((h) => String(h.nama_kompetitor || '').toLowerCase().includes(kompetitor.toLowerCase()))
    : headersByUser;

  const headerIds = headers.map((h) => Number(h.id)).filter((id) => Number.isFinite(id));
  let details: SurveiDetailRow[] = [];

  if (headerIds.length > 0) {
    const batches: number[][] = [];
    for (let i = 0; i < headerIds.length; i += 250) batches.push(headerIds.slice(i, i + 250));

    const results = await Promise.all(
      batches.map(async (ids) => {
        const detailQuery = new URLSearchParams();
        detailQuery.set('select', 'id,header_id,plu,nama_barang,harga,frac');
        detailQuery.set('header_id', `in.(${ids.join(',')})`);
        detailQuery.set('order', 'header_id.asc,id.asc');
        return fetchSupabaseAll<SurveiDetailRow>(`tbtr_survei_detail?${detailQuery.toString()}`, {
          pageSize: 1000,
          maxRows: 10000,
        }).catch((err) => {
          console.error('[survei-harga] Gagal memuat batch detail:', err.message);
          return [];
        });
      })
    );
    details = results.flat();
  }

  const uniquePlus = Array.from(new Set(details.map((d) => normalizePlu(d.plu)).filter(Boolean)));

  // Join tbtr_survei_detail.plu -> tbmaster_prodmast.prd_prdcd.
  // Harga kita menggunakan promo aktif jika lebih murah daripada harga normal.
  let productRows: ProductPriceRow[] = [];
  if (uniquePlus.length > 0) {
    productRows = await queryLocal<ProductPriceRow>(
      `
        SELECT
          p.prd_prdcd,
          p.prd_deskripsipanjang,
          p.prd_unit,
          p.prd_frac,
          p.prd_hrgjual::numeric AS harga_normal,
          COALESCE((
            SELECT MIN(pm.prmd_hrgjual::numeric)
            FROM tbtr_promomd pm
            WHERE pm.prmd_prdcd = p.prd_prdcd
              AND CURRENT_DATE BETWEEN pm.prmd_tglawal::date AND pm.prmd_tglakhir::date
              AND COALESCE(pm.prmd_hrgjual, 0) > 0
          ), 0) AS harga_promo
        FROM tbmaster_prodmast p
        WHERE p.prd_prdcd = ANY($1::text[])
          AND p.prd_recordid IS NULL
      `,
      [uniquePlus]
    ).catch((err) => {
      console.warn('[survei-harga] DB lokal tidak terjangkau / offline, harga pembanding master dilewati:', err.message);
      return [];
    });
  }

  const productMap = new Map<string, {
    nama_master: string | null;
    unit: string | null;
    frac_master: number;
    harga_normal: number;
    harga_promo: number;
    harga_kita: number;
  }>();

  for (const row of productRows) {
    const plu = normalizePlu(row.prd_prdcd);
    const hargaNormal = safeNumber(row.harga_normal);
    const hargaPromo = safeNumber(row.harga_promo);
    const hargaKita = hargaPromo > 0 && hargaNormal > 0
      ? Math.min(hargaNormal, hargaPromo)
      : (hargaPromo > 0 ? hargaPromo : hargaNormal);

    productMap.set(plu, {
      nama_master: row.prd_deskripsipanjang || null,
      unit: row.prd_unit || null,
      frac_master: safeNumber(row.prd_frac),
      harga_normal: hargaNormal,
      harga_promo: hargaPromo,
      harga_kita: hargaKita,
    });
  }

  const headerMap = new Map(headers.map((h) => [Number(h.id), h]));

  const flatHistory = details
    .map((detail) => {
      const header = headerMap.get(Number(detail.header_id));
      if (!header) return null;

      const plu = normalizePlu(detail.plu);
      const product = productMap.get(plu);
      const hargaKompetitor = safeNumber(detail.harga);
      const hargaKita = product?.harga_kita || 0;
      const status = compareHarga(hargaKompetitor, hargaKita);
      const selisih = hargaKompetitor - hargaKita;
      const selisihPersen = hargaKita > 0 ? (selisih / hargaKita) * 100 : 0;

      return {
        detail_id: Number(detail.id),
        header_id: Number(detail.header_id),
        plu,
        nama_barang: product?.nama_master || detail.nama_barang || '-',
        nama_barang_input: detail.nama_barang || '-',
        frac: detail.frac || null,
        unit: product?.unit || null,
        frac_master: product?.frac_master || 0,
        harga_kompetitor: hargaKompetitor,
        harga_kita: hargaKita,
        harga_normal: product?.harga_normal || 0,
        harga_promo: product?.harga_promo || 0,
        status,
        selisih,
        selisih_persen: selisihPersen,
        produk_ditemukan: Boolean(product),
        nama_kompetitor: header.nama_kompetitor,
        tanggal_struk: header.tanggal_struk,
        foto_struk: header.foto_struk,
        nama_user: header.nama_user,
        cabang: header.cabang,
        created_at: header.created_at,
      };
    })
    .filter(Boolean)
    .sort(sortHistoryDesc) as any[];

  const historyByPlu = new Map<string, any[]>();
  for (const item of flatHistory) {
    const key = item.plu || `__NO_PLU__${item.detail_id}`;
    if (!historyByPlu.has(key)) historyByPlu.set(key, []);
    historyByPlu.get(key)!.push(item);
  }

  const products = Array.from(historyByPlu.entries())
    .map(([key, history]) => {
      history.sort(sortHistoryDesc);
      const latest = history[0];
      const kompetitorSet = new Set(
        history.map((h) => String(h.nama_kompetitor || '').trim().toUpperCase()).filter(Boolean)
      );

      return {
        plu: latest.plu || (key.startsWith('__NO_PLU__') ? '' : key),
        nama_barang: latest.nama_barang,
        unit: latest.unit,
        frac: latest.frac,
        frac_master: latest.frac_master,
        harga_kita: latest.harga_kita,
        harga_normal: latest.harga_normal,
        harga_promo: latest.harga_promo,
        produk_ditemukan: latest.produk_ditemukan,
        total_survei: history.length,
        total_kompetitor: kompetitorSet.size,
        menang: history.filter((h) => h.status === 'MENANG').length,
        kalah: history.filter((h) => h.status === 'KALAH').length,
        seri: history.filter((h) => h.status === 'SERI').length,
        latest,
        history,
      };
    })
    .sort((a, b) => sortHistoryDesc(a.latest, b.latest));

  const byHeader = new Map<number, any[]>();
  for (const item of flatHistory) {
    if (!byHeader.has(item.header_id)) byHeader.set(item.header_id, []);
    byHeader.get(item.header_id)!.push(item);
  }

  const struk = headers.map((header) => ({
    ...header,
    jumlah_item: byHeader.get(Number(header.id))?.length || 0,
    detail: byHeader.get(Number(header.id)) || [],
  }));

  const latestRecords = products.map((p) => p.latest);
  const kompetitorUnik = new Set(
    struk.map((row) => String(row.nama_kompetitor || '').trim().toUpperCase()).filter(Boolean)
  );

  return {
    cabang,
    tgl_dari: tglDari || null,
    tgl_sampai: tglSampai || null,
    petugas,
    kompetitor,
    users,
    competitors,
    totals: {
      total_struk: struk.length,
      total_item: flatHistory.length,
      total_produk: products.length,
      total_kompetitor: kompetitorUnik.size,
      menang: latestRecords.filter((r) => r.status === 'MENANG').length,
      kalah: latestRecords.filter((r) => r.status === 'KALAH').length,
      seri: latestRecords.filter((r) => r.status === 'SERI').length,
      tidak_ada_harga: latestRecords.filter((r) => r.status === 'TIDAK_ADA_HARGA').length,
    },
    products,
    struk,
  };
}

function addPriceRows(ws: ExcelJS.Worksheet, rows: any[]) {
  for (const item of rows) {
    const row = ws.addRow([
      item.tanggal_struk || '',
      item.status === 'TIDAK_ADA_HARGA' ? 'BELUM MATCH' : item.status,
      item.status === 'MENANG' ? 1 : 0,
      item.status === 'KALAH' ? 1 : 0,
      item.status === 'SERI' ? 1 : 0,
      item.status === 'TIDAK_ADA_HARGA' ? 1 : 0,
      item.plu || '',
      item.nama_barang || '',
      item.unit || '',
      item.frac_master || item.frac || '',
      item.nama_kompetitor || '',
      item.nama_user || '',
      item.harga_kita || 0,
      item.harga_kompetitor || 0,
      item.selisih || 0,
      item.selisih_persen || 0,
      item.harga_normal || 0,
      item.harga_promo || 0,
      item.cabang || '',
      item.header_id || '',
      item.foto_struk || '',
    ]);

    row.eachCell((cell) => {
      cell.border = thinBorder();
      cell.alignment = { vertical: 'middle' };
    });

    for (const col of [13, 14, 15, 17, 18]) row.getCell(col).numFmt = '#,##0';
    row.getCell(16).numFmt = '0.00%';
    row.getCell(16).value = safeNumber(item.selisih_persen) / 100;

    const statusCell = row.getCell(2);
    if (item.status === 'MENANG') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.success } };
    } else if (item.status === 'KALAH') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.fail } };
    } else if (item.status === 'SERI') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.grey } };
    }
    statusCell.font = { bold: true };
  }
}

function setupPriceSheet(ws: ExcelJS.Worksheet) {
  ws.addRow([
    'Tanggal',
    'Status',
    'Menang',
    'Kalah',
    'Seri',
    'Belum Match',
    'PLU',
    'Nama Barang',
    'Unit',
    'Frac',
    'Kompetitor',
    'Nama Penginput',
    'Harga Kita',
    'Harga Kompetitor',
    'Selisih Rp',
    'Selisih %',
    'Harga Normal',
    'Harga Promo',
    'Cabang',
    'ID Struk',
    'Foto Struk',
  ]);
  styleHeaderRow(ws.getRow(1));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'U1' };
  ws.columns = [
    { width: 13 }, { width: 14 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 12 },
    { width: 14 }, { width: 42 }, { width: 10 }, { width: 10 }, { width: 24 }, { width: 20 },
    { width: 16 }, { width: 18 }, { width: 16 }, { width: 13 }, { width: 16 }, { width: 16 },
    { width: 10 }, { width: 12 }, { width: 48 },
  ];
}

surveiHargaRouter.get('/', async (req, res) => {
  try {
    const data = await buildSurveiHargaData({
      cabang: String(req.query.cabang || '').trim(),
      petugas: String(req.query.petugas || '').trim(),
      kompetitor: String(req.query.kompetitor || '').trim(),
      tglDari: String(req.query.tgl_dari || '').trim(),
      tglSampai: String(req.query.tgl_sampai || '').trim(),
    });
    res.json(data);
  } catch (err: any) {
    console.error('[survei-harga] GET error:', err);
    res.status(err?.message === 'Cabang wajib diisi.' ? 400 : 500).json({
      error: err?.message || 'Gagal mengambil data survei harga',
    });
  }
});

surveiHargaRouter.get('/export', async (req, res) => {
  try {
    const data = await buildSurveiHargaData({
      cabang: String(req.query.cabang || '').trim(),
      petugas: String(req.query.petugas || '').trim(),
      kompetitor: String(req.query.kompetitor || '').trim(),
      tglDari: String(req.query.tgl_dari || '').trim(),
      tglSampai: String(req.query.tgl_sampai || '').trim(),
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'RKM Visit Monitoring';
    workbook.created = new Date();

    const preview = workbook.addWorksheet('Preview Terbaru');
    setupPriceSheet(preview);
    addPriceRows(preview, data.products.map((p: any) => p.latest));

    const history = workbook.addWorksheet('Riwayat Harga');
    setupPriceSheet(history);
    const allHistory = data.struk.flatMap((s: any) => s.detail || []).sort(sortHistoryDesc);
    addPriceRows(history, allHistory);

    const safeCabang = data.cabang.replace(/[^a-zA-Z0-9_-]/g, '');
    const from = data.tgl_dari || 'awal';
    const to = data.tgl_sampai || 'akhir';
    await sendWorkbook(res, workbook, `survei-harga-${safeCabang}-${from}-${to}.xlsx`);
  } catch (err: any) {
    console.error('[survei-harga] EXPORT error:', err);
    if (!res.headersSent) {
      res.status(err?.message === 'Cabang wajib diisi.' ? 400 : 500).json({
        error: err?.message || 'Gagal export survei harga',
      });
    }
  }
});
