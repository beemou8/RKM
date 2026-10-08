import { Router } from 'express';
import { fetchSupabase, insertSupabase, updateSupabase, deleteSupabase } from '../lib/supabase.js';
import { resolveCabang } from '../lib/cabang.js';

export const masterRouter = Router();

// tipe yang valid untuk master_alasan_menolak — 'GET_MEMBER' dipakai di fitur
// Member Baru (mau_jadi_member = false), 'RKM' dipakai di fitur Kunjungan RKM
// (berhasil_order = false).
const VALID_TIPE = ['GET_MEMBER', 'RKM'] as const;
type Tipe = (typeof VALID_TIPE)[number];

function isValidTipe(v: any): v is Tipe {
  return VALID_TIPE.includes(v);
}

// ============================================================
// GET /api/master/alasan-menolak — list, opsional filter cabang & tipe.
// Selalu dikembalikan terurut cabang -> tipe -> kategori_alasan supaya
// mudah dikelompokkan rapi di UI tanpa perlu logic tambahan di frontend.
// ============================================================
masterRouter.get('/alasan-menolak', async (req, res) => {
  try {
    const branch = resolveCabang(req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const tipe = (req.query.tipe as string) || '';

    let query = 'master_alasan_menolak?select=*&order=cabang.asc,tipe.asc,kategori_alasan.asc';
    if (cabang) query += `&cabang=eq.${encodeURIComponent(cabang)}`;
    if (tipe) query += `&tipe=eq.${encodeURIComponent(tipe)}`;

    const data = await fetchSupabase<any>(query);
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/master/alasan-menolak — tambah 1 kategori alasan baru.
// ============================================================
masterRouter.post('/alasan-menolak', async (req, res) => {
  try {
    const branch = resolveCabang(req.body?.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const { tipe, kategori_alasan } = req.body || {};
    if (!cabang || !tipe || !kategori_alasan) {
      res.status(400).json({ error: 'Cabang, tipe, dan kategori alasan wajib diisi.' });
      return;
    }
    if (!isValidTipe(tipe)) {
      res.status(400).json({ error: `Tipe tidak valid. Gunakan salah satu: ${VALID_TIPE.join(', ')}.` });
      return;
    }

    // Cegah duplikat kategori di cabang & tipe yang sama supaya list di
    // dashboard tetap rapi (tidak ada entri yang mirip/berulang).
    const existing = await fetchSupabase<any>(
      `master_alasan_menolak?select=id&cabang=eq.${encodeURIComponent(cabang)}&tipe=eq.${encodeURIComponent(
        tipe
      )}&kategori_alasan=eq.${encodeURIComponent(String(kategori_alasan).trim())}`
    ).catch(() => []);
    if (existing.length > 0) {
      res.status(400).json({ error: 'Kategori alasan ini sudah ada untuk cabang & tipe tersebut.' });
      return;
    }

    await insertSupabase('master_alasan_menolak', {
      cabang,
      tipe,
      kategori_alasan: String(kategori_alasan).trim(),
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PATCH /api/master/alasan-menolak/:id — ubah nama kategori (cabang & tipe
// dibiarkan tetap supaya pengelompokan tidak berantakan; hapus & buat baru
// kalau memang perlu pindah kelompok).
// ============================================================
masterRouter.patch('/alasan-menolak/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'ID tidak valid. Harus berupa angka.' });
      return;
    }
    const branch = resolveCabang(req.body?.cabang || req.query.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    const { kategori_alasan } = req.body || {};
    if (!kategori_alasan || !String(kategori_alasan).trim()) {
      res.status(400).json({ error: 'Kategori alasan wajib diisi.' });
      return;
    }
    await updateSupabase('master_alasan_menolak', `id=eq.${id}&cabang=eq.${encodeURIComponent(cabang)}`, {
      kategori_alasan: String(kategori_alasan).trim(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DELETE /api/master/alasan-menolak/:id
// ============================================================
masterRouter.delete('/alasan-menolak/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'ID tidak valid. Harus berupa angka.' });
      return;
    }
    const branch = resolveCabang(req.query.cabang || req.body?.cabang);
    if (!branch.ok) {
      res.status(403).json({ error: branch.reason, cabang: branch.cabang });
      return;
    }
    const cabang = branch.cabang;
    await deleteSupabase('master_alasan_menolak', `id=eq.${id}&cabang=eq.${encodeURIComponent(cabang)}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
