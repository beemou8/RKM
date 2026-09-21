// ============================================================
// Hari libur nasional & cuti bersama Indonesia — dipakai supaya
// Penjadwalan Otomatis tidak menaruh toko di tanggal merah resmi
// (mengikuti SKB 3 Menteri), sama seperti hari Minggu yang sudah
// otomatis dilewati sebelumnya.
//
// Sumber data: api-hari-libur.vercel.app (gratis, tanpa API key,
// datanya di-update otomatis tiap awal bulan). Kalau API ini
// down/timeout, kita FAIL-OPEN: anggap tidak ada hari libur yang
// diketahui untuk tahun itu, supaya generate jadwal tidak sampai
// gagal total hanya gara-gara API pihak ketiga bermasalah. Skip
// hari Minggu tetap jalan seperti biasa apapun yang terjadi di sini.
// ============================================================

const HOLIDAY_API_BASE = 'https://api-hari-libur.vercel.app/api';

interface HolidayInfo {
  dates: Set<string>;
  names: Map<string, string>; // "YYYY-MM-DD" -> nama hari libur
}

// Cache in-memory per tahun, supaya generate jadwal berkali-kali dalam
// sesi yang sama tidak nembak API luar tiap kali. Di-refresh tiap 12 jam
// (bukan cache permanen), karena data cuti bersama kadang direvisi.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<number, { info: HolidayInfo; fetchedAt: number }>();

interface HolidayApiResponse {
  status: string;
  code: number;
  data?: Array<{ date: string; description: string }>;
  message?: string;
}

/** Ambil info hari libur nasional/cuti bersama resmi untuk tahun tertentu.
 *  Selalu berhasil (tidak throw) — kalau API gagal dihubungi, balikin data
 *  kosong (fail-open, atau cache lama kalau ada) dan cuma nge-log warning
 *  di server, supaya generate jadwal tetap jalan. */
export async function getHolidayInfo(tahun: number): Promise<HolidayInfo> {
  const cached = cache.get(tahun);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.info;
  }

  try {
    const res = await fetch(`${HOLIDAY_API_BASE}?year=${tahun}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: HolidayApiResponse = await res.json();
    const dates = new Set<string>();
    const names = new Map<string, string>();
    for (const h of body.data || []) {
      dates.add(h.date);
      names.set(h.date, h.description);
    }
    const info: HolidayInfo = { dates, names };
    cache.set(tahun, { info, fetchedAt: Date.now() });
    return info;
  } catch (err: any) {
    console.warn(`[holidays] Gagal ambil data hari libur ${tahun} dari API, lanjut tanpa filter libur:`, err.message);
    // Kalau ada cache lama (walau sudah lewat TTL), lebih baik pakai itu
    // daripada tidak sama sekali — data libur nasional jarang berubah drastis.
    if (cached) return cached.info;
    return { dates: new Set(), names: new Map() };
  }
}
