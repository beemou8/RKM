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
  Info,
} from 'lucide-react';
import { Card, CardHeader, StatCard, Badge, Button, Input, Select, EmptyState } from '../components/ui';
import type { LayoutContext } from '../components/Layout';
import type { KilometerMotorRow } from '../types';
import {
  fetchKilometerMotor,
  hitungGpsKm,
  saveKilometerMotor,
  deleteKilometerMotor,
  exportKilometerMotorUrl,
  fetchTracking,
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

export default function KilometerMotor() {
  const { cabang } = useOutletContext<LayoutContext>();

  // Filter list state
  const [tglDari, setTglDari] = useState(firstDayOfMonthStr());
  const [tglSampai, setTglSampai] = useState(todayStr());
  const [petugasFilter, setPetugasFilter] = useState('');
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
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Load advisor list from tracking API
  useEffect(() => {
    if (!cabang) return;
    fetchTracking(todayStr(), '', cabang)
      .then((res) => {
        if (res.advisor_list && Array.isArray(res.advisor_list)) {
          setAdvisorList(res.advisor_list);
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
        setError(err.message || 'Gagal memuat catatan kilometer');
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
      alert('Pilih tanggal dan petugas terlebih dahulu.');
      return;
    }
    if (kmAkhirNum <= kmAwalNum && kmAkhirNum > 0) {
      alert('KM Akhir harus lebih besar daripada KM Awal.');
      return;
    }

    setSubmitting(true);
    setSubmitSuccess(null);
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

      setSubmitSuccess(`Catatan kilometer untuk ${formPetugas} (${formTanggal}) berhasil disimpan!`);
      setFormKmAwal('');
      setFormKmAkhir('');
      setFormKeterangan('');
      loadData();
      setTimeout(() => setSubmitSuccess(null), 5000);
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan catatan');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id?: number) => {
    if (!id) return;
    if (!confirm('Yakin ingin menghapus catatan kilometer ini?')) return;
    try {
      await deleteKilometerMotor(id);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus');
    }
  };

  // Filtered table data
  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dataList;
    return dataList.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        (r.nama_petugas && r.nama_petugas.toLowerCase().includes(q)) ||
        (r.keterangan && r.keterangan.toLowerCase().includes(q))
    );
  }, [dataList, search]);

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

  const countAnomali = useMemo(() => {
    return dataList.filter((r) => r.status_validasi === 'ANOMALI' || r.status_validasi === 'TOLERANSI').length;
  }, [dataList]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                Pencatatan Kilometer Motor
              </h1>
              <p className="text-xs text-[var(--text-muted)]">
                Validasi klaim odometer motor advisor terhadap total kilometer GPS tracking riil &bull; Cabang{' '}
                <span className="font-semibold text-[var(--accent)]">{cabang}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={loadData} disabled={loading} title="Refresh data">
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Gauge}
          label="Total KM Fisik Motor"
          value={`${totalKmMotor.toLocaleString('id-ID')} km`}
          sub="Akumulasi odometer fisik"
          tone="blue"
        />
        <StatCard
          icon={Navigation}
          label="Total KM GPS Tracking"
          value={`${totalKmGps.toLocaleString('id-ID')} km`}
          sub="Rekaman sinyal GPS riil"
          tone="slate"
        />
        <StatCard
          icon={CheckCircle2}
          label="Valid / Wajar"
          value={countValid}
          sub="Deviasi wajar (≤ 15%)"
          tone="emerald"
        />
        <StatCard
          icon={AlertTriangle}
          label="Perlu Verifikasi"
          value={countAnomali}
          sub="Toleransi sedang & anomali"
          tone={countAnomali > 0 ? 'rose' : 'slate'}
        />
      </div>

      {/* Form Input Catatan Kilometer Baru */}
      <Card className="p-5 border-blue-500/20 bg-blue-500/[0.02]">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-blue-500" />
            Input Catatan Odometer Motor Harian
          </h2>
          <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-blue-400" />
            KM GPS otomatis dihitung dari titik GPS hari terpilih
          </span>
        </div>

        {submitSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {submitSuccess}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Tanggal Operasional
              </label>
              <Input
                type="date"
                value={formTanggal}
                onChange={(e) => setFormTanggal(e.target.value)}
                required
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Petugas / Advisor
              </label>
              <Select
                value={formPetugas}
                onChange={(e) => setFormPetugas(e.target.value)}
                required
                className="w-full"
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
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                KM Awal (Berangkat)
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                placeholder="misal: 14250.0"
                value={formKmAwal}
                onChange={(e) => setFormKmAwal(e.target.value)}
                required
                className="w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                KM Akhir (Pulang)
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                placeholder="misal: 14285.5"
                value={formKmAkhir}
                onChange={(e) => setFormKmAkhir(e.target.value)}
                required
                className="w-full font-mono"
              />
            </div>
          </div>

          {/* Live Validation Bar */}
          <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6 text-xs">
              <div>
                <span className="text-[var(--text-faint)] block text-[10px]">KM FISIK MOTOR</span>
                <span className="font-mono font-semibold text-sm text-[var(--text-primary)]">
                  {kmMotorTotal > 0 ? `${kmMotorTotal} km` : '-'}
                </span>
              </div>

              <div>
                <span className="text-[var(--text-faint)] block text-[10px] flex items-center gap-1">
                  KM GPS TRACKING
                  {fetchingGps && <RefreshCw className="w-2.5 h-2.5 animate-spin text-blue-400" />}
                </span>
                <span className="font-mono font-semibold text-sm text-blue-400">
                  {formKmGps > 0 ? `${formKmGps} km` : '0.0 km'}
                  <span className="text-[10px] text-[var(--text-faint)] ml-1">({formGpsPoints} titik)</span>
                </span>
              </div>

              <div>
                <span className="text-[var(--text-faint)] block text-[10px]">SELISIH JARAK</span>
                <span className="font-mono font-semibold text-sm text-[var(--text-primary)]">
                  {kmMotorTotal > 0 ? `${selisihKm} km (${deviasiPersen}%)` : '-'}
                </span>
              </div>

              <div>
                <span className="text-[var(--text-faint)] block text-[10px]">STATUS EVALUASI</span>
                {kmMotorTotal > 0 ? (
                  validasiStatus === 'VALID' ? (
                    <Badge tone="emerald">🟢 VALID (WAJAR)</Badge>
                  ) : validasiStatus === 'TOLERANSI' ? (
                    <Badge tone="amber">🟡 TOLERANSI (GANG/MACET)</Badge>
                  ) : (
                    <Badge tone="rose">🔴 ANOMALI (PERLU CEK)</Badge>
                  )
                ) : (
                  <span className="text-[10px] text-[var(--text-faint)]">Menunggu input KM</span>
                )}
              </div>
            </div>

            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Catatan / keterangan perjalanan (opsional)"
                value={formKeterangan}
                onChange={(e) => setFormKeterangan(e.target.value)}
                className="w-full text-xs"
              />
            </div>

            <Button type="submit" variant="primary" disabled={submitting || kmMotorTotal <= 0}>
              <PlusCircle className="w-3.5 h-3.5" />
              {submitting ? 'Menyimpan...' : 'Simpan Catatan'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Tabel Riwayat & Filter */}
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 mb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Riwayat Kilometer Motor ({filteredData.length})
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                placeholder="Cari petugas / catatan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-44 text-xs"
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

            <Input
              type="date"
              value={tglDari}
              onChange={(e) => setTglDari(e.target.value)}
              className="w-36 text-xs"
            />
            <span className="text-xs text-[var(--text-faint)]">s/d</span>
            <Input
              type="date"
              value={tglSampai}
              onChange={(e) => setTglSampai(e.target.value)}
              className="w-36 text-xs"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {error}
          </div>
        )}

        {filteredData.length === 0 ? (
          <EmptyState
            icon={Gauge}
            text={
              loading
                ? 'Memuat catatan kilometer motor...'
                : 'Belum ada data catatan kilometer motor pada periode ini.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2.5 px-3 font-semibold">Tanggal</th>
                  <th className="py-2.5 px-3 font-semibold">Petugas / Advisor</th>
                  <th className="py-2.5 px-3 font-semibold text-right">KM Awal</th>
                  <th className="py-2.5 px-3 font-semibold text-right">KM Akhir</th>
                  <th className="py-2.5 px-3 font-semibold text-right text-blue-400">Total KM Motor</th>
                  <th className="py-2.5 px-3 font-semibold text-right text-emerald-400">Total KM GPS</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Selisih</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Deviasi</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Keterangan</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-[var(--text-secondary)]">
                {filteredData.map((row) => (
                  <tr key={row.id || `${row.tanggal}-${row.username}`} className="hover:bg-[var(--bg-hover)] transition-colors">
                    <td className="py-2.5 px-3 font-mono font-medium">{row.tanggal}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[var(--text-primary)]">
                        {row.nama_petugas || row.username}
                      </div>
                      <div className="text-[10px] text-[var(--text-faint)] font-mono">{row.username}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[var(--text-muted)]">
                      {Number(row.km_awal).toLocaleString('id-ID', { minimumFractionDigits: 1 })}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[var(--text-muted)]">
                      {Number(row.km_akhir).toLocaleString('id-ID', { minimumFractionDigits: 1 })}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-blue-400">
                      {Number(row.km_motor).toLocaleString('id-ID', { minimumFractionDigits: 1 })} km
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-400">
                      {Number(row.km_gps).toLocaleString('id-ID', { minimumFractionDigits: 1 })} km
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {Number(row.selisih_km).toLocaleString('id-ID', { minimumFractionDigits: 1 })} km
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono">
                      {row.deviasi_persen}%
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {row.status_validasi === 'VALID' ? (
                        <Badge tone="emerald">VALID</Badge>
                      ) : row.status_validasi === 'TOLERANSI' ? (
                        <Badge tone="amber">TOLERANSI</Badge>
                      ) : (
                        <Badge tone="rose">ANOMALI</Badge>
                      )}
                    </td>
                    <td className="py-2.5 px-3 max-w-[200px] truncate text-[11px] text-[var(--text-faint)]">
                      {row.keterangan || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => handleDelete(row.id)}
                        className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                        title="Hapus catatan"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
