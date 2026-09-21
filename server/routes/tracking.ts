import { Router } from 'express';
import { fetchSupabase, fetchSupabaseCached } from '../lib/supabase.js';
import { queryLocal, getDbStatus } from '../lib/db.js';
import { distanceMeters } from '../lib/geo.js';

export const trackingRouter = Router();

// In-memory CRM coordinates cache (10 menit) untuk mengurangi query berulang ke DB lokal saat polling
interface CachedCrmInfo {
  nama_customer: string;
  crm_koordinat: string;
  crm_lat: number | null;
  crm_lng: number | null;
  expiresAt: number;
}
const crmCoordsCache = new Map<string, CachedCrmInfo>();

const TRACKING_SELECT = 'id,username,latitude,longitude,created_at';
const VISIT_SELECT = 'id,username,kode_member,nama_toko,created_at,berhasil_order,kategori_tidak_order,alasan_tidak_order,latitude,longitude,is_in_radius';

trackingRouter.get('/', async (req, res) => {
  try {
    const tglFilter = /^\d{4}-\d{2}-\d{2}$/.test((req.query.tgl as string) || '')
      ? (req.query.tgl as string)
      : new Date().toISOString().slice(0, 10);
    const petugasFilter = (req.query.petugas as string) || '';
    const cabang = (req.query.cabang as string) || '2T';
    const isSingleView = !!petugasFilter;

    // Cache daftar user aktif cabang selama 60 detik agar tidak membebani Supabase di setiap polling 30s
    const listUsers = await fetchSupabaseCached<any>(
      `tbmaster_user?select=username,nama_lengkap&cabang=eq.${encodeURIComponent(cabang)}&is_active=eq.true&user_type=not.is.null`,
      60_000
    ).catch(() => []);
    const activeUsernames = new Set((listUsers || []).map((u: any) => u.username));

    let allTrackingData: any[] = [];
    let rawRkm: any[] = [];
    let advisorNoLogin: any[] = [];
    // Kalau petugas yang diminta bukan advisor aktif di cabang ini (nonaktif,
    // salah cabang, atau username tidak ada), jangan tampilkan datanya —
    // tracking hanya untuk advisor yang is_active = true.
    const petugasTidakAktif = isSingleView && !activeUsernames.has(petugasFilter);

    if (isSingleView && !petugasTidakAktif) {
      allTrackingData = await fetchSupabase<any>(
        `tbtr_tracking?select=${TRACKING_SELECT}&username=eq.${encodeURIComponent(petugasFilter)}&cabang=eq.${encodeURIComponent(cabang)}&created_at=gte.${tglFilter}T00:00:00%2B07:00&created_at=lte.${tglFilter}T23:59:59%2B07:00&order=created_at.asc`
      ).catch(() => []);

      rawRkm = await fetchSupabase<any>(
        `tbtr_kunjungan_rkm?select=${VISIT_SELECT}&cabang=eq.${encodeURIComponent(cabang)}&username=eq.${encodeURIComponent(petugasFilter)}&created_at=gte.${tglFilter}T00:00:00%2B07:00&created_at=lte.${tglFilter}T23:59:59%2B07:00`
      ).catch(() => []);
    } else if (!isSingleView) {
      const usernames = Array.from(activeUsernames).filter(Boolean);
      const rawTracking =
        usernames.length > 0
          ? await fetchSupabase<any>(
              `tbtr_tracking?select=${TRACKING_SELECT}&username=in.(${usernames.join(',')})&cabang=eq.${encodeURIComponent(cabang)}&created_at=gte.${tglFilter}T00:00:00%2B07:00&created_at=lte.${tglFilter}T23:59:59%2B07:00&order=created_at.desc`
            ).catch(() => [])
          : [];

      const processed = new Set<string>();
      for (const t of rawTracking) {
        if (!processed.has(t.username)) {
          allTrackingData.push(t);
          processed.add(t.username);
        }
      }

      const sortedAsc = [...rawTracking].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const byUser: Record<string, any[]> = {};
      for (const t of sortedAsc) {
        byUser[t.username] = byUser[t.username] || [];
        byUser[t.username].push(t);
      }

      const stayDurationMap: Record<string, number> = {};
      for (const [uname, points] of Object.entries(byUser)) {
        const last = points[points.length - 1];
        if (!last.latitude || !last.longitude) continue;
        let startIdx = points.length - 1;
        for (let i = points.length - 2; i >= 0; i--) {
          const jarak = distanceMeters(points[i].latitude, points[i].longitude, last.latitude, last.longitude);
          if (jarak !== null && jarak <= 50) startIdx = i;
          else break;
        }
        const menitDiam = Math.round(
          (new Date(last.created_at).getTime() - new Date(points[startIdx].created_at).getTime()) / 60000
        );
        stayDurationMap[uname] = menitDiam;
      }
      allTrackingData = allTrackingData.map((t) => ({ ...t, lama_diam_menit: stayDurationMap[t.username] ?? 0 }));

      // Advisor aktif (tbmaster_user) yang belum pernah mengirim satu pun titik
      // GPS hari ini — kemungkinan besar belum login / belum buka aplikasi.
      const trackedUsernames = new Set(Object.keys(byUser));
      advisorNoLogin = (listUsers || []).filter((u: any) => u.username && !trackedUsernames.has(u.username));

      rawRkm =
        usernames.length > 0
          ? await fetchSupabase<any>(
              `tbtr_kunjungan_rkm?select=${VISIT_SELECT}&cabang=eq.${encodeURIComponent(cabang)}&username=in.(${usernames.join(
                ','
              )})&created_at=gte.${tglFilter}T00:00:00%2B07:00&created_at=lte.${tglFilter}T23:59:59%2B07:00`
            ).catch(() => [])
          : [];
    }

    // Enrich visits with local CRM data (customer name + coordinates)
    const rkmVisits: any[] = [];
    if (rawRkm.length > 0) {
      const memberIds = Array.from(new Set(rawRkm.map((v) => v.kode_member).filter(Boolean)));
      let customerMap: Record<string, any> = {};

      if (memberIds.length > 0) {
        const now = Date.now();
        const missingIds: string[] = [];
        for (const mid of memberIds) {
          const cached = crmCoordsCache.get(mid);
          if (cached && cached.expiresAt > now) {
            customerMap[mid] = cached;
          } else {
            missingIds.push(mid);
          }
        }

        if (missingIds.length > 0) {
          try {
            const rows = await queryLocal(
              `SELECT cust.cus_kodemember, cust.cus_namamember, crm.crm_koordinat
               FROM tbmaster_customer cust
               LEFT JOIN tbmaster_customercrm crm ON cust.cus_kodemember = crm.crm_kodemember
               WHERE cust.cus_kodemember = ANY($1::text[])`,
              [missingIds]
            );
            for (const r of rows) {
              let lat: number | null = null;
              let lng: number | null = null;
              if (r.crm_koordinat) {
                const parts = String(r.crm_koordinat).split(',');
                if (parts.length === 2) {
                  lat = parseFloat(parts[0].trim());
                  lng = parseFloat(parts[1].trim());
                }
              }
              const info: CachedCrmInfo = {
                nama_customer: r.cus_namamember,
                crm_koordinat: r.crm_koordinat,
                crm_lat: lat,
                crm_lng: lng,
                expiresAt: now + 10 * 60_000,
              };
              customerMap[r.cus_kodemember] = info;
              crmCoordsCache.set(r.cus_kodemember, info);
            }
          } catch {
            // local DB unreachable — visits still show but without CRM name/coords
          }
        }
      }

      for (const visit of rawRkm) {
        const map = customerMap[visit.kode_member];
        const namaFinal = (map?.nama_customer || '').trim() || (visit.nama_toko || '').trim();
        if (!namaFinal) continue;

        const jarak = distanceMeters(map?.crm_lat, map?.crm_lng, visit.latitude, visit.longitude);
        rkmVisits.push({
          ...visit,
          nama_toko_customer: namaFinal,
          crm_koordinat_text: map?.crm_koordinat || 'Titik toko belum diset',
          crm_lat: map?.crm_lat ?? null,
          crm_lng: map?.crm_lng ?? null,
          jarak_meter: jarak,
          status_kunjungan: jarak === null ? 'tidak_ada_gps' : jarak <= 100 ? 'valid' : 'luar_radius',
        });
      }
    }

    const totalAdvisorDipantau = listUsers.length;
    const totalAdvisorOnline = new Set(allTrackingData.map((t) => t.username)).size;
    const totalKunjungan = rkmVisits.length;
    const totalValid = rkmVisits.filter((v) => v.status_kunjungan === 'valid').length;
    const totalLuarRadius = rkmVisits.filter((v) => v.status_kunjungan === 'luar_radius').length;
    const totalTanpaGps = rkmVisits.filter((v) => v.status_kunjungan === 'tidak_ada_gps').length;

    const kategoriTidakOrderCount: Record<string, number> = {};
    for (const v of rkmVisits) {
      const gagalOrder = v.berhasil_order !== true && v.berhasil_order !== 't';
      if (!gagalOrder) continue;
      const kategori = (v.kategori_tidak_order || '').trim() || 'Tidak dikategorikan';
      kategoriTidakOrderCount[kategori] = (kategoriTidakOrderCount[kategori] || 0) + 1;
    }
    const breakdownKategoriTidakOrder = Object.entries(kategoriTidakOrderCount)
      .map(([kategori, jumlah]) => ({ kategori, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah);

    let lastUpdate = '-';
    if (allTrackingData.length > 0) {
      const maxTs = Math.max(...allTrackingData.map((t) => new Date(t.created_at).getTime()));
      lastUpdate =
        new Date(maxTs).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) +
        ' WIB';
    }

    res.json({
      is_single_view: isSingleView,
      petugas_tidak_aktif: petugasTidakAktif,
      tgl_filter: tglFilter,
      petugas_filter: petugasFilter,
      last_update: lastUpdate,
      tracking_points: allTrackingData,
      visits: rkmVisits,
      totals: {
        advisor_dipantau: totalAdvisorDipantau,
        advisor_online: totalAdvisorOnline,
        kunjungan: totalKunjungan,
        valid: totalValid,
        luar_radius: totalLuarRadius,
        tanpa_gps: totalTanpaGps,
      },
      breakdown_kategori_tidak_order: breakdownKategoriTidakOrder,
      advisor_list: listUsers,
      advisor_no_login: advisorNoLogin,
      db_lokal_connected: getDbStatus().connected,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
