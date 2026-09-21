import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CheckCircle2, FileSpreadsheet, Footprints, PhoneCall, Search, Users, XCircle } from 'lucide-react';
import { fetchMemberStatus, exportMemberStatusUrl } from '../lib/api';
import type { MemberStatusResponse } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Select, StatCard, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

type Source = 'rkm' | 'by_call';
type Tab = 'sudah' | 'belum';

export default function StatusKunjunganMember() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [source, setSource] = useState<Source>('rkm');
  const [petugas, setPetugas] = useState('');
  const [tab, setTab] = useState<Tab>('belum');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<MemberStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = (nextSource = source, nextPetugas = petugas) => {
    setLoading(true);
    setError(null);
    fetchMemberStatus(cabang, nextSource, nextPetugas)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setPetugas('');
    setSearch('');
    setPage(1);
    setTab('belum');
    load(source, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabang, source]);

  useEffect(() => {
    setPage(1);
  }, [tab, search]);

  const rows = useMemo(() => {
    const base = tab === 'sudah' ? data?.sudah || [] : data?.belum || [];
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      String(r.kode_member || '').toLowerCase().includes(q) ||
      String(r.nama_member || '').toLowerCase().includes(q) ||
      String(r.advisor || '').toLowerCase().includes(q) ||
      String(r.username_kunjungan || '').toLowerCase().includes(q)
    );
  }, [data, tab, search]);

  const displayedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const sudahLabel = source === 'by_call' ? 'Sudah Belanja' : 'Sudah Dikunjungi';
  const belumLabel = source === 'by_call' ? 'Belum Belanja' : 'Belum Dikunjungi';

  return (
    <div className="max-w-[1500px] mx-auto space-y-4">
      <Card className="p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-400" /> Status Kunjungan Member
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Cabang <span className="text-amber-400 font-semibold">{cabang}</span>
            </p>
          </div>
          <a href={exportMemberStatusUrl(cabang, source, petugas)}>
            <Button variant="success">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
            </Button>
          </a>
        </div>
      </Card>

      <Card className="p-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSource('rkm')}
            className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-xs font-semibold transition-colors ${
              source === 'rkm'
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : 'bg-[var(--wash-1)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Footprints className="w-4 h-4" /> RKM
          </button>
          <button
            onClick={() => setSource('by_call')}
            className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-xs font-semibold transition-colors ${
              source === 'by_call'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-[var(--wash-1)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <PhoneCall className="w-4 h-4" /> By Call
          </button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Advisor</label>
            <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-full">
              <option value="">Semua Advisor</option>
              {(data?.advisor_list || []).map((a) => (
                <option key={a} value={a}>{a.toUpperCase()}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Cari Member</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button variant="primary" onClick={() => load()} disabled={loading}>
            <Search className="w-3.5 h-3.5" /> {loading ? 'Memuat...' : 'Tampilkan'}
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={Users} tone="slate" label="Total Member" value={data.totals.total_member.toLocaleString('id-ID')} />
            <StatCard icon={CheckCircle2} tone="emerald" label={sudahLabel} value={data.totals.sudah.toLocaleString('id-ID')} />
            <StatCard icon={XCircle} tone="rose" label={belumLabel} value={data.totals.belum.toLocaleString('id-ID')} />
          </div>

          <Card>
            <CardHeader
              title="Status Member"
              icon={Users}
              right={
                <Badge tone={tab === 'sudah' ? 'emerald' : 'rose'}>
                  {search.trim() ? `${rows.length} Ditemukan` : `${rows.length} Member`}
                </Badge>
              }
            />
            <div className="p-3 border-b border-[var(--border)] grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setTab('sudah');
                  setPage(1);
                }}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold border ${tab === 'sudah' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--wash-1)]'}`}
              >
                {sudahLabel} ({data.totals.sudah})
              </button>
              <button
                onClick={() => {
                  setTab('belum');
                  setPage(1);
                }}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold border ${tab === 'belum' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--wash-1)]'}`}
              >
                {belumLabel} ({data.totals.belum})
              </button>
            </div>

            <div className="overflow-x-auto max-h-[620px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[var(--wash-2)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="p-3.5 font-semibold">Kode Member</th>
                    <th className="p-3.5 font-semibold">Nama Member</th>
                    <th className="p-3.5 font-semibold">Advisor Master</th>
                    {tab === 'sudah' && <th className="p-3.5 font-semibold">{source === 'by_call' ? 'Petugas By Call' : 'Petugas Kunjungan'}</th>}
                    {tab === 'sudah' && <th className="p-3.5 font-semibold">No Trx</th>}
                    {tab === 'sudah' && <th className="p-3.5 font-semibold">Waktu</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {displayedRows.length === 0 && (
                    <tr>
                      <td colSpan={tab === 'sudah' ? 6 : 3}>
                        <EmptyState icon={tab === 'sudah' ? CheckCircle2 : XCircle} text={`Tidak ada data ${tab === 'sudah' ? sudahLabel.toLowerCase() : belumLabel.toLowerCase()}`} />
                      </td>
                    </tr>
                  )}
                  {displayedRows.map((r, i) => (
                    <tr key={`${r.kode_member}-${i}`} className="hover:bg-[var(--wash-1)] transition-colors text-sm">
                      <td className="p-3.5 font-mono font-semibold text-blue-400">{r.kode_member}</td>
                      <td className="p-3.5 text-[var(--text-secondary)]">{r.nama_member}</td>
                      <td className="p-3.5 text-[var(--text-muted)] font-mono">{(r.advisor || '-').toUpperCase()}</td>
                      {tab === 'sudah' && <td className="p-3.5 text-[var(--text-secondary)] font-mono">{(r.username_kunjungan || '-').toUpperCase()}</td>}
                      {tab === 'sudah' && <td className="p-3.5 text-[var(--text-muted)] font-mono">{r.no_trx || '-'}</td>}
                      {tab === 'sudah' && <td className="p-3.5 text-[var(--text-muted)]">{formatDateTime(r.waktu_kunjungan)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={page}
              totalItems={rows.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </Card>
        </>
      )}

      {loading && !data && <p className="text-sm text-[var(--text-faint)] text-center py-10">Memuat data...</p>}
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
