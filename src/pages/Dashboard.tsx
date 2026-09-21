import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Footprints, ShoppingCart, Wallet, Percent, FileSpreadsheet, CalendarRange, Filter, CheckCircle2, XCircle, X, Loader2,
  PieChart as PieChartIcon, MapPinned, UserPlus, Star, Moon, UserRoundX, Users, Search,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchDashboard, fetchDashboardByCall, exportDashboardUrl, exportDashboardByCallUrl, exportBulananUrl } from '../lib/api';
import type { DashboardMemberFilter } from '../lib/api';
import type { DashboardResponse, KategoriCount } from '../types';
import { Card, CardHeader, StatCard, Badge, EmptyState, Input, Select, Button, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';
import DashboardSpvSubPage from '../components/DashboardSpvSubPage';

const PIE_COLORS = ['#f43f5e', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#a3a3a3'];

const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const MEMBER_FILTERS: Array<{ value: DashboardMemberFilter; label: string; icon: any }> = [
  { value: 'semua', label: 'Semua Member', icon: Users },
  { value: 'member_pilihan', label: 'Member Pilihan', icon: Star },
  { value: 'sleeper', label: 'Member Sleeper', icon: Moon },
  { value: 'belum_aktivasi', label: 'Belum Aktivasi', icon: UserRoundX },
];

export type DashboardMode = 'rkm' | 'by_call';

export function PerformanceDashboard({
  mode = 'rkm',
  onDashboardModeChange,
}: {
  mode?: DashboardMode;
  onDashboardModeChange?: (mode: 'reguler' | 'spv') => void;
}) {
  const { cabang } = useOutletContext<LayoutContext>();
  const isByCall = mode === 'by_call';
  const sourceLabel = isByCall ? 'BY CALL' : 'RKM';
  const [tglDari, setTglDari] = useState(todayStr());
  const [tglSampai, setTglSampai] = useState(todayStr());
  const [petugas, setPetugas] = useState('');
  const [memberFilter, setMemberFilter] = useState<DashboardMemberFilter>('semua');
  const [appliedTglDari, setAppliedTglDari] = useState(todayStr());
  const [appliedTglSampai, setAppliedTglSampai] = useState(todayStr());
  const [appliedPetugas, setAppliedPetugas] = useState('');
  const [appliedMemberFilter, setAppliedMemberFilter] = useState<DashboardMemberFilter>('semua');
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBulanan, setShowBulanan] = useState(false);

  // Search & Pagination for Berhasil Belanja
  const [searchBerhasil, setSearchBerhasil] = useState('');
  const [pageBerhasil, setPageBerhasil] = useState(1);
  const [pageSizeBerhasil, setPageSizeBerhasil] = useState(25);

  // Search & Pagination for Tidak Berhasil Belanja
  const [searchGagal, setSearchGagal] = useState('');
  const [pageGagal, setPageGagal] = useState(1);
  const [pageSizeGagal, setPageSizeGagal] = useState(25);

  const loadDashboard = async (filters = {
    tglDari: appliedTglDari,
    tglSampai: appliedTglSampai,
    petugas: appliedPetugas,
    memberFilter: appliedMemberFilter,
  }) => {
    if (filters.tglDari > filters.tglSampai) {
      setError('Tanggal sampai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }
    setLoading(true);
    setError(null);
    const loader = isByCall ? fetchDashboardByCall : fetchDashboard;
    try {
      const result = await loader(filters.tglDari, filters.tglSampai, filters.petugas, cabang, filters.memberFilter);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAppliedTglDari(tglDari);
    setAppliedTglSampai(tglSampai);
    setAppliedPetugas(petugas);
    setAppliedMemberFilter(memberFilter);
    loadDashboard({ tglDari, tglSampai, petugas, memberFilter });
    // Cabang / mode adalah konteks halaman, jadi perubahan keduanya memang langsung reload.
    // Filter lainnya hanya dijalankan setelah tombol Filter ditekan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabang, isByCall]);

  const handleFilter = () => {
    if (tglDari > tglSampai) {
      setError('Tanggal sampai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }
    setAppliedTglDari(tglDari);
    setAppliedTglSampai(tglSampai);
    setAppliedPetugas(petugas);
    setAppliedMemberFilter(memberFilter);
    loadDashboard({ tglDari, tglSampai, petugas, memberFilter });
  };

  const rupiah = (v: number) => 'Rp ' + Math.round(v || 0).toLocaleString('id-ID');

  const filteredBerhasil = useMemo(() => {
    if (!data?.data_berhasil) return [];
    const q = searchBerhasil.trim().toLowerCase();
    if (!q) return data.data_berhasil;
    return data.data_berhasil.filter(
      (b) =>
        String(b.kode_member || '').toLowerCase().includes(q) ||
        String(b.nama || '').toLowerCase().includes(q) ||
        String(b.nama_toko || '').toLowerCase().includes(q) ||
        String(b.username || '').toLowerCase().includes(q)
    );
  }, [data?.data_berhasil, searchBerhasil]);

  const pagedBerhasil = useMemo(() => {
    const start = (pageBerhasil - 1) * pageSizeBerhasil;
    return filteredBerhasil.slice(start, start + pageSizeBerhasil);
  }, [filteredBerhasil, pageBerhasil, pageSizeBerhasil]);

  const filteredGagal = useMemo(() => {
    if (!data?.data_gagal) return [];
    const q = searchGagal.trim().toLowerCase();
    if (!q) return data.data_gagal;
    return data.data_gagal.filter(
      (g) =>
        String(g.kode_member || '').toLowerCase().includes(q) ||
        String(g.nama_toko || '').toLowerCase().includes(q) ||
        String(g.alasan_tidak_order || '').toLowerCase().includes(q) ||
        String(g.kategori_tidak_order || '').toLowerCase().includes(q) ||
        String(g.username || '').toLowerCase().includes(q)
    );
  }, [data?.data_gagal, searchGagal]);

  const pagedGagal = useMemo(() => {
    const start = (pageGagal - 1) * pageSizeGagal;
    return filteredGagal.slice(start, start + pageSizeGagal);
  }, [filteredGagal, pageGagal, pageSizeGagal]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)]">{isByCall ? 'Dashboard By Call' : 'Dashboard Performa'}</h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Periode{' '}
              {data ? `${data.tgl_dari || tglDari} s/d ${data.tgl_sampai || tglSampai}` : `${tglDari} s/d ${tglSampai}`}
              {data && <> &middot; <span className="font-semibold text-blue-400">{MEMBER_FILTERS.find((f) => f.value === appliedMemberFilter)?.label}</span></>}
            </p>
          </div>

          {/* Pilihan Dashboard Selector */}
          {!isByCall && onDashboardModeChange && (
            <div className="flex border border-[var(--border)] bg-[var(--wash-1)] rounded-xl p-1 gap-1 self-start sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => onDashboardModeChange('reguler')}
                className="py-1.5 px-3.5 text-xs font-bold rounded-lg transition-all text-center cursor-pointer bg-amber-400/15 text-amber-400 border border-amber-400/30 shadow-sm"
              >
                Dashboard Reguler (Advisor / MR)
              </button>
              <button
                type="button"
                onClick={() => onDashboardModeChange('spv')}
                className="py-1.5 px-3.5 text-xs font-bold rounded-lg transition-all text-center cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--wash-2)] border border-transparent"
              >
                Dashboard Khusus SPV
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-2 items-center">
          <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-48" disabled={loading}>
            <option value="">Semua Advisor</option>
            {(data?.advisor_list || []).map((u) => (
              <option key={u.username} value={u.username}>
                {u.username.toUpperCase()} — {u.nama_lengkap}
              </option>
            ))}
          </Select>
          <Input type="date" value={tglDari} onChange={(e) => setTglDari(e.target.value)} disabled={loading} />
          <Input type="date" value={tglSampai} min={tglDari} onChange={(e) => setTglSampai(e.target.value)} disabled={loading} />
          <Button variant="primary" onClick={handleFilter} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
            {loading ? 'Memuat...' : 'Filter'}
          </Button>
          <a href={data ? (isByCall ? exportDashboardByCallUrl(appliedTglDari, appliedTglSampai, appliedPetugas, cabang, appliedMemberFilter) : exportDashboardUrl(appliedTglDari, appliedTglSampai, appliedPetugas, cabang, appliedMemberFilter)) : undefined} className={loading ? 'pointer-events-none opacity-50' : ''}>
            <Button variant="success">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Harian
            </Button>
          </a>
          <Button variant="ghost" onClick={() => setShowBulanan(true)}>
            <CalendarRange className="w-3.5 h-3.5" /> Export Bulanan
          </Button>
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="shrink-0 px-2">
            <p className="text-xs font-semibold text-[var(--text-primary)]">Filter Tipe Member</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-1">
            {MEMBER_FILTERS.map((item) => {
              const Icon = item.icon;
              const active = memberFilter === item.value;
              const count = data?.member_filter_counts?.[item.value] ?? 0;
              return (
                <button
                  key={item.value}
                  onClick={() => setMemberFilter(item.value)} disabled={loading}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                      : 'bg-[var(--wash-1)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-blue-500/15' : 'bg-[var(--wash-2)]'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}

      {data && (
        <>
          {isByCall ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard icon={ShoppingCart} tone="emerald" label="Member Belanja" value={data.totals.belanja.toLocaleString('id-ID')} />
              <StatCard icon={Wallet} tone="amber" label="Total RPH" value={`Rp ${(data.totals.rph / 1_000_000).toFixed(1)}Jt`} sub={!data.db_lokal_connected ? 'DB lokal offline — nilai bisa 0' : undefined} />
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Footprints} tone="blue" label="Kunjungan" value={data.totals.kunjungan.toLocaleString('id-ID')} />
              <StatCard icon={ShoppingCart} tone="emerald" label="Transaksi Berhasil" value={data.totals.belanja.toLocaleString('id-ID')} />
              <StatCard icon={Wallet} tone="amber" label="Total RPH" value={`Rp ${(data.totals.rph / 1_000_000).toFixed(1)}Jt`} sub={!data.db_lokal_connected ? 'DB lokal offline — nilai bisa 0' : undefined} />
              <StatCard icon={Percent} tone="slate" label="Effective Call" value={`${data.totals.avg_strike.toFixed(1)}%`} />
            </div>
          )}

          <Card>
            <CardHeader
              title={isByCall ? 'Belanja per Advisor' : 'Performance per Advisor'}
              icon={Filter}
              right={<span className="text-xs text-[var(--text-muted)]">{data.summary.length} advisor</span>}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="p-3.5 font-semibold">Advisor</th>
                    {!isByCall && <th className="p-3.5 font-semibold text-center">Kunjungan</th>}
                    <th className="p-3.5 font-semibold text-center">{isByCall ? 'Member Belanja' : 'Belanja'}</th>
                    <th className="p-3.5 font-semibold text-right">Total RPH</th>
                    {!isByCall && <th className="p-3.5 font-semibold text-center">Effective Call</th>}
                    {!isByCall && <th className="p-3.5 font-semibold text-center">Performa</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.summary.length === 0 && (
                    <tr>
                      <td colSpan={isByCall ? 3 : 6}>
                        <EmptyState icon={Footprints} text={isByCall ? 'Tidak ada member belanja pada tanggal ini' : 'Tidak ada data kunjungan pada tanggal ini'} />
                      </td>
                    </tr>
                  )}
                  {data.summary.map((v, i) => {
                    const persen = v.kunjungan > 0 ? (v.belanja / v.kunjungan) * 100 : 0;
                    const perf =
                      persen >= 90
                        ? { tone: 'emerald' as const, label: 'Excellent' }
                        : persen >= 60
                        ? { tone: 'blue' as const, label: 'Good' }
                        : persen >= 40
                        ? { tone: 'amber' as const, label: 'Average' }
                        : { tone: 'rose' as const, label: 'Perlu Perbaikan' };
                    return (
                      <tr key={v.username} className="hover:bg-[var(--wash-1)] transition-colors text-sm">
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-[var(--wash-2)] flex items-center justify-center text-[11px] font-bold text-[var(--text-muted)]">
                              {i + 1}
                            </div>
                            <div>
                              <div className="font-semibold text-[var(--text-primary)] text-sm">{v.username.toUpperCase()}</div>
                              <div className="text-[11px] text-[var(--text-faint)]">{v.nama_lengkap}</div>
                            </div>
                          </div>
                        </td>
                        {!isByCall && <td className="p-3.5 text-center text-[var(--text-secondary)]">{v.kunjungan}</td>}
                        <td className="p-3.5 text-center font-semibold text-emerald-400">{v.belanja}</td>
                        <td className="p-3.5 text-right font-mono text-[var(--text-secondary)]">{rupiah(v.rph)}</td>
                        {!isByCall && (
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-16 h-1.5 bg-[var(--wash-3)] rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-blue-500 to-amber-500 rounded-full" style={{ width: `${Math.min(persen, 100)}%` }} />
                              </div>
                              <span className="text-[11px] font-semibold text-[var(--text-muted)] w-9">{persen.toFixed(1)}%</span>
                            </div>
                          </td>
                        )}
                        {!isByCall && (
                          <td className="p-3.5 text-center">
                            <Badge tone={perf.tone}>{perf.label}</Badge>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {!isByCall && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <AlasanPieChart
                title={`Evaluasi: Kenapa Toko Tidak Order (${sourceLabel})`}
                icon={MapPinned}
                tone="rose"
                data={data.breakdown_kategori_tidak_order}
                emptyText="Tidak ada kunjungan gagal order pada periode ini"
              />
              <AlasanPieChart
                title="Evaluasi: Kenapa Menolak Jadi Member"
                icon={UserPlus}
                tone="amber"
                data={data.breakdown_kategori_menolak}
                emptyText="Tidak ada penolakan member baru pada periode ini"
              />
            </div>
          )}

          <div className={`grid grid-cols-1 ${isByCall ? '' : 'lg:grid-cols-2'} gap-5`}>
            <Card>
              <CardHeader
                title="Berhasil Belanja"
                icon={CheckCircle2}
                right={<Badge tone="emerald">{data.data_berhasil.length} Member</Badge>}
              />
              <div className="p-3 border-b border-[var(--border)]">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Cari member / toko / advisor..."
                    value={searchBerhasil}
                    onChange={(e) => {
                      setSearchBerhasil(e.target.value);
                      setPageBerhasil(1);
                    }}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--wash-1)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y divide-[var(--border)]">
                {pagedBerhasil.length === 0 && (
                  <EmptyState
                    icon={CheckCircle2}
                    text={searchBerhasil ? 'Tidak ada member yang cocok' : 'Belum ada transaksi berhasil'}
                  />
                )}
                {pagedBerhasil.map((b, i) => (
                  <div key={i} className="flex items-center justify-between p-3.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <ShoppingCart className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-blue-400 font-semibold text-xs">{b.kode_member}</div>
                        <div className="text-xs text-[var(--text-muted)] truncate max-w-[220px]">{b.nama}</div>
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-emerald-400 text-sm">{rupiah(b.rp)}</span>
                  </div>
                ))}
              </div>
              <Pagination
                currentPage={pageBerhasil}
                totalItems={filteredBerhasil.length}
                pageSize={pageSizeBerhasil}
                onPageChange={setPageBerhasil}
                onPageSizeChange={setPageSizeBerhasil}
              />
            </Card>

            {!isByCall && (
              <Card>
                <CardHeader
                  title="Tidak Berhasil Belanja"
                  icon={XCircle}
                  right={<Badge tone="rose">{data.data_gagal.length} Member</Badge>}
                />
                <div className="p-3 border-b border-[var(--border)]">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      placeholder="Cari member / toko / alasan..."
                      value={searchGagal}
                      onChange={(e) => {
                        setSearchGagal(e.target.value);
                        setPageGagal(1);
                      }}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--wash-1)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
                <div className="max-h-[400px] overflow-y-auto divide-y divide-[var(--border)]">
                  {pagedGagal.length === 0 && (
                    <EmptyState
                      icon={XCircle}
                      text={searchGagal ? 'Tidak ada kunjungan yang cocok' : 'Tidak ada kunjungan gagal'}
                    />
                  )}
                  {pagedGagal.map((g, i) => (
                    <div key={i} className="flex items-center justify-between p-3.5 gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded bg-rose-500/10 flex items-center justify-center shrink-0">
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-[var(--text-secondary)]">{g.kode_member}</div>
                          <div className="text-xs text-[var(--text-faint)] truncate max-w-[180px]">{g.nama_toko}</div>
                        </div>
                      </div>
                      <span className="text-[11px] text-rose-300/80 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20 shrink-0">
                        {g.alasan_tidak_order || 'Tidak ada alasan'}
                      </span>
                    </div>
                  ))}
                </div>
                <Pagination
                  currentPage={pageGagal}
                  totalItems={filteredGagal.length}
                  pageSize={pageSizeGagal}
                  onPageChange={setPageGagal}
                  onPageSizeChange={setPageSizeGagal}
                />
              </Card>
            )}
          </div>
        </>
      )}

      {loading && (
        <Card className="p-5 border-blue-500/20 bg-blue-500/5">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Sedang memuat data...</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Mengambil data melalui relay server. Mohon tunggu.</p>
            </div>
          </div>
        </Card>
      )}

      {showBulanan && data && (
        <ExportBulananModal advisorList={data.advisor_list} cabang={cabang} source={mode} onClose={() => setShowBulanan(false)} />
      )}
    </div>
  );
}

export default function Dashboard() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [dashboardMode, setDashboardMode] = useState<'reguler' | 'spv'>('reguler');

  return dashboardMode === 'spv' ? (
    <DashboardSpvSubPage cabang={cabang} onDashboardModeChange={setDashboardMode} />
  ) : (
    <PerformanceDashboard mode="rkm" onDashboardModeChange={setDashboardMode} />
  );
}

export function AlasanPieChart({
  title,
  icon,
  tone,
  data,
  emptyText,
}: {
  title: string;
  icon: any;
  tone: 'rose' | 'amber';
  data: KategoriCount[];
  emptyText: string;
}) {
  const total = data.reduce((s, k) => s + k.jumlah, 0);
  // Pie dibatasi 7 kategori teratas biar tetap terbaca; sisanya digabung "Lainnya".
  const top = data.slice(0, 7);
  const sisa = data.slice(7).reduce((s, k) => s + k.jumlah, 0);
  const chartData = sisa > 0 ? [...top, { kategori: 'Lainnya', jumlah: sisa }] : top;

  return (
    <Card>
      <CardHeader
        title={title}
        icon={icon}
        right={<Badge tone={tone}>{total} kejadian</Badge>}
      />
      {chartData.length === 0 ? (
        <EmptyState icon={PieChartIcon} text={emptyText} />
      ) : (
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData.map((k) => ({ name: k.kategori, value: k.jumlah }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="var(--bg-card)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12 }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  labelStyle={{ color: 'var(--text-muted)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {chartData.map((k, i) => {
              const pct = total > 0 ? (k.jumlah / total) * 100 : 0;
              return (
                <div key={k.kategori} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="text-[var(--text-secondary)] truncate flex-1">
                    {k.kategori}
                  </span>
                  <span className="text-[var(--text-primary)] font-semibold">{k.jumlah}</span>
                  <span className="text-[var(--text-faint)] text-xs w-10 text-right">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function ExportBulananModal({
  advisorList,
  cabang,
  source,
  onClose,
}: {
  advisorList: Array<{ username: string; nama_lengkap: string; user_type?: string }>;
  cabang: string;
  source: DashboardMode;
  onClose: () => void;
}) {
  const now = new Date();
  const [bulan, setBulan] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [tahun, setTahun] = useState(String(now.getFullYear()));

  // Murni hanya auto-filter yang user_type nya RKM atau GET
  const targetAdvisors = useMemo(() => {
    return advisorList.filter((u) => {
      const type = u.user_type?.toUpperCase();
      return source === 'by_call' ? type === 'RKM' : (type === 'RKM' || type === 'GET');
    });
  }, [advisorList, source]);

  // Ekstrak username jadi array string secara otomatis
  const selected = targetAdvisors.map((u) => u.username);

  const months = useMemo(
    () => [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
    ],
    []
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-amber-400" /> Export Laporan Bulanan
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Bulan</label>
            <Select value={bulan} onChange={(e) => setBulan(e.target.value)} className="w-full">
              {months.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, '0')}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Tahun</label>
            <Select value={tahun} onChange={(e) => setTahun(e.target.value)} className="w-full">
              {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Batal
          </Button>
          <a
            className={`flex-1 ${selected.length === 0 ? 'pointer-events-none opacity-50' : ''}`}
            href={selected.length > 0 ? exportBulananUrl(bulan, tahun, selected, cabang, source) : undefined}
            onClick={(e) => {
              if (selected.length === 0) {
                e.preventDefault();
                alert('Tidak ada advisor bertipe RKM/GET yang bisa diekspor!');
              } else {
                onClose();
              }
            }}
          >
            <Button variant="primary" className="w-full" disabled={selected.length === 0}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> Download
            </Button>
          </a>
        </div>
      </Card>
    </div>
  );
}