import { Router } from 'express';
import ExcelJS from 'exceljs';
import { queryLocal, getDbStatus } from '../lib/db.js';
import { fetchSupabase, insertSupabase, updateSupabase, deleteSupabase, upsertManySupabase } from '../lib/supabase.js';
import { resolveCabang } from '../lib/cabang.js';
import { sendWorkbook, styleHeaderRow, thinBorder } from '../lib/excel.js';

export const memberParetoRouter = Router();

export const DEFAULT_PARETO_ITEMS = [
  { cabang: 'ALL', prd_prdcd: '0027940', nama_barang: 'INDOMIE MIE INSTANT AYAM BAWANG PCK 69g', is_active: true },
  { cabang: 'ALL', prd_prdcd: '0060410', nama_barang: 'INDOMIE MIE GORENG PLUS SPECIAL PCK 80g', is_active: true },
  { cabang: 'ALL', prd_prdcd: '1666510', nama_barang: 'KAPAL API KOPI BUBUK SPECIAL MIX RCG 10x23g', is_active: true },
];

async function getActiveMasterPareto(cabang?: string): Promise<Array<{ prd_prdcd: string; nama_barang: string; cabang?: string }>> {
  try {
    let query = 'tbmaster_item_pareto?is_active=eq.true';
    if (cabang) {
      query += `&or=(cabang.eq.ALL,cabang.eq.${encodeURIComponent(cabang)})`;
    }
    query += '&order=prd_prdcd.asc';
    const res = await fetchSupabase<any>(query);
    if (Array.isArray(res) && res.length > 0) {
      return res.map((r) => ({
        cabang: r.cabang || 'ALL',
        prd_prdcd: String(r.prd_prdcd).trim(),
        nama_barang: String(r.nama_barang || '').trim(),
      }));
    }
  } catch {
    // fallback if table does not exist yet
  }
  return DEFAULT_PARETO_ITEMS;
}

function getDefaultDates(): { tglDari: string; tglSampai: string } {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const tglSampai = `${yyyy}-${mm}-${dd}`;

  // 3 bulan yang lalu
  const dPast = new Date(d);
  dPast.setMonth(dPast.getMonth() - 3);
  const pYyyy = dPast.getFullYear();
  const pMm = String(dPast.getMonth() + 1).padStart(2, '0');
  const pDd = String(dPast.getDate()).padStart(2, '0');
  const tglDari = `${pYyyy}-${pMm}-${pDd}`;

  return { tglDari, tglSampai };
}

// ============================================================
// GET /api/member-pareto/master-items — Daftar Master Item Pareto dari Supabase
// ============================================================
memberParetoRouter.get('/master-items', async (req, res) => {
  try {
    const cabang = (req.query.cabang as string | undefined)?.trim();
    let query = 'tbmaster_item_pareto?order=prd_prdcd.asc';
    if (cabang) {
      query = `tbmaster_item_pareto?or=(cabang.eq.ALL,cabang.eq.${encodeURIComponent(cabang)})&order=prd_prdcd.asc`;
    }
    const rows = await fetchSupabase<any>(query).catch(() => []);
    if (!rows || rows.length === 0) {
      res.json({ data: DEFAULT_PARETO_ITEMS, from_fallback: true });
      return;
    }
    res.json({ data: rows, from_fallback: false });
  } catch (err: any) {
    res.json({ data: DEFAULT_PARETO_ITEMS, from_fallback: true, error: err.message });
  }
});

// ============================================================
// POST /api/member-pareto/master-items — Tambah Item ke Master Supabase
// ============================================================
memberParetoRouter.post('/master-items', async (req, res) => {
  try {
    const cabang = String(req.body.cabang || 'ALL').trim().toUpperCase();
    const prd_prdcd = String(req.body.prd_prdcd || '').trim();
    let nama_barang = String(req.body.nama_barang || '').trim();
    const keterangan = req.body.keterangan ? String(req.body.keterangan).trim() : null;

    if (!prd_prdcd) {
      res.status(400).json({ error: 'Kode PLU / prdcd wajib diisi.' });
      return;
    }

    // Jika nama_barang tidak diisi, cari otomatis di database lokal tbmaster_prodmast
    if (!nama_barang) {
      const localProd = await queryLocal<any>(
        `SELECT prd_deskripsipanjang FROM tbmaster_prodmast WHERE prd_prdcd = $1 LIMIT 1`,
        [prd_prdcd]
      ).catch(() => []);
      if (localProd && localProd.length > 0 && localProd[0].prd_deskripsipanjang) {
        nama_barang = localProd[0].prd_deskripsipanjang.trim();
      } else {
        nama_barang = `PRODUK ${prd_prdcd}`;
      }
    }

    await insertSupabase('tbmaster_item_pareto', {
      cabang,
      prd_prdcd,
      nama_barang,
      keterangan,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    res.json({ success: true, item: { cabang, prd_prdcd, nama_barang, keterangan } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DELETE /api/member-pareto/master-items/:id — Hapus Item Master dari Supabase
// ============================================================
memberParetoRouter.delete('/master-items/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await deleteSupabase('tbmaster_item_pareto', `id=eq.${id}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/member-pareto/lookup-product/:plu — Lookup info PLU di DB Lokal
// ============================================================
memberParetoRouter.get('/lookup-product/:plu', async (req, res) => {
  try {
    const plu = String(req.params.plu || '').trim();
    const rows = await queryLocal<any>(
      `SELECT prd_prdcd, prd_deskripsipanjang, prd_unit, prd_frac
       FROM tbmaster_prodmast
       WHERE prd_prdcd = $1
       LIMIT 1`,
      [plu]
    ).catch(() => []);
    if (rows && rows.length > 0) {
      res.json({ found: true, product: rows[0] });
    } else {
      res.json({ found: false });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/member-pareto/products — Master info produk pareto (Legacy / Batch)
// ============================================================
memberParetoRouter.get('/products', async (req, res) => {
  try {
    const requestedPlus = String(req.query.plus || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const targetPlus = requestedPlus.length > 0 ? requestedPlus : DEFAULT_PARETO_ITEMS.map((i) => i.prd_prdcd);

    const rows = await queryLocal<any>(
      `SELECT prd_prdcd, prd_deskripsipanjang, prd_unit, prd_frac
       FROM tbmaster_prodmast
       WHERE prd_prdcd = ANY($1::text[])
       ORDER BY prd_prdcd ASC`,
      [targetPlus]
    );

    res.json({ data: rows, db_lokal_connected: getDbStatus().connected });
  } catch (err: any) {
    res.status(500).json({ error: err.message, db_lokal_connected: false });
  }
});

// ============================================================
// GET /api/member-pareto/analisis — Query member belum belanja item pareto (DB Lokal)
// ============================================================
memberParetoRouter.get('/analisis', async (req, res) => {
  try {
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;

    const defaults = getDefaultDates();
    const tglDari = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.tgl_dari || ''))
      ? String(req.query.tgl_dari)
      : defaults.tglDari;
    const tglSampai = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.tgl_sampai || ''))
      ? String(req.query.tgl_sampai)
      : defaults.tglSampai;
    const petugas = String(req.query.petugas || '').trim();
    const kodeMember = String(req.query.kode_member || '').trim().toUpperCase();

    const requestedPlu = String(req.query.plu || '').trim();
    let targetPlus: string[] = [];
    if (requestedPlu && requestedPlu !== 'all' && requestedPlu !== 'semua') {
      targetPlus = requestedPlu.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (targetPlus.length === 0) {
      const activeMaster = await getActiveMasterPareto(cabang);
      targetPlus = activeMaster.map((i) => i.prd_prdcd);
    }

    // Filter SQL dinamis
    const params: any[] = [cabang, targetPlus, tglDari, `${tglSampai} 23:59:59`];
    let advisorFilterSql = '';
    if (petugas) {
      params.push(petugas);
      advisorFilterSql = ` AND LOWER(TRIM(c.cus_nosalesman)) = LOWER(TRIM($${params.length}))`;
    }
    let kodeMemberFilterSql = '';
    if (kodeMember) {
      params.push(`%${kodeMember}%`);
      kodeMemberFilterSql = ` AND UPPER(TRIM(c.cus_kodemember)) LIKE $${params.length}`;
    }

    // Kueri teroptimasi: JOIN branch_customers terlebih dahulu agar tidak melakukan
    // scan riwayat belanja global di seluruh perusahaan
    const sql = `
      WITH target AS (
          SELECT UNNEST($2::text[]) AS prd_prdcd
      ),
      branch_customers AS (
          SELECT c.cus_kodemember, c.cus_namamember, c.cus_nosalesman, c.cus_kodeigr
          FROM tbmaster_customer c
          WHERE c.cus_kodeigr = $1
            AND c.cus_namamember <> 'NEW'
            AND (c.cus_recordid != '1' OR c.cus_recordid IS NULL)
            ${advisorFilterSql}
            ${kodeMemberFilterSql}
      ),
      riwayat_belanja AS (
          SELECT
              jh.jh_cus_kodemember,
              TO_CHAR(MIN(jh.jh_transactiondate), 'YYYY-MM-DD') AS belanja_pertama,
              TO_CHAR(MAX(jh.jh_transactiondate), 'YYYY-MM-DD') AS belanja_terakhir
          FROM tbtr_jualheader jh
          INNER JOIN branch_customers bc ON jh.jh_cus_kodemember = bc.cus_kodemember
          GROUP BY jh.jh_cus_kodemember
      )
      SELECT 
          c.cus_kodemember AS kode_member,
          c.cus_namamember AS nama_member,
          COALESCE(TRIM(c.cus_nosalesman), '') AS username,
          rb.belanja_pertama,
          rb.belanja_terakhir,
          p.prd_prdcd,
          COALESCE(p.prd_deskripsipanjang, t.prd_prdcd) AS nama_barang
      FROM branch_customers c
      CROSS JOIN target t
      LEFT JOIN tbmaster_prodmast p
          ON p.prd_prdcd = t.prd_prdcd
      INNER JOIN riwayat_belanja rb
          ON c.cus_kodemember = rb.jh_cus_kodemember
      WHERE NOT EXISTS (
          SELECT 1
          FROM tbtr_jualdetail e
          WHERE e.trjd_kodeigr        = c.cus_kodeigr
            AND e.trjd_cus_kodemember = c.cus_kodemember
            AND e.trjd_prdcd          = t.prd_prdcd
            AND e.trjd_transactiondate BETWEEN $3 AND $4
      )
      ORDER BY c.cus_nosalesman ASC, c.cus_kodemember ASC, p.prd_prdcd ASC;
    `;

    const rows = await queryLocal<any>(sql, params);

    // Hitung ringkasan
    const uniqueMembers = new Set<string>();
    const uniqueAdvisors = new Set<string>();
    const uniqueProducts = new Set<string>();
    for (const r of rows) {
      if (r.kode_member) uniqueMembers.add(r.kode_member);
      if (r.username) uniqueAdvisors.add(r.username);
      if (r.prd_prdcd) uniqueProducts.add(r.prd_prdcd);
    }

    // Ambil daftar seluruh advisor aktif cabang untuk dropdown filter
    const allAdvisorsRows = await queryLocal<any>(
      `SELECT DISTINCT TRIM(cus_nosalesman) AS advisor
       FROM tbmaster_customer
       WHERE cus_kodeigr = $1
         AND cus_namamember <> 'NEW'
         AND (cus_recordid != '1' OR cus_recordid IS NULL)
         AND NULLIF(TRIM(COALESCE(cus_nosalesman, '')), '') IS NOT NULL
       ORDER BY advisor ASC`,
      [cabang]
    ).catch(() => []);

    res.json({
      cabang,
      tgl_dari: tglDari,
      tgl_sampai: tglSampai,
      target_plus: targetPlus,
      petugas_filter: petugas,
      data: rows,
      totals: {
        total_baris: rows.length,
        total_member: uniqueMembers.size,
        total_advisor: uniqueAdvisors.size,
        total_produk: uniqueProducts.size,
      },
      advisor_list: allAdvisorsRows.map((a) => a.advisor).filter(Boolean),
      db_lokal_connected: getDbStatus().connected,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, db_lokal_connected: false });
  }
});

// ============================================================
// POST /api/member-pareto/upload — Upload/upsert batch target pareto ke Supabase
// ============================================================
memberParetoRouter.post('/upload', async (req, res) => {
  try {
    const { cabang, periode_dari, periode_sampai, items } = req.body || {};

    if (!cabang || !periode_dari || !periode_sampai) {
      res.status(400).json({ error: 'Cabang, periode_dari, dan periode_sampai wajib diisi.' });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Tidak ada data item pareto yang dipilih untuk di-upload.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const rowsToInsert = items.map((it: any) => ({
      cabang: String(cabang).trim(),
      username: String(it.username || it.cus_nosalesman || '').trim(),
      kode_member: String(it.kode_member || it.cus_kodemember || '').trim().toUpperCase(),
      nama_member: String(it.nama_member || it.cus_namamember || '').trim(),
      belanja_pertama: it.belanja_pertama || null,
      belanja_terakhir: it.belanja_terakhir || null,
      prd_prdcd: String(it.prd_prdcd || '').trim(),
      nama_barang: String(it.nama_barang || it.prd_deskripsipanjang || '').trim(),
      periode_dari,
      periode_sampai,
      status_followup: it.status_followup || 'Pending',
      catatan: it.catatan || null,
      updated_at: nowIso,
    }));

    // Batch upsert per 500 baris agar tidak melebihi payload PostgREST
    const batchSize = 500;
    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const chunk = rowsToInsert.slice(i, i + batchSize);
      await upsertManySupabase('tbtr_member_pareto', chunk);
    }

    res.json({
      success: true,
      inserted_count: rowsToInsert.length,
      cabang,
      periode_dari,
      periode_sampai,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/member-pareto/monitoring — Ambil data target dari Supabase
// ============================================================
memberParetoRouter.get('/monitoring', async (req, res) => {
  try {
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;

    const periodeDari = req.query.periode_dari as string | undefined;
    const periodeSampai = req.query.periode_sampai as string | undefined;
    const petugas = (req.query.petugas as string | undefined)?.trim();
    const status = (req.query.status as string | undefined)?.trim();
    const kodeMember = (req.query.kode_member as string | undefined)?.trim().toUpperCase();
    const plu = (req.query.plu as string | undefined)?.trim();

    let query = `tbtr_member_pareto?select=*&cabang=eq.${encodeURIComponent(cabang)}`;
    if (periodeDari) query += `&periode_dari=gte.${encodeURIComponent(periodeDari)}`;
    if (periodeSampai) query += `&periode_sampai=lte.${encodeURIComponent(periodeSampai)}`;
    if (petugas) query += `&username=eq.${encodeURIComponent(petugas)}`;
    if (status && status !== 'semua') query += `&status_followup=eq.${encodeURIComponent(status)}`;
    if (kodeMember) query += `&kode_member=ilike.*${encodeURIComponent(kodeMember)}*`;
    if (plu && plu !== 'semua' && plu !== 'all') query += `&prd_prdcd=eq.${encodeURIComponent(plu)}`;
    query += '&order=username.asc,nama_member.asc,prd_prdcd.asc';

    const rows = await fetchSupabase<any>(query).catch(() => []);

    const totals = {
      total: rows.length,
      pending: 0,
      sudah_ditawari: 0,
      berhasil_beli: 0,
      menolak: 0,
    };

    const advisorSet = new Set<string>();
    for (const r of rows) {
      if (r.username) advisorSet.add(r.username);
      const st = String(r.status_followup || '').toLowerCase();
      if (st === 'sudah ditawari') totals.sudah_ditawari++;
      else if (st === 'berhasil beli') totals.berhasil_beli++;
      else if (st === 'menolak') totals.menolak++;
      else totals.pending++;
    }

    res.json({
      cabang,
      data: rows,
      totals,
      advisor_list: Array.from(advisorSet).sort(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PATCH /api/member-pareto/status/:id — Update status follow up & catatan
// ============================================================
memberParetoRouter.patch('/status/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { status_followup, catatan } = req.body || {};

    if (!status_followup) {
      res.status(400).json({ error: 'Status follow-up wajib diisi.' });
      return;
    }

    const payload: Record<string, any> = {
      status_followup,
      updated_at: new Date().toISOString(),
    };
    if (catatan !== undefined) payload.catatan = catatan;

    await updateSupabase('tbtr_member_pareto', `id=eq.${id}`, payload);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DELETE /api/member-pareto/:id — Hapus target satuan
// ============================================================
memberParetoRouter.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await deleteSupabase('tbtr_member_pareto', `id=eq.${id}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/member-pareto/bulk-delete — Hapus target massal
// ============================================================
memberParetoRouter.post('/bulk-delete', async (req, res) => {
  try {
    const ids: number[] = req.body.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Tidak ada data target yang dipilih untuk dihapus.' });
      return;
    }
    await deleteSupabase('tbtr_member_pareto', `id=in.(${ids.join(',')})`);
    res.json({ success: true, count: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/member-pareto/export — Export Excel
// ============================================================
memberParetoRouter.get('/export', async (req, res) => {
  try {
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const mode = String(req.query.mode || 'analisis');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'RKM Monitoring';
    wb.created = new Date();

    if (mode === 'monitoring') {
      const ws = wb.addWorksheet('Monitoring Target Pareto');
      const kodeMember = (req.query.kode_member as string | undefined)?.trim();
      const plu = (req.query.plu as string | undefined)?.trim();
      let queryStr = `tbtr_member_pareto?select=*&cabang=eq.${encodeURIComponent(cabang)}`;
      if (kodeMember) queryStr += `&kode_member=ilike.*${encodeURIComponent(kodeMember)}*`;
      if (plu && plu !== 'semua' && plu !== 'all') queryStr += `&prd_prdcd=eq.${encodeURIComponent(plu)}`;
      queryStr += '&order=username.asc,nama_member.asc';

      const rows = await fetchSupabase<any>(queryStr).catch(() => []);

      ws.columns = [
        { header: 'No', key: 'no', width: 6 },
        { header: 'Advisor', key: 'username', width: 12 },
        { header: 'Kode Member', key: 'kode_member', width: 14 },
        { header: 'Nama Member / Toko', key: 'nama_member', width: 35 },
        { header: 'PLU Pareto', key: 'prd_prdcd', width: 12 },
        { header: 'Nama Produk', key: 'nama_barang', width: 35 },
        { header: 'Periode Dari', key: 'periode_dari', width: 14 },
        { header: 'Periode Sampai', key: 'periode_sampai', width: 14 },
        { header: 'Status Follow-up', key: 'status_followup', width: 18 },
        { header: 'Catatan', key: 'catatan', width: 30 },
      ];
      styleHeaderRow(ws.getRow(1));

      rows.forEach((r, idx) => {
        const row = ws.addRow({
          no: idx + 1,
          username: r.username,
          kode_member: r.kode_member,
          nama_member: r.nama_member,
          prd_prdcd: r.prd_prdcd,
          nama_barang: r.nama_barang,
          periode_dari: r.periode_dari,
          periode_sampai: r.periode_sampai,
          status_followup: r.status_followup,
          catatan: r.catatan || '-',
        });
        row.eachCell((cell) => {
          cell.border = thinBorder();
        });
      });

      await sendWorkbook(res, wb, `Monitoring_Target_Pareto_${cabang}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } else {
      // Export Analisis DB Lokal
      const defaults = getDefaultDates();
      const tglDari = String(req.query.tgl_dari || defaults.tglDari);
      const tglSampai = String(req.query.tgl_sampai || defaults.tglSampai);
      const petugas = String(req.query.petugas || '').trim();
      const kodeMember = String(req.query.kode_member || '').trim().toUpperCase();
      const requestedPlu = String(req.query.plu || '').trim();

      let targetPlus: string[] = [];
      if (requestedPlu && requestedPlu !== 'all' && requestedPlu !== 'semua') {
        targetPlus = requestedPlu.split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (targetPlus.length === 0) {
        const activeMaster = await getActiveMasterPareto(cabang);
        targetPlus = activeMaster.map((i) => i.prd_prdcd);
      }

      const params: any[] = [cabang, targetPlus, tglDari, `${tglSampai} 23:59:59`];
      let advisorFilterSql = '';
      if (petugas) {
        params.push(petugas);
        advisorFilterSql = ` AND LOWER(TRIM(c.cus_nosalesman)) = LOWER(TRIM($${params.length}))`;
      }
      let kodeMemberFilterSql = '';
      if (kodeMember) {
        params.push(`%${kodeMember}%`);
        kodeMemberFilterSql = ` AND UPPER(TRIM(c.cus_kodemember)) LIKE $${params.length}`;
      }

      const sql = `
        WITH target AS (
            SELECT UNNEST($2::text[]) AS prd_prdcd
        ),
        branch_customers AS (
            SELECT c.cus_kodemember, c.cus_namamember, c.cus_nosalesman, c.cus_kodeigr
            FROM tbmaster_customer c
            WHERE c.cus_kodeigr = $1
              AND c.cus_namamember <> 'NEW'
              AND (c.cus_recordid != '1' OR c.cus_recordid IS NULL)
              ${advisorFilterSql}
              ${kodeMemberFilterSql}
        ),
        riwayat_belanja AS (
            SELECT
                jh.jh_cus_kodemember,
                TO_CHAR(MIN(jh.jh_transactiondate), 'YYYY-MM-DD') AS belanja_pertama,
                TO_CHAR(MAX(jh.jh_transactiondate), 'YYYY-MM-DD') AS belanja_terakhir
            FROM tbtr_jualheader jh
            INNER JOIN branch_customers bc ON jh.jh_cus_kodemember = bc.cus_kodemember
            GROUP BY jh.jh_cus_kodemember
        )
        SELECT 
            c.cus_kodemember AS kode_member,
            c.cus_namamember AS nama_member,
            COALESCE(TRIM(c.cus_nosalesman), '') AS username,
            rb.belanja_pertama,
            rb.belanja_terakhir,
            p.prd_prdcd,
            COALESCE(p.prd_deskripsipanjang, t.prd_prdcd) AS nama_barang
        FROM branch_customers c
        CROSS JOIN target t
        LEFT JOIN tbmaster_prodmast p
            ON p.prd_prdcd = t.prd_prdcd
        INNER JOIN riwayat_belanja rb
            ON c.cus_kodemember = rb.jh_cus_kodemember
        WHERE NOT EXISTS (
            SELECT 1
            FROM tbtr_jualdetail e
            WHERE e.trjd_kodeigr        = c.cus_kodeigr
              AND e.trjd_cus_kodemember = c.cus_kodemember
              AND e.trjd_prdcd          = t.prd_prdcd
              AND e.trjd_transactiondate BETWEEN $3 AND $4
        )
        ORDER BY c.cus_nosalesman ASC, c.cus_kodemember ASC, p.prd_prdcd ASC;
      `;

      const rows = await queryLocal<any>(sql, params);
      const ws = wb.addWorksheet('Belum Belanja Pareto');

      ws.columns = [
        { header: 'No', key: 'no', width: 6 },
        { header: 'Advisor', key: 'username', width: 12 },
        { header: 'Kode Member', key: 'kode_member', width: 14 },
        { header: 'Nama Member / Toko', key: 'nama_member', width: 35 },
        { header: 'Belanja Pertama', key: 'belanja_pertama', width: 15 },
        { header: 'Belanja Terakhir', key: 'belanja_terakhir', width: 15 },
        { header: 'PLU Pareto', key: 'prd_prdcd', width: 12 },
        { header: 'Nama Produk', key: 'nama_barang', width: 35 },
      ];
      styleHeaderRow(ws.getRow(1));

      rows.forEach((r, idx) => {
        const row = ws.addRow({
          no: idx + 1,
          username: r.username,
          kode_member: r.kode_member,
          nama_member: r.nama_member,
          belanja_pertama: r.belanja_pertama || '-',
          belanja_terakhir: r.belanja_terakhir || '-',
          prd_prdcd: r.prd_prdcd,
          nama_barang: r.nama_barang,
        });
        row.eachCell((cell) => {
          cell.border = thinBorder();
        });
      });

      await sendWorkbook(res, wb, `Analisis_Belum_Belanja_Pareto_${cabang}_${tglDari}_${tglSampai}.xlsx`);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
