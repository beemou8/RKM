import { useEffect, useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ListTree, Plus, X, Save, Trash2, Pencil, UserPlus, MapPinned, Tags, Search } from 'lucide-react';
import { fetchMasterAlasan, addMasterAlasan, updateMasterAlasan, deleteMasterAlasan } from '../lib/api';
import type { MasterAlasanMenolak } from '../types';
import { Card, CardHeader, EmptyState, Input, Button, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

// Dua tipe kategori alasan yang dipakai di seluruh aplikasi:
// - GET_MEMBER: alasan toko menolak jadi member (fitur Member Baru)
// - RKM       : alasan toko tidak order saat kunjungan (fitur Kunjungan RKM)
const TIPE_TABS: Array<{ key: 'GET_MEMBER' | 'RKM'; label: string; icon: any; tone: 'emerald' | 'blue' }> = [
  { key: 'GET_MEMBER', label: 'Menolak Jadi Member', icon: UserPlus, tone: 'emerald' },
  { key: 'RKM', label: 'Tidak Order (RKM)', icon: MapPinned, tone: 'blue' },
];

export default function MasterAlasanMenolak() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [tipe, setTipe] = useState<'GET_MEMBER' | 'RKM'>('GET_MEMBER');
  const [data, setData] = useState<MasterAlasanMenolak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ kategori_alasan: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchMasterAlasan(cabang, tipe)
      .then((r: { data: MasterAlasanMenolak[] }) => setData(r.data || []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setPage(1);
    setSearchQuery('');
    load();
  }, [cabang, tipe]);

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) => (row.kategori_alasan || '').toLowerCase().includes(q));
  }, [data, searchQuery]);

  const pagedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ kategori_alasan: '' });
    setShowModal(true);
  };

  const openEdit = (row: MasterAlasanMenolak) => {
    setEditingId(row.id ?? null);
    setForm({ kategori_alasan: row.kategori_alasan });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.kategori_alasan.trim()) {
      alert('Nama kategori wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateMasterAlasan(editingId, form.kategori_alasan.trim());
      } else {
        await addMasterAlasan({ cabang, tipe, kategori_alasan: form.kategori_alasan.trim() });
      }
      setShowModal(false);
      setForm({ kategori_alasan: '' });
      setEditingId(null);
      load();
    } catch (err: any) {
      alert('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: MasterAlasanMenolak) => {
    if (!confirm(`Hapus kategori "${row.kategori_alasan}"? Kategori ini tidak akan muncul lagi sebagai pilihan.`)) return;
    setBusyId(row.id ?? null);
    try {
      await deleteMasterAlasan(row.id!);
      load();
    } catch (err: any) {
      alert('Gagal menghapus: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  const activeTab = TIPE_TABS.find((t) => t.key === tipe)!;

  return (
    <div className="max-w-[1000px] mx-auto space-y-5">
      <Card className="p-5">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ListTree className="w-5 h-5 text-amber-400" /> Master Alasan Menolak
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Kelola daftar kategori alasan
              yang muncul sebagai pilihan di aplikasi lapangan, dikelompokkan per fitur supaya dashboard rapi.
            </p>
          </div>
          <Button variant="primary" onClick={openAdd}>
            <Plus className="w-3.5 h-3.5" /> Tambah Kategori
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}

      <Card>
        <div className="flex border-b border-[var(--border)]">
          {TIPE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTipe(t.key)}
              className={`flex items-center gap-2 px-5 py-3.5 text-xs font-semibold border-b-2 transition-colors ${
                tipe === t.key
                  ? `border-current ${t.tone === 'emerald' ? 'text-emerald-400' : 'text-blue-400'}`
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
              <span className="bg-[var(--wash-3)] px-1.5 py-0.5 rounded text-[10px]">
                {tipe === t.key ? data.length : ''}
              </span>
            </button>
          ))}
        </div>
        <CardHeader
          title={`Kategori untuk "${activeTab.label}" (${data.length})`}
          icon={Tags}
        />
        <div className="p-3 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Cari kategori alasan..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--wash-1)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {searchQuery ? `Ditemukan ${filteredData.length} dari total ${data.length} kategori` : `Total: ${data.length} kategori`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                <th className="p-3.5 font-semibold">Kategori Alasan</th>
                <th className="p-3.5 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-sm">
              {loading ? (
                <tr>
                  <td colSpan={2} className="p-8 text-center text-xs text-[var(--text-muted)]">
                    Memuat data...
                  </td>
                </tr>
              ) : pagedData.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <EmptyState icon={Tags} text={searchQuery ? 'Tidak ada kategori alasan yang cocok dengan pencarian.' : `Belum ada kategori alasan untuk "${activeTab.label}".`} />
                  </td>
                </tr>
              ) : (
                pagedData.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--wash-1)] transition-colors">
                    <td className="p-3.5 text-[var(--text-primary)]">{row.kategori_alasan}</td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(row)}
                          title="Ubah nama kategori"
                          className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          disabled={busyId === row.id}
                          title="Hapus kategori"
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={page}
          totalItems={filteredData.length}
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
                <Tags className="w-4 h-4 text-amber-400" /> {editingId ? 'Ubah Kategori' : 'Tambah Kategori'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mb-4 -mt-1">
              Untuk kelompok <span className="font-semibold text-[var(--text-primary)]">{activeTab.label}</span> &middot; Cabang{' '}
              <span className="font-semibold text-[var(--text-primary)]">{cabang}</span>
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Nama Kategori">
                <Input
                  value={form.kategori_alasan}
                  onChange={(e) => setForm({ kategori_alasan: e.target.value })}
                  className="w-full"
                  placeholder="Misal: Harga tidak cocok, Sudah punya supplier lain, dll"
                  required
                  autoFocus
                />
              </Field>
              <div className="pt-1">
                <Button type="submit" variant="primary" className="w-full justify-center" disabled={saving}>
                  {saving ? 'Menyimpan...' : (
                    <>
                      <Save className="w-4 h-4 mr-1.5" /> Simpan
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
