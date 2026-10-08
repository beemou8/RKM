import { Router } from 'express';
import ExcelJS from 'exceljs';
import { fetchSupabase, upsertManySupabase, deleteSupabase } from '../lib/supabase.js';
import { resolveCabang } from '../lib/cabang.js';
import { distanceMeters } from '../lib/geo.js';
import { FILL, sendWorkbook, styleHeaderRow, thinBorder } from '../lib/excel.js';

export const kilometerMotorRouter = Router();

// 1. GET: Ambil daftar catatan kilometer motor
kilometerMotorRouter.get('/', async (req, res) => {
  try {
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }

    const cabang = branch.cabang;
    const tglDari = String(req.query.tgl_dari || '').trim();
    const tglSampai = String(req.query.tgl_sampai || '').trim();
    const petugas = String(req.query.petugas || '').trim();

    let query = `tbtr_kilometer_motor?select=*&cabang=eq.${encodeURIComponent(cabang)}&order=tanggal.desc,created_at.desc`;
    if (tglDari) query += `&tanggal=gte.${tglDari}`;
    if (tglSampai) query += `&tanggal=lte.${tglSampai}`;
    if (petugas) query += `&username=eq.${encodeURIComponent(petugas)}`;

    const data = await fetchSupabase<any>(query).catch(() => []);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[kilometer-motor] GET error:', err);
    res.status(500).json({ error: err?.message || 'Gagal mengambil data kilometer motor' });
  }
});

// 2. GET /hitung-gps: Hitung KM GPS riil dari tbtr_tracking
kilometerMotorRouter.get('/hitung-gps', async (req, res) => {
  try {
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }

    const cabang = branch.cabang;
    const tanggal = String(req.query.tanggal || '').trim();
    const username = String(req.query.username || '').trim();

    if (!tanggal || !username) {
      res.status(400).json({ error: 'Tanggal dan Petugas wajib diisi.' });
      return;
    }

    // Ambil seluruh titik GPS dari tbtr_tracking hari tersebut
    const points = await fetchSupabase<any>(
      `tbtr_tracking?select=latitude,longitude,created_at&cabang=eq.${encodeURIComponent(cabang)}&username=eq.${encodeURIComponent(username)}&created_at=gte.${tanggal}T00:00:00%2B07:00&created_at=lte.${tanggal}T23:59:59%2B07:00&order=created_at.asc`
    ).catch(() => []);

    let totalMeters = 0;
    const validPoints = (points || []).filter((p: any) => p.latitude && p.longitude);

    for (let i = 1; i < validPoints.length; i++) {
      const d = distanceMeters(
        validPoints[i - 1].latitude,
        validPoints[i - 1].longitude,
        validPoints[i].latitude,
        validPoints[i].longitude
      );
      // Saring noise GPS statis (< 5m) dan loncatan anomali sinyal (> 5000m)
      if (d !== null && d > 5 && d < 5000) {
        totalMeters += d;
      }
    }

    const kmGps = Math.round((totalMeters / 1000) * 10) / 10;
    res.json({
      success: true,
      username,
      tanggal,
      total_titik: validPoints.length,
      km_gps: kmGps,
    });
  } catch (err: any) {
    console.error('[kilometer-motor] hitung-gps error:', err);
    res.status(500).json({ error: err?.message || 'Gagal menghitung KM GPS' });
  }
});

// 3. POST: Simpan atau update catatan kilometer
kilometerMotorRouter.post('/', async (req, res) => {
  try {
    const branch = resolveCabang(req.body.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }

    const {
      tanggal,
      username,
      nama_petugas,
      km_awal,
      km_akhir,
      km_gps = 0,
      keterangan,
      foto_odometer,
    } = req.body;

    if (!tanggal || !username) {
      res.status(400).json({ error: 'Tanggal dan Petugas wajib diisi.' });
      return;
    }

    const awal = parseFloat(km_awal) || 0;
    const akhir = parseFloat(km_akhir) || 0;
    const motor = Math.max(0, Math.round((akhir - awal) * 10) / 10);
    const gps = Math.max(0, parseFloat(km_gps) || 0);
    const selisih = Math.round(Math.abs(motor - gps) * 10) / 10;
    const deviasi = motor > 0 ? Math.round((selisih / motor) * 1000) / 10 : 0;

    // Evaluasi status validasi
    let status = 'VALID';
    if (deviasi > 25 && selisih > 5) {
      status = 'ANOMALI';
    } else if (deviasi > 15 || selisih > 3) {
      status = 'TOLERANSI';
    }

    const payload = {
      cabang: branch.cabang,
      tanggal,
      username,
      nama_petugas: nama_petugas || username,
      km_awal: awal,
      km_akhir: akhir,
      km_motor: motor,
      km_gps: gps,
      selisih_km: selisih,
      deviasi_persen: deviasi,
      status_validasi: status,
      keterangan: keterangan || '',
      foto_odometer: foto_odometer || null,
      updated_at: new Date().toISOString(),
    };

    await upsertManySupabase('tbtr_kilometer_motor', [payload]);
    res.json({ success: true, data: payload });
  } catch (err: any) {
    console.error('[kilometer-motor] POST error:', err);
    res.status(500).json({ error: err?.message || 'Gagal menyimpan catatan kilometer motor' });
  }
});

// 4. DELETE: Hapus catatan
kilometerMotorRouter.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: 'ID wajib disertakan' });
      return;
    }
    await deleteSupabase('tbtr_kilometer_motor', `id=eq.${id}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[kilometer-motor] DELETE error:', err);
    res.status(500).json({ error: err?.message || 'Gagal menghapus data' });
  }
});

// 5. GET /export: Export rekapan ke Excel
kilometerMotorRouter.get('/export', async (req, res) => {
  try {
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }

    const cabang = branch.cabang;
    const tglDari = String(req.query.tgl_dari || '').trim();
    const tglSampai = String(req.query.tgl_sampai || '').trim();
    const petugas = String(req.query.petugas || '').trim();

    let query = `tbtr_kilometer_motor?select=*&cabang=eq.${encodeURIComponent(cabang)}&order=tanggal.desc,created_at.desc`;
    if (tglDari) query += `&tanggal=gte.${tglDari}`;
    if (tglSampai) query += `&tanggal=lte.${tglSampai}`;
    if (petugas) query += `&username=eq.${encodeURIComponent(petugas)}`;

    const rows = await fetchSupabase<any>(query).catch(() => []);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'RKM Visit Monitoring';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Kilometer Motor');
    sheet.addRow([
      'Tanggal',
      'Petugas / Advisor',
      'KM Awal',
      'KM Akhir',
      'Total KM Fisik',
      'Total KM GPS',
      'Selisih (KM)',
      'Deviasi (%)',
      'Status Validasi',
      'Keterangan',
      'Cabang',
    ]);
    styleHeaderRow(sheet.getRow(1));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const r of rows) {
      const row = sheet.addRow([
        r.tanggal || '',
        r.nama_petugas || r.username || '',
        Number(r.km_awal) || 0,
        Number(r.km_akhir) || 0,
        Number(r.km_motor) || 0,
        Number(r.km_gps) || 0,
        Number(r.selisih_km) || 0,
        (Number(r.deviasi_persen) || 0) / 100,
        r.status_validasi || 'VALID',
        r.keterangan || '',
        r.cabang || '',
      ]);

      row.eachCell((cell) => {
        cell.border = thinBorder();
        cell.alignment = { vertical: 'middle' };
      });

      for (const col of [3, 4, 5, 6, 7]) {
        row.getCell(col).numFmt = '#,##0.0';
      }
      row.getCell(8).numFmt = '0.0%';

      const statusCell = row.getCell(9);
      if (r.status_validasi === 'VALID') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.success } };
      } else if (r.status_validasi === 'ANOMALI') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.fail } };
      } else {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.amber || 'FFF59E0B' } };
      }
      statusCell.font = { bold: true };
    }

    sheet.columns = [
      { width: 14 }, // Tanggal
      { width: 25 }, // Petugas
      { width: 12 }, // KM Awal
      { width: 12 }, // KM Akhir
      { width: 15 }, // Total KM Fisik
      { width: 15 }, // Total KM GPS
      { width: 14 }, // Selisih
      { width: 14 }, // Deviasi %
      { width: 16 }, // Status
      { width: 30 }, // Keterangan
      { width: 10 }, // Cabang
    ];

    const safeCabang = cabang.replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `kilometer-motor-${safeCabang}-${tglDari || 'awal'}-${tglSampai || 'akhir'}.xlsx`;
    await sendWorkbook(res, workbook, filename);
  } catch (err: any) {
    console.error('[kilometer-motor] EXPORT error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Gagal export kilometer motor' });
    }
  }
});
