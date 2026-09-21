import { Fragment, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapContainer, CircleMarker, Marker, Circle, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import {
  MapPinned, Users, Store, Clock, RefreshCw, ArrowRight, Radio, ZoomOut, AlertTriangle, Search
} from 'lucide-react';
import { fetchTracking } from '../lib/api';
import type { TrackingResponse } from '../types';
import { Card, CardHeader, Badge, EmptyState, Input, Select, Pagination } from '../components/ui';
import { FitBounds, FlyTo, pinIcon, useRoadMatch, CartoTileLayer } from '../components/mapUtils';
import type { LayoutContext } from '../components/Layout';
import { useTheme } from '../lib/theme';

// Disesuaikan ke zona waktu WIB (UTC+7)
const todayStr = () => {
  const d = new Date();
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
};

const DEFAULT_CENTER: [number, number] = [-6.9946, 107.5657];

const ALERT_META: Record<'gps' | 'radius' | 'diam' | 'login', { label: string; border: string; text: string; glow?: boolean }> = {
  radius: { label: '📍 Kunjungan Deviasi', border: 'border-amber-500/20', text: 'text-amber-400' },
  gps: { label: '📡 GPS Offline', border: 'border-rose-500/30', text: 'text-rose-400', glow: true },
  login: { label: '🔒 Belum Login', border: 'border-rose-500/30', text: 'text-rose-400', glow: true },
  diam: { label: '⏱️ Indikasi Diam', border: 'border-[var(--border-strong)]', text: 'text-[var(--text-secondary)]' },
};

type Resp = TrackingResponse & { advisor_list: Array<{ username: string; nama_lengkap: string }> };

export default function Tracking() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [theme] = useTheme();
  const routeColor = theme === 'light' ? '#2563eb' : '#60a5fa';
  const [tgl, setTgl] = useState(todayStr());
  const [petugas, setPetugas] = useState('');
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'kunjungan' | 'secondary'>('kunjungan');
  
  // State untuk fokus peta
  const [focusPoint, setFocusPoint] = useState<[number, number] | null>(null);
  const [focusBounds, setFocusBounds] = useState<[number, number][] | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const focusOnVisit = (v: any, key: string) => {
    setFocusKey(key);
    
    const pts: [number, number][] = [];
    // Kumpulkan posisi HP & posisi Toko CRM
    if (v.latitude && v.longitude) pts.push([v.latitude, v.longitude]);
    if (v.crm_lat && v.crm_lng) pts.push([v.crm_lat, v.crm_lng]);

    if (pts.length > 1) {
      // Jika ada 2 titik, set bounds agar kedua titik (HP & Toko) terlihat dalam 1 layar
      setFocusPoint(null);
      setFocusBounds(pts);
    } else if (pts.length === 1) {
      // Jika hanya 1 titik, gunakan FlyTo biasa
      setFocusBounds(null);
      setFocusPoint(pts[0]);
    }
  };

  const focusOnPoint = (lat: number, lng: number, key: string) => {
    setFocusBounds(null);
    setFocusPoint([lat, lng]);
    setFocusKey(key);
  };

  // Mekanisme Auto-Refresh realtime
  useEffect(() => {
    let isMounted = true;
    
    const loadData = () => {
      fetchTracking(tgl, petugas, cabang)
        .then((d) => {
          if (isMounted) {
            setData(d as Resp);
            setError(null);
          }
        })
        .catch((e) => {
          if (isMounted) setError(e.message);
        });
    };

    loadData();
    const intervalId = setInterval(loadData, 30000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [tgl, petugas, cabang]);

  const tripTrail: [number, number][] = useMemo(() => {
    if (!data || !data.is_single_view) return [];
    return data.tracking_points.filter((t) => t.latitude && t.longitude).map((t) => [t.latitude, t.longitude] as [number, number]);
  }, [data]);

  // Snaps the recorded GPS trail onto the actual road network instead of
  // drawing straight segments between raw samples.
  const { route: tripRoute, loading: tripRouteLoading, snapped: tripRouteSnapped, distanceKm: tripDistanceKm } = useRoadMatch(tripTrail);

  const stayPoints = useMemo(() => {
    if (!data || !data.is_single_view) return [];
    const pts = data.tracking_points;
    const result: Array<{ lat: number; lng: number; jam: string; durasi: number }> = [];
    let i = 0;
    const distM = (a: any, b: any) => {
      if (!a.latitude || !a.longitude || !b.latitude || !b.longitude) return null;
      const R = 6371000;
      const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
      const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };
    while (i < pts.length) {
      const pt = pts[i];
      if (!pt.latitude || !pt.longitude) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < pts.length) {
        const nxt = pts[j + 1];
        if (!nxt.latitude || !nxt.longitude) break;
        const jarak = distM(pt, nxt);
        if (jarak !== null && jarak <= 50) j++;
        else break;
      }
      const selisih = Math.round((new Date(pts[j].created_at).getTime() - new Date(pt.created_at).getTime()) / 60000);
      if (j > i && selisih >= 15) {
        result.push({ lat: pt.latitude, lng: pt.longitude, jam: fmtWIB(pt.created_at), durasi: selisih });
      }
      i = j + 1;
    }
    return result.sort((a, b) => b.durasi - a.durasi);
  }, [data]);

  const centerPoints: [number, number][] = useMemo(() => {
    if (!data) return [];
    const pts: [number, number][] = [];
    for (const t of data.tracking_points) {
      if (t.latitude && t.longitude) pts.push([t.latitude, t.longitude]);
    }
    for (const v of data.visits) {
      if (v.crm_lat && v.crm_lng) pts.push([v.crm_lat, v.crm_lng]);
      if (v.latitude && v.longitude) pts.push([v.latitude, v.longitude]); // Menambahkan posisi asli advisor saat visit
    }
    return pts;
  }, [data]);

  // Cek apakah sekarang adalah jam kerja (Jam 08:00 - 16:59 WIB)
  const isWorkingHourNow = () => {
    const currentHour = parseInt(
      new Date().toLocaleTimeString('en-US', { hour12: false, hour: 'numeric', timeZone: 'Asia/Jakarta' }),
      10
    );
    return currentHour >= 8 && currentHour <= 16;
  };

  // FUNGSI PERINGATAN (ALERTS DETECTOR)
  const warnings = useMemo(() => {
    if (!data) return [];
    const alerts: Array<{ id: string; type: 'gps' | 'radius' | 'diam' | 'login'; msg: string; time?: string }> = [];

    // 1. Deteksi Luar Radius (Tetap dihitung karena bukti visit)
    data.visits.forEach((v, i) => {
      if (v.status_kunjungan === 'luar_radius') {
        alerts.push({
          id: `rad-${i}`,
          type: 'radius',
          msg: `${v.username ? v.username.toUpperCase() + ' - ' : ''}Kunjungan diluar radius (${Math.round(v.jarak_meter || 0)}m) di ${v.nama_toko_customer}`,
          time: fmtWIB(v.created_at)
        });
      }
    });

    // 2. Deteksi advisor yang belum login / belum kirim posisi sama sekali hari ini
    //    (HANYA AKTIF SAAT HARI INI DAN DALAM JAM KERJA, biar tidak ribut di luar jam kerja)
    if (!data.is_single_view && tgl === todayStr() && isWorkingHourNow()) {
      (data.advisor_no_login || []).forEach((u) => {
        alerts.push({
          id: `login-${u.username}`,
          type: 'login',
          msg: `${u.username.toUpperCase()} - Belum melakukan login / belum ada posisi live hari ini.`,
        });
      });
    }

    // 3. Deteksi GPS Mati & Diam Lama (HANYA AKTIF SAAT HARI INI DAN DALAM JAM KERJA)
    if (tgl === todayStr() && isWorkingHourNow()) {
      const latestPerUser = new Map();
      const sortedPoints = [...data.tracking_points].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      sortedPoints.forEach(t => {
        latestPerUser.set(t.username, t);
      });

      latestPerUser.forEach((t, uname) => {
        const diffMenit = (new Date().getTime() - new Date(t.created_at).getTime()) / 60000;
        
        if (diffMenit > 30) {
          alerts.push({
            id: `gps-${uname}`,
            type: 'gps',
            msg: `${uname.toUpperCase()} - GPS mati / offline, tidak ada pergerakan > 30 menit.`,
            time: fmtWIB(t.created_at)
          });
        } else if ((t.lama_diam_menit || 0) >= 15) {
          alerts.push({
            id: `diam-${uname}`,
            type: 'diam',
            msg: `${uname.toUpperCase()} - Terdeteksi diam di titik yang sama selama ${fmtDurasi(t.lama_diam_menit || 0)}.`,
            time: fmtWIB(t.created_at)
          });
        }
      });
    }

    return alerts;
  }, [data, tgl]);

  const getAdvisorStatus = (createdAt: string, lamaDiam: number) => {
    const isToday = tgl === todayStr();
    
    // Kalau bukan hari ini ATAU di luar jam kerja, set netral
    if (isToday && !isWorkingHourNow()) {
      return { label: 'Di Luar Jam Kerja', color: '#64748b', textClass: 'text-slate-400' };
    }

    const diffMenit = (new Date().getTime() - new Date(createdAt).getTime()) / 60000;
    
    if (isToday && diffMenit > 30) {
      return { label: 'GPS Mati / Offline', color: '#ef4444', textClass: 'text-rose-400' };
    }
    if (lamaDiam >= 15) {
      return { label: `Diam ${fmtDurasi(lamaDiam)}`, color: '#64748b', textClass: 'text-slate-400' };
    }
    return { label: 'Bergerak (Aktif)', color: '#10b981', textClass: 'text-emerald-400' };
  };

  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);

  useEffect(() => {
    setTablePage(1);
  }, [tgl, petugas, cabang]);

  const filteredVisits = useMemo(() => {
    if (!data?.visits) return [];
    const q = tableSearch.trim().toLowerCase();
    if (!q) return data.visits;
    return data.visits.filter((v) =>
      (v.nama_toko_customer && v.nama_toko_customer.toLowerCase().includes(q)) ||
      (v.kode_member && v.kode_member.toLowerCase().includes(q)) ||
      (v.username && v.username.toLowerCase().includes(q)) ||
      (v.alasan_tidak_order && v.alasan_tidak_order.toLowerCase().includes(q)) ||
      (v.kategori_tidak_order && v.kategori_tidak_order.toLowerCase().includes(q))
    );
  }, [data?.visits, tableSearch]);

  const pagedVisits = useMemo(() => {
    if (tablePageSize >= 9999) return filteredVisits;
    const start = (tablePage - 1) * tablePageSize;
    return filteredVisits.slice(start, start + tablePageSize);
  }, [filteredVisits, tablePage, tablePageSize]);

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      <Card className="px-5 py-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[var(--wash-2)] border border-[var(--border-strong)] flex items-center justify-center shrink-0">
              <MapPinned className="w-4.5 h-4.5 text-[var(--text-secondary)]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="font-display text-lg font-semibold text-[var(--text-primary)]">Command Center — Tracking RKM</h1>
                <span className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live (Auto-Refresh)
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Update terakhir {data?.last_update || '-'} &middot;{' '}
                {data?.is_single_view ? 'Rute & durasi diam advisor' : 'Posisi terakhir seluruh advisor'}
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center bg-[var(--wash-1)] p-1.5 rounded-xl border border-[var(--border)]">
            <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-48">
              <option value="">Semua Advisor</option>
              {(data?.advisor_list || []).map((u) => (
                <option key={u.username} value={u.username}>
                  {u.username.toUpperCase()} — {u.nama_lengkap}
                </option>
              ))}
            </Select>
            <Input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} />
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}

      {data?.petugas_tidak_aktif && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-amber-400">
            Advisor <span className="font-mono font-semibold">{petugas.toUpperCase()}</span> tidak aktif (nonaktif atau bukan
            advisor di cabang ini), sehingga tidak ditampilkan di tracking. Pilih advisor lain dari daftar.
          </p>
        </Card>
      )}

      {data && (
        <>
          {/* BANNER PERINGATAN (ALERT SYSTEM) */}
          {warnings.length > 0 && (
            <Card className="p-4 border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-md">
              <div className="flex items-start gap-3">
                <div className="bg-[var(--border)] border border-[var(--border-strong)] p-2 rounded-full mt-0.5 shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-400 animate-pulse" />
                </div>
                <div className="flex-1 w-full min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Sistem Peringatan ({warnings.length} Catatan)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {warnings.map((w) => {
                      const meta = ALERT_META[w.type];
                      return (
                        <div
                          key={w.id}
                          className={`bg-[var(--bg-card)] rounded-lg px-3 py-2.5 text-xs border flex flex-col justify-between ${meta.border} ${
                            meta.glow ? 'shadow-[0_0_10px_rgba(244,63,94,0.05)]' : ''
                          }`}
                        >
                          <div>
                            <span className={`font-semibold block mb-1 ${meta.text}`}>{meta.label}</span>
                            <span className="text-[var(--text-muted)] leading-relaxed">{w.msg}</span>
                          </div>
                          {w.time && (
                            <span className="block mt-2 pt-2 border-t border-white/5 text-[10px] text-[var(--text-faint)] font-mono">
                              Tercatat: {w.time}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="flex flex-col lg:flex-row gap-4">
            <Card className="relative flex-1 overflow-hidden" style={{ height: '65vh', minHeight: 420 }}>
              {data.tracking_points.length === 0 && data.visits.length === 0 ? (
                <EmptyState icon={MapPinned} text="Belum ada data lokasi untuk tanggal ini." />
              ) : (
                <>
                  <MapContainer center={DEFAULT_CENTER} zoom={12} zoomControl={false} style={{ height: '100%', width: '100%', background: 'var(--bg-app)' }}>
                    <CartoTileLayer />
                    
                    {/* Komponen pembantu peta */}
                    <FitBounds points={centerPoints} resetSignal={resetSignal} />
                    <FlyTo point={focusPoint} />
                    <FocusBounds points={focusBounds} />

                    {data.visits.map((v, idx) =>
                      v.crm_lat && v.crm_lng ? (
                        <Fragment key={`crm-${idx}`}>
                          <Circle
                            center={[v.crm_lat, v.crm_lng]}
                            radius={100}
                            pathOptions={{
                              color: v.status_kunjungan === 'valid' ? '#10b981' : '#ef4444',
                              fillColor: v.status_kunjungan === 'valid' ? '#10b981' : '#ef4444',
                              fillOpacity: 0.08,
                              weight: 1.5,
                            }}
                          />
                          <Marker position={[v.crm_lat, v.crm_lng]} icon={pinIcon('#334155', 22)}>
                            <Popup>
                              <b>Toko (Data CRM)</b>
                              <br />
                              Toko: {v.nama_toko_customer}
                              <br />
                              Kode: {v.kode_member}
                            </Popup>
                          </Marker>
                          {v.latitude && v.longitude && (
                            <CircleMarker
                              center={[v.latitude, v.longitude]}
                              radius={7}
                              pathOptions={{
                                color: '#fff',
                                weight: 2,
                                fillColor: v.status_kunjungan === 'valid' ? '#10b981' : '#ef4444',
                                fillOpacity: 1,
                              }}
                            >
                              <Popup>
                                <b>Posisi HP saat input kunjungan</b>
                                <br />
                                Toko: {v.nama_toko_customer}
                                <br />
                                Jarak ke toko: {v.jarak_meter?.toFixed(1)} meter
                                <br />
                                Status: {v.status_kunjungan === 'valid' ? 'Dalam radius' : 'Di luar radius, perlu dicek'}
                              </Popup>
                            </CircleMarker>
                          )}
                        </Fragment>
                      ) : null
                    )}

                    {!data.is_single_view &&
                      data.tracking_points.map((t, idx) => {
                        if (!t.latitude || !t.longitude) return null;
                        const { label, color } = getAdvisorStatus(t.created_at, t.lama_diam_menit || 0);
                        return (
                          <Marker
                            key={`t-${idx}`}
                            position={[t.latitude, t.longitude]}
                            icon={pinIcon(color)}
                          >
                            <Tooltip direction="top" offset={[0, -20]} opacity={1} permanent>
                              <div className="font-bold text-[10px] uppercase text-[var(--border)]">
                                {t.username}
                              </div>
                            </Tooltip>
                            <Popup>
                              <b>Posisi Terakhir: {t.username.toUpperCase()}</b>
                              <br />
                              Status: {label}
                              <br />
                              Update: {fmtWIB(t.created_at)}
                            </Popup>
                          </Marker>
                        );
                      })
                    }

                    {data.is_single_view && (
                      <>
                        <Polyline 
                          positions={tripRoute} 
                          pathOptions={{
                            color: routeColor,
                            weight: 4,
                            opacity: tripRouteLoading ? 0.4 : 0.85,
                            lineCap: 'round',
                            lineJoin: 'round',
                            ...(tripRouteSnapped ? {} : tripTrail.length > 1 ? { dashArray: '1, 8' } : {}),
                          }}
                        />
                        
                        {data.tracking_points.length > 0 && (
                           (() => {
                             const latest = data.tracking_points[data.tracking_points.length - 1];
                             if (latest.latitude && latest.longitude) {
                               const { label, color } = getAdvisorStatus(latest.created_at, latest.lama_diam_menit || 0);
                               return (
                                <Marker position={[latest.latitude, latest.longitude]} icon={pinIcon(color)}>
                                  <Popup>
                                    <b>Posisi Terkini: {latest.username.toUpperCase()}</b>
                                    <br />
                                    Status: {label}
                                    <br />
                                    Update: {fmtWIB(latest.created_at)}
                                  </Popup>
                                </Marker>
                               );
                             }
                             return null;
                           })()
                        )}
                        
                        {stayPoints.map((sp, idx) => (
                          <Marker key={`sp-${idx}`} position={[sp.lat, sp.lng]} icon={pinIcon('#64748b', 22)}>
                            <Popup>
                              Diam {sp.durasi} menit di lokasi
                              <br />
                              Jam: {sp.jam}
                            </Popup>
                          </Marker>
                        ))}
                      </>
                    )}
                  </MapContainer>

                  <div className="absolute top-3 left-3 z-[1000] bg-[var(--bg-overlay)] border border-[var(--border-strong)] rounded-lg shadow-md flex items-stretch overflow-hidden text-xs">
                    <MiniStat label="Advisor Aktif" value={`${data.totals.advisor_online} / ${data.totals.advisor_dipantau}`} />
                    {!data.is_single_view && (
                      <MiniStat label="Belum Login" value={String((data.advisor_no_login || []).length)} tone="rose" />
                    )}
                    <MiniStat label="Kunjungan" value={String(data.totals.kunjungan)} />
                    <MiniStat label="Valid" value={String(data.totals.valid)} tone="emerald" />
                    <MiniStat label="Perlu Dicek" value={String(data.totals.luar_radius + data.totals.tanpa_gps)} tone="rose" last={!data.is_single_view} />
                    {data.is_single_view && tripTrail.length > 1 && (
                      <MiniStat
                        label="Jarak Tempuh"
                        value={tripDistanceKm > 0 ? `${tripDistanceKm.toFixed(1)} km` : '-'}
                        tone="blue"
                        last
                      />
                    )}
                  </div>

                  {data.is_single_view && tripTrail.length > 1 && (
                    <div className="absolute bottom-3 left-3 z-[1000] bg-[var(--bg-overlay)] border border-[var(--border-strong)] px-2.5 py-1.5 rounded-lg shadow-md text-[11px] font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
                      {tripRouteLoading ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-[var(--text-faint)]" />
                          Menyesuaikan jalur ke jalan...
                        </>
                      ) : tripRouteSnapped ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Jalur mengikuti jalan
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]" />
                          Garis lurus (jalur tidak tersedia)
                        </>
                      )}
                    </div>
                  )}

                  {(focusPoint || focusBounds) && (
                    <button
                      onClick={() => {
                        setFocusPoint(null);
                        setFocusBounds(null);
                        setFocusKey(null);
                        setResetSignal((s) => s + 1);
                      }}
                      className="absolute top-3 right-3 z-[1000] bg-[var(--bg-overlay)] border border-[var(--border-strong)] rounded-lg shadow-md px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-white hover:border-amber-500/40 flex items-center gap-1.5"
                    >
                      <ZoomOut className="w-3.5 h-3.5" /> Zoom Out
                    </button>
                  )}
                </>
              )}
            </Card>

            <Card className="w-full lg:w-[380px] shrink-0 flex flex-col overflow-hidden" style={{ height: '65vh', minHeight: 420 }}>
              <div className="flex border-b border-[var(--border)] bg-[var(--wash-1)] shrink-0">
                <TabBtn active={tab === 'kunjungan'} onClick={() => setTab('kunjungan')} icon={Store} label="Kunjungan" count={data.visits.length} />
                <TabBtn
                  active={tab === 'secondary'}
                  onClick={() => setTab('secondary')}
                  icon={data.is_single_view ? Clock : Users}
                  label={data.is_single_view ? 'Titik Diam' : 'Status Advisor'}
                  count={
                    data.is_single_view
                      ? stayPoints.length
                      : data.tracking_points.length + (data.advisor_no_login || []).length
                  }
                />
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {tab === 'kunjungan' &&
                  (data.visits.length === 0 ? (
                    <EmptyState icon={Store} text="Belum ada kunjungan hari ini." />
                  ) : (
                    data.visits.map((v, idx) => {
                      const key = `visit-${idx}`;
                      const isDeviasi = v.status_kunjungan === 'luar_radius';
                      return (
                        <div
                          key={idx}
                          onClick={() => focusOnVisit(v, key)}
                          className={`bg-[var(--wash-1)] border rounded-lg p-3 cursor-pointer transition-colors hover:border-amber-500/40 ${
                            focusKey === key ? 'border-amber-500/60 bg-amber-500/[0.04]' : 'border-[var(--border)]'
                          }`}
                        >
                          {!data.is_single_view && (
                            <p className="text-[10px] font-medium text-[var(--text-muted)] font-mono mb-1">{v.username.toUpperCase()}</p>
                          )}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-[var(--text-primary)] text-sm truncate">{v.nama_toko_customer}</p>
                              <p className="text-[10px] text-[var(--text-faint)] font-mono">{v.kode_member}</p>
                            </div>
                            <span className="text-[10px] font-mono text-[var(--text-faint)] shrink-0">{fmtWIB(v.created_at)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <Badge tone={v.berhasil_order === true || v.berhasil_order === 't' ? 'emerald' : 'slate'}>
                              {v.berhasil_order === true || v.berhasil_order === 't' ? 'Order' : 'Belum Order'}
                            </Badge>
                            <Badge tone={v.status_kunjungan === 'valid' ? 'emerald' : v.status_kunjungan === 'tidak_ada_gps' ? 'slate' : 'rose'}>
                              {v.status_kunjungan === 'valid' ? 'Valid' : v.status_kunjungan === 'tidak_ada_gps' ? 'GPS Mati' : 'Luar Radius'}
                            </Badge>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono ml-auto">
                              {v.latitude && v.longitude ? `${v.jarak_meter?.toFixed(0)} m` : '—'}
                            </span>
                          </div>
                          {(v.alasan_tidak_order || v.kategori_tidak_order) && (
                            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                              {v.kategori_tidak_order && <Badge tone="amber">{v.kategori_tidak_order}</Badge>}
                              {v.alasan_tidak_order && <p className="text-[10px] text-[var(--text-faint)]">{v.alasan_tidak_order}</p>}
                            </div>
                          )}
                          {isDeviasi && (
                            <p className="text-[10px] text-rose-400 mt-1.5 flex items-center gap-1">
                              <MapPinned className="w-2.5 h-2.5" /> Klik untuk lihat titik deviasi di peta
                            </p>
                          )}
                        </div>
                      );
                    })
                  ))}

                {tab === 'secondary' && data.is_single_view && (
                  stayPoints.length === 0 ? (
                    <EmptyState icon={Clock} text="Tidak ada titik diam lebih dari 15 menit hari ini." />
                  ) : (
                    stayPoints.map((sp, idx) => {
                      const key = `stay-${idx}`;
                      return (
                        <div
                          key={idx}
                          onClick={() => focusOnPoint(sp.lat, sp.lng, key)}
                          className={`bg-[var(--wash-1)] border rounded-lg p-3 cursor-pointer transition-colors hover:border-[var(--border-strong)] ${
                            focusKey === key ? 'border-[var(--text-muted)]/60 bg-[var(--wash-2)]' : 'border-[var(--border)]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-mono text-[var(--text-muted)]">{sp.jam}</span>
                            <span className="text-xs font-medium text-[var(--text-secondary)]">{fmtDurasi(sp.durasi)}</span>
                          </div>
                          <p className="text-xs text-[var(--text-faint)]">
                            Lat: {sp.lat.toFixed(5)}, Lng: {sp.lng.toFixed(5)}
                          </p>
                        </div>
                      );
                    })
                  )
                )}

                {tab === 'secondary' && !data.is_single_view && (
                  data.tracking_points.length === 0 && (data.advisor_no_login || []).length === 0 ? (
                    <EmptyState icon={Users} text="Belum ada advisor yang mengirim posisi hari ini." />
                  ) : (
                    <>
                      {(data.advisor_no_login || []).length > 0 && (
                        <>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-400/80 px-0.5 pt-1">
                            Belum Login ({data.advisor_no_login!.length})
                          </p>
                          {data.advisor_no_login!.map((u) => (
                            <div key={`nologin-${u.username}`} className="bg-rose-500/[0.04] border border-rose-500/25 rounded-lg p-3">
                              <div className="flex items-center justify-between">
                                <p className="font-medium text-[var(--text-primary)] text-sm font-mono">{u.username.toUpperCase()}</p>
                                <span className="text-[10px] font-semibold text-rose-400">Belum Login</span>
                              </div>
                              <p className="text-[10px] text-[var(--text-muted)] mt-1">{u.nama_lengkap}</p>
                              <p className="text-[10px] text-rose-400/80 mt-1.5">Belum ada posisi live yang tercatat hari ini.</p>
                            </div>
                          ))}
                        </>
                      )}

                      {data.tracking_points.length > 0 && (
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] px-0.5 pt-2">
                          Sudah Kirim Posisi ({data.tracking_points.length})
                        </p>
                      )}
                      {[...data.tracking_points]
                        .sort((a, b) => (b.lama_diam_menit || 0) - (a.lama_diam_menit || 0))
                        .map((pt, idx) => {
                        const { label, textClass } = getAdvisorStatus(pt.created_at, pt.lama_diam_menit || 0);
                        const key = `adv-${idx}`;
                        return (
                          <div
                            key={idx}
                            onClick={() => pt.latitude && pt.longitude && focusOnPoint(pt.latitude, pt.longitude, key)}
                            className={`bg-[var(--wash-1)] border rounded-lg p-3 cursor-pointer transition-colors hover:border-[var(--border-strong)] ${
                              focusKey === key ? 'border-[var(--text-muted)]/60 bg-[var(--wash-2)]' : 'border-[var(--border)]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-[var(--text-primary)] text-sm font-mono">{pt.username.toUpperCase()}</p>
                              <span className={`text-[10px] font-semibold ${textClass}`}>{label}</span>
                            </div>
                            <p className="text-[10px] text-[var(--text-faint)] mt-1">Update terakhir {fmtWIB(pt.created_at)}</p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPetugas(pt.username);
                              }}
                              className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-secondary)] hover:text-white"
                            >
                              Lihat rute harian <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        );
                        })}
                    </>
                  )
                )}
              </div>
            </Card>
          </div>

          {data.breakdown_kategori_tidak_order.length > 0 && (
            <Card>
              <CardHeader title="Breakdown Kategori Tidak Order" icon={Store} />
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {data.breakdown_kategori_tidak_order.map((k) => (
                  <div key={k.kategori} className="rounded-lg bg-[var(--wash-1)] border border-[var(--border)] p-3">
                    <p className="text-lg font-display font-semibold text-amber-400">{k.jumlah}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate" title={k.kategori}>
                      {k.kategori}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title={`Tabel Detail Kunjungan (${data.is_single_view ? petugas.toUpperCase() : 'Semua Advisor'})`}
              icon={Radio}
              right={<Badge tone="slate">Total: {data.totals.kunjungan} Kunjungan</Badge>}
            />
            <div className="p-3 border-b border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  type="text"
                  placeholder="Cari toko, member, advisor, alasan..."
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value);
                    setTablePage(1);
                  }}
                  className="w-full bg-[var(--wash-2)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                />
              </div>
              {filteredVisits.length !== data.visits.length && (
                <span className="text-xs text-[var(--text-faint)]">
                  Menemukan {filteredVisits.length} dari {data.visits.length} kunjungan
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {!data.is_single_view && <th className="p-3.5 font-semibold">Advisor</th>}
                    <th className="p-3.5 font-semibold">Kode Member</th>
                    <th className="p-3.5 font-semibold">Nama Toko</th>
                    <th className="p-3.5 font-semibold text-center">Status Order</th>
                    <th className="p-3.5 font-semibold text-center">Status Kunjungan</th>
                    <th className="p-3.5 font-semibold text-center">Jarak Riil</th>
                    <th className="p-3.5 font-semibold">Jam Kunjung</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-sm">
                  {pagedVisits.length === 0 ? (
                    <tr>
                      <td colSpan={data.is_single_view ? 6 : 7}>
                        <EmptyState icon={Store} text={data.visits.length === 0 ? "Belum ada kunjungan hari ini." : "Tidak ada kunjungan yang sesuai pencarian."} />
                      </td>
                    </tr>
                  ) : (
                    pagedVisits.map((v, idx) => {
                      const key = `visit-${idx}`;
                      const isDeviasi = v.status_kunjungan === 'luar_radius';
                      return (
                        <tr
                          key={idx}
                          onClick={() => focusOnVisit(v, key)}
                          className={`cursor-pointer transition-colors hover:bg-[var(--wash-1)] ${
                            focusKey === key ? 'bg-amber-500/[0.06]' : isDeviasi ? 'bg-rose-500/[0.03]' : ''
                          }`}
                        >
                          {!data.is_single_view && (
                            <td className="p-3.5 font-mono text-xs text-[var(--text-secondary)]">{v.username.toUpperCase()}</td>
                          )}
                          <td className="p-3.5 font-mono text-xs text-[var(--text-muted)]">{v.kode_member}</td>
                          <td className="p-3.5">
                            <div className="font-medium text-[var(--text-primary)]">{v.nama_toko_customer}</div>
                            {v.kategori_tidak_order && (
                              <div className="text-[10px] text-amber-400 font-medium mt-0.5">{v.kategori_tidak_order}</div>
                            )}
                            {v.alasan_tidak_order && <div className="text-[11px] text-[var(--text-faint)]">{v.alasan_tidak_order}</div>}
                          </td>
                          <td className="p-3.5 text-center">
                            <Badge tone={v.berhasil_order === true || v.berhasil_order === 't' ? 'emerald' : 'slate'}>
                              {v.berhasil_order === true || v.berhasil_order === 't' ? 'Order' : 'Belum Order'}
                            </Badge>
                          </td>
                          <td className="p-3.5 text-center">
                            <Badge tone={v.status_kunjungan === 'valid' ? 'emerald' : v.status_kunjungan === 'tidak_ada_gps' ? 'slate' : 'rose'}>
                              {v.status_kunjungan === 'valid' ? 'Valid' : v.status_kunjungan === 'tidak_ada_gps' ? 'GPS Mati' : 'Luar Radius'}
                            </Badge>
                          </td>
                          <td className="p-3.5 text-center font-mono text-xs text-[var(--text-secondary)]">
                            {v.jarak_meter != null ? `${Math.round(v.jarak_meter)} m` : '—'}
                          </td>
                          <td className="p-3.5 font-mono text-xs text-[var(--text-muted)]">{fmtWIB(v.created_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={tablePage}
              totalItems={filteredVisits.length}
              pageSize={tablePageSize}
              onPageChange={setTablePage}
              onPageSizeChange={(size) => {
                setTablePageSize(size);
                setTablePage(1);
              }}
            />
          </Card>
        </>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--text-faint)] text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Memuat data tracking...
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-xs font-semibold py-3 transition-colors flex items-center justify-center gap-1.5 ${
        active ? 'bg-amber-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
      {count !== undefined && (
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
            active ? 'bg-white/20 text-white' : 'bg-[var(--wash-3)] text-[var(--text-muted)]'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function MiniStat({ label, value, tone, last }: { label: string; value: string; tone?: 'emerald' | 'rose' | 'blue'; last?: boolean }) {
  const color =
    tone === 'emerald' ? 'text-emerald-400' : tone === 'rose' ? 'text-rose-400' : tone === 'blue' ? 'text-blue-400' : 'text-[var(--text-primary)]';
  return (
    <div className={`px-3.5 py-2 ${!last ? 'border-r border-[var(--border-strong)]' : ''}`}>
      <p className="text-[var(--text-muted)] leading-none mb-1">{label}</p>
      <p className={`font-semibold leading-none ${color}`}>{value}</p>
    </div>
  );
}

function fmtWIB(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
}

function fmtDurasi(menit: number) {
  if (menit < 60) return `${menit} menit`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa > 0 ? `${jam} jam ${sisa} menit` : `${jam} jam`;
}

// Komponen pembantu untuk membuat map mengepaskan (fitBounds) layar berdasarkan multi titik array
function FocusBounds({ points }: { points: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (points && points.length > 0) {
      map.fitBounds(points, { padding: [60, 60], maxZoom: 16 });
    }
  }, [map, points]);
  return null;
}