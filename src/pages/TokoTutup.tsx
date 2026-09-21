import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Store as StoreIcon, Plus, X, Save, Trash2, ShieldBan, ShieldCheck, FileSpreadsheet, Search, Loader2 } from 'lucide-react';
import { fetchStatusToko, addStatusToko, deleteStatusToko, exportStatusTokoUrl } from '../lib/api';
import type { StatusToko } from '../types';
import { Card, CardHeader, Badge, EmptyState, Input, Button, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

export default function TokoTutup() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [data, setData] = useState<StatusToko[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [cleanedUp, setCleanedUp] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [form, setForm] = useState({
    username: '',
    nama_toko: '',
    kode_member: '',
    status: 'Tutup',
    keterangan_lainnya: '',
    deskripsi: '',
  });

  // Debounce search agar menembak SQL query baru ke server setelah berhenti mengetik
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = (searchTerm = debouncedSearch) => {
    setLoading(true);
    setError(null);
    fetchStatusToko(cabang, searchTerm)
      .then((r) => {
        setData(r.data || []);
        if (!searchTerm) {
          setTotalCount(r.data?.length || 0);
        }
        if (r.jadwal_dihapus > 0) setCleanedUp(r.jadwal_dihapus);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(debouncedSearch);
  }, [cabang, debouncedSearch]);

  const displayData = useMemo(() => {
    if (pageSize >= 9999) return data;
    const start = (page - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, page, pageSize]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.nama_toko || !form.kode_member) {
      alert('Username, kode member, dan nama toko wajib diisi — kode member dipakai untuk memblokir toko dari jadwal.');
      return;
    }
    setSaving(true);
    try {
      const r = await addStatusToko({ ...form, cabang, kode_member: form.kode_member.toUpperCase() });
      setShowModal(false);
      setForm({ username: '', nama_toko: '', kode_member: '', status: 'Tutup', keterangan_lainnya: '', deskripsi: '' });
      load();
      if (r.jadwal_dihapus > 0) {
        alert(`Toko berhasil diblokir. ${r.jadwal_dihapus} jadwal yang sudah terlanjur dibuat untuk toko ini (hari ini & ke depan) otomatis dihapus.`);
      }
    } catch (err: any) {
      alert('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    window.open(exportStatusTokoUrl(cabang), '_blank');
  };

  const handleDelete = async (row: StatusToko) => {
    if (!confirm(`Hapus data "${row.nama_toko}" dari daftar blokir? Toko ini akan bisa dijadwalkan lagi.`)) return;
    setBusyId(row.id);
    try {
      await deleteStatusToko(row.id);
      load();
    } catch (err: any) {
      alert('Gagal menghapus: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <Card className="p-5">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <StoreIcon className="w-5 h-5 text-rose-400" /> Daftar Toko Tutup
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Toko yang{' '}
              <span className="text-rose-400 font-semibold">terdaftar di sini otomatis diblokir</span> dari penjadwalan (generate
              maupun input manual) — apapun isi status-nya. Hapus datanya untuk membuka blokir.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" onClick={handleExport} disabled={loading || data.length === 0}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
            </Button>
            <Button variant="danger" onClick={() => setShowModal(true)}>
              <Plus className="w-3.5 h-3.5" /> Tandai Toko Tutup
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}

      {cleanedUp !== null && (
        <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-emerald-400">
              {cleanedUp} jadwal (hari ini &amp; ke depan) untuk toko yang terdaftar di sini otomatis dibersihkan dari
              penjadwalan.
            </p>
            <button onClick={() => setCleanedUp(null)} className="text-emerald-400/70 hover:text-emerald-400 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari toko berdasarkan nama, kode member, status, dicatat oleh..."
              className="pl-9 w-full"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="Hapus pencarian"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)] whitespace-nowrap self-end sm:self-center flex items-center gap-2">
            {loading && (
              <span className="flex items-center gap-1.5 text-blue-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat dari database...
              </span>
            )}
            {debouncedSearch ? (
              <span>
                Ditemukan <strong className="text-amber-400 font-semibold">{data.length}</strong> toko cocok
              </span>
            ) : (
              <span>
                Total <strong className="text-amber-400 font-semibold">{totalCount || data.length}</strong> toko diblokir
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            debouncedSearch
              ? `Hasil Pencarian Database (${data.length})`
              : `Toko Diblokir dari Penjadwalan (${totalCount || data.length})`
          }
          icon={ShieldBan}
          right={
            debouncedSearch ? (
              <Badge tone="amber">{data.length} hasil ditemukan</Badge>
            ) : (
              <Badge tone="rose">{totalCount || data.length} Toko</Badge>
            )
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                <th className="p-3.5 font-semibold">Tanggal</th>
                <th className="p-3.5 font-semibold">Dicatat Oleh</th>
                <th className="p-3.5 font-semibold">Kode Member</th>
                <th className="p-3.5 font-semibold">Nama Toko</th>
                <th className="p-3.5 font-semibold">Keterangan</th>
                <th className="p-3.5 font-semibold text-center">Status</th>
                <th className="p-3.5 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" /> Sedang mengambil data toko dari database...
                    </span>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={debouncedSearch ? Search : ShieldCheck}
                      text={debouncedSearch ? `Tidak ada toko di database yang cocok dengan "${debouncedSearch}".` : "Tidak ada toko yang diblokir saat ini."}
                    />
                  </td>
                </tr>
              ) : displayData.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={Search}
                      text={`Halaman kosong.`}
                    />
                  </td>
                </tr>
              ) : (
                displayData.map((t) => (
                  <tr key={t.id} className="hover:bg-[var(--wash-1)] transition-colors">
                    <td className="p-3.5 text-[var(--text-muted)] font-mono text-xs whitespace-nowrap">{fmtDate(t.tanggal)}</td>
                    <td className="p-3.5 font-mono text-amber-400">{t.username?.toUpperCase()}</td>
                    <td className="p-3.5 font-mono text-blue-400">{t.kode_member || '-'}</td>
                    <td className="p-3.5 text-[var(--text-primary)]">{t.nama_toko}</td>
                    <td className="p-3.5 text-[var(--text-muted)] text-xs max-w-[240px] truncate" title={t.keterangan_lainnya || t.deskripsi || ''}>
                      {t.keterangan_lainnya || t.deskripsi || '-'}
                    </td>
                    <td className="p-3.5 text-center">
                      <Badge tone="rose">{t.status}</Badge>
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => handleDelete(t)}
                        disabled={busyId === t.id}
                        title="Hapus data (buka blokir)"
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={page}
          totalItems={data.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Card>

      {showModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm flex flex-col bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-2xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <ShieldBan className="w-4 h-4 text-rose-400" /> Tandai Toko Tutup
              </h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mb-4 -mt-1">
              Menyimpan data di sini langsung memblokir toko dari penjadwalan, apapun isi field status di bawah.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Dicatat Oleh (Username)">
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full uppercase"
                  placeholder="Username kamu"
                  required
                />
              </Field>
              <Field label="Kode Member">
                <Input
                  value={form.kode_member}
                  onChange={(e) => setForm({ ...form, kode_member: e.target.value })}
                  className="w-full uppercase"
                  placeholder="Misal: 2T123456"
                  required
                />
                <p className="text-[11px] text-[var(--text-faint)] mt-1.5">Wajib diisi — ini yang dipakai untuk memblokir toko dari jadwal.</p>
              </Field>
              <Field label="Nama Toko">
                <Input
                  value={form.nama_toko}
                  onChange={(e) => setForm({ ...form, nama_toko: e.target.value })}
                  className="w-full uppercase"
                  placeholder="Nama toko lengkap"
                  required
                />
              </Field>
              <Field label="Keterangan (opsional)">
                <Input
                  value={form.keterangan_lainnya}
                  onChange={(e) => setForm({ ...form, keterangan_lainnya: e.target.value })}
                  className="w-full"
                  placeholder="Misal: tutup permanen, pindah alamat, dll"
                />
              </Field>
              <div className="pt-1">
                <Button type="submit" variant="danger" className="w-full justify-center" disabled={saving}>
                  {saving ? 'Menyimpan...' : (
                    <>
                      <Save className="w-4 h-4 mr-1.5" /> Simpan &amp; Blokir
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
