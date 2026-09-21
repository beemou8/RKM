import { useEffect, useMemo, useState } from 'react';
import {
  Footprints,
  ShoppingCart,
  Wallet,
  Percent,
  FileSpreadsheet,
  Filter,
  CheckCircle2,
  XCircle,
  MapPin,
  ExternalLink,
  Loader2,
  Search,
  Eye,
  ImageIcon,
  X,
  MapPinned,
} from 'lucide-react';
import { fetchDashboardSpv, exportDashboardSpvUrl } from '../lib/api';
import type { DashboardSpvResponse } from '../types';
import { Card, CardHeader, StatCard, Badge, EmptyState, Input, Select, Button, Pagination } from './ui';
import { AlasanPieChart } from '../pages/Dashboard';

interface DashboardSpvSubPageProps {
  cabang: string;
  onDashboardModeChange?: (mode: 'reguler' | 'spv') => void;
}

const todayStr = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

function formatWIBTime(iso: string | null | undefined) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function rupiah(v: number) {
  return 'Rp ' + Math.round(v || 0).toLocaleString('id-ID');
}

type FilterOrderStatus = 'semua' | 'berhasil' | 'gagal' | 'foto';

export default function DashboardSpvSubPage({ cabang, onDashboardModeChange }: DashboardSpvSubPageProps) {
  const [tglDari, setTglDari] = useState(todayStr());
  const [tglSampai, setTglSampai] = useState(todayStr());
  const [selectedSpv, setSelectedSpv] = useState('');

  const [appliedTglDari, setAppliedTglDari] = useState(todayStr());
  const [appliedTglSampai, setAppliedTglSampai] = useState(todayStr());
  const [appliedSpv, setAppliedSpv] = useState('');

  const [data, setData] = useState<DashboardSpvResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterOrderStatus>('semua');
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; title: string; subtitle: string } | null>(null);

  const loadData = async (filters = { tglDari: appliedTglDari, tglSampai: appliedTglSampai, spv: appliedSpv }) => {
    if (filters.tglDari > filters.tglSampai) {
      setError('Tanggal sampai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDashboardSpv(filters.tglDari, filters.tglSampai, filters.spv, cabang);
      setData(res);
    } catch (e: any) {
      setError(e.message || 'Gagal memuat data dashboard SPV.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAppliedTglDari(tglDari);
    setAppliedTglSampai(tglSampai);
    setAppliedSpv(selectedSpv);
    loadData({ tglDari, tglSampai, spv: selectedSpv });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabang]);

  const handleFilter = () => {
    if (tglDari > tglSampai) {
      setError('Tanggal sampai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }
    setAppliedTglDari(tglDari);
    setAppliedTglSampai(tglSampai);
    setAppliedSpv(selectedSpv);
    loadData({ tglDari, tglSampai, spv: selectedSpv });
  };

  // Search & Pagination for Berhasil Belanja
  const [searchBerhasil, setSearchBerhasil] = useState('');
  const [pageBerhasil, setPageBerhasil] = useState(1);
  const [pageSizeBerhasil, setPageSizeBerhasil] = useState(25);

  // Search & Pagination for Tidak Berhasil Belanja
  const [searchGagal, setSearchGagal] = useState('');
  const [pageGagal, setPageGagal] = useState(1);
  const [pageSizeGagal, setPageSizeGagal] = useState(25);

  // Pagination for Feed Kunjungan SPV
  const [pageFeed, setPageFeed] = useState(1);
  const [pageSizeFeed, setPageSizeFeed] = useState(25);

  const filteredBerhasil = useMemo(() => {
    if (!data?.data_berhasil) return [];
    const q = searchBerhasil.trim().toLowerCase();
    if (!q) return data.data_berhasil;
    return data.data_berhasil.filter(
      (b) =>
        String(b.kode_member || '').toLowerCase().includes(q) ||
        String(b.nama || '').toLowerCase().includes(q) ||
        String(b.nama_toko || '').toLowerCase().includes(q) ||
        String(b.username || '').toLowerCase().includes(q) ||
        String(b.no_trx || '').toLowerCase().includes(q)
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

  // Filter list kunjungan lokal berdasarkan search query & status pill
  const filteredKunjungan = useMemo(() => {
    if (!data?.kunjungan) return [];
    let list = data.kunjungan;

    if (filterStatus === 'berhasil') {
      list = list.filter((k) => k.berhasil_order);
    } else if (filterStatus === 'gagal') {
      list = list.filter((k) => !k.berhasil_order);
    } else if (filterStatus === 'foto') {
      list = list.filter((k) => !!k.foto_url);
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter(
      (k) =>
        k.nama_toko.toLowerCase().includes(q) ||
        k.kode_member.toLowerCase().includes(q) ||
        k.username.toLowerCase().includes(q) ||
        k.nama_lengkap.toLowerCase().includes(q) ||
        (k.catatan_spv && k.catatan_spv.toLowerCase().includes(q)) ||
        (k.no_trx && k.no_trx.toLowerCase().includes(q))
    );
  }, [data?.kunjungan, filterStatus, searchQuery]);

  const pagedFeed = useMemo(() => {
    const start = (pageFeed - 1) * pageSizeFeed;
    return filteredKunjungan.slice(start, start + pageSizeFeed);
  }, [filteredKunjungan, pageFeed, pageSizeFeed]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      {/* 1. Header & Filter Controls Card */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)]">
              Dashboard Kunjungan Khusus SPV
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Periode{' '}
              {appliedTglDari} s/d {appliedTglSampai}
              {appliedSpv && (
                <>
                  {' '}
                  &middot; SPV:{' '}
                  <span className="text-indigo-400 font-semibold">{appliedSpv.toUpperCase()}</span>
                </>
              )}
            </p>
          </div>

          {/* Pilihan Dashboard Selector */}
          {onDashboardModeChange && (
            <div className="flex border border-[var(--border)] bg-[var(--wash-1)] rounded-xl p-1 gap-1 self-start sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => onDashboardModeChange('reguler')}
                className="py-1.5 px-3.5 text-xs font-bold rounded-lg transition-all text-center cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--wash-2)] border border-transparent"
              >
                Dashboard Reguler (Advisor / MR)
              </button>
              <button
                type="button"
                onClick={() => onDashboardModeChange('spv')}
                className="py-1.5 px-3.5 text-xs font-bold rounded-lg transition-all text-center cursor-pointer bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-sm"
              >
                Dashboard Khusus SPV
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-2 items-center">
          <Select
            value={selectedSpv}
            onChange={(e) => setSelectedSpv(e.target.value)}
            className="w-48"
            disabled={loading}
          >
            <option value="">Semua SPV</option>
            {(data?.spv_list || []).map((u) => (
              <option key={u.username} value={u.username}>
                {u.username.toUpperCase()} — {u.nama_lengkap}
              </option>
            ))}
          </Select>

          <Input
            type="date"
            value={tglDari}
            onChange={(e) => setTglDari(e.target.value)}
            disabled={loading}
          />
          <Input
            type="date"
            value={tglSampai}
            min={tglDari}
            onChange={(e) => setTglSampai(e.target.value)}
            disabled={loading}
          />

          <Button variant="primary" onClick={handleFilter} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
            {loading ? 'Memuat...' : 'Filter'}
          </Button>

          <a
            href={data ? exportDashboardSpvUrl(appliedTglDari, appliedTglSampai, appliedSpv, cabang) : undefined}
            className={loading ? 'pointer-events-none opacity-50' : ''}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="success">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Data SPV
            </Button>
          </a>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}

      {loading && !data && (
        <Card className="p-5 border-blue-500/20 bg-blue-500/5">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Sedang memuat data...</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Mengambil data kunjungan SPV dari Supabase...</p>
            </div>
          </div>
        </Card>
      )}

      {data && (
        <>
          {/* 2. StatCards Grid: Kunjungan, Transaksi Berhasil, Total RPH, Effective Call */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Footprints}
              tone="blue"
              label="Kunjungan SPV"
              value={data.totals.kunjungan.toLocaleString('id-ID')}
            />
            <StatCard
              icon={ShoppingCart}
              tone="emerald"
              label="Transaksi Berhasil"
              value={data.totals.belanja.toLocaleString('id-ID')}
            />
            <StatCard
              icon={Wallet}
              tone="amber"
              label="Total RPH"
              value={data.totals.rph > 0 ? `Rp ${(data.totals.rph / 1_000_000).toFixed(1)}Jt` : 'Rp 0'}
              sub={!data.db_lokal_connected ? 'DB lokal offline — nilai bisa 0' : undefined}
            />
            <StatCard
              icon={Percent}
              tone="slate"
              label="Effective Call"
              value={`${data.totals.avg_strike.toFixed(1)}%`}
            />
          </div>

          {/* 3. Performance per SPV Table (sama persis seperti Performance per Advisor di dashboard reguler) */}
          <Card>
            <CardHeader
              title="Performance per SPV"
              icon={Filter}
              right={<span className="text-xs text-[var(--text-muted)]">{data.summary.length} SPV</span>}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="p-3.5 font-semibold">SPV</th>
                    <th className="p-3.5 font-semibold text-center">Kunjungan</th>
                    <th className="p-3.5 font-semibold text-center">Belanja</th>
                    <th className="p-3.5 font-semibold text-right">Total RPH</th>
                    <th className="p-3.5 font-semibold text-center">Effective Call</th>
                    <th className="p-3.5 font-semibold text-center">Performa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.summary.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          icon={Footprints}
                          text="Tidak ada data kunjungan SPV pada periode tanggal ini"
                        />
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
                              <div className="font-semibold text-[var(--text-primary)] text-sm">
                                {v.username.toUpperCase()}
                              </div>
                              <div className="text-[11px] text-[var(--text-faint)]">{v.nama_lengkap}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5 text-center text-[var(--text-secondary)]">{v.kunjungan}</td>
                        <td className="p-3.5 text-center font-semibold text-emerald-400">{v.belanja}</td>
                        <td className="p-3.5 text-right font-mono text-[var(--text-secondary)]">
                          {rupiah(v.rph)}
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 h-1.5 bg-[var(--wash-3)] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-blue-500 to-amber-500 rounded-full"
                                style={{ width: `${Math.min(persen, 100)}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-semibold text-[var(--text-muted)] w-9">
                              {persen.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="p-3.5 text-center">
                          <Badge tone={perf.tone}>{perf.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 4. Evaluasi Kenapa Toko Tidak Order (Pie Chart) */}
          <div className="grid grid-cols-1 gap-5">
            <AlasanPieChart
              title="Evaluasi: Kenapa Toko Tidak Order (SPV)"
              icon={MapPinned}
              tone="rose"
              data={data.breakdown_kategori_tidak_order}
              emptyText="Tidak ada kunjungan gagal order pada periode ini"
            />
          </div>

          {/* 5. Dua Card Bersebelahan: Berhasil Belanja (dengan Rupiah) vs Tidak Berhasil Belanja */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Card Berhasil Belanja */}
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
                    placeholder="Cari member / toko / SPV / no trx..."
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
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-blue-400 font-semibold text-xs">{b.kode_member}</span>
                          <span className="text-[10px] text-[var(--text-faint)]">SPV: {b.username.toUpperCase()}</span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)] truncate max-w-[220px]">
                          {b.nama || b.nama_toko}
                        </div>
                        {b.no_trx && (
                          <div className="text-[10px] text-[var(--text-faint)] font-mono">
                            PB: {b.no_trx}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-emerald-400 text-sm">
                      {rupiah(b.rp)}
                    </span>
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

            {/* Card Tidak Berhasil Belanja */}
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
                    placeholder="Cari member / toko / SPV / alasan..."
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
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-[var(--text-secondary)]">{g.kode_member}</span>
                          <span className="text-[10px] text-[var(--text-faint)]">SPV: {g.username.toUpperCase()}</span>
                        </div>
                        <div className="text-xs text-[var(--text-faint)] truncate max-w-[180px]">
                          {g.nama_toko}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] text-rose-300/80 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20 shrink-0">
                      {g.alasan_tidak_order || g.kategori_tidak_order || 'Tidak ada alasan'}
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
          </div>

          {/* 6. Feed Rincian Kunjungan SPV (Lengkap dengan Foto & Radius) */}
          <Card>
            <CardHeader
              title="Feed Kunjungan Khusus SPV"
              icon={Footprints}
              right={<Badge tone="slate">{filteredKunjungan.length} Kunjungan</Badge>}
            />
            <div className="p-4 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Quick Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('semua');
                    setPageFeed(1);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                    filterStatus === 'semua'
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--wash-1)]'
                  }`}
                >
                  Semua ({data.kunjungan.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('berhasil');
                    setPageFeed(1);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                    filterStatus === 'berhasil'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--wash-1)]'
                  }`}
                >
                  Berhasil Order ({data.totals.belanja})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('gagal');
                    setPageFeed(1);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                    filterStatus === 'gagal'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--wash-1)]'
                  }`}
                >
                  Tidak Order ({data.totals.gagal})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('foto');
                    setPageFeed(1);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                    filterStatus === 'foto'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--wash-1)]'
                  }`}
                >
                  Ada Foto ({data.kunjungan.filter((k) => !!k.foto_url).length})
                </button>
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Cari toko / kode / catatan..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPageFeed(1);
                  }}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--wash-1)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {filteredKunjungan.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Footprints}
                  text="Tidak ada data kunjungan SPV yang cocok dengan filter ini."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="p-3.5 font-semibold">Waktu</th>
                      <th className="p-3.5 font-semibold">SPV</th>
                      <th className="p-3.5 font-semibold">Toko & Member</th>
                      <th className="p-3.5 font-semibold">Status Order</th>
                      <th className="p-3.5 font-semibold text-right">RPH</th>
                      <th className="p-3.5 font-semibold">Catatan SPV</th>
                      <th className="p-3.5 font-semibold">Radius & GPS</th>
                      <th className="p-3.5 font-semibold text-center">Foto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {pagedFeed.map((item) => (
                      <tr key={item.id} className="hover:bg-[var(--wash-1)] transition-colors align-top">
                        {/* Waktu */}
                        <td className="p-3.5 whitespace-nowrap text-[var(--text-secondary)] font-mono text-[11px]">
                          {formatWIBTime(item.tanggal || item.created_at)}
                        </td>

                        {/* SPV */}
                        <td className="p-3.5 whitespace-nowrap">
                          <div className="font-bold text-[var(--text-primary)]">
                            {item.username.toUpperCase()}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)]">{item.nama_lengkap}</div>
                        </td>

                        {/* Toko & Member */}
                        <td className="p-3.5 min-w-[200px]">
                          <div className="font-semibold text-[var(--text-primary)] leading-snug">
                            {item.nama_toko}
                          </div>
                          <div className="font-mono text-[11px] text-blue-400 mt-0.5">
                            {item.kode_member}
                          </div>
                        </td>

                        {/* Status Order */}
                        <td className="p-3.5 min-w-[180px]">
                          {item.berhasil_order ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3" /> Berhasil Order
                              </span>
                              {item.no_trx && (
                                <div className="text-[11px] text-[var(--text-muted)] font-mono">
                                  PB/Trx: <span className="text-[var(--text-secondary)] font-semibold">{item.no_trx}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                                <XCircle className="w-3 h-3" /> Tidak Order
                              </span>
                              {item.kategori_tidak_order && (
                                <div className="text-[11px] font-semibold text-rose-300">
                                  {item.kategori_tidak_order}
                                </div>
                              )}
                              {item.alasan_tidak_order && (
                                <div className="text-[10.5px] text-[var(--text-muted)] leading-tight">
                                  {item.alasan_tidak_order}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* RPH */}
                        <td className="p-3.5 text-right font-mono font-semibold text-emerald-400 whitespace-nowrap">
                          {item.rp && item.rp > 0 ? rupiah(item.rp) : '-'}
                        </td>

                        {/* Catatan SPV */}
                        <td className="p-3.5 min-w-[200px]">
                          {item.catatan_spv ? (
                            <div className="text-[11px] text-[var(--text-secondary)] bg-[var(--wash-1)] p-2 rounded-lg border border-[var(--border)] leading-relaxed italic">
                              "{item.catatan_spv}"
                            </div>
                          ) : (
                            <span className="text-[11px] text-[var(--text-muted)] italic">-</span>
                          )}
                        </td>

                        {/* Radius & GPS */}
                        <td className="p-3.5 whitespace-nowrap">
                          <div className="space-y-1">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10.5px] font-semibold border ${
                                item.is_in_radius
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              }`}
                            >
                              {item.is_in_radius ? 'Dalam Radius' : 'Di Luar Radius'}
                            </span>
                            {item.latitude && item.longitude ? (
                              <div>
                                <a
                                  href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[10.5px] text-blue-400 hover:underline"
                                  title="Lihat koordinat di Google Maps"
                                >
                                  <MapPin className="w-3 h-3" /> Maps
                                </a>
                              </div>
                            ) : null}
                          </div>
                        </td>

                        {/* Foto Kunjungan */}
                        <td className="p-3.5 text-center whitespace-nowrap">
                          {item.foto_url ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewPhoto({
                                  url: item.foto_url!,
                                  title: item.nama_toko,
                                  subtitle: `SPV: ${item.username.toUpperCase()} • ${formatWIBTime(
                                    item.tanggal || item.created_at
                                  )}`,
                                })
                              }
                              className="group relative w-12 h-12 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--wash-1)] inline-block cursor-pointer hover:ring-2 hover:ring-indigo-500 transition-all"
                              title="Klik untuk perbesar foto"
                            >
                              <img
                                src={item.foto_url}
                                alt={item.nama_toko}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                                <Eye className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </button>
                          ) : (
                            <span className="text-[10px] text-[var(--text-muted)] bg-[var(--wash-1)] px-2 py-1 rounded border border-[var(--border)] inline-flex items-center gap-1">
                              <ImageIcon className="w-2.5 h-2.5" /> Tidak ada
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              currentPage={pageFeed}
              totalItems={filteredKunjungan.length}
              pageSize={pageSizeFeed}
              onPageChange={setPageFeed}
              onPageSizeChange={setPageSizeFeed}
            />
          </Card>
        </>
      )}

      {/* Modal Preview Foto Resolusi Penuh */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="border border-[var(--border)] bg-[var(--surface-card)] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  {previewPhoto.title}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {previewPhoto.subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-black/30 flex items-center justify-center min-h-[300px] max-h-[70vh] overflow-auto">
              <img
                src={previewPhoto.url}
                alt={previewPhoto.title}
                className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md"
              />
            </div>

            <div className="p-3 border-t border-[var(--border)] flex justify-between items-center text-xs">
              <span className="text-[var(--text-muted)] text-[11px]">
                Bucket: Supabase Storage / RKM SPV
              </span>
              <a
                href={previewPhoto.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Buka Foto di Tab Baru
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
