import { Router } from 'express';
import { fetchSupabaseCached } from '../lib/supabase.js';
import { sendWorkbook, styleHeaderRow, FILL } from '../lib/excel.js';
import ExcelJS from 'exceljs';
import { resolveCabang } from '../lib/cabang.js';

// PASTIKAN BARIS INI ADA KATA 'export' DI AWALNYA
export const memberRouter = Router();

// Helper untuk mendapatkan tanggal WIB (anti mundur hari)
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

export async function buildMemberData(tglDari: string, tglSampai: string, petugasFilter: string, cabang: string, usersOverride?: any[]) {
  // Samakan sumber user + cabang dengan Tracking:
  // hanya user aktif, punya user_type, dan benar-benar berada di cabang yang dipilih.
  const users2t = usersOverride || await fetchSupabaseCached<any>(
    `tbmaster_user?select=username,nama_lengkap,user_type,cabang,is_active&cabang=eq.${encodeURIComponent(cabang)}&is_active=eq.true&user_type=not.is.null&order=created_at.desc`
  ).catch(() => []);
  const advisors2t = Array.from(
    new Set((users2t || []).map((u: any) => u.username).filter(Boolean))
  ) as string[];

  // PERBAIKAN: Tambahkan T00:00:00%2B07:00 dan T23:59:59%2B07:00 agar query akurat di jam WIB
  let urlSupa = `tbtr_member_baru?select=username,tanggal,nama_toko,kode_member,mau_jadi_member,lanjut_belanja,kategori_menolak,alasan_menolak&tanggal=gte.${tglDari}T00:00:00%2B07:00&tanggal=lte.${tglSampai}T23:59:59%2B07:00&order=created_at.desc`;
  
  const petugasValid = petugasFilter && advisors2t.includes(petugasFilter) ? petugasFilter : '';

  if (petugasValid) {
    urlSupa += `&username=eq.${encodeURIComponent(petugasValid)}`;
  } else if (advisors2t.length > 0) {
    urlSupa += `&username=in.(${advisors2t.join(',')})`;
  }

  const allMember = advisors2t.length > 0
    ? await fetchSupabaseCached<any>(urlSupa, 30_000).catch(() => [])
    : [];

  const summaryPetugas: Record<
    string,
    { total_kunjungan: number; mau_jadi_member: number; menolak: number; lanjut_belanja: number; pending: number }
  > = {};
  const dataBerhasil: any[] = [];
  const dataDitolak: any[] = [];
  const dataPending: any[] = [];
  const kategoriMenolakCount: Record<string, number> = {};

  for (const row of allMember || []) {
    const adv = row.username;
    if (!advisors2t.includes(adv)) continue;
    if (!summaryPetugas[adv]) {
      summaryPetugas[adv] = { total_kunjungan: 0, mau_jadi_member: 0, menolak: 0, lanjut_belanja: 0, pending: 0 };
    }
    summaryPetugas[adv].total_kunjungan++;

    const jadi = row.mau_jadi_member === true || row.mau_jadi_member === 't';
    const tolak = row.mau_jadi_member === false || row.mau_jadi_member === 'f';

    if (jadi) {
      dataBerhasil.push(row);
      summaryPetugas[adv].mau_jadi_member++;
      const lanjut = row.lanjut_belanja === true || row.lanjut_belanja === 't';
      if (lanjut) summaryPetugas[adv].lanjut_belanja++;
    } else if (tolak) {
      dataDitolak.push(row);
      summaryPetugas[adv].menolak++;
      const kategori = (row.kategori_menolak || '').trim() || 'Tidak dikategorikan';
      kategoriMenolakCount[kategori] = (kategoriMenolakCount[kategori] || 0) + 1;
    } else {
      dataPending.push(row);
      summaryPetugas[adv].pending++;
    }
  }

  return {
    advisors: advisors2t,
    summary: Object.entries(summaryPetugas).map(([username, v]) => ({ username, ...v })),
    data_berhasil: dataBerhasil,
    data_ditolak: dataDitolak,
    data_pending: dataPending,
    breakdown_kategori_menolak: Object.entries(kategoriMenolakCount)
      .map(([kategori, jumlah]) => ({ kategori, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah),
  };
}

memberRouter.get('/', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || today;
    const petugas = (req.query.petugas as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const data = await buildMemberData(tglDari, tglSampai, petugas, cabang);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

memberRouter.get('/export', async (req, res) => {
  try {
    const today = getTodayWIB();
    const tglDari = (req.query.tgl_dari as string) || today;
    const tglSampai = (req.query.tgl_sampai as string) || today;
    const petugas = (req.query.petugas as string) || '';
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const data = await buildMemberData(tglDari, tglSampai, petugas, cabang);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Member Baru');
    ws.addRow([`Member Baru Report - Cabang ${cabang}`]);
    ws.addRow([`Periode: ${tglDari} s/d ${tglSampai}`]);
    ws.addRow([]);
    const header = ws.addRow(['Tanggal', 'Advisor', 'Nama Toko', 'Kode Member', 'Lanjut Belanja']);
    styleHeaderRow(header);
    for (const row of data.data_berhasil) {
      const lanjut = row.lanjut_belanja === true || row.lanjut_belanja === 't';
      
      // Jika tanggal mau diformat potong jamnya di excel
      let tglTampil = row.tanggal;
      if (tglTampil) {
          const wib = getWIBDate(tglTampil);
          tglTampil = `${wib.getFullYear()}-${String(wib.getMonth()+1).padStart(2,'0')}-${String(wib.getDate()).padStart(2,'0')}`;
      }

      ws.addRow([tglTampil, row.username, row.nama_toko, row.kode_member || '-', lanjut ? 'Ya' : 'Tidak']);
    }
    ws.columns.forEach((c) => (c.width = 22));

    const wsTolak = wb.addWorksheet('Menolak');
    wsTolak.addRow([`Data Menolak - Cabang ${cabang}`]);
    wsTolak.addRow([`Periode: ${tglDari} s/d ${tglSampai}`]);
    wsTolak.addRow([]);
    const headerTolak = wsTolak.addRow(['Tanggal', 'Advisor', 'Nama Toko', 'Kode Member', 'Kategori Menolak', 'Alasan Menolak']);
    styleHeaderRow(headerTolak, FILL.headerYellow, 'FF1a1a1a');
    for (const row of data.data_ditolak) {
      let tglTampil = row.tanggal;
      if (tglTampil) {
        const wib = getWIBDate(tglTampil);
        tglTampil = `${wib.getFullYear()}-${String(wib.getMonth()+1).padStart(2,'0')}-${String(wib.getDate()).padStart(2,'0')}`;
      }
      wsTolak.addRow([
        tglTampil,
        row.username,
        row.nama_toko,
        row.kode_member || '-',
        row.kategori_menolak || 'Tidak dikategorikan',
        row.alasan_menolak || '-',
      ]);
    }
    wsTolak.columns.forEach((c) => (c.width = 24));

    await sendWorkbook(res, wb, `Member_Baru_Report_${cabang}_${tglDari}.xlsx`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});