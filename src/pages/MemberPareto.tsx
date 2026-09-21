import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  PackageCheck, ShoppingBag, Database, CloudUpload, FileSpreadsheet,
  Search, RefreshCw, CheckCircle2, Clock, XCircle, AlertCircle,
  Plus, Trash2, Edit3, Save, X, Users, Store, CheckSquare, Square,
  Settings
} from 'lucide-react';
import {
  fetchMemberParetoAnalisis,
  fetchMasterItemPareto,
  createMasterItemPareto,
  deleteMasterItemPareto,
  lookupProductPlu,
  uploadMemberPareto,
  fetchMemberParetoMonitoring,
  updateMemberParetoStatus,
  deleteMemberPareto,
  bulkDeleteMemberPareto,
  exportMemberParetoUrl
} from '../lib/api';
import type {
  MemberParetoRow,
  MemberParetoMonitoringRow,
  MasterItemPareto
} from '../types';
import { Card, StatCard, EmptyState, Button, Input, Select, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

const STATUS_OPTS = ['Pending', 'Sudah Ditawari', 'Berhasil Beli', 'Menolak'] as const;

function getDefaultRange(): { tglDari: string; tglSampai: string } {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const tglSampai = `${yyyy}-${mm}-${dd}`;

  const dPast = new Date(d);
  dPast.setMonth(dPast.getMonth() - 3);
  const pYyyy = dPast.getFullYear();
  const pMm = String(dPast.getMonth() + 1).padStart(2, '0');
  const pDd = String(dPast.getDate()).padStart(2, '0');
  const tglDari = `${pYyyy}-${pMm}-${pDd}`;

  return { tglDari, tglSampai };
}

export default function MemberPareto() {
  const { cabang } = useOutletContext<LayoutContext>();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'analisis' | 'monitoring'>('analisis');

  // ==========================================
  // MASTER ITEM PARETO (Supabase)
  // ==========================================
  const [masterItems, setMasterItems] = useState<MasterItemPareto[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);
  const [newPlu, setNewPlu] = useState('');
  const [newNamaBarang, setNewNamaBarang] = useState('');
  const [newKeterangan, setNewKeterangan] = useState('');
  const [newCabang, setNewCabang] = useState('ALL');
  const [isSavingMaster, setIsSavingMaster] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);

  const loadMasterItems = () => {
    setLoadingMaster(true);
    fetchMasterItemPareto(cabang)
      .then((res) => {
        setMasterItems(res.data || []);
      })
      .catch(() => {})
      .finally(() => setLoadingMaster(false));
  };

  useEffect(() => {
    loadMasterItems();
  }, [cabang]);

  // Quick lookup product name from local database when typing PLU
  const handlePluBlur = async () => {
    const clean = newPlu.trim();
    if (!clean) return;
    try {
      const res = await lookupProductPlu(clean);
      if (res.found && res.product) {
        setNewNamaBarang(res.product.prd_deskripsipanjang);
        setMasterError(null);
      }
    } catch {
      // ignore
    }
  };

  const handleSaveMasterItem = async () => {
    const cleanPlu = newPlu.trim();
    if (!cleanPlu) {
      setMasterError('Kode PLU / prdcd tidak boleh kosong.');
      return;
    }
    setIsSavingMaster(true);
    setMasterError(null);
    try {
      await createMasterItemPareto({
        cabang: newCabang || 'ALL',
        prd_prdcd: cleanPlu,
        nama_barang: newNamaBarang.trim() || undefined,
        keterangan: newKeterangan.trim() || undefined,
      });
      setNewPlu('');
      setNewNamaBarang('');
      setNewKeterangan('');
      loadMasterItems();
    } catch (err: any) {
      setMasterError(err.message || 'Gagal menyimpan ke Supabase master.');
    } finally {
      setIsSavingMaster(false);
    }
  };

  const handleDeleteMasterItem = async (id?: number) => {
    if (!id) {
      alert('Item bawaan tidak dapat dihapus.');
      return;
    }
    if (!confirm('Yakin ingin menghapus item pareto ini dari Supabase Master?')) return;
    try {
      await deleteMasterItemPareto(id);
      loadMasterItems();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus item');
    }
  };

  // ==========================================
  // TAB 1: Analisis DB Lokal
  // ==========================================
  const defaults = useMemo(() => getDefaultRange(), []);
  const [tglDari, setTglDari] = useState(defaults.tglDari);
  const [tglSampai, setTglSampai] = useState(defaults.tglSampai);
  const [petugas, setPetugas] = useState('');
  const [selectedPlu, setSelectedPlu] = useState('all');
  const [filterKodeMember, setFilterKodeMember] = useState('');
  const [filterSearchAnalisis, setFilterSearchAnalisis] = useState('');
  const [pageAnalisis, setPageAnalisis] = useState(1);
  const [pageSizeAnalisis, setPageSizeAnalisis] = useState(25);

  const [analisisData, setAnalisisData] = useState<MemberParetoRow[]>([]);
  const [advisorList, setAdvisorList] = useState<string[]>([]);
  const [loadingAnalisis, setLoadingAnalisis] = useState(false);
  const [errorAnalisis, setErrorAnalisis] = useState<string | null>(null);

  // Selection for upload
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  // ==========================================
  // TAB 2: Monitoring Supabase
  // ==========================================
  const [monitoringData, setMonitoringData] = useState<MemberParetoMonitoringRow[]>([]);
  const [monitoringTotals, setMonitoringTotals] = useState({
    total: 0,
    pending: 0,
    sudah_ditawari: 0,
    berhasil_beli: 0,
    menolak: 0,
  });
  const [monitoringAdvisors, setMonitoringAdvisors] = useState<string[]>([]);
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);
  const [errorMonitoring, setErrorMonitoring] = useState<string | null>(null);

  const [filterMonPetugas, setFilterMonPetugas] = useState('');
  const [filterMonStatus, setFilterMonStatus] = useState('semua');
  const [filterMonPlu, setFilterMonPlu] = useState('semua');
  const [filterMonKodeMember, setFilterMonKodeMember] = useState('');
  const [filterMonSearch, setFilterMonSearch] = useState('');
  const [pageMonitoring, setPageMonitoring] = useState(1);
  const [pageSizeMonitoring, setPageSizeMonitoring] = useState(25);
  const [monCheckedIds, setMonCheckedIds] = useState<Record<number, boolean>>({});
  const [isDeletingMon, setIsDeletingMon] = useState(false);

  // Edit Note Modal
  const [editingRow, setEditingRow] = useState<MemberParetoMonitoringRow | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [statusInput, setStatusInput] = useState('Pending');
  const [savingStatus, setSavingStatus] = useState(false);

  // Load Analisis DB Lokal
  const loadAnalisis = () => {
    if (tglDari > tglSampai) {
      setErrorAnalisis('Tanggal mulai tidak boleh lebih besar dari tanggal sampai.');
      return;
    }
    setLoadingAnalisis(true);
    setErrorAnalisis(null);
    setCheckedKeys({});
    setUploadSuccessMsg(null);

    const pluList = selectedPlu && selectedPlu !== 'all' ? [selectedPlu] : [];

    fetchMemberParetoAnalisis(
      cabang,
      tglDari,
      tglSampai,
      petugas,
      pluList,
      filterKodeMember.trim() || undefined
    )
      .then((res) => {
        setAnalisisData(res.data || []);
        setAdvisorList(res.advisor_list || []);
      })
      .catch((err) => {
        setErrorAnalisis(err.message || 'Gagal memuat analisis data pareto.');
      })
      .finally(() => {
        setLoadingAnalisis(false);
      });
  };

  // Load Monitoring Supabase
  const loadMonitoring = () => {
    setLoadingMonitoring(true);
    setErrorMonitoring(null);
    setMonCheckedIds({});

    fetchMemberParetoMonitoring(cabang, {
      petugas: filterMonPetugas || undefined,
      status: filterMonStatus !== 'semua' ? filterMonStatus : undefined,
      plu: filterMonPlu !== 'semua' ? filterMonPlu : undefined,
      kode_member: filterMonKodeMember.trim() || undefined,
    })
      .then((res) => {
        setMonitoringData(res.data || []);
        setMonitoringTotals(res.totals || { total: 0, pending: 0, sudah_ditawari: 0, berhasil_beli: 0, menolak: 0 });
        setMonitoringAdvisors(res.advisor_list || []);
      })
      .catch((err) => {
        setErrorMonitoring(err.message || 'Gagal memuat data monitoring dari Supabase.');
      })
      .finally(() => {
        setLoadingMonitoring(false);
      });
  };

  // Auto load when tab changes or branch changes
  useEffect(() => {
    if (activeTab === 'analisis') {
      loadAnalisis();
    } else {
      loadMonitoring();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, cabang]);

  // Set quick ranges
  const handleQuickRange = (months: number) => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const end = `${yyyy}-${mm}-${dd}`;

    const dPast = new Date(d);
    dPast.setMonth(dPast.getMonth() - months);
    const pYyyy = dPast.getFullYear();
    const pMm = String(dPast.getMonth() + 1).padStart(2, '0');
    const pDd = String(dPast.getDate()).padStart(2, '0');
    const start = `${pYyyy}-${pMm}-${pDd}`;

    setTglDari(start);
    setTglSampai(end);
  };

  // Filtered Analisis (Client Search)
  const filteredAnalisis = useMemo(() => {
    if (!filterSearchAnalisis.trim()) return analisisData;
    const q = filterSearchAnalisis.toLowerCase();
    return analisisData.filter(
      (r) =>
        r.kode_member.toLowerCase().includes(q) ||
        r.nama_member.toLowerCase().includes(q) ||
        r.prd_prdcd.toLowerCase().includes(q) ||
        r.nama_barang.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q)
    );
  }, [analisisData, filterSearchAnalisis]);

  const pagedAnalisis = useMemo(() => {
    const start = (pageAnalisis - 1) * pageSizeAnalisis;
    return filteredAnalisis.slice(start, start + pageSizeAnalisis);
  }, [filteredAnalisis, pageAnalisis, pageSizeAnalisis]);

  // Checkbox helpers in Tab 1
  const toggleSelectAllAnalisis = () => {
    const allChecked = filteredAnalisis.length > 0 && filteredAnalisis.every((r) => checkedKeys[`${r.kode_member}_${r.prd_prdcd}`]);
    const next: Record<string, boolean> = { ...checkedKeys };
    filteredAnalisis.forEach((r) => {
      const k = `${r.kode_member}_${r.prd_prdcd}`;
      next[k] = !allChecked;
    });
    setCheckedKeys(next);
  };

  const selectedAnalisisCount = useMemo(() => {
    return Object.values(checkedKeys).filter(Boolean).length;
  }, [checkedKeys]);

  const isAllAnalisisChecked = useMemo(() => {
    return (
      filteredAnalisis.length > 0 &&
      filteredAnalisis.every((r) => checkedKeys[`${r.kode_member}_${r.prd_prdcd}`])
    );
  }, [filteredAnalisis, checkedKeys]);

  // Upload to Supabase
  const handleUploadToSupabase = async () => {
    const itemsToUpload = selectedAnalisisCount > 0
      ? filteredAnalisis.filter((r) => checkedKeys[`${r.kode_member}_${r.prd_prdcd}`])
      : filteredAnalisis;

    if (itemsToUpload.length === 0) {
      alert('Tidak ada data member yang dipilih untuk di-upload.');
      return;
    }

    if (
      !confirm(
        `Upload ${itemsToUpload.length.toLocaleString('id-ID')} target member pareto cabang ${cabang}?`
      )
    ) {
      return;
    }

    setIsUploading(true);
    setUploadSuccessMsg(null);
    try {
      const res = await uploadMemberPareto({
        cabang,
        periode_dari: tglDari,
        periode_sampai: tglSampai,
        items: itemsToUpload,
      });
      setUploadSuccessMsg(`Berhasil upload ${res.inserted_count.toLocaleString('id-ID')} target pareto.`);
      setCheckedKeys({});
    } catch (err: any) {
      alert(`Gagal upload: ${err.message || 'Terjadi kesalahan'}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Filtered Monitoring (Client Search)
  const filteredMonitoring = useMemo(() => {
    if (!filterMonSearch.trim()) return monitoringData;
    const q = filterMonSearch.toLowerCase();
    return monitoringData.filter(
      (r) =>
        r.kode_member.toLowerCase().includes(q) ||
        r.nama_member.toLowerCase().includes(q) ||
        r.prd_prdcd.toLowerCase().includes(q) ||
        r.nama_barang.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q)
    );
  }, [monitoringData, filterMonSearch]);

  const pagedMonitoring = useMemo(() => {
    const start = (pageMonitoring - 1) * pageSizeMonitoring;
    return filteredMonitoring.slice(start, start + pageSizeMonitoring);
  }, [filteredMonitoring, pageMonitoring, pageSizeMonitoring]);

  // Inline status change in Monitoring
  const handleInlineStatusChange = async (id: number, newStatus: string) => {
    try {
      await updateMemberParetoStatus(id, { status_followup: newStatus });
      setMonitoringData((prev) =>
        prev.map((row) => (row.id === id ? { ...row, status_followup: newStatus } : row))
      );
      setMonitoringTotals((prev) => {
        const next = { ...prev };
        const oldRow = monitoringData.find((r) => r.id === id);
        if (oldRow) {
          const oldSt = oldRow.status_followup.toLowerCase();
          if (oldSt === 'berhasil beli') next.berhasil_beli--;
          else if (oldSt === 'sudah ditawari') next.sudah_ditawari--;
          else if (oldSt === 'menolak') next.menolak--;
          else next.pending--;

          const newSt = newStatus.toLowerCase();
          if (newSt === 'berhasil beli') next.berhasil_beli++;
          else if (newSt === 'sudah ditawari') next.sudah_ditawari++;
          else if (newSt === 'menolak') next.menolak++;
          else next.pending++;
        }
        return next;
      });
    } catch (err: any) {
      alert(`Gagal update status: ${err.message}`);
    }
  };

  // Delete monitoring row
  const handleDeleteMonitoring = async (id: number) => {
    if (!confirm('Hapus data target ini dari Supabase?')) return;
    try {
      await deleteMemberPareto(id);
      setMonitoringData((prev) => prev.filter((r) => r.id !== id));
      loadMonitoring();
    } catch (err: any) {
      alert(`Gagal menghapus: ${err.message}`);
    }
  };

  // Bulk delete monitoring
  const handleBulkDeleteMonitoring = async () => {
    const ids = Object.entries(monCheckedIds)
      .filter(([, checked]) => checked)
      .map(([id]) => Number(id));

    if (ids.length === 0) return;
    if (!confirm(`Hapus ${ids.length} data target terpilih dari Supabase?`)) return;

    setIsDeletingMon(true);
    try {
      await bulkDeleteMemberPareto(ids);
      setMonCheckedIds({});
      loadMonitoring();
    } catch (err: any) {
      alert(`Gagal hapus massal: ${err.message}`);
    } finally {
      setIsDeletingMon(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (row: MemberParetoMonitoringRow) => {
    setEditingRow(row);
    setNoteInput(row.catatan || '');
    setStatusInput(row.status_followup || 'Pending');
  };

  // Save Modal
  const handleSaveModal = async () => {
    if (!editingRow) return;
    setSavingStatus(true);
    try {
      await updateMemberParetoStatus(editingRow.id, {
        status_followup: statusInput,
        catatan: noteInput,
      });
      setMonitoringData((prev) =>
        prev.map((r) =>
          r.id === editingRow.id ? { ...r, status_followup: statusInput, catatan: noteInput } : r
        )
      );
      setEditingRow(null);
    } catch (err: any) {
      alert(`Gagal menyimpan: ${err.message}`);
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Page */}
      <Card className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-amber-400" /> Member Belum Belanja Item Pareto
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Cabang <span className="text-amber-400 font-semibold">{cabang}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsMasterModalOpen(true)}
            className="flex items-center gap-1.5 text-xs border border-[var(--border)]"
          >
            <Database className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Master Item Pareto</span>
          </Button>
        </div>
      </Card>

      {/* Tab Navigation */}
      <div className="flex border-b border-[var(--border)] gap-2">
        <button
          onClick={() => setActiveTab('analisis')}
          className={`pb-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'analisis'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Analisis Target</span>
          {analisisData.length > 0 && (
            <span className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] bg-[var(--accent-soft-bg)] text-[var(--accent)]">
              {analisisData.length.toLocaleString('id-ID')}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('monitoring')}
          className={`pb-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'monitoring'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <CloudUpload className="w-4 h-4" />
          <span>Monitoring Target</span>
          {monitoringData.length > 0 && (
            <span className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {monitoringData.length.toLocaleString('id-ID')}
            </span>
          )}
        </button>
      </div>

      {/* ============================================================ */}
      {/* TAB 1: ANALISIS DB LOKAL */}
      {/* ============================================================ */}
      {activeTab === 'analisis' && (
        <div className="space-y-4">
          {/* Filters Card */}
          <Card className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[var(--border)]">
              <span className="text-xs font-semibold text-[var(--text-primary)]">Filter Analisis</span>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" className="text-xs px-2.5 py-0.5 border border-[var(--border)]" onClick={() => handleQuickRange(1)}>1 Bln</Button>
                <Button variant="ghost" className="text-xs px-2.5 py-0.5 border border-[var(--border)]" onClick={() => handleQuickRange(3)}>3 Bln</Button>
                <Button variant="ghost" className="text-xs px-2.5 py-0.5 border border-[var(--border)]" onClick={() => handleQuickRange(6)}>6 Bln</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Periode Dari</label>
                <Input type="date" value={tglDari} onChange={(e) => setTglDari(e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Periode Sampai</label>
                <Input type="date" value={tglSampai} onChange={(e) => setTglSampai(e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Sales Advisor</label>
                <Select value={petugas} onChange={(e) => setPetugas(e.target.value)}>
                  <option value="">Semua Advisor</option>
                  {advisorList.map((adv) => (
                    <option key={adv} value={adv}>{adv}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Kode Member</label>
                <Input
                  type="text"
                  placeholder="Kode member..."
                  value={filterKodeMember}
                  onChange={(e) => setFilterKodeMember(e.target.value)}
                  className="uppercase font-mono text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1 max-w-xl">
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>Item Pareto</span>
                  <button
                    onClick={() => setIsMasterModalOpen(true)}
                    className="text-[var(--accent)] hover:underline text-[11px] font-normal flex items-center gap-1 normal-case"
                  >
                    <Settings className="w-3 h-3" /> Kelola Master
                  </button>
                </label>
                <Select
                  value={selectedPlu}
                  onChange={(e) => setSelectedPlu(e.target.value)}
                  className="text-xs"
                >
                  <option value="all">Semua Item Pareto</option>
                  {masterItems.map((m) => (
                    <option key={m.prd_prdcd} value={m.prd_prdcd}>
                      [{m.prd_prdcd}] {m.nama_barang}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-end gap-2 shrink-0">
                <Button
                  variant="primary"
                  className="flex items-center justify-center gap-2 text-xs px-5 py-2"
                  onClick={loadAnalisis}
                  disabled={loadingAnalisis}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalisis ? 'animate-spin' : ''}`} />
                  {loadingAnalisis ? 'Menganalisis...' : 'Cari Data'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Success Notification */}
          {uploadSuccessMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{uploadSuccessMsg}</span>
              </div>
              <button onClick={() => setActiveTab('monitoring')} className="underline font-semibold hover:text-emerald-300">
                Lihat Monitoring &rarr;
              </button>
            </div>
          )}

          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Total Target"
              value={analisisData.length.toLocaleString('id-ID')}
              icon={ShoppingBag}
              tone="amber"
            />
            <StatCard
              label="Member"
              value={new Set(analisisData.map((d) => d.kode_member)).size.toLocaleString('id-ID')}
              icon={Store}
              tone="blue"
            />
            <StatCard
              label="Sales Advisor"
              value={new Set(analisisData.map((d) => d.username).filter(Boolean)).size.toLocaleString('id-ID')}
              icon={Users}
              tone="emerald"
            />
            <StatCard
              label="Item Pareto"
              value={selectedPlu === 'all' ? `${masterItems.length} Item` : '1 Item'}
              icon={PackageCheck}
              tone="slate"
            />
          </div>

          {/* Table & Actions */}
          <Card className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <Input
                    placeholder="Cari data..."
                    value={filterSearchAnalisis}
                    onChange={(e) => {
                      setFilterSearchAnalisis(e.target.value);
                      setPageAnalisis(1);
                    }}
                    className="pl-8 text-xs h-9"
                  />
                </div>
                {selectedAnalisisCount > 0 && (
                  <span className="text-xs text-amber-400 font-medium">
                    {selectedAnalisisCount} dipilih
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const url = exportMemberParetoUrl(cabang, 'analisis', {
                      tglDari,
                      tglSampai,
                      petugas,
                      kodeMember: filterKodeMember,
                      plu: selectedPlu !== 'all' ? selectedPlu : undefined,
                    });
                    window.open(url, '_blank');
                  }}
                  disabled={analisisData.length === 0}
                  className="flex items-center gap-1.5 text-xs border border-[var(--border)]"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  Export Excel
                </Button>

                <Button
                  variant="primary"
                  onClick={handleUploadToSupabase}
                  disabled={analisisData.length === 0 || isUploading}
                  className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <CloudUpload className={`w-3.5 h-3.5 ${isUploading ? 'animate-spin' : ''}`} />
                  {isUploading ? 'Mengunggah...' : selectedAnalisisCount > 0 ? `Upload Terpilih (${selectedAnalisisCount})` : `Upload Target (${filteredAnalisis.length})`}
                </Button>
              </div>
            </div>

            {errorAnalisis ? (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {errorAnalisis}
              </div>
            ) : loadingAnalisis ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent)]" />
                <span>Memuat data...</span>
              </div>
            ) : filteredAnalisis.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                text="Tidak ada data yang cocok dengan filter."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[var(--bg-app-alt)] text-[var(--text-secondary)] border-b border-[var(--border)]">
                    <tr>
                      <th className="py-2 px-3 w-10 text-center">
                        <button onClick={toggleSelectAllAnalisis} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                          {isAllAnalisisChecked ? <CheckSquare className="w-4 h-4 text-[var(--accent)]" /> : <Square className="w-4 h-4" />}
                        </button>
                      </th>
                      <th className="py-2 px-3 font-semibold">Cabang</th>
                      <th className="py-2 px-3 font-semibold">Advisor</th>
                      <th className="py-2 px-3 font-semibold">Kode Member</th>
                      <th className="py-2 px-3 font-semibold">Nama Member</th>
                      <th className="py-2 px-3 font-semibold">Item Pareto</th>
                      <th className="py-2 px-3 font-semibold">Belanja Pertama</th>
                      <th className="py-2 px-3 font-semibold">Belanja Terakhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {pagedAnalisis.map((r) => {
                      const key = `${r.kode_member}_${r.prd_prdcd}`;
                      const isChecked = !!checkedKeys[key];
                      return (
                        <tr
                          key={key}
                          className={`hover:bg-[var(--bg-app-alt)] transition-colors ${
                            isChecked ? 'bg-[var(--accent-soft-bg)]/20' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => setCheckedKeys((c) => ({ ...c, [key]: !c[key] }))}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              {isChecked ? <CheckSquare className="w-4 h-4 text-[var(--accent)]" /> : <Square className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-sky-400">{cabang}</td>
                          <td className="py-2 px-3 font-mono font-semibold text-amber-400">{r.username || '-'}</td>
                          <td className="py-2 px-3 font-mono font-medium text-[var(--text-primary)]">{r.kode_member}</td>
                          <td className="py-2 px-3 font-medium text-[var(--text-primary)] max-w-xs truncate">{r.nama_member}</td>
                          <td className="py-2 px-3">
                            <div className="font-mono text-indigo-400 font-semibold">{r.prd_prdcd}</div>
                            <div className="text-[var(--text-muted)] text-[11px] max-w-[200px] truncate">{r.nama_barang}</div>
                          </td>
                          <td className="py-2 px-3 font-mono text-[var(--text-muted)] text-[11px]">{r.belanja_pertama || '-'}</td>
                          <td className="py-2 px-3 font-mono text-[var(--text-muted)] text-[11px]">{r.belanja_terakhir || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              currentPage={pageAnalisis}
              totalItems={filteredAnalisis.length}
              pageSize={pageSizeAnalisis}
              onPageChange={setPageAnalisis}
              onPageSizeChange={setPageSizeAnalisis}
            />
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 2: MONITORING SUPABASE */}
      {/* ============================================================ */}
      {activeTab === 'monitoring' && (
        <div className="space-y-4">
          {/* Stat Cards Monitoring */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              label="Total Target"
              value={monitoringTotals.total.toLocaleString('id-ID')}
              icon={ShoppingBag}
              tone="slate"
            />
            <StatCard
              label="Pending"
              value={monitoringTotals.pending.toLocaleString('id-ID')}
              icon={Clock}
              tone="amber"
            />
            <StatCard
              label="Sudah Ditawari"
              value={monitoringTotals.sudah_ditawari.toLocaleString('id-ID')}
              icon={AlertCircle}
              tone="blue"
            />
            <StatCard
              label="Berhasil Beli"
              value={monitoringTotals.berhasil_beli.toLocaleString('id-ID')}
              icon={CheckCircle2}
              tone="emerald"
            />
            <StatCard
              label="Menolak"
              value={monitoringTotals.menolak.toLocaleString('id-ID')}
              icon={XCircle}
              tone="rose"
            />
          </div>

          {/* Monitoring Filters & Actions */}
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Sales Advisor</label>
                <Select value={filterMonPetugas} onChange={(e) => setFilterMonPetugas(e.target.value)}>
                  <option value="">Semua Advisor</option>
                  {monitoringAdvisors.map((adv) => (
                    <option key={adv} value={adv}>{adv}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Status Follow-up</label>
                <Select value={filterMonStatus} onChange={(e) => setFilterMonStatus(e.target.value)}>
                  <option value="semua">Semua Status</option>
                  {STATUS_OPTS.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Item Pareto</label>
                <Select value={filterMonPlu} onChange={(e) => setFilterMonPlu(e.target.value)}>
                  <option value="semua">Semua Item Pareto</option>
                  {masterItems.map((m) => (
                    <option key={m.prd_prdcd} value={m.prd_prdcd}>
                      [{m.prd_prdcd}] {m.nama_barang}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Kode Member</label>
                <Input
                  type="text"
                  placeholder="Kode member..."
                  value={filterMonKodeMember}
                  onChange={(e) => setFilterMonKodeMember(e.target.value)}
                  className="uppercase font-mono text-xs"
                />
              </div>

              <div className="flex items-end gap-2">
                <Button variant="ghost" className="w-full flex items-center justify-center gap-1.5 border border-[var(--border)]" onClick={loadMonitoring} disabled={loadingMonitoring}>
                  <RefreshCw className={`w-4 h-4 ${loadingMonitoring ? 'animate-spin' : ''}`} />
                  Filter
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const url = exportMemberParetoUrl(cabang, 'monitoring', {
                      petugas: filterMonPetugas,
                      kodeMember: filterMonKodeMember,
                      plu: filterMonPlu !== 'semua' ? filterMonPlu : undefined,
                    });
                    window.open(url, '_blank');
                  }}
                  className="flex items-center gap-1.5 border border-[var(--border)]"
                  title="Export Excel"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                </Button>
              </div>
            </div>

            {/* Quick search input in table */}
            <div className="relative max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                placeholder="Cari data..."
                value={filterMonSearch}
                onChange={(e) => {
                  setFilterMonSearch(e.target.value);
                  setPageMonitoring(1);
                }}
                className="pl-8 text-xs"
              />
            </div>

            {/* Bulk actions */}
            {Object.values(monCheckedIds).filter(Boolean).length > 0 && (
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center justify-between text-xs text-rose-400">
                <span>{Object.values(monCheckedIds).filter(Boolean).length} data dipilih</span>
                <Button
                  variant="danger"
                  onClick={handleBulkDeleteMonitoring}
                  disabled={isDeletingMon}
                  className="flex items-center gap-1 text-xs py-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus Terpilih
                </Button>
              </div>
            )}

            {/* Monitoring Table */}
            {errorMonitoring ? (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {errorMonitoring}
              </div>
            ) : loadingMonitoring ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent)]" />
                <span>Memuat data...</span>
              </div>
            ) : filteredMonitoring.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                text="Tidak ada data target pareto."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[var(--bg-app-alt)] text-[var(--text-secondary)] border-b border-[var(--border)]">
                    <tr>
                      <th className="py-2 px-3 w-10 text-center">
                        <button
                          onClick={() => {
                            const all = filteredMonitoring.every((r) => monCheckedIds[r.id]);
                            const next: Record<number, boolean> = {};
                            filteredMonitoring.forEach((r) => {
                              next[r.id] = !all;
                            });
                            setMonCheckedIds(next);
                          }}
                          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          {filteredMonitoring.length > 0 && filteredMonitoring.every((r) => monCheckedIds[r.id]) ? (
                            <CheckSquare className="w-4 h-4 text-[var(--accent)]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="py-2 px-3 font-semibold">Cabang</th>
                      <th className="py-2 px-3 font-semibold">Advisor</th>
                      <th className="py-2 px-3 font-semibold">Kode Member</th>
                      <th className="py-2 px-3 font-semibold">Nama Member</th>
                      <th className="py-2 px-3 font-semibold">Item Pareto</th>
                      <th className="py-2 px-3 font-semibold">Periode Target</th>
                      <th className="py-2 px-3 font-semibold">Status Follow-up</th>
                      <th className="py-2 px-3 font-semibold">Catatan</th>
                      <th className="py-2 px-3 text-center font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {pagedMonitoring.map((r) => {
                      const isChecked = !!monCheckedIds[r.id];
                      return (
                        <tr
                          key={r.id}
                          className={`hover:bg-[var(--bg-app-alt)] transition-colors ${
                            isChecked ? 'bg-[var(--accent-soft-bg)]/20' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => setMonCheckedIds((c) => ({ ...c, [r.id]: !c[r.id] }))}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              {isChecked ? <CheckSquare className="w-4 h-4 text-[var(--accent)]" /> : <Square className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-sky-400">{r.cabang || cabang}</td>
                          <td className="py-2 px-3 font-mono font-semibold text-amber-400">{r.username}</td>
                          <td className="py-2 px-3 font-mono font-medium text-[var(--text-primary)]">{r.kode_member}</td>
                          <td className="py-2 px-3 font-medium text-[var(--text-primary)] max-w-xs truncate">{r.nama_member}</td>
                          <td className="py-2 px-3">
                            <div className="font-mono text-indigo-400 font-semibold">{r.prd_prdcd}</div>
                            <div className="text-[var(--text-muted)] text-[11px] max-w-[200px] truncate">{r.nama_barang}</div>
                          </td>
                          <td className="py-2 px-3 font-mono text-[var(--text-muted)] text-[11px]">
                            {r.periode_dari} s/d {r.periode_sampai}
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={r.status_followup}
                              onChange={(e) => handleInlineStatusChange(r.id, e.target.value)}
                              className="px-2 py-1 text-xs rounded-md bg-[var(--bg-app-alt)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                            >
                              {STATUS_OPTS.map((st) => (
                                <option key={st} value={st}>{st}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3 text-[var(--text-muted)] max-w-[160px] truncate">
                            {r.catatan || '-'}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => openEditModal(r)}
                                className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                                title="Edit Catatan & Status"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteMonitoring(r.id)}
                                className="p-1 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                                title="Hapus Data"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              currentPage={pageMonitoring}
              totalItems={filteredMonitoring.length}
              pageSize={pageSizeMonitoring}
              onPageChange={setPageMonitoring}
              onPageSizeChange={setPageSizeMonitoring}
            />
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: KELOLA MASTER PARETO */}
      {/* ============================================================ */}
      {isMasterModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[var(--accent)]" />
                <h3 className="font-semibold text-sm text-[var(--text-primary)]">Master Item Pareto</h3>
              </div>
              <button onClick={() => setIsMasterModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Input Tambah Item */}
            <div className="p-3 rounded-xl bg-[var(--bg-app-alt)] border border-[var(--border)] space-y-3">
              <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Tambah Item Pareto</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                    Cabang
                  </label>
                  <select
                    value={newCabang}
                    onChange={(e) => setNewCabang(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="ALL">ALL (Semua)</option>
                    <option value={cabang}>{cabang}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                    Kode PLU / Barcode
                  </label>
                  <Input
                    type="text"
                    placeholder="0027940"
                    value={newPlu}
                    onChange={(e) => setNewPlu(e.target.value)}
                    onBlur={handlePluBlur}
                    className="text-xs font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                    Nama Barang
                  </label>
                  <Input
                    type="text"
                    placeholder="Nama barang..."
                    value={newNamaBarang}
                    onChange={(e) => setNewNamaBarang(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>

              {masterError && (
                <div className="text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                  {masterError}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  variant="primary"
                  className="text-xs px-4 py-1.5 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={handleSaveMasterItem}
                  disabled={isSavingMaster || !newPlu.trim()}
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSavingMaster ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </div>
            </div>

            {/* List Existing Master Items */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)] flex items-center justify-between">
                <span>Daftar Item Master</span>
                {loadingMaster && <RefreshCw className="w-3 h-3 animate-spin text-[var(--accent)]" />}
              </div>

              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-[var(--bg-app-alt)] text-[var(--text-secondary)] border-b border-[var(--border)]">
                    <tr>
                      <th className="py-2 px-3 w-10 text-center">No</th>
                      <th className="py-2 px-3 w-20">Cabang</th>
                      <th className="py-2 px-3 w-24">PLU</th>
                      <th className="py-2 px-3">Nama Barang</th>
                      <th className="py-2 px-3 w-16 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {masterItems.map((item, idx) => (
                      <tr key={`${item.cabang || 'ALL'}_${item.prd_prdcd}`} className="hover:bg-[var(--bg-app-alt)] transition-colors">
                        <td className="py-2 px-3 text-center text-[var(--text-muted)]">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono font-semibold text-sky-400">{item.cabang || 'ALL'}</td>
                        <td className="py-2 px-3 font-mono font-semibold text-amber-400">{item.prd_prdcd}</td>
                        <td className="py-2 px-3 font-medium text-[var(--text-primary)]">{item.nama_barang}</td>
                        <td className="py-2 px-3 text-center">
                          {item.id ? (
                            <button
                              onClick={() => handleDeleteMasterItem(item.id)}
                              className="p-1 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                              title="Hapus"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="text-[10px] text-[var(--text-muted)]">Default</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-[var(--border)]">
              <Button
                variant="ghost"
                className="text-xs px-4 py-1.5 border border-[var(--border)]"
                onClick={() => setIsMasterModalOpen(false)}
              >
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: EDIT NOTE & STATUS */}
      {/* ============================================================ */}
      {editingRow && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="font-semibold text-sm text-[var(--text-primary)]">Follow-up Target</h3>
              <button onClick={() => setEditingRow(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-1.5 text-[var(--text-secondary)]">
              <div><span className="font-semibold text-[var(--text-primary)]">Member:</span> {editingRow.nama_member} ({editingRow.kode_member})</div>
              <div><span className="font-semibold text-[var(--text-primary)]">Produk:</span> {editingRow.nama_barang} ({editingRow.prd_prdcd})</div>
              <div><span className="font-semibold text-[var(--text-primary)]">Advisor:</span> {editingRow.username}</div>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Status Follow-up</label>
                <Select value={statusInput} onChange={(e) => setStatusInput(e.target.value)}>
                  {STATUS_OPTS.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Catatan</label>
                <textarea
                  rows={3}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Catatan..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-app-alt)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="ghost" className="text-xs px-3 py-1.5 border border-[var(--border)]" onClick={() => setEditingRow(null)}>
                Batal
              </Button>
              <Button variant="primary" className="text-xs px-3 py-1.5" onClick={handleSaveModal} disabled={savingStatus}>
                <Save className="w-3.5 h-3.5 mr-1" />
                {savingStatus ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
