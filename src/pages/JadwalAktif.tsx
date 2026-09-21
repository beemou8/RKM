import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapContainer, Polyline, Marker, Popup } from 'react-leaflet';
import {
  Route,
  Search,
  RotateCcw,
  FileSpreadsheet,
  UserRound,
  Compass,
  Trash2,
  CalendarCheck2,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  fetchScheduleAdvisors,
  fetchRiwayatJadwal,
  deleteRiwayatById,
  deleteRiwayatBulk,
  deleteRiwayatByAdvisor,
  deleteRiwayatAll,
  exportSchedule,
  downloadBlob,
} from '../lib/api';
import type { RiwayatResponse } from '../types';
import { Card, Select, Button, EmptyState } from '../components/ui';
import { FitBounds, numberedIcon, useRoadRoute, CartoTileLayer } from '../components/mapUtils';
import { useTheme } from '../lib/theme';
import type { LayoutContext } from '../components/Layout';

const now = new Date();

/** Tanggal hari ini di zona waktu Jakarta, format YYYY-MM-DD — dipakai untuk
 *  menentukan apakah jadwal sudah "lewat" dan karenanya tidak boleh dihapus. */
function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function isPastDate(tanggal: string): boolean {
  return tanggal < todayStr();
}

/** Key unik untuk React list rendering. State checkbox sendiri memakai `id`
 *  karena id adalah PRIMARY KEY tbtr_jadwal_bulanan. */
function rowKey(advisor: string, tanggal: string, t: { id: number; cus_kodemember: string }): string {
  return `${advisor}__${tanggal}__${t.id}__${t.cus_kodemember}`;
}

export default function JadwalAktif() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [theme] = useTheme();
  const routeColor = theme === 'light' ? '#2563eb' : '#60a5fa';
  const [advisorList, setAdvisorList] = useState<string[]>([]);
  const [petugas, setPetugas] = useState('');
  const [bulan, setBulan] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [tahun, setTahun] = useState(String(now.getFullYear()));
  const [result, setResult] = useState<RiwayatResponse | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [preview, setPreview] = useState<{ advisor: string; tanggal: string; toko: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null); // 'item_<id>' | 'day_<adv>_<tgl>' | 'advisor_<adv>' | 'bulk' | 'all'
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    desc: string;
    action: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    fetchScheduleAdvisors(cabang)
      .then((r) => setAdvisorList(r.advisors))
      .catch(() => {});
  }, [cabang]);

  const runFetch = () => {
    setLoading(true);
    setError(null);
    fetchRiwayatJadwal(bulan, tahun, petugas, cabang)
      .then((r) => {
        setResult(r);
        setChecked({});
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    runFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabang]);

  const reset = () => {
    setPetugas('');
    setBulan(String(now.getMonth() + 1).padStart(2, '0'));
    setTahun(String(now.getFullYear()));
    setPreview(null);
  };

  const allItems = useMemo(() => {
    if (!result) return [] as Array<{ id: number; advisor: string; tanggal: string }>;
    const items: Array<{ id: number; advisor: string; tanggal: string }> = [];
    for (const [adv, days] of Object.entries(result.matrix)) {
      for (const day of days) {
        for (const t of day.toko) items.push({ id: Number(t.id), advisor: adv, tanggal: day.tanggal });
      }
    }
    return items;
  }, [result]);

  const totalJadwal = allItems.length;
  const totalJadwalFuture = allItems.filter((i) => !isPastDate(i.tanggal)).length;
  // id adalah PRIMARY KEY tbtr_jadwal_bulanan. Checkbox disimpan langsung
  // berdasarkan id supaya tombol hapus terpilih benar-benar hanya mengirim id
  // yang dicentang, tanpa terpengaruh box tanggal/advisor lain.
  const selectedItems = allItems.filter((i) => checked[i.id] === true);
  const selectedIds = selectedItems.map((i) => i.id);
  const selectedCount = selectedIds.length;

  // Jadwal yang tanggalnya sudah lewat tidak boleh ikut dicentang/dihapus.
  const toggleAllForDay = (_advisor: string, day: { tanggal: string; toko: any[] }, value: boolean) => {
    if (isPastDate(day.tanggal)) return;
    setChecked((c) => {
      const next = { ...c };
      day.toko.forEach((t) => (next[Number(t.id)] = value));
      return next;
    });
  };

  const toggleAllForAdvisor = (_advisor: string, days: { tanggal: string; toko: any[] }[], value: boolean) => {
    setChecked((c) => {
      const next = { ...c };
      days
        .filter((d) => !isPastDate(d.tanggal))
        .forEach((d) => d.toko.forEach((t: any) => (next[Number(t.id)] = value)));
      return next;
    });
  };

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
      runFetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyKey(null);
      setConfirmModal(null);
    }
  };

  // Hapus 1 baris toko saja.
  const handleDeleteItem = (id: number, label: string) => {
    setConfirmModal({
      title: 'Hapus 1 Jadwal',
      desc: `Hapus jadwal untuk ${label}? Tindakan ini tidak bisa dibatalkan.`,
      action: () => runAction(`item_${id}`, async () => {
        await deleteRiwayatById(id);
      }),
    });
  };

  // Hapus semua jadwal 1 advisor sepanjang periode bulan/tahun yang tampil.
  const handleDeleteAdvisor = (advisor: string, jumlah: number) => {
    setConfirmModal({
      title: 'Hapus Semua Jadwal Advisor Ini',
      desc: `Hapus SEMUA ${jumlah} jadwal ${advisor.toUpperCase()} untuk periode ${bulan}/${tahun}? Berlaku untuk semua tanggal.`,
      action: () => runAction(`advisor_${advisor}`, async () => {
        await deleteRiwayatByAdvisor(advisor, bulan, tahun, cabang);
        if (preview && preview.advisor === advisor) setPreview(null);
      }),
    });
  };

  // Hapus baris yang dicentang, bisa lintas tanggal & advisor.
  const handleDeleteSelected = () => {
    if (selectedCount === 0) return;
    setConfirmModal({
      title: 'Hapus Jadwal Terpilih',
      desc: `Hapus ${selectedCount} jadwal yang dicentang? Tindakan ini tidak bisa dibatalkan.`,
      action: () => runAction('bulk', async () => {
        await deleteRiwayatBulk(selectedIds);
        setPreview(null);
      }),
    });
  };

  // Tombol di dalam box tanggal hanya menghapus checkbox yang dipilih pada
  // tanggal itu. Tidak pernah lagi menghapus seluruh isi box secara otomatis.
  const handleDeleteSelectedForDay = (advisor: string, day: { tanggal: string; toko: any[] }) => {
    const ids = day.toko
      .map((t: any) => Number(t.id))
      .filter((id: number) => checked[id] === true);
    if (ids.length === 0) return;
    setConfirmModal({
      title: 'Hapus Jadwal Terpilih',
      desc: `Hapus ${ids.length} jadwal yang dicentang untuk ${advisor.toUpperCase()} pada ${fmtDate(day.tanggal)}?`,
      action: () => runAction(`day_selected_${advisor}_${day.tanggal}`, async () => {
        await deleteRiwayatBulk(ids);
        if (preview && preview.advisor === advisor && preview.tanggal === day.tanggal) setPreview(null);
      }),
    });
  };

  // Blast: hapus SEMUA jadwal yang sedang tampil (sesuai filter aktif),
  // tapi jadwal yang tanggalnya sudah lewat otomatis tidak ikut terhapus.
  const handleDeleteAll = () => {
    if (totalJadwalFuture === 0) return;
    const lewatInfo = totalJadwal - totalJadwalFuture > 0 ? ` (${totalJadwal - totalJadwalFuture} jadwal yang sudah lewat tanggal akan dilewati)` : '';
    setConfirmModal({
      title: 'Hapus Semua Jadwal (Blast)',
      desc: `Hapus ${totalJadwalFuture} jadwal untuk periode ${bulan}/${tahun}${petugas ? ` (advisor ${petugas.toUpperCase()})` : ''}?${lewatInfo} Ini akan menghapus jadwal SEMUA advisor yang sedang tampil dan tidak bisa dibatalkan.`,
      action: () => runAction('all', async () => {
        await deleteRiwayatAll(bulan, tahun, cabang, petugas);
        setPreview(null);
      }),
    });
  };

  const handleExport = async () => {
    if (!result) return;
    const rows: Array<{ tanggal: string; username: string; kode_member: string; cabang: string; tipe_member?: string | null; member_pilihan?: boolean }> = [];
    for (const [adv, days] of Object.entries(result.matrix)) {
      for (const day of days) {
        for (const t of day.toko) {
          rows.push({ tanggal: day.tanggal, username: adv, kode_member: t.cus_kodemember, cabang: t.cus_kodeigr, tipe_member: t.tipe_member, member_pilihan: !!t.member_pilihan });
        }
      }
    }
    if (rows.length === 0) {
      alert('Tidak ada jadwal aktif untuk di-export.');
      return;
    }
    try {
      const blob = await exportSchedule(rows);
      downloadBlob(blob, `Jadwal_Aktif_RKM_${bulan}_${tahun}.xlsx`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const previewLine: [number, number][] = useMemo(
    () => (preview ? preview.toko.filter((t) => t.lat && t.lng).map((t) => [t.lat, t.lng] as [number, number]) : []),
    [preview]
  );

  const { route: roadRoute, loading: routeLoading, snapped: routeSnapped } = useRoadRoute(previewLine);

  return (
    <div className="max-w-[1700px] mx-auto space-y-4">
      <Card className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <CalendarCheck2 className="w-4.5 h-4.5 text-amber-400" /> Jadwal Aktif RKM Bulanan
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Jadwal yang sudah tersimpan. Bisa dihapus satu-satu, per tanggal, per advisor, atau sekaligus semua.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {result && totalJadwal > 0 && (
            <>
              <Button variant="success" onClick={handleExport}>
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export ({totalJadwal})
              </Button>
              <Button
                variant="danger"
                onClick={handleDeleteAll}
                disabled={busyKey === 'all' || totalJadwalFuture === 0}
                title={totalJadwalFuture === 0 ? 'Semua jadwal yang tampil tanggalnya sudah lewat, tidak bisa dihapus.' : undefined}
              >
                <Trash2 className="w-3.5 h-3.5" /> {busyKey === 'all' ? 'Menghapus...' : `Hapus Semua (${totalJadwalFuture})`}
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Advisor / MR</label>
            <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-full">
              <option value="">Semua Advisor</option>
              {advisorList.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Bulan</label>
            <Select value={bulan} onChange={(e) => setBulan(e.target.value)} className="w-full">
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Tahun</label>
            <Select value={tahun} onChange={(e) => setTahun(e.target.value)} className="w-full">
              {[now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-1.5 md:col-span-3">
            <Button variant="primary" className="flex-1" onClick={runFetch} disabled={loading}>
              <Search className="w-3.5 h-3.5" /> {loading ? 'Memuat...' : 'Tampilkan'}
            </Button>
            <button onClick={reset} className="bg-[var(--wash-2)] hover:bg-[var(--wash-4)] text-[var(--text-muted)] p-2.5 rounded-xl text-xs border border-[var(--border-strong)]" title="Reset">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5 space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
          {!result || Object.keys(result.matrix).length === 0 ? (
            <Card className="p-8">
              <EmptyState icon={Route} text="Belum ada jadwal aktif untuk filter ini." />
            </Card>
          ) : (
            <>
              <Card className="p-3 flex justify-between items-center gap-2 flex-wrap">
                <span className="text-xs text-[var(--text-muted)]">Total {totalJadwal} jadwal &middot; {selectedCount} dicentang.</span>
                <Button variant="danger" onClick={handleDeleteSelected} disabled={selectedCount === 0 || busyKey === 'bulk'}>
                  <Trash2 className="w-3.5 h-3.5" /> {busyKey === 'bulk' ? 'Menghapus...' : `Hapus Terpilih (${selectedCount})`}
                </Button>
              </Card>

              {Object.entries(result.matrix).map(([adv, days]) => {
                const totalAdvisor = days.reduce((a, d) => a + d.toko.length, 0);
                const totalAdvisorFuture = days
                  .filter((d) => !isPastDate(d.tanggal))
                  .reduce((a, d) => a + d.toko.length, 0);
                const selectableAdvisorRows = days.filter((d) => !isPastDate(d.tanggal)).flatMap((d) => d.toko);
                const allAdvisorChecked = selectableAdvisorRows.length > 0 && selectableAdvisorRows.every((t: any) => checked[Number(t.id)] === true);
                return (
                  <Card key={adv} className="p-4 space-y-2.5">
                    <div className="flex justify-between items-center border-b border-[var(--border)] pb-2 gap-2 flex-wrap">
                      <h2 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                        <UserRound className="w-3.5 h-3.5 text-amber-400" /> ADVISOR:{' '}
                        <span className="text-amber-400 font-mono">{adv.toUpperCase()}</span>
                        <span className="text-[var(--text-faint)] font-normal">({totalAdvisor} jadwal)</span>
                      </h2>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allAdvisorChecked}
                            onChange={(e) => toggleAllForAdvisor(adv, days, e.target.checked)}
                            className="accent-amber-500"
                          />
                          semua
                        </label>
                        <button
                          onClick={() => handleDeleteAdvisor(adv, totalAdvisorFuture)}
                          disabled={busyKey === `advisor_${adv}` || totalAdvisorFuture === 0}
                          className="flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                          title={totalAdvisorFuture === 0 ? 'Semua jadwal advisor ini tanggalnya sudah lewat, tidak bisa dihapus.' : 'Hapus semua jadwal advisor ini (kecuali yang tanggalnya sudah lewat)'}
                        >
                          <Trash2 className="w-3 h-3" /> {busyKey === `advisor_${adv}` ? 'Menghapus...' : 'Hapus Semua'}
                        </button>
                      </div>
                    </div>
                    {days.map((day) => {
                      const dayIsPast = isPastDate(day.tanggal);
                      const selectedDayCount = day.toko.filter((t: any) => checked[Number(t.id)] === true).length;
                      const allDayChecked = !dayIsPast && day.toko.length > 0 && selectedDayCount === day.toko.length;
                      return (
                        <div
                          key={day.tanggal}
                          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-2.5 hover:border-emerald-500/40 transition-colors cursor-pointer"
                          onMouseEnter={() => setPreview({ advisor: adv, tanggal: day.tanggal, toko: day.toko })}
                        >
                          <div className="flex justify-between items-center bg-[var(--wash-1)] p-1.5 rounded-lg mb-1.5 gap-2 flex-wrap">
                            <span className="text-xs font-bold text-[var(--text-secondary)] font-mono flex items-center gap-1">
                              <Compass className="w-3 h-3 text-emerald-400" /> {fmtDate(day.tanggal)}
                              <span className="text-[var(--text-faint)] font-normal">({day.toko.length} toko)</span>
                              {dayIsPast && <span className="text-rose-400 font-normal">&middot; sudah lewat</span>}
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={allDayChecked}
                                  disabled={dayIsPast}
                                  onChange={(e) => toggleAllForDay(adv, day, e.target.checked)}
                                  className="accent-amber-500 disabled:opacity-40"
                                />
                                semua
                              </label>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSelectedForDay(adv, day);
                                }}
                                disabled={busyKey === `day_selected_${adv}_${day.tanggal}` || dayIsPast || selectedDayCount === 0}
                                className="flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                                title={dayIsPast ? 'Tanggal sudah lewat, tidak bisa dihapus.' : selectedDayCount === 0 ? 'Centang jadwal yang ingin dihapus.' : 'Hapus hanya jadwal yang dicentang pada tanggal ini'}
                              >
                                <Trash2 className="w-3 h-3" /> {busyKey === `day_selected_${adv}_${day.tanggal}` ? 'Menghapus...' : `Hapus Terpilih (${selectedDayCount})`}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                            {day.toko.map((t: any, idx: number) => (
                              <div key={rowKey(adv, day.tanggal, t)} className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/[0.03]">
                                <label className="flex items-center gap-1.5 truncate cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked[Number(t.id)] === true}
                                    disabled={dayIsPast}
                                    onChange={(e) => {
                                      const id = Number(t.id);
                                      setChecked((c) => ({ ...c, [id]: e.target.checked }));
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="accent-amber-500 w-3 h-3 disabled:opacity-40"
                                  />
                                  <span className="font-bold text-[var(--text-faint)]">{idx + 1}.</span>
                                  <span className="font-mono text-blue-400 font-bold">{t.cus_kodemember}</span>
                                  <span className="text-[var(--text-secondary)] truncate">{t.cus_namamember}</span>
                                  {t.member_pilihan && (
                                    <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-400">MEMBER PILIHAN</span>
                                  )}
                                  {(t.tipe_member === 'Sleeper' || t.tipe_member === 'Belum Aktivasi') && (
                                    <span
                                      className={`shrink-0 px-1 py-0.5 rounded text-[9px] font-bold ${
                                        t.tipe_member === 'Sleeper'
                                          ? 'bg-amber-500/15 text-amber-400'
                                          : 'bg-rose-500/15 text-rose-400'
                                      }`}
                                    >
                                      {t.tipe_member}
                                    </span>
                                  )}
                                </label>
                                <span className="flex items-center gap-2 shrink-0">
                                  <span className="text-[10px] text-[var(--text-faint)] font-mono">{t.status_visit || '-'}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteItem(t.id, `${t.cus_kodemember} — ${t.cus_namamember} (${fmtDate(day.tanggal)})`);
                                    }}
                                    disabled={busyKey === `item_${t.id}` || dayIsPast}
                                    className="text-[var(--text-faint)] hover:text-rose-400 transition-colors disabled:opacity-50"
                                    title={dayIsPast ? 'Tanggal sudah lewat, tidak bisa dihapus.' : 'Hapus jadwal ini saja'}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                );
              })}
            </>
          )}
        </div>

        <div className="xl:col-span-7 sticky top-4">
          <Card className="p-2 overflow-hidden relative" style={{ height: 'calc(100vh - 260px)', minHeight: 420 }}>
            {preview && (
              <div className="absolute top-4 left-14 z-[1000] bg-[var(--bg-overlay)] border border-[var(--border-strong)] px-3 py-1.5 rounded-xl text-xs font-bold text-[var(--text-primary)] shadow-xl flex items-center gap-2">
                <Route className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Lintasan {preview.advisor.toUpperCase()} | {fmtDate(preview.tanggal)}</span>
                {routeLoading && (
                  <span className="text-[10px] font-normal text-[var(--text-muted)] whitespace-nowrap">
                    · menyesuaikan ke jalan...
                  </span>
                )}
                {!routeLoading && routeSnapped && (
                  <span className="text-[10px] font-normal text-emerald-500 whitespace-nowrap">· mengikuti jalan</span>
                )}
              </div>
            )}
            <MapContainer center={[-6.9946, 107.5657]} zoom={11} style={{ height: '100%', width: '100%' }}>
              <CartoTileLayer />
              {preview && <FitBounds points={previewLine} />}
              {preview &&
                preview.toko.map((t: any, idx: number) =>
                  t.lat && t.lng ? (
                    <Marker key={t.id ?? t.cus_kodemember} position={[t.lat, t.lng]} icon={numberedIcon(idx + 1)}>
                      <Popup>
                        <b>Urutan Ke-{idx + 1}</b>
                        <hr />
                        <b>Toko:</b> {t.cus_namamember}
                        {t.member_pilihan && (<>
                          <br /><b>Keterangan:</b> Member Pilihan
                        </>)}
                        {t.tipe_member && t.tipe_member !== 'Aktif' && (
                          <>
                            <br />
                            <b>Tipe:</b> {t.tipe_member}
                          </>
                        )}
                      </Popup>
                    </Marker>
                  ) : null
                )}
              {previewLine.length > 1 && (
                <Polyline
                  positions={roadRoute}
                  pathOptions={{
                    color: routeColor,
                    weight: 4,
                    opacity: routeLoading ? 0.45 : 0.85,
                    lineCap: 'round',
                    lineJoin: 'round',
                    ...(routeSnapped ? {} : { dashArray: '1, 8' }),
                  }}
                />
              )}
            </MapContainer>
          </Card>
        </div>
      </div>

      {/* Modal konfirmasi hapus (dipakai untuk semua jenis hapus: satuan, per tanggal, per advisor, terpilih, semua) */}
      {confirmModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm flex flex-col bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-2xl p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" /> {confirmModal.title}
              </h2>
              <button onClick={() => setConfirmModal(null)} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">{confirmModal.desc}</p>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1 justify-center" onClick={() => confirmModal.action()} disabled={busyKey !== null}>
                {busyKey !== null ? 'Menghapus...' : 'Ya, Hapus'}
              </Button>
              <button
                onClick={() => setConfirmModal(null)}
                className="bg-[var(--wash-2)] hover:bg-[var(--wash-4)] text-[var(--text-muted)] px-4 py-2.5 rounded-xl text-xs border border-[var(--border-strong)]"
              >
                Batal
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
