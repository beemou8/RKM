import { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Gauge,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  PlusCircle,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  X,
  AlertCircle,
} from 'lucide-react';
import { Card, StatCard, Badge, Button, Input, Select, EmptyState } from '../components/ui';
import type { LayoutContext } from '../components/Layout';
import type { KilometerMotorRow } from '../types';
import {
  fetchKilometerMotor,
  hitungGpsKm,
  saveKilometerMotor,
  deleteKilometerMotor,
  exportKilometerMotorUrl,
  fetchKilometerMotorAdvisors,
} from '../lib/api';

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function firstDayOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

type ToastState = {
  message: string;
  type: 'success' | 'error' | 'info';
} | null;

type StatusFilterType = 'ALL' | 'VALID' | 'TOLERANSI' | 'ANOMALI';

export default function KilometerMotor() {
  const { cabang } = useOutletContext<LayoutContext>();

  // Filter list state
  const [tglDari, setTglDari] = useState(firstDayOfMonthStr());
  const [tglSampai, setTglSampai] = useState(todayStr());
  const [petugasFilter, setPetugasFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('ALL');
  const [search, setSearch] = useState('');

  // Data state
  const [dataList, setDataList] = useState<KilometerMotorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advisorList, setAdvisorList] = useState<Array<{ username: string; nama_lengkap: string }>>([]);

  // Form input state
  const [formTanggal, setFormTanggal] = useState(todayStr());
  const [formPetugas, setFormPetugas] = useState('');
  const [formKmAwal, setFormKmAwal] = useState<string>('');
  const [formKmAkhir, setFormKmAkhir] = useState<string>('');
  const [formKmGps, setFormKmGps] = useState<number>(0);
  const [formGpsPoints, setFormGpsPoints] = useState<number>(0);
  const [formKeterangan, setFormKeterangan] = useState('');
  const [fetchingGps, setFetchingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // UI helpers
  const [toast, setToast] = useState<ToastState>(null);
  const [deleteTarget, setDeleteTarget] = useState<KilometerMotorRow | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  };

  // Load advisor list langsung dari endpoint khusus yang ringan dan dicache
  useEffect(() => {
    if (!cabang) return;
    fetchKilometerMotorAdvisors(cabang)
      .then((res) => {
        if (res.data && Array.isArray(res.data)) {
          setAdvisorList(res.data);
        }
      })
      .catch(() => {});
  }, [cabang]);

  // Load list data
  const loadData = useCallback(() => {
    if (!cabang) return;
    setLoading(true);
    setError(null);
    fetchKilometerMotor(cabang, tglDari, tglSampai, petugasFilter)
      .then((res) => {
        setDataList(res.data || []);
      })
      .catch((err) => {
        setError(err.message || 'Gagal memuat catatan kilometer motor');
      })
      .finally(() => setLoading(false));
  }, [cabang, tglDari, tglSampai, petugasFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto fetch KM GPS saat tanggal atau petugas form berubah
  useEffect(() => {
    if (!cabang || !formTanggal || !formPetugas) {
      setFormKmGps(0);
      setFormGpsPoints(0);
      return;
    }

    let active = true;
    setFetchingGps(true);
    hitungGpsKm(cabang, formTanggal, formPetugas)
      .then((res) => {
        if (active) {
          setFormKmGps(res.km_gps || 0);
          setFormGpsPoints(res.total_titik || 0);
        }
      })
      .catch(() => {
        if (active) {
          setFormKmGps(0);
          setFormGpsPoints(0);
        }
      })
      .finally(() => {
        if (active) setFetchingGps(false);
      });

    return () => {
      active = false;
    };
  }, [cabang, formTanggal, formPetugas]);

  // Form calculation preview
  const kmAwalNum = parseFloat(formKmAwal) || 0;
  const kmAkhirNum = parseFloat(formKmAkhir) || 0;
  const kmMotorTotal = Math.max(0, Math.round((kmAkhirNum - kmAwalNum) * 10) / 10);
  const selisihKm = Math.round(Math.abs(kmMotorTotal - formKmGps) * 10) / 10;
  const deviasiPersen = kmMotorTotal > 0 ? Math.round((selisihKm / kmMotorTotal) * 1000) / 10 : 0;

  const validasiStatus: 'VALID' | 'TOLERANSI' | 'ANOMALI' = useMemo(() => {
    if (kmMotorTotal <= 0) return 'VALID';
    if (deviasiPersen > 25 && selisihKm > 5) return 'ANOMALI';
    if (deviasiPersen > 15 || selisihKm > 3) return 'TOLERANSI';
    return 'VALID';
  }, [kmMotorTotal, deviasiPersen, selisihKm]);

  // Submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cabang) return;

    if (!formTanggal || !formPetugas) {
      showToast('Pilih tanggal dan advisor terlebih dahulu.', 'error');
      return;
    }

    if (kmAkhirNum <= kmAwalNum && kmAkhirNum > 0) {
      showToast('KM Pulang harus lebih besar daripada KM Berangkat.', 'error');
      return;
    }

    if (kmMotorTotal <= 0) {
      showToast('Total kilometer motor harus lebih besar dari 0 km.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const selectedAdv = advisorList.find((a) => a.username === formPetugas);
      await saveKilometerMotor({
        cabang,
        tanggal: formTanggal,
        username: formPetugas,
        nama_petugas: selectedAdv?.nama_lengkap || formPetugas,
        km_awal: kmAwalNum,
        km_akhir: kmAkhirNum,
        km_gps: formKmGps,
        keterangan: formKeterangan,
      });

      showToast(`Catatan ${formPetugas} (${formTanggal}) tersimpan.`, 'success');
      setFormKmAwal('');
      setFormKmAkhir('');
      setFormKeterangan('');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Gagal menyimpan catatan', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete handler with confirmation modal
  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    try {
      await deleteKilometerMotor(deleteTarget.id);
      showToast('Catatan kilometer berhasil dihapus.', 'success');
      setDeleteTarget(null);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Gagal menghapus catatan', 'error');
    }
  };

  // Filtered table data
  const filteredData = useMemo(() => {
    let result = dataList;

    if (statusFilter !== 'ALL') {
      result = result.filter((r) => r.status_validasi === statusFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.username.toLowerCase().includes(q) ||
          (r.nama_petugas && r.nama_petugas.toLowerCase().includes(q)) ||
          (r.keterangan && r.keterangan.toLowerCase().includes(q))
      );
    }

    return result;
  }, [dataList, statusFilter, search]);

  // Aggregate stats
  const totalKmMotor = useMemo(() => {
    return Math.round(dataList.reduce((acc, r) => acc + (Number(r.km_motor) || 0), 0) * 10) / 10;
  }, [dataList]);

  const totalKmGps = useMemo(() => {
    return Math.round(dataList.reduce((acc, r) => acc + (Number(r.km_gps) || 0), 0) * 10) / 10;
  }, [dataList]);

  const countValid = useMemo(() => {
    return dataList.filter((r) => r.status_validasi === 'VALID').length;
  }, [dataList]);

  const countToleransi = useMemo(() => {
    return dataList.filter((r) => r.status_validasi === 'TOLERANSI').length;
  }, [dataList]);

  const countAnomali = useMemo(() => {
    return dataList.filter((r) => r.status_validasi === 'ANOMALI').length;
  }, [dataList]);

  // Percentage of GPS vs physical odometer
  const maxMeterKm = Math.max(kmMotorTotal, formKmGps, 1);
  const motorMeterPct = Math.min(100, Math.round((kmMotorTotal / maxMeterKm) * 100));
  const gpsMeterPct = Math.min(100, Math.round((formKmGps / maxMeterKm) * 100));

  return (
    <div className="space-y-5">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-xl border text-xs font-medium bg-[var(--bg-card)] border-[var(--border-strong)] text-[var(--text-primary)] animate-in fade-in slide-in-from-bottom-2">
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          {toast.type === 'info' && <Gauge className="w-4 h-4 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" />
              Hapus Catatan Kilometer
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Hapus catatan {deleteTarget.nama_petugas || deleteTarget.username} tanggal {deleteTarget.tanggal} ({deleteTarget.km_motor} km)?
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                Batal
              </Button>
              <Button variant="danger" onClick={confirmDelete}>
                Hapus
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
            <Gauge className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--text-primary)]">
              Kilometer Motor
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={loadData} disabled={loading} title="Perbarui data">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <a
            href={exportKilometerMotorUrl(cabang, tglDari, tglSampai, petugasFilter)}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="success">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export Excel
            </Button>
          </a>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Gauge}
          label="Total KM Fisik"
          value={`${totalKmMotor.toLocaleString('id-ID')} km`}
          tone="blue"
        />
        <StatCard
          icon={Navigation}
          label="Total KM GPS"
          value={`${totalKmGps.toLocaleString('id-ID')} km`}
          tone="slate"
        />
        <StatCard
          icon={CheckCircle2}
          label="Klaim Wajar"
          value={countValid}
          tone="emerald"
        />
        <StatCard
          icon={AlertTriangle}
          label="Perlu Cek SPV"
          value={countAnomali}
          tone={countAnomali > 0 ? 'rose' : 'slate'}
        />
      </div>

      {/* Form Input Odometer */}
      <Card className="p-4 border-blue-500/20 bg-blue-500/[0.015]">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border)]">
          <h2 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2 uppercase tracking-wider">
            <PlusCircle className="w-4 h-4 text-blue-500" />
            Input Catatan Odometer
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                Tanggal
              </label>
              <Input
                type="date"
                value={formTanggal}
                onChange={(e) => setFormTanggal(e.target.value)}
                required
                className="w-full text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                Petugas / Advisor
              </label>
              <Select
                value={formPetugas}
                onChange={(e) => setFormPetugas(e.target.value)}
                required
                className="w-full text-xs"
              >
                <option value="">-- Pilih Advisor --</option>
                {advisorList.map((adv) => (
                  <option key={adv.username} value={adv.username}>
                    {adv.nama_lengkap || adv.username} ({adv.username})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                KM Berangkat
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                placeholder="misal: 14250.0"
                value={formKmAwal}
                onChange={(e) => setFormKmAwal(e.target.value)}
                required
                className="w-full font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                KM Pulang
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                placeholder="misal: 14285.5"
                value={formKmAkhir}
                onChange={(e) => setFormKmAkhir(e.target.value)}
                required
                className="w-full font-mono text-xs"
              />
            </div>
          </div>

          {/* Real-time Calculation Bar */}
          <div className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-2">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[var(--text-faint)] block text-[10px] font-semibold uppercase">
                    KM Motor
                  </span>
                  <span className="font-mono font-bold text-sm text-blue-400">
                    {kmMotorTotal > 0 ? `${kmMotorTotal.toLocaleString('id-ID')} km` : '-'}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--text-faint)] block text-[10px] font-semibold uppercase flex items-center gap-1">
                    KM GPS
                    {fetchingGps && <RefreshCw className="w-2.5 h-2.5 animate-spin text-emerald-400" />}
                  </span>
                  <span className="font-mono font-bold text-sm text-emerald-400">
                    {formKmGps > 0 ? `${formKmGps.toLocaleString('id-ID')} km` : '0.0 km'}
                  </span>
                  <span className="text-[10px] text-[var(--text-faint)] block">
                    {formGpsPoints} titik
                  </span>
                </div>

                <div>
                  <span className="text-[var(--text-faint)] block text-[10px] font-semibold uppercase">
                    Selisih
                  </span>
                  <span className="font-mono font-bold text-sm text-[var(--text-primary)]">
                    {kmMotorTotal > 0 ? `${selisihKm.toLocaleString('id-ID')} km` : '-'}
                  </span>
                  {kmMotorTotal > 0 && (
                    <span className="text-[10px] text-[var(--text-muted)] block">
                      {deviasiPersen}%
                    </span>
                  )}
                </div>

                <div>
                  <span className="text-[var(--text-faint)] block text-[10px] font-semibold uppercase mb-1">
                    Status
                  </span>
                  {kmMotorTotal > 0 ? (
                    validasiStatus === 'VALID' ? (
                      <Badge tone="emerald">WAJAR</Badge>
                    ) : validasiStatus === 'TOLERANSI' ? (
                      <Badge tone="amber">TOLERANSI</Badge>
                    ) : (
                      <Badge tone="rose">CEK SPV</Badge>
                    )
                  ) : (
                    <span className="text-[11px] text-[var(--text-faint)]">-</span>
                  )}
                </div>
              </div>

              {kmMotorTotal > 0 && (
                <div className="w-full lg:w-64 p-2.5 rounded-lg bg-[var(--wash-1)] border border-[var(--border)] space-y-1.5">
                  <div>
                    <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-0.5">
                      <span>Fisik</span>
                      <span className="font-mono text-blue-400">{kmMotorTotal} km</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${motorMeterPct}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-0.5">
                      <span>GPS</span>
                      <span className="font-mono text-emerald-400">{formKmGps} km</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${gpsMeterPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-[var(--border)] flex flex-col sm:flex-row items-center gap-2">
              <div className="flex-1 w-full">
                <Input
                  placeholder="Catatan (opsional)"
                  value={formKeterangan}
                  onChange={(e) => setFormKeterangan(e.target.value)}
                  className="w-full text-xs"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                disabled={submitting || kmMotorTotal <= 0}
                className="w-full sm:w-auto shrink-0"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      {/* Tabel Data & Filter */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 pb-3 mb-3 border-b border-[var(--border)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Riwayat Kilometer ({filteredData.length})
            </h3>

            {/* Quick Status Filter Tabs */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--wash-1)] border border-[var(--border)] overflow-x-auto">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                  statusFilter === 'ALL'
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Semua ({dataList.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('VALID')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                  statusFilter === 'VALID'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-[var(--text-muted)] hover:text-emerald-400'
                }`}
              >
                Wajar ({countValid})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('TOLERANSI')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                  statusFilter === 'TOLERANSI'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'text-[var(--text-muted)] hover:text-amber-400'
                }`}
              >
                Toleransi ({countToleransi})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ANOMALI')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                  statusFilter === 'ANOMALI'
                    ? 'bg-rose-500/20 text-rose-400'
                    : 'text-[var(--text-muted)] hover:text-rose-400'
                }`}
              >
                Cek SPV ({countAnomali})
              </button>
            </div>
          </div>

          {/* Filter Inputs */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                placeholder="Cari advisor / catatan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-full text-xs"
              />
            </div>

            <Select
              value={petugasFilter}
              onChange={(e) => setPetugasFilter(e.target.value)}
              className="w-40 text-xs"
            >
              <option value="">Semua Advisor</option>
              {advisorList.map((a) => (
                <option key={a.username} value={a.username}>
                  {a.nama_lengkap || a.username}
                </option>
              ))}
            </Select>

            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={tglDari}
                onChange={(e) => setTglDari(e.target.value)}
                className="w-32 text-xs"
              />
              <span className="text-xs text-[var(--text-faint)]">-</span>
              <Input
                type="date"
                value={tglSampai}
                onChange={(e) => setTglSampai(e.target.value)}
                className="w-32 text-xs"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="p-2.5 mb-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {filteredData.length === 0 ? (
          <EmptyState
            icon={Gauge}
            text={
              loading
                ? 'Memuat data kilometer...'
                : 'Tidak ada data kilometer pada filter ini.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)] bg-[var(--wash-1)]">
                  <th className="py-2 px-3 font-semibold">Tanggal</th>
                  <th className="py-2 px-3 font-semibold">Advisor</th>
                  <th className="py-2 px-3 font-semibold text-right">KM Awal</th>
                  <th className="py-2 px-3 font-semibold text-right">KM Akhir</th>
                  <th className="py-2 px-3 font-semibold text-right text-blue-400">KM Motor</th>
                  <th className="py-2 px-3 font-semibold text-right text-emerald-400">KM GPS</th>
                  <th className="py-2 px-3 font-semibold text-right">Selisih</th>
                  <th className="py-2 px-3 font-semibold text-center">Deviasi</th>
                  <th className="py-2 px-3 font-semibold text-center">Status</th>
                  <th className="py-2 px-3 font-semibold">Catatan</th>
                  <th className="py-2 px-3 font-semibold text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-[var(--text-secondary)]">
                {filteredData.map((row) => (
                  <tr
                    key={row.id || `${row.tanggal}-${row.username}`}
                    className="hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <td className="py-2 px-3 font-mono text-[var(--text-primary)]">
                      {row.tanggal}
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-semibold text-[var(--text-primary)]">
                        {row.nama_petugas || row.username}
                      </div>
                      <div className="text-[10px] text-[var(--text-faint)] font-mono">{row.username}</div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-muted)]">
                      {Number(row.km_awal).toLocaleString('id-ID', { minimumFractionDigits: 1 })}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-muted)]">
                      {Number(row.km_akhir).toLocaleString('id-ID', { minimumFractionDigits: 1 })}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-blue-400">
                      {Number(row.km_motor).toLocaleString('id-ID', { minimumFractionDigits: 1 })} km
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                      {Number(row.km_gps).toLocaleString('id-ID', { minimumFractionDigits: 1 })} km
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-[var(--text-primary)]">
                      {Number(row.selisih_km).toLocaleString('id-ID', { minimumFractionDigits: 1 })} km
                    </td>
                    <td className="py-2 px-3 text-center font-mono">
                      {row.deviasi_persen}%
                    </td>
                    <td className="py-2 px-3 text-center">
                      {row.status_validasi === 'VALID' ? (
                        <Badge tone="emerald">WAJAR</Badge>
                      ) : row.status_validasi === 'TOLERANSI' ? (
                        <Badge tone="amber">TOLERANSI</Badge>
                      ) : (
                        <Badge tone="rose">CEK SPV</Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 max-w-[200px] truncate text-[11px] text-[var(--text-muted)]" title={row.keterangan || undefined}>
                      {row.keterangan || '-'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => setDeleteTarget(row)}
                        className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Hapus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-[var(--border)] bg-[var(--wash-1)] text-xs font-semibold">
                <tr>
                  <td colSpan={4} className="py-2 px-3 text-[var(--text-muted)]">
                    Total ({filteredData.length} baris)
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-blue-400">
                    {filteredData
                      .reduce((sum, r) => sum + (Number(r.km_motor) || 0), 0)
                      .toLocaleString('id-ID', { minimumFractionDigits: 1 })}{' '}
                    km
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                    {filteredData
                      .reduce((sum, r) => sum + (Number(r.km_gps) || 0), 0)
                      .toLocaleString('id-ID', { minimumFractionDigits: 1 })}{' '}
                    km
                  </td>
                  <td colSpan={5} className="py-2 px-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

