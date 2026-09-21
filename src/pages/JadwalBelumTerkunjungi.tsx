import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  CalendarX2,
  Search,
  RotateCcw,
  UserRound,
  Compass,
  CalendarClock,
  X,
  CheckCircle2,
  UploadCloud,
} from 'lucide-react';
import { fetchScheduleAdvisors, fetchBelumTerkunjungi, rescheduleJadwal } from '../lib/api';
import type { BelumTerkunjungiResponse } from '../types';
import { Card, Select, Button, EmptyState, Input, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

export default function JadwalBelumTerkunjungi() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [advisorList, setAdvisorList] = useState<string[]>([]);
  const [petugas, setPetugas] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<BelumTerkunjungiResponse | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [rescheduleModal, setRescheduleModal] = useState(false);
  const [newTanggal, setNewTanggal] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchScheduleAdvisors(cabang)
      .then((r) => setAdvisorList(r.advisors))
      .catch(() => {});
  }, [cabang]);

  const runFetch = () => {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setPage(1);
    fetchBelumTerkunjungi(petugas, cabang)
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
    setSearch('');
    setPage(1);
  };

  const allItems = useMemo(() => {
    if (!result) return [] as Array<{ id: number; advisor: string; tanggal: string }>;
    const items: Array<{ id: number; advisor: string; tanggal: string }> = [];
    for (const [adv, days] of Object.entries(result.matrix)) {
      for (const day of days) {
        for (const t of day.toko) items.push({ id: t.id, advisor: adv, tanggal: day.tanggal });
      }
    }
    return items;
  }, [result]);

  const filteredMatrix = useMemo(() => {
    if (!result?.matrix) return {};
    const q = search.trim().toLowerCase();
    if (!q) return result.matrix;

    const res: Record<string, typeof result.matrix[string]> = {};
    for (const [adv, days] of Object.entries(result.matrix)) {
      const filteredDays = days
        .map((day) => {
          const matchingToko = day.toko.filter(
            (t: any) =>
              adv.toLowerCase().includes(q) ||
              String(t.cus_kodemember || '').toLowerCase().includes(q) ||
              String(t.cus_namamember || '').toLowerCase().includes(q)
          );
          return { ...day, toko: matchingToko };
        })
        .filter((day) => day.toko.length > 0);

      if (filteredDays.length > 0) {
        res[adv] = filteredDays;
      }
    }
    return res;
  }, [result?.matrix, search]);

  const advisorEntries = useMemo(() => Object.entries(filteredMatrix), [filteredMatrix]);

  const pagedAdvisors = useMemo(() => {
    const start = (page - 1) * pageSize;
    return advisorEntries.slice(start, start + pageSize);
  }, [advisorEntries, page, pageSize]);

  const totalBelumTerkunjungi = allItems.length;
  const selectedIds = Object.entries(checked)
    .filter(([, v]) => v)
    .map(([id]) => Number(id));
  const selectedCount = selectedIds.length;

  const toggleAllForDay = (toko: any[], value: boolean) => {
    setChecked((c) => {
      const next = { ...c };
      toko.forEach((t) => (next[t.id] = value));
      return next;
    });
  };

  const toggleAllForAdvisor = (days: { toko: any[] }[], value: boolean) => {
    setChecked((c) => {
      const next = { ...c };
      days.forEach((d) => d.toko.forEach((t: any) => (next[t.id] = value)));
      return next;
    });
  };

  const openRescheduleModal = () => {
    if (selectedCount === 0) return;
    setNewTanggal('');
    setRescheduleModal(true);
  };

  const submitReschedule = async () => {
    if (!newTanggal) {
      setError('Pilih tanggal baru terlebih dahulu.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await rescheduleJadwal(selectedIds, newTanggal);
      setRescheduleModal(false);
      setSuccessMsg(`${r.count} jadwal berhasil dipindahkan ke ${fmtDate(r.tanggal)}.`);
      runFetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const minTanggal = todayStr();

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      <Card className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <CalendarX2 className="w-4.5 h-4.5 text-rose-400" /> Jadwal Member Belum Terkunjungi
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; 
          </p>
        </div>
        {result && totalBelumTerkunjungi > 0 && (
          <Button variant="primary" onClick={openRescheduleModal} disabled={selectedCount === 0}>
            <CalendarClock className="w-3.5 h-3.5" /> Jadwalkan Ulang ({selectedCount})
          </Button>
        )}
      </Card>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Advisor / MR
            </label>
            <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-full">
              <option value="">Semua Advisor</option>
              {advisorList.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Cari Toko / Member
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari nama toko / kode member..."
                className="pl-8 w-full"
              />
            </div>
          </div>
          <div className="flex gap-1.5 md:col-span-1">
            <Button variant="primary" className="flex-1" onClick={runFetch} disabled={loading}>
              <Search className="w-3.5 h-3.5" /> {loading ? 'Memuat...' : 'Tampilkan'}
            </Button>
            <button
              onClick={reset}
              className="bg-[var(--wash-2)] hover:bg-[var(--wash-4)] text-[var(--text-muted)] p-2.5 rounded-xl text-xs border border-[var(--border-strong)]"
              title="Reset"
            >
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

      {successMsg && (
        <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
          <p className="text-sm text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> {successMsg}
          </p>
        </Card>
      )}

      {!result || Object.keys(result.matrix).length === 0 ? (
        <Card className="p-8">
          <EmptyState icon={CalendarX2} text="Tidak ada jadwal member yang belum terkunjungi untuk filter ini." />
        </Card>
      ) : advisorEntries.length === 0 ? (
        <Card className="p-8">
          <EmptyState icon={Search} text={`Tidak ada jadwal yang cocok dengan pencarian "${search}".`} />
        </Card>
      ) : (
        <div className="space-y-3">
          <Card className="p-3 flex justify-between items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--text-muted)]">
              Total {totalBelumTerkunjungi} jadwal member belum terkunjungi &middot; {selectedCount} dicentang.
            </span>
          </Card>

          {pagedAdvisors.map(([adv, days]) => {
            const totalAdvisor = days.reduce((a, d) => a + d.toko.length, 0);
            const allAdvisorChecked = days.every((d) => d.toko.every((t: any) => checked[t.id]));
            return (
              <Card key={adv} className="p-4 space-y-2.5">
                <div className="flex justify-between items-center border-b border-[var(--border)] pb-2 gap-2 flex-wrap">
                  <h2 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                    <UserRound className="w-3.5 h-3.5 text-amber-400" /> ADVISOR:{' '}
                    <span className="text-amber-400 font-mono">{adv.toUpperCase()}</span>
                    <span className="text-[var(--text-faint)] font-normal">({totalAdvisor} terlewat)</span>
                  </h2>
                  <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allAdvisorChecked}
                      onChange={(e) => toggleAllForAdvisor(days, e.target.checked)}
                      className="accent-rose-500"
                    />
                    pilih semua
                  </label>
                </div>
                {days.map((day) => {
                  const allDayChecked = day.toko.every((t: any) => checked[t.id]);
                  const lewat = daysOverdue(day.tanggal);
                  return (
                    <div
                      key={day.tanggal}
                      className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-2.5"
                    >
                      <div className="flex justify-between items-center bg-rose-500/5 p-1.5 rounded-lg mb-1.5 gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[var(--text-secondary)] font-mono flex items-center gap-1">
                          <Compass className="w-3 h-3 text-rose-400" /> {fmtDate(day.tanggal)}
                          <span className="text-[var(--text-faint)] font-normal">({day.toko.length} toko)</span>
                          <span className="text-rose-400 font-bold ml-1">
                            &middot; {lewat} hari lewat
                          </span>
                        </span>
                        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allDayChecked}
                            onChange={(e) => toggleAllForDay(day.toko, e.target.checked)}
                            className="accent-rose-500"
                          />
                          pilih semua
                        </label>
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {day.toko.map((t: any, idx: number) => (
                          <label
                            key={t.id}
                            className="flex items-start gap-1.5 text-[11px] py-1 border-b border-white/[0.03] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={!!checked[t.id]}
                              onChange={(e) => setChecked((c) => ({ ...c, [t.id]: e.target.checked }))}
                              className="accent-rose-500 w-3 h-3 mt-0.5 shrink-0"
                            />
                            <span className="font-bold text-[var(--text-faint)] shrink-0">{idx + 1}.</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-blue-400 font-bold">{t.cus_kodemember}</span>
                                <span className="text-[var(--text-secondary)] font-semibold">{t.cus_namamember}</span>
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
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </Card>
            );
          })}
          <Pagination
            currentPage={page}
            totalItems={advisorEntries.length}
            pageSize={pageSize}
            pageSizeOptions={[25, 50, 100]}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Popup jadwalkan ulang: pilih tanggal baru lalu upload */}
      {rescheduleModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm flex flex-col bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-2xl p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-amber-400" /> Jadwalkan Ulang
              </h2>
              <button
                onClick={() => setRescheduleModal(false)}
                className="text-[var(--text-muted)] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
              {selectedCount} Anda Yakni Ingin Menambahkan Jadwal Ke Tanggal Yang baru?
            </p>
            <div className="mb-4">
              <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                Tanggal Baru
              </label>
              <Input
                type="date"
                min={minTanggal}
                value={newTanggal}
                onChange={(e) => setNewTanggal(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                className="flex-1 justify-center"
                onClick={submitReschedule}
                disabled={saving || !newTanggal}
              >
                <UploadCloud className="w-3.5 h-3.5" /> {saving ? 'Menyimpan...' : 'Upload'}
              </Button>
              <button
                onClick={() => setRescheduleModal(false)}
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

/** Tanggal hari ini di zona waktu Jakarta, format YYYY-MM-DD — konsisten
 *  dengan `todayJakarta()` di backend supaya tidak selisih karena timezone. */
function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function daysOverdue(iso: string): number {
  const today = new Date(todayStr() + 'T00:00:00');
  const target = new Date(iso + 'T00:00:00');
  const diff = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function fmtDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
