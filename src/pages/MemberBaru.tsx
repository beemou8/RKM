import { useEffect, useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { UserPlus, FileSpreadsheet, CheckCircle2, XCircle, Clock3, ShoppingBag, Filter, Loader2, Search } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchMember, exportMemberUrl } from '../lib/api';
import type { MemberResponse } from '../types';
import { Card, CardHeader, StatCard, Badge, EmptyState, Input, Select, Button, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

const todayStr = () => new Date().toISOString().slice(0, 10);

const PIE_COLORS = ['#f43f5e', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#a3a3a3'];

export default function MemberBaru() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [tglDari, setTglDari] = useState(todayStr());
  const [tglSampai, setTglSampai] = useState(todayStr());
  const [petugas, setPetugas] = useState('');
  const [data, setData] = useState<MemberResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'berhasil' | 'ditolak' | 'pending'>('berhasil');
  const [loading, setLoading] = useState(true);
  const [appliedTglDari, setAppliedTglDari] = useState(tglDari);
  const [appliedTglSampai, setAppliedTglSampai] = useState(tglSampai);
  const [appliedPetugas, setAppliedPetugas] = useState('');

  const loadData = async (next = { tglDari: appliedTglDari, tglSampai: appliedTglSampai, petugas: appliedPetugas }) => {
    if (next.tglDari > next.tglSampai) {
      setError('Tanggal sampai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMember(next.tglDari, next.tglSampai, next.petugas, cabang);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data member baru.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const today = todayStr();
    setAppliedTglDari(today);
    setAppliedTglSampai(today);
    setAppliedPetugas('');
    loadData({ tglDari: today, tglSampai: today, petugas: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabang]);

  const handleFilter = () => {
    if (tglDari > tglSampai) {
      setError('Tanggal sampai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }
    setAppliedTglDari(tglDari);
    setAppliedTglSampai(tglSampai);
    setAppliedPetugas(petugas);
    loadData({ tglDari, tglSampai, petugas });
  };

  const totalKunjungan = data?.summary.reduce((s, v) => s + v.total_kunjungan, 0) ?? 0;
  const totalJadi = data?.summary.reduce((s, v) => s + v.mau_jadi_member, 0) ?? 0;
  const totalLanjut = data?.summary.reduce((s, v) => s + v.lanjut_belanja, 0) ?? 0;
  const totalTolak = data?.summary.reduce((s, v) => s + v.menolak, 0) ?? 0;

  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const activeList = data ? (tab === 'berhasil' ? data.data_berhasil : tab === 'ditolak' ? data.data_ditolak : data.data_pending) : [];

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeList;
    return activeList.filter((row) =>
      String(row.nama_toko || '').toLowerCase().includes(q) ||
      String(row.kode_member || '').toLowerCase().includes(q) ||
      String(row.username || '').toLowerCase().includes(q) ||
      String(row.tanggal || '').toLowerCase().includes(q) ||
      String(row.kategori_menolak || '').toLowerCase().includes(q) ||
      String(row.alasan_menolak || '').toLowerCase().includes(q)
    );
  }, [activeList, searchQuery]);

  const pagedList = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, page, pageSize]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <Card className="p-5">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-emerald-400" /> Monitoring Member Baru
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Periode {tglDari} s/d {tglSampai}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-48" disabled={loading}>
              <option value="">Semua Advisor</option>
              {(data?.advisors || []).map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </Select>
            <Input type="date" value={tglDari} onChange={(e) => setTglDari(e.target.value)} disabled={loading} />
            <Input type="date" value={tglSampai} min={tglDari} onChange={(e) => setTglSampai(e.target.value)} disabled={loading} />
            <Button variant="primary" onClick={handleFilter} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
              {loading ? 'Memuat...' : 'Filter'}
            </Button>
            <a href={data ? exportMemberUrl(appliedTglDari, appliedTglSampai, appliedPetugas, cabang) : undefined} className={loading ? 'pointer-events-none opacity-50' : ''}>
              <Button variant="success">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export
              </Button>
            </a>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={UserPlus} tone="blue" label="Total Prospek" value={totalKunjungan} />
            <StatCard icon={CheckCircle2} tone="emerald" label="Jadi Member" value={totalJadi} />
            <StatCard icon={ShoppingBag} tone="amber" label="Lanjut Belanja" value={totalLanjut} />
            <StatCard icon={XCircle} tone="rose" label="Menolak" value={totalTolak} />
          </div>

          <Card>
            <CardHeader title="Performance per Advisor" icon={UserPlus} />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="p-3.5 font-semibold">Advisor</th>
                    <th className="p-3.5 font-semibold text-center">Kunjungan</th>
                    <th className="p-3.5 font-semibold text-center">Mau Member</th>
                    <th className="p-3.5 font-semibold text-center">Lanjut Belanja</th>
                    <th className="p-3.5 font-semibold text-center">Menolak</th>
                    <th className="p-3.5 font-semibold text-center">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.summary.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState icon={UserPlus} text="Tidak ada data member baru pada rentang tanggal ini" />
                      </td>
                    </tr>
                  )}
                  {data.summary
                    .sort((a, b) => b.mau_jadi_member - a.mau_jadi_member)
                    .map((v) => {
                      const conv = v.total_kunjungan > 0 ? (v.mau_jadi_member / v.total_kunjungan) * 100 : 0;
                      return (
                        <tr key={v.username} className="hover:bg-[var(--wash-1)] transition-colors text-sm">
                          <td className="p-3.5 font-mono font-semibold text-[var(--text-primary)]">{v.username.toUpperCase()}</td>
                          <td className="p-3.5 text-center text-[var(--text-secondary)]">{v.total_kunjungan}</td>
                          <td className="p-3.5 text-center text-emerald-400 font-semibold">{v.mau_jadi_member}</td>
                          <td className="p-3.5 text-center text-amber-400">{v.lanjut_belanja}</td>
                          <td className="p-3.5 text-center text-rose-400">{v.menolak}</td>
                          <td className="p-3.5 text-center text-[var(--text-muted)]">{conv.toFixed(0)}%</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="flex border-b border-[var(--border)]">
              <DetailTab
                active={tab === 'berhasil'}
                onClick={() => {
                  setTab('berhasil');
                  setPage(1);
                }}
                icon={CheckCircle2}
                label="Jadi Member"
                count={data.data_berhasil.length}
                tone="emerald"
              />
              <DetailTab
                active={tab === 'ditolak'}
                onClick={() => {
                  setTab('ditolak');
                  setPage(1);
                }}
                icon={XCircle}
                label="Menolak"
                count={data.data_ditolak.length}
                tone="rose"
              />
              <DetailTab
                active={tab === 'pending'}
                onClick={() => {
                  setTab('pending');
                  setPage(1);
                }}
                icon={Clock3}
                label="Pending"
                count={data.data_pending.length}
                tone="amber"
              />
            </div>

            {tab === 'ditolak' && data.breakdown_kategori_menolak.length > 0 && (
              <div className="p-5 border-b border-[var(--border)] grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.breakdown_kategori_menolak.map((k) => ({ name: k.kategori, value: k.jumlah }))}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {data.breakdown_kategori_menolak.map((_, i) => (
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
                  <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Breakdown Kategori Menolak
                  </p>
                  {data.breakdown_kategori_menolak.map((k, i) => {
                    const total = data.breakdown_kategori_menolak.reduce((s, x) => s + x.jumlah, 0);
                    const pct = total > 0 ? (k.jumlah / total) * 100 : 0;
                    return (
                      <div key={k.kategori} className="flex items-center gap-2.5 text-sm">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="text-[var(--text-secondary)] truncate flex-1" title={k.kategori}>
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

            <div className="p-3 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Cari toko / member / advisor..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--wash-1)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {searchQuery ? `Ditemukan ${filteredList.length} dari total ${activeList.length} data` : `Total: ${activeList.length} data`}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="p-3.5 font-semibold">Tanggal</th>
                    <th className="p-3.5 font-semibold">Advisor</th>
                    <th className="p-3.5 font-semibold">Nama Toko</th>
                    <th className="p-3.5 font-semibold">Kode Member</th>
                    {tab === 'berhasil' && <th className="p-3.5 font-semibold text-center">Lanjut Belanja</th>}
                    {tab === 'ditolak' && <th className="p-3.5 font-semibold">Kategori Menolak</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-sm">
                  {pagedList.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState icon={UserPlus} text={searchQuery ? 'Tidak ada data yang cocok dengan pencarian' : 'Tidak ada data pada kategori ini'} />
                      </td>
                    </tr>
                  ) : (
                    pagedList.map((row, i) => (
                      <tr key={i} className="hover:bg-[var(--wash-1)] transition-colors">
                        <td className="p-3.5 text-[var(--text-muted)] font-mono text-xs">{row.tanggal}</td>
                        <td className="p-3.5 font-mono font-semibold text-[var(--text-secondary)]">{row.username.toUpperCase()}</td>
                        <td className="p-3.5 text-[var(--text-primary)]">{row.nama_toko}</td>
                        <td className="p-3.5 font-mono text-xs text-[var(--text-muted)]">{row.kode_member || '-'}</td>
                        {tab === 'berhasil' && (
                          <td className="p-3.5 text-center">
                            <Badge tone={row.lanjut_belanja === true || row.lanjut_belanja === 't' ? 'emerald' : 'slate'}>
                              {row.lanjut_belanja === true || row.lanjut_belanja === 't' ? 'Ya' : 'Tidak'}
                            </Badge>
                          </td>
                        )}
                        {tab === 'ditolak' && (
                          <td className="p-3.5">
                            <Badge tone="rose">{row.kategori_menolak || 'Tidak dikategorikan'}</Badge>
                            {row.alasan_menolak && (
                              <p className="text-[10px] text-[var(--text-faint)] mt-1">{row.alasan_menolak}</p>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={page}
              totalItems={filteredList.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function DetailTab({
  active, onClick, icon: Icon, label, count, tone,
}: {
  active: boolean; onClick: () => void; icon: any; label: string; count: number; tone: 'emerald' | 'rose' | 'amber';
}) {
  const toneText = tone === 'emerald' ? 'text-emerald-400' : tone === 'rose' ? 'text-rose-400' : 'text-amber-400';
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3.5 text-xs font-semibold border-b-2 transition-colors ${
        active ? `border-current ${toneText}` : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
      <span className="bg-[var(--wash-3)] px-1.5 py-0.5 rounded text-[10px]">{count}</span>
    </button>
  );
}
