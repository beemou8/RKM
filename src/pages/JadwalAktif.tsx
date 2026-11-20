import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapContainer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import {
  Route,
  Search,
  RotateCcw,
  FileSpreadsheet,
  Trash2,
  CalendarCheck2,
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
  X,
  AlertTriangle,
  List,
  Map as MapIcon,
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

/* ---------------- tipe & helper ---------------- */

type Toko = {
  id: number | string;
  cus_kodemember: string;
  cus_namamember: string;
  cus_kodeigr?: string;
  lat?: number | null;
  lng?: number | null;
  tipe_member?: string | null;
  member_pilihan?: boolean;
  status_visit?: string | null;
};
type Day = { tanggal: string; toko: Toko[] };
type Matrix = Record<string, Day[]>;
type ConfirmState = { title: string; desc: string; action: () => Promise<void> };

/** Sesuaikan jika header layout induk berbeda tingginya. */
const PAGE_HEIGHT = 'h-[calc(100dvh-4.5rem)] min-h-[560px]';

const tid = (t: Toko) => Number(t.id);
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const isPastDate = (tanggal: string) => tanggal < todayStr();
const futureDays = (days: Day[]) => days.filter((d) => !isPastDate(d.tanggal));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fmtDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const K = {
  item: (id: number) => `item_${id}`,
  advisor: (adv: string) => `advisor_${adv}`,
  bulk: 'bulk',
  all: 'all',
};

/* ---------------- komponen kecil ---------------- */

function Checkbox({
  checked,
  indeterminate = false,
  disabled,
  onChange,
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      title={title}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-amber-500 w-[18px] h-[18px] shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
    />
  );
}

function IconDelete({ onClick, disabled, title }: { onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-faint)]"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

function Tags({ toko }: { toko: Toko }) {
  const tags: { text: string; color: string }[] = [];
  if (toko.member_pilihan) tags.push({ text: 'Member pilihan', color: '#3b82f6' });
  if (toko.tipe_member === 'Sleeper') tags.push({ text: 'Sleeper', color: '#f59e0b' });
  if (toko.tipe_member === 'Belum Aktivasi') tags.push({ text: 'Belum aktivasi', color: '#f43f5e' });
  return (
    <>
      {tags.map((t) => (
        <span key={t.text} className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <i className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
          {t.text}
        </span>
      ))}
    </>
  );
}

function MapResizer({ trigger }: { trigger: unknown }) {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(id);
  }, [map, trigger]);
  return null;
}

function ConfirmModal({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, running]);

  const confirm = async () => {
    setRunning(true);
    try {
      await state.action();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={() => !running && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card className="bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-2xl p-6">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-full bg-rose-500/10 grid place-items-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </span>
            <div>
              <h2 id="confirm-title" className="text-base font-semibold text-[var(--text-primary)]">
                {state.title}
              </h2>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-1">{state.desc}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={onClose} disabled={running} className="px-4 py-2 rounded-xl text-sm text-[var(--text-muted)] hover:bg-[var(--wash-2)]">
              Batal
            </button>
            <Button variant="danger" onClick={confirm} disabled={running}>
              {running ? 'Menghapus...' : 'Ya, hapus'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- halaman ---------------- */

export default function JadwalAktif() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [theme] = useTheme();
  const routeColor = theme === 'light' ? '#2563eb' : '#60a5fa';

  const [advisorList, setAdvisorList] = useState<string[]>([]);
  const [petugas, setPetugas] = useState('');
  const [bulan, setBulan] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));
  const [tahun, setTahun] = useState(() => String(new Date().getFullYear()));
  const [result, setResult] = useState<RiwayatResponse | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [advisorSel, setAdvisorSel] = useState<string | null>(null); // langkah 1
  const [daySel, setDaySel] = useState<string | null>(null); // langkah 2
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<'daftar' | 'peta'>('daftar');
  const reqId = useRef(0);

  const matrix = useMemo<Matrix>(() => (result ? (result.matrix as unknown as Matrix) : {}), [result]);
  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1];
  }, []);

  /* ----- data ----- */

  useEffect(() => {
    fetchScheduleAdvisors(cabang)
      .then((r) => setAdvisorList(r.advisors))
      .catch(() => {});
  }, [cabang]);

  const runFetch = useCallback(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    fetchRiwayatJadwal(bulan, tahun, petugas, cabang)
      .then((r) => {
        if (id !== reqId.current) return;
        setResult(r);
        const alive = new Set<number>();
        Object.values(r.matrix as unknown as Matrix).forEach((days) =>
          days.forEach((d) => d.toko.forEach((t) => alive.add(tid(t))))
        );
        setChecked((c) => {
          const next: Record<number, boolean> = {};
          Object.keys(c).forEach((k) => {
            if (c[Number(k)] && alive.has(Number(k))) next[Number(k)] = true;
          });
          return next;
        });
      })
      .catch((e) => id === reqId.current && setError(errMsg(e)))
      .finally(() => id === reqId.current && setLoading(false));
  }, [bulan, tahun, petugas, cabang]);

  useEffect(() => {
    const h = setTimeout(runFetch, 250);
    return () => clearTimeout(h);
  }, [runFetch]);

  const reset = () => {
    const n = new Date();
    setPetugas('');
    setBulan(String(n.getMonth() + 1).padStart(2, '0'));
    setTahun(String(n.getFullYear()));
    setAdvisorSel(null);
    setDaySel(null);
  };

  /* ----- turunan ----- */

  const advisors = Object.keys(matrix);
  const hasData = advisors.length > 0;

  const allItems = useMemo(() => {
    const items: { id: number; tanggal: string }[] = [];
    Object.values(matrix).forEach((days) =>
      days.forEach((d) => d.toko.forEach((t) => items.push({ id: tid(t), tanggal: d.tanggal })))
    );
    return items;
  }, [matrix]);

  const totalJadwal = allItems.length;
  const selectableIds = useMemo(() => allItems.filter((i) => !isPastDate(i.tanggal)).map((i) => i.id), [allItems]);
  const totalJadwalFuture = selectableIds.length;
  const selectedIds = useMemo(() => selectableIds.filter((id) => checked[id] === true), [selectableIds, checked]);
  const selectedCount = selectedIds.length;

  const advisorDays = advisorSel ? matrix[advisorSel] ?? [] : [];
  const preview = useMemo(() => {
    if (!advisorSel || !daySel) return null;
    const day = matrix[advisorSel]?.find((d) => d.tanggal === daySel);
    return day ? { advisor: advisorSel, tanggal: day.tanggal, toko: day.toko } : null;
  }, [advisorSel, daySel, matrix]);

  // Kalau advisor yang dipilih hilang (mis. habis dihapus) kembali ke daftar;
  // kalau hanya ada satu advisor, langsung masuk.
  useEffect(() => {
    if (advisorSel && !matrix[advisorSel]) {
      setAdvisorSel(null);
      setDaySel(null);
    } else if (!advisorSel && advisors.length === 1) {
      openAdvisor(advisors[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix]);

  const openAdvisor = (adv: string) => {
    const days = matrix[adv] ?? [];
    setAdvisorSel(adv);
    setDaySel((futureDays(days)[0] ?? days[0])?.tanggal ?? null);
  };

  const backToAdvisors = () => {
    setAdvisorSel(null);
    setDaySel(null);
  };

  const previewLine: [number, number][] = useMemo(
    () => (preview ? preview.toko.filter((t) => t.lat && t.lng).map((t) => [t.lat as number, t.lng as number]) : []),
    [preview]
  );
  const { route: roadRoute, loading: routeLoading, snapped: routeSnapped } = useRoadRoute(previewLine);

  /* ----- centang ----- */

  const toggleOne = (id: number, value: boolean) => setChecked((c) => ({ ...c, [id]: value }));
  const toggleDay = (day: Day, value: boolean) => {
    if (isPastDate(day.tanggal)) return;
    setChecked((c) => {
      const next = { ...c };
      day.toko.forEach((t) => (next[tid(t)] = value));
      return next;
    });
  };

  /* ----- hapus ----- */

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
      setConfirmModal(null);
      runFetch();
    } catch (e) {
      setConfirmModal(null);
      setError(errMsg(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteItem = (t: Toko, tanggal: string) => {
    const id = tid(t);
    setConfirmModal({
      title: 'Hapus 1 jadwal',
      desc: `Hapus jadwal ${t.cus_kodemember} — ${t.cus_namamember} (${fmtDate(tanggal)})? Tindakan ini tidak bisa dibatalkan.`,
      action: () => runAction(K.item(id), async () => void (await deleteRiwayatById(id))),
    });
  };

  const handleDeleteAdvisor = (advisor: string, jumlah: number) => {
    setConfirmModal({
      title: 'Hapus semua jadwal advisor ini',
      desc: `Hapus ${jumlah} jadwal ${advisor.toUpperCase()} untuk periode ${bulan}/${tahun}? Jadwal yang tanggalnya sudah lewat tidak ikut dihapus.`,
      action: () => runAction(K.advisor(advisor), async () => void (await deleteRiwayatByAdvisor(advisor, bulan, tahun, cabang))),
    });
  };

  const handleDeleteSelected = () => {
    if (selectedCount === 0) return;
    const ids = [...selectedIds];
    setConfirmModal({
      title: 'Hapus jadwal terpilih',
      desc: `Hapus ${ids.length} jadwal yang dicentang? Tindakan ini tidak bisa dibatalkan.`,
      action: () => runAction(K.bulk, async () => void (await deleteRiwayatBulk(ids))),
    });
  };

  const handleDeleteAll = () => {
    setMenuOpen(false);
    if (totalJadwalFuture === 0) return;
    const skipped = totalJadwal - totalJadwalFuture;
    const skipInfo = skipped > 0 ? ` ${skipped} jadwal yang tanggalnya sudah lewat akan dilewati.` : '';
    const who = petugas ? ` (advisor ${petugas.toUpperCase()})` : '';
    setConfirmModal({
      title: 'Hapus semua jadwal',
      desc: `Hapus ${totalJadwalFuture} jadwal untuk periode ${bulan}/${tahun}${who}?${skipInfo} Semua advisor yang tampil ikut terhapus dan tidak bisa dibatalkan.`,
      action: () => runAction(K.all, async () => void (await deleteRiwayatAll(bulan, tahun, cabang, petugas))),
    });
  };

  /* ----- export ----- */

  const handleExport = async () => {
    const rows: Array<{
      tanggal: string;
      username: string;
      kode_member: string;
      cabang: string;
      tipe_member?: string | null;
      member_pilihan?: boolean;
    }> = [];
    Object.entries(matrix).forEach(([adv, days]) =>
      days.forEach((day) =>
        day.toko.forEach((t) =>
          rows.push({
            tanggal: day.tanggal,
            username: adv,
            kode_member: t.cus_kodemember,
            cabang: t.cus_kodeigr ?? cabang,
            tipe_member: t.tipe_member,
            member_pilihan: !!t.member_pilihan,
          })
        )
      )
    );
    if (rows.length === 0) {
      setError('Tidak ada jadwal aktif untuk di-export.');
      return;
    }
    try {
      downloadBlob(await exportSchedule(rows), `Jadwal_Aktif_RKM_${bulan}_${tahun}.xlsx`);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  /* ----- render ----- */

  const busy = busyKey !== null;
  const advisorFutureCount = futureDays(advisorDays).reduce((a, d) => a + d.toko.length, 0);

  return (
    <div className={`max-w-[1700px] mx-auto flex flex-col ${PAGE_HEIGHT}`}>
      {/* Header */}
      <header className="shrink-0 pb-3 border-b border-[var(--border-strong)] relative">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="mr-auto min-w-[200px]">
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <CalendarCheck2 className="w-5 h-5 text-amber-400" /> Jadwal aktif RKM
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              Cabang <span className="text-[var(--text-secondary)] font-medium">{cabang}</span>
              {hasData && <> · {totalJadwal} jadwal</>}
            </p>
          </div>

          <div className="w-44">
            <label className="block text-xs text-[var(--text-muted)] mb-1">Advisor / MR</label>
            <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-full">
              <option value="">Semua advisor</option>
              {advisorList.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-20">
            <label className="block text-xs text-[var(--text-muted)] mb-1">Bulan</label>
            <Select value={bulan} onChange={(e) => setBulan(e.target.value)} className="w-full">
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-24">
            <label className="block text-xs text-[var(--text-muted)] mb-1">Tahun</label>
            <Select value={tahun} onChange={(e) => setTahun(e.target.value)} className="w-full">
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="primary" onClick={runFetch} disabled={loading}>
              <Search className="w-4 h-4" /> {loading ? 'Memuat...' : 'Muat ulang'}
            </Button>
            <button onClick={reset} className="text-[var(--text-muted)] hover:bg-[var(--wash-2)] p-2.5 rounded-xl" title="Reset filter" aria-label="Reset filter">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {hasData && (
            <div className="flex items-center gap-1.5 relative">
              <Button variant="success" onClick={handleExport}>
                <FileSpreadsheet className="w-4 h-4" /> Export
              </Button>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Aksi lainnya"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="text-[var(--text-muted)] hover:bg-[var(--wash-2)] p-2.5 rounded-xl"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="absolute right-0 top-full mt-1 z-40 w-72 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-overlay)] shadow-xl p-1">
                    <button
                      role="menuitem"
                      onClick={handleDeleteAll}
                      disabled={totalJadwalFuture === 0 || busy}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="w-4 h-4" /> Hapus semua jadwal yang tampil ({totalJadwalFuture})
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {loading && <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-amber-400/70 animate-pulse" />}
      </header>

      {error && (
        <div className="shrink-0 mt-3 flex items-start justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3">
          <p className="text-sm text-rose-400">{error}</p>
          <button onClick={() => setError(null)} aria-label="Tutup pesan" className="text-rose-400/70 hover:text-rose-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tab untuk layar kecil */}
      <div className="xl:hidden shrink-0 flex gap-5 border-b border-[var(--border)] mt-1">
        {([
          ['daftar', 'Daftar', List],
          ['peta', 'Peta', MapIcon],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-amber-400 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)]'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 flex-1 min-h-0 pt-3">
        {/* Panel kiri: advisor -> tanggal -> toko */}
        <div className={`${tab === 'daftar' ? 'flex' : 'hidden'} xl:flex xl:col-span-5 flex-col min-h-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {!hasData ? (
            <div className="py-16">
              <EmptyState icon={Route} text={loading ? 'Memuat jadwal...' : 'Belum ada jadwal aktif untuk filter ini.'} />
            </div>
          ) : !advisorSel ? (
            /* LANGKAH 1: daftar nama advisor */
            <div className="min-h-0 overflow-y-auto">
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">Pilih advisor ({advisors.length})</p>
              <ul>
                {advisors.map((adv) => {
                  const days = matrix[adv];
                  const jumlah = days.reduce((a, d) => a + d.toko.length, 0);
                  const dicentang = days.flatMap((d) => d.toko).filter((t) => checked[tid(t)] === true).length;
                  return (
                    <li key={adv} className="border-b border-[var(--border)]">
                      <button
                        onClick={() => openAdvisor(adv)}
                        className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-[var(--wash-1)] transition-colors"
                      >
                        <span className="w-9 h-9 rounded-full bg-amber-500/15 text-amber-400 grid place-items-center text-sm font-semibold shrink-0">
                          {adv.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--text-primary)] truncate">{adv.toUpperCase()}</span>
                          <span className="block text-xs text-[var(--text-muted)]">
                            {days.length} hari · {jumlah} toko
                            {dicentang > 0 && ` · ${dicentang} dicentang`}
                          </span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            /* LANGKAH 2 & 3: tanggal advisor terpilih, toko muncul di tanggal yang dipilih */
            <div className="min-h-0 flex flex-col">
              <div className="shrink-0 flex items-center gap-2 px-1 py-2 border-b border-[var(--border-strong)]">
                {advisors.length > 1 && (
                  <button
                    onClick={backToAdvisors}
                    className="flex items-center gap-1 pl-1 pr-2 py-1.5 rounded-lg text-sm text-[var(--text-muted)] hover:bg-[var(--wash-2)]"
                  >
                    <ChevronLeft className="w-4 h-4" /> Advisor
                  </button>
                )}
                <div className="min-w-0 mr-auto pl-1">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{advisorSel.toUpperCase()}</h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    {advisorDays.length} hari · {advisorDays.reduce((a, d) => a + d.toko.length, 0)} toko
                  </p>
                </div>
                <IconDelete
                  onClick={() => handleDeleteAdvisor(advisorSel, advisorFutureCount)}
                  disabled={busy || advisorFutureCount === 0}
                  title={advisorFutureCount === 0 ? 'Semua jadwal advisor ini sudah lewat tanggalnya' : 'Hapus semua jadwal advisor ini'}
                />
              </div>

              <div className="min-h-0 overflow-y-auto">
                {advisorDays.map((day) => {
                  const past = isPastDate(day.tanggal);
                  const open = daySel === day.tanggal;
                  const cnt = day.toko.filter((t) => checked[tid(t)] === true).length;
                  const all = !past && day.toko.length > 0 && cnt === day.toko.length;
                  return (
                    <div key={day.tanggal} className={`border-b border-[var(--border)] ${past ? 'opacity-55' : ''}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        onClick={() => setDaySel(day.tanggal)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDaySel(day.tanggal);
                          }
                        }}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none border-l-[3px] hover:bg-[var(--wash-1)] ${
                          open ? 'bg-[var(--wash-1)] border-l-amber-400' : 'border-l-transparent'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--text-primary)]">{fmtDate(day.tanggal)}</p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {day.toko.length} toko{past && ' · sudah lewat'}
                            {cnt > 0 && ` · ${cnt} dicentang`}
                          </p>
                        </div>
                        <Checkbox
                          checked={all}
                          indeterminate={cnt > 0}
                          disabled={past}
                          onChange={(v) => toggleDay(day, v)}
                          title={past ? 'Tanggal sudah lewat' : 'Pilih semua toko di tanggal ini'}
                        />
                        <ChevronRight className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
                      </div>

                      {open && (
                        <ol className="pl-6 pr-3 pb-3 pt-1 border-l-[3px] border-l-amber-400 bg-[var(--wash-1)]">
                          {day.toko.map((t, idx) => (
                            <li key={t.id} className="flex items-start gap-3 py-2 border-b border-[var(--border)] last:border-b-0">
                              <span className="w-6 h-6 rounded-full bg-[var(--wash-3,var(--wash-2))] text-[var(--text-secondary)] grid place-items-center text-xs font-semibold tabular-nums shrink-0 mt-0.5">
                                {idx + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-[var(--text-primary)] leading-snug truncate" title={t.cus_namamember}>
                                  {t.cus_namamember}
                                </p>
                                <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                  <span className="text-xs text-[var(--text-muted)] tabular-nums">{t.cus_kodemember}</span>
                                  {t.status_visit && <span className="text-xs text-[var(--text-faint)]">{t.status_visit}</span>}
                                  <Tags toko={t} />
                                </div>
                              </div>
                              <Checkbox checked={checked[tid(t)] === true} disabled={past} onChange={(v) => toggleOne(tid(t), v)} />
                              <IconDelete
                                onClick={() => handleDeleteItem(t, day.tanggal)}
                                disabled={past || busy}
                                title={past ? 'Tanggal sudah lewat, tidak bisa dihapus' : 'Hapus jadwal ini'}
                              />
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bar hapus terpilih: hanya muncul kalau ada yang dicentang */}
          {selectedCount > 0 && (
            <div className="shrink-0 mt-auto flex items-center gap-3 px-3 py-2.5 border-t border-[var(--border-strong)] bg-[var(--bg-overlay)]">
              <span className="text-sm text-[var(--text-secondary)] mr-auto tabular-nums">{selectedCount} dicentang</span>
              <button onClick={() => setChecked({})} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                Batal pilih
              </button>
              <Button variant="danger" onClick={handleDeleteSelected} disabled={busy}>
                <Trash2 className="w-4 h-4" /> {busyKey === K.bulk ? 'Menghapus...' : `Hapus ${selectedCount}`}
              </Button>
            </div>
          )}
        </div>

        {/* Peta */}
        <div className={`${tab === 'peta' ? 'block' : 'hidden'} xl:block xl:col-span-7 min-h-0 h-full`}>
          <div className="relative h-full min-h-[360px] rounded-2xl overflow-hidden border border-[var(--border-strong)]">
            {preview ? (
              <div className="absolute top-3 left-14 right-3 z-[1000] pointer-events-none">
                <div className="inline-flex max-w-full items-center gap-2 bg-[var(--bg-overlay)] border border-[var(--border-strong)] px-3 py-2 rounded-xl shadow-lg">
                  <Route className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {preview.advisor.toUpperCase()} · {fmtDate(preview.tanggal)}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {routeLoading ? 'menyesuaikan ke jalan...' : routeSnapped ? 'mengikuti jalan' : 'garis lurus (perkiraan)'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
                <p className="text-sm text-[var(--text-muted)] bg-[var(--bg-overlay)] border border-[var(--border-strong)] rounded-xl px-4 py-2 shadow">
                  {advisorSel ? 'Pilih tanggal untuk melihat rute.' : 'Pilih advisor, lalu tanggal, untuk melihat rute.'}
                </p>
              </div>
            )}

            <MapContainer center={[-6.9946, 107.5657]} zoom={11} style={{ height: '100%', width: '100%' }}>
              <MapResizer trigger={tab} />
              <CartoTileLayer />
              {preview && <FitBounds points={previewLine} />}
              {preview?.toko.map((t, idx) =>
                t.lat && t.lng ? (
                  <Marker key={t.id ?? t.cus_kodemember} position={[t.lat, t.lng]} icon={numberedIcon(idx + 1)}>
                    <Popup>
                      <b>Urutan ke-{idx + 1}</b>
                      <hr />
                      <b>Toko:</b> {t.cus_namamember}
                      {t.member_pilihan && (
                        <>
                          <br />
                          <b>Keterangan:</b> Member Pilihan
                        </>
                      )}
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
                    weight: 5,
                    opacity: routeLoading ? 0.45 : 0.9,
                    lineCap: 'round',
                    lineJoin: 'round',
                    ...(routeSnapped ? {} : { dashArray: '1, 8' }),
                  }}
                />
              )}
            </MapContainer>
          </div>
        </div>
      </div>

      {confirmModal && <ConfirmModal state={confirmModal} onClose={() => setConfirmModal(null)} />}
    </div>
  );
}