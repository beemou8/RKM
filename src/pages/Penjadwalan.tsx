import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { MapContainer, Polyline, Marker, Popup } from 'react-leaflet';
import {
  Route,
  Search,
  Zap,
  RotateCcw,
  UploadCloud,
  FileSpreadsheet,
  UserRound,
  Compass,
  List,
  X,
  Plus,
  Save,
  ShieldAlert,
  Repeat,
  FileUp,
  Download,
  CheckCircle2,
  Star,
} from 'lucide-react';
import {
  fetchScheduleAdvisors,
  fetchScheduleGenerate,
  pushSchedule,
  exportSchedule,
  downloadBlob,
  fetchMemberLookup,
  fetchExistingDay,
  fetchStatusToko,
  importScheduleTemplateUrl,
  importSchedule,
  memberPilihanTemplateUrl,
  uploadMemberPilihan,
  type MemberPilihanUploadResult,
  type ImportScheduleResult,
} from '../lib/api';
import type { ScheduleResponse, CustomerCandidate, JadwalBulanan, StatusToko } from '../types';
import { Card, Select, Input, Button, EmptyState } from '../components/ui';
import { FitBounds, numberedIcon, useRoadRoute, CartoTileLayer } from '../components/mapUtils';
import { useTheme } from '../lib/theme';
import type { LayoutContext } from '../components/Layout';
import PenjadwalanSpvSubPage from '../components/PenjadwalanSpvSubPage';

const now = new Date();

export default function Penjadwalan() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [scheduleMode, setScheduleMode] = useState<'reguler' | 'spv'>('reguler');
  const [theme] = useTheme();
  const routeColor = theme === 'light' ? '#2563eb' : '#60a5fa';
  const [advisorList, setAdvisorList] = useState<string[]>([]);
  const [petugas, setPetugas] = useState('');
  const [tglDari, setTglDari] = useState('');
  const [tglSampai, setTglSampai] = useState('');
  const [bulan, setBulan] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [tahun, setTahun] = useState(String(now.getFullYear()));
  const [maksPerHari, setMaksPerHari] = useState('15');
  const [result, setResult] = useState<ScheduleResponse | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ advisor: string; tanggal: string; toko: CustomerCandidate[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [filterInfo, setFilterInfo] = useState<string | null>(null);
  
  // State untuk Modal Input Manual (fitur tersembunyi)
  const [showManualModal, setShowManualModal] = useState(false);
  const [submittingManual, setSubmittingManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    tanggal: '',
    username: '',
    kode_member: '',
    nama_toko: '',
  });
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'found' | 'blocked' | 'not_found'>('idle');
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [lookupLatLng, setLookupLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [lookupTipeMember, setLookupTipeMember] = useState<string | null>(null);
  const [existingDay, setExistingDay] = useState<JadwalBulanan[]>([]);
  const [replaceId, setReplaceId] = useState<number | ''>('');

  // State untuk Modal Import Excel
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportScheduleResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Upload Member Pilihan bulanan
  const [showPilihanModal, setShowPilihanModal] = useState(false);
  const [pilihanFile, setPilihanFile] = useState<File | null>(null);
  const [pilihanUploading, setPilihanUploading] = useState(false);
  const [pilihanResult, setPilihanResult] = useState<MemberPilihanUploadResult | null>(null);
  const [pilihanError, setPilihanError] = useState<string | null>(null);

  useEffect(() => {
    fetchScheduleAdvisors(cabang)
      .then((r) => setAdvisorList(r.advisors))
      .catch(() => {});
  }, [cabang]);

  const runGenerate = (mode: string) => {
    setLoading(true);
    setError(null);
    setPushMsg(null);
    setFilterInfo(null);
    Promise.all([
      fetchScheduleGenerate({ bulan, tahun, petugas, mode, tglDari, tglSampai, cabang, maksPerHari }),
      fetchStatusToko(cabang).catch(() => ({ data: [] as StatusToko[], jadwal_dihapus: 0 })),
    ])
      .then(([r, statusRes]) => {
        // Pastikan dulu toko yang ada di tbtr_status_toko benar-benar tidak
        // ikut sebelum ditampilkan ke frontend — pengaman tambahan di sisi
        // client, di luar filter yang sudah dilakukan di backend.
        const blockedCodes = new Set(
          (statusRes.data || []).map((s) => (s.kode_member || '').trim().toUpperCase()).filter(Boolean)
        );

        let jumlahDisaring = 0;
        const matrixBersih: typeof r.matrix = {};
        for (const [advisor, days] of Object.entries(r.matrix)) {
          const daysBersih = days
            .map((day) => {
              const tokoBersih = day.toko.filter((t) => {
                const blocked = blockedCodes.has((t.cus_kodemember || '').trim().toUpperCase());
                if (blocked) jumlahDisaring++;
                return !blocked;
              });
              return { ...day, toko: tokoBersih };
            })
            .filter((day) => day.toko.length > 0);
          if (daysBersih.length > 0) matrixBersih[advisor] = daysBersih;
        }

        setResult({ ...r, matrix: matrixBersih });
        const initChecked: Record<string, boolean> = {};
        Object.values(matrixBersih).forEach((days) =>
          days.forEach((day) => day.toko.forEach((t) => (initChecked[uniqueKey(day.tanggal, t.cus_kodemember)] = true)))
        );
        setChecked(initChecked);
        const infoParts: string[] = [];
        if (jumlahDisaring > 0) {
          infoParts.push(`${jumlahDisaring} toko yang terdaftar di Toko Tutup ikut disaring dari hasil generate.`);
        }
        if (r.hari_libur_dilewati && r.hari_libur_dilewati.length > 0) {
          const daftar = r.hari_libur_dilewati.map((h) => `${fmtDate(h.tanggal)} (${h.nama})`).join(', ');
          infoParts.push(`${r.hari_libur_dilewati.length} tanggal merah resmi dilewati dari penjadwalan: ${daftar}.`);
        }
        if (r.member_pilihan_info) {
          const rows = Object.entries(r.member_pilihan_info);
          const uploaded = rows.reduce((n, [, v]) => n + v.uploaded, 0);
          const generated = rows.reduce((n, [, v]) => n + v.generated, 0);
          const already = rows.reduce((n, [, v]) => n + v.already_scheduled, 0);
          const unresolved = rows.reduce((n, [, v]) => n + v.unresolved, 0);
          if (uploaded > 0) infoParts.push(`Member Pilihan: ${uploaded} member terdaftar, ${generated} slot baru dibuat, ${already} slot sudah ada${unresolved > 0 ? `, ${unresolved} slot belum tertampung` : ''}.`);
        }
        if (infoParts.length > 0) setFilterInfo(infoParts.join(' '));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const reset = () => {
    setResult(null);
    setPreview(null);
    setPetugas('');
    setTglDari('');
    setTglSampai('');
    setFilterInfo(null);
    setMaksPerHari('15');
  };

  // Lookup otomatis nama toko & cabang dari kode member (debounced), sekaligus
  // cek apakah toko ini berstatus tutup sebelum bisa dimasukkan ke jadwal.
  useEffect(() => {
    const kode = manualForm.kode_member.trim();
    if (!showManualModal || kode.length < 3) {
      setLookupState('idle');
      setLookupMsg(null);
      setLookupLatLng(null);
      setLookupTipeMember(null);
      return;
    }
    const id = setTimeout(() => {
      setLookupState('loading');
      fetchMemberLookup(kode, cabang)
        .then((r) => {
          if (r.blocked) {
            setLookupState('blocked');
            setLookupMsg(r.message || 'Toko ini berstatus tutup.');
            setLookupLatLng(null);
            setLookupTipeMember(null);
          } else if (r.found) {
            setLookupState('found');
            setLookupMsg(null);
            setManualForm((f) => ({ ...f, nama_toko: r.nama_toko || f.nama_toko }));
            setLookupLatLng(r.lat && r.lng ? { lat: r.lat, lng: r.lng } : null);
            setLookupTipeMember(r.tipe_member || null);
          } else {
            setLookupState('not_found');
            setLookupMsg(r.message || 'Kode member tidak ditemukan, silakan isi nama toko manual.');
            setLookupLatLng(null);
            setLookupTipeMember(null);
          }
        })
        .catch(() => {
          setLookupState('not_found');
          setLookupMsg('Gagal cek kode member, silakan isi nama toko manual.');
        });
    }, 450);
    return () => clearTimeout(id);
  }, [manualForm.kode_member, cabang, showManualModal]);

  // Ambil jadwal yang sudah ada untuk advisor + tanggal terpilih, supaya bisa
  // menggantikan salah satu dari maksimal 15 jadwal yang sudah ada di hari itu.
  useEffect(() => {
    setReplaceId('');
    if (!showManualModal || !manualForm.username || !manualForm.tanggal) {
      setExistingDay([]);
      return;
    }
    fetchExistingDay(manualForm.username, manualForm.tanggal, cabang)
      .then((r) => setExistingDay(r.data || []))
      .catch(() => setExistingDay([]));
  }, [manualForm.username, manualForm.tanggal, showManualModal, cabang]);

  const selectedCount = Object.values(checked).filter(Boolean).length;

  const toggleAllForDay = (tanggal: string, toko: CustomerCandidate[], value: boolean) => {
    setChecked((c) => {
      const next = { ...c };
      toko.forEach((t) => (next[uniqueKey(tanggal, t.cus_kodemember)] = value));
      return next;
    });
  };

  const gatherSelectedItems = () => {
    if (!result) return [];
    const items: Array<{ tanggal: string; username: string; kode_member: string; cabang: string; lat: number; lng: number; nama_toko: string; tipe_member?: string | null; member_pilihan?: boolean }> = [];
    for (const [adv, days] of Object.entries(result.matrix)) {
      for (const day of days) {
        for (const t of day.toko) {
          if (checked[uniqueKey(day.tanggal, t.cus_kodemember)]) {
            items.push({
              tanggal: day.tanggal,
              username: adv,
              kode_member: t.cus_kodemember,
              cabang: t.cus_kodeigr,
              lat: t.lat,
              lng: t.lng,
              nama_toko: t.cus_namamember,
              tipe_member: t.tipe_member || null,
              member_pilihan: !!t.member_pilihan,
            });
          }
        }
      }
    }
    return items;
  };

  const handlePush = async () => {
    const items = gatherSelectedItems();
    if (items.length === 0) {
      alert('Pilih minimal 1 jadwal toko untuk di-push.');
      return;
    }
    const konfirmasi = window.confirm(
      `Anda yakin ingin push ${items.length} jadwal terpilih ke Supabase Cloud?\n\nData akan langsung tersimpan ke database dan tidak bisa dibatalkan.`
    );
    if (!konfirmasi) return;

    setPushing(true);
    setError(null);
    try {
      const r = await pushSchedule(items);
      setPushMsg(`Sukses upload ${r.count} rute terpilih ke Supabase Cloud.`);
      window.location.reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPushing(false);
    }
  };

  // Fungsi Push Manual
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.tanggal || !manualForm.username || !manualForm.kode_member || !manualForm.nama_toko) {
      alert('Harap lengkapi semua field!');
      return;
    }
    if (lookupState === 'blocked') {
      alert(lookupMsg || 'Toko ini berstatus tutup dan tidak bisa dijadwalkan.');
      return;
    }

    const konfirmasi = window.confirm(
      replaceId
        ? `Anda yakin ingin mengganti jadwal ini dengan entri manual (${manualForm.nama_toko || manualForm.kode_member}) di Supabase?`
        : `Anda yakin ingin menambahkan jadwal manual (${manualForm.nama_toko || manualForm.kode_member}) ke Supabase?`
    );
    if (!konfirmasi) return;

    setSubmittingManual(true);
    try {
      const payload = [
        {
          tanggal: manualForm.tanggal,
          username: manualForm.username,
          kode_member: manualForm.kode_member.toUpperCase(),
          nama_toko: manualForm.nama_toko,
          cabang: cabang,
          lat: lookupLatLng?.lat ?? 0,
          lng: lookupLatLng?.lng ?? 0,
          tipe_member: lookupTipeMember,
          ...(replaceId ? { replace_id: replaceId } : {}),
        },
      ];

      await pushSchedule(payload);
      alert(replaceId ? 'Sukses mengganti jadwal dengan entri manual!' : 'Sukses menambahkan jadwal manual ke Supabase!');
      setShowManualModal(false);
      setManualForm({ tanggal: '', username: '', kode_member: '', nama_toko: '' });
      setReplaceId('');
      window.location.reload();
    } catch (err: any) {
      alert('Gagal push manual: ' + err.message);
    } finally {
      setSubmittingManual(false);
    }
  };

  const handleExport = async () => {
    const items = gatherSelectedItems();
    if (items.length === 0) {
      alert('Pilih minimal 1 jadwal toko untuk di-export.');
      return;
    }
    try {
      const blob = await exportSchedule(items);
      downloadBlob(blob, `Jadwal_RKM_${bulan}_${tahun}.xlsx`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDownloadTemplate = () => {
    window.open(importScheduleTemplateUrl(cabang), '_blank');
  };

  const handleImportSubmit = async () => {
    if (!importFile) {
      setImportError('Pilih file .xlsx terlebih dahulu.');
      return;
    }
    const konfirmasi = window.confirm(
      `Anda yakin ingin mengupload file "${importFile.name}" dan push isinya ke Supabase Cloud?\n\nData akan langsung tersimpan ke database dan tidak bisa dibatalkan.`
    );
    if (!konfirmasi) return;

    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const r = await importSchedule(importFile, cabang);
      setImportResult(r);
      setImportFile(null);
    } catch (e: any) {
      setImportError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const handlePilihanUpload = async () => {
    if (!pilihanFile) {
      setPilihanError('Pilih file .xlsx terlebih dahulu.');
      return;
    }
    setPilihanUploading(true);
    setPilihanError(null);
    setPilihanResult(null);
    try {
      const r = await uploadMemberPilihan(pilihanFile, cabang, bulan, tahun);
      setPilihanResult(r);
      setPilihanFile(null);
    } catch (e: any) {
      setPilihanError(e.message);
    } finally {
      setPilihanUploading(false);
    }
  };

  const closePilihanModal = () => {
    setShowPilihanModal(false);
    setPilihanFile(null);
    setPilihanError(null);
    setPilihanResult(null);
  };

  const closeImportModal = () => {
    const adaHasilSukses = !!importResult && importResult.inserted > 0;
    setShowImportModal(false);
    setImportFile(null);
    setImportResult(null);
    setImportError(null);
    // Kalau sebelumnya sudah ada data yang berhasil di-push, refresh halaman
    // supaya data yang tampil di layar sinkron dengan Supabase.
    if (adaHasilSukses) {
      window.location.reload();
    }
  };

  const previewLine: [number, number][] = useMemo(
    () => (preview ? preview.toko.filter((t) => t.lat && t.lng).map((t) => [t.lat, t.lng] as [number, number]) : []),
    [preview]
  );

  // Snap the visit sequence to real roads instead of a straight line that
  // cuts through blocks/buildings.
  const { route: roadRoute, loading: routeLoading, snapped: routeSnapped } = useRoadRoute(previewLine);

  return (
    <div className="max-w-[1700px] mx-auto space-y-4">
      <Card className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Compass className="w-4.5 h-4.5 text-amber-400" /> Penjadwalan RKM Bulanan
            {/* Tombol kecil tersembunyi untuk input manual */}
            <button 
              onClick={() => setShowManualModal(true)} 
              className="ml-2 p-1 text-[var(--text-muted)] hover:text-amber-400 opacity-30 hover:opacity-100 transition-all cursor-pointer"
              title="Input Jadwal Manual"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Toko di luar radius 15 km, yang terdaftar di Toko Tutup, hari Minggu, dan tanggal merah resmi otomatis dibuang/dilewati.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/toko-tutup">
            <Button variant="ghost">
              <List className="w-3.5 h-3.5" /> List Toko Tutup
            </Button>
          </Link>
          <Button variant="primary" onClick={() => setShowPilihanModal(true)}>
            <Star className="w-3.5 h-3.5" /> Upload Member Pilihan
          </Button>
          <Button variant="ghost" onClick={() => setShowImportModal(true)}>
            <FileUp className="w-3.5 h-3.5" /> Import Excel
          </Button>
          {result && (
            <Button variant="success" onClick={handleExport}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Selected ({selectedCount})
            </Button>
          )}
        </div>
      </Card>

      {/* Tab Switcher: Reguler vs Khusus SPV */}
      <div className="flex bg-[var(--surface)] p-1 rounded-xl border border-[var(--border-subtle)] gap-2">
        <button
          type="button"
          onClick={() => setScheduleMode('reguler')}
          className={`flex-1 py-2 px-4 text-xs font-bold rounded-lg transition-all text-center cursor-pointer ${
            scheduleMode === 'reguler'
              ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30 shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] border border-transparent'
          }`}
        >
          Penjadwalan Reguler (Advisor / MR)
        </button>
        <button
          type="button"
          onClick={() => setScheduleMode('spv')}
          className={`flex-1 py-2 px-4 text-xs font-bold rounded-lg transition-all text-center cursor-pointer ${
            scheduleMode === 'spv'
              ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] border border-transparent'
          }`}
        >
          Penjadwalan Khusus SPV
        </button>
      </div>

      {scheduleMode === 'spv' ? (
        <PenjadwalanSpvSubPage cabang={cabang} />
      ) : (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Advisor / MR</label>
            <Select value={petugas} onChange={(e) => setPetugas(e.target.value)} className="w-full">
              <option value="">Semua Advisor</option>
              {advisorList.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Dari Tanggal</label>
            <Input type="date" value={tglDari} onChange={(e) => setTglDari(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Sampai Tanggal</label>
            <Input type="date" value={tglSampai} onChange={(e) => setTglSampai(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Bulan</label>
            <Select value={bulan} onChange={(e) => setBulan(e.target.value)} className="w-full">
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Tahun</label>
            <Select value={tahun} onChange={(e) => setTahun(e.target.value)} className="w-full">
              {[now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5" title="Berapa toko maksimal dijadwalkan per hari per advisor">
              Member / Hari
            </label>
            <Input
              type="number"
              min={1}
              max={50}
              value={maksPerHari}
              onChange={(e) => setMaksPerHari(e.target.value)}
              className="w-full"
              placeholder="15"
            />
          </div>
          <div className="flex gap-1.5">
            <Button variant="primary" className="flex-1" onClick={() => runGenerate('')} disabled={loading}>
              <Search className="w-3.5 h-3.5" /> Cari
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => runGenerate('full')} disabled={loading} title="Generate Full Satu Bulan">
              <Zap className="w-3.5 h-3.5" /> Full
            </Button>
            <button onClick={reset} className="bg-[var(--wash-2)] hover:bg-[var(--wash-4)] text-[var(--text-muted)] p-2.5 rounded-xl text-xs border border-[var(--border-strong)]" title="Reset">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/5">
          <p className="text-sm text-rose-400">{error}</p>
        </Card>
      )}
      {pushMsg && (
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <p className="text-sm text-emerald-400 flex items-center gap-2">
            <UploadCloud className="w-4 h-4" /> {pushMsg}
          </p>
        </Card>
      )}
      {filterInfo && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-amber-400 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> {filterInfo}
          </p>
        </Card>
      )}
      {result && !result.db_lokal_connected && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-amber-400">
            DB lokal (data toko/CRM kantor) sedang tidak terhubung, jadi hasil generate mungkin kosong. Jalankan aplikasi ini dari jaringan kantor/VPN yang punya akses ke database tersebut.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5 space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
          {!result ? (
            <Card className="p-8">
              <EmptyState icon={Route} text="Tentukan filter tanggal atau klik 'Full' untuk melihat rute klaster terdekat yang sejalur." />
            </Card>
          ) : Object.keys(result.matrix).length === 0 ? (
            <Card className="p-8">
              <EmptyState icon={Route} text="Tidak ada toko yang cocok dengan filter ini." />
            </Card>
          ) : (
            <>
              <Card className="p-3 flex justify-between items-center">
                <span className="text-xs text-[var(--text-muted)]">Saring &amp; review rute sebelum push cloud.</span>
                <Button variant="danger" onClick={handlePush} disabled={pushing}>
                  <UploadCloud className="w-3.5 h-3.5" /> {pushing ? 'Mengirim...' : `Push ke Supabase (${selectedCount})`}
                </Button>
              </Card>

              {Object.entries(result.matrix).map(([adv, days]) => (
                <Card key={adv} className="p-4 space-y-2.5">
                  <h2 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                    <UserRound className="w-3.5 h-3.5 text-amber-400" /> ADVISOR:{' '}
                    <span className="text-amber-400 font-mono">{adv.toUpperCase()}</span>
                  </h2>
                  {days.map((day) => (
                    <div
                      key={day.tanggal}
                      className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-2.5 hover:border-emerald-500/40 transition-colors cursor-pointer"
                      onMouseEnter={() => setPreview({ advisor: adv, tanggal: day.tanggal, toko: day.toko })}
                    >
                      <div className="flex justify-between items-center bg-[var(--wash-1)] p-1.5 rounded-lg mb-1.5">
                        <span className="text-xs font-bold text-[var(--text-secondary)] font-mono flex items-center gap-1">
                          <Compass className="w-3 h-3 text-emerald-400" /> {fmtDate(day.tanggal)}
                        </span>
                        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={day.toko.every((t) => checked[uniqueKey(day.tanggal, t.cus_kodemember)])}
                            onChange={(e) => toggleAllForDay(day.tanggal, day.toko, e.target.checked)}
                            className="accent-amber-500"
                          />
                          semua
                        </label>
                      </div>
                      <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                        {day.toko.map((t, idx) => (
                          <label key={t.cus_kodemember} className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/[0.03] cursor-pointer">
                            <span className="flex items-center gap-1.5 truncate">
                              <input
                                type="checkbox"
                                checked={!!checked[uniqueKey(day.tanggal, t.cus_kodemember)]}
                                onChange={(e) =>
                                  setChecked((c) => ({ ...c, [uniqueKey(day.tanggal, t.cus_kodemember)]: e.target.checked }))
                                }
                                className="accent-amber-500 w-3 h-3"
                              />
                              <span className="font-bold text-[var(--text-faint)]">{idx + 1}.</span>
                              <span className="font-mono text-blue-400 font-bold">{t.cus_kodemember}</span>
                              <span className="text-[var(--text-secondary)] truncate">{t.cus_namamember}</span>
                              {t.member_pilihan && (
                                <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-400">
                                  MEMBER PILIHAN
                                </span>
                              )}
                              {(t.tipe_member === 'Sleeper' || t.tipe_member === 'Belum Aktivasi') && (
                                <span
                                  className={`shrink-0 px-1 py-0.5 rounded text-[9px] font-bold ${
                                    t.tipe_member === 'Sleeper'
                                      ? 'bg-amber-500/15 text-amber-400'
                                      : 'bg-rose-500/15 text-rose-400'
                                  }`}
                                >
                                  {t.tipe_member}
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-[var(--text-faint)] font-mono">{t.crm_koordinat}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </Card>
              ))}
            </>
          )}
        </div>

        <div className="xl:col-span-7 sticky top-4">
          <Card className="p-2 overflow-hidden relative" style={{ height: 'calc(100vh - 260px)', minHeight: 420 }}>
            {preview && (
              <div className="absolute top-4 left-14 z-[1000] bg-[var(--bg-overlay)] border border-[var(--border-strong)] px-3 py-1.5 rounded-xl text-xs font-bold text-[var(--text-primary)] shadow-xl flex items-center gap-2">
                <Route className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Lintasan {preview.advisor.toUpperCase()} | {fmtDate(preview.tanggal)}</span>
                {routeLoading && (
                  <span className="text-[10px] font-normal text-[var(--text-muted)] whitespace-nowrap">
                    · menyesuaikan ke jalan...
                  </span>
                )}
                {!routeLoading && routeSnapped && (
                  <span className="text-[10px] font-normal text-emerald-500 whitespace-nowrap">· mengikuti jalan</span>
                )}
              </div>
            )}
            <MapContainer center={[-6.9946, 107.5657]} zoom={11} style={{ height: '100%', width: '100%' }}>
              <CartoTileLayer />
              {preview && <FitBounds points={previewLine} />}
              {preview &&
                preview.toko.map((t, idx) =>
                  t.lat && t.lng ? (
                    <Marker key={t.cus_kodemember} position={[t.lat, t.lng]} icon={numberedIcon(idx + 1)}>
                      <Popup>
                        <b>Urutan Ke-{idx + 1}</b>
                        <hr />
                        <b>Toko:</b> {t.cus_namamember}
                        {t.member_pilihan && (<>
                          <br />
                          <b>Keterangan:</b> Member Pilihan
                        </>)}
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
                    weight: 4,
                    opacity: routeLoading ? 0.45 : 0.85,
                    lineCap: 'round',
                    lineJoin: 'round',
                    ...(routeSnapped ? {} : { dashArray: '1, 8' }),
                  }}
                />
              )}
            </MapContainer>
          </Card>
        </div>
      </div>
      </>
      )}

      {/* Modal Input Jadwal Manual */}
      {showManualModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm flex flex-col bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-2xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Plus className="w-4 h-4 text-amber-400" /> Input Jadwal Manual
              </h2>
              <button onClick={() => setShowManualModal(false)} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Tanggal</label>
                <Input 
                  type="date" 
                  value={manualForm.tanggal} 
                  onChange={(e) => setManualForm({...manualForm, tanggal: e.target.value})} 
                  className="w-full" 
                  required 
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Advisor / MR</label>
                <Select 
                  value={manualForm.username} 
                  onChange={(e) => setManualForm({...manualForm, username: e.target.value})} 
                  className="w-full" 
                  required
                >
                  <option value="">Pilih Advisor</option>
                  {advisorList.map((a) => (
                    <option key={a} value={a}>{a.toUpperCase()}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Kode Member</label>
                <Input 
                  type="text" 
                  placeholder="Misal: 2T123456" 
                  value={manualForm.kode_member} 
                  onChange={(e) => setManualForm({...manualForm, kode_member: e.target.value})} 
                  className="w-full uppercase" 
                  required 
                />
                {lookupState === 'loading' && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-1.5">Mengecek kode member...</p>
                )}
                {lookupState === 'found' && (
                  <p className="text-[11px] text-emerald-400 mt-1.5">
                    Toko ditemukan, nama & koordinat terisi otomatis.
                    {lookupTipeMember && lookupTipeMember !== 'Aktif' && (
                      <span className={lookupTipeMember === 'Sleeper' ? ' text-amber-400' : ' text-rose-400'}>
                        {' '}Tipe member: {lookupTipeMember}.
                      </span>
                    )}
                  </p>
                )}
                {lookupState === 'not_found' && lookupMsg && (
                  <p className="text-[11px] text-amber-400 mt-1.5">{lookupMsg}</p>
                )}
                {lookupState === 'blocked' && (
                  <p className="text-[11px] text-rose-400 mt-1.5 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {lookupMsg}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Nama Toko</label>
                <Input 
                  type="text" 
                  placeholder="Nama Toko Lengkap" 
                  value={manualForm.nama_toko} 
                  onChange={(e) => setManualForm({...manualForm, nama_toko: e.target.value})} 
                  className="w-full uppercase" 
                  required 
                />
              </div>

              {existingDay.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5 text-amber-400" /> Ganti Jadwal yang Sudah Ada (opsional)
                  </label>
                  <Select
                    value={replaceId}
                    onChange={(e) => setReplaceId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full"
                  >
                    <option value="">Tambah baru (jangan ganti)</option>
                    {existingDay.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.kode_member} — {j.nama_toko || 'tanpa nama'}{j.member_pilihan ? ' — MEMBER PILIHAN' : ''}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[11px] text-[var(--text-faint)] mt-1.5">
                    {existingDay.length}/15 jadwal sudah terisi di hari ini untuk advisor ini
                    {existingDay.length >= 15 ? ' — sudah penuh, pilih salah satu untuk digantikan.' : '.'}
                  </p>
                </div>
              )}

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full justify-center"
                  disabled={submittingManual || lookupState === 'blocked'}
                >
                  {submittingManual ? 'Menyimpan...' : (
                    <>
                      <Save className="w-4 h-4 mr-1.5" /> {replaceId ? 'Ganti Jadwal' : 'Simpan ke Supabase'}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Modal Upload Member Pilihan */}
      {showPilihanModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg flex flex-col bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-2xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" /> Upload Member Pilihan
              </h2>
              <button onClick={closePilihanModal} className="text-[var(--text-muted)] hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-[var(--text-secondary)]">
                Cabang <strong>{cabang}</strong>. File terbaru mengganti daftar Member Pilihan aktif cabang ini dan berlaku untuk generate setiap bulan sampai daftar diupload ulang. Jumlah member unik per MR tidak dibatasi (bebas berapa pun) dan setiap member ditargetkan <strong>2x kunjungan setiap bulan</strong> saat generate otomatis.
              </div>
              <a href={memberPilihanTemplateUrl()} target="_blank" rel="noreferrer">
                <Button variant="ghost" className="w-full justify-center"><Download className="w-3.5 h-3.5" /> Download Template Member Pilihan</Button>
              </a>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => { setPilihanFile(e.target.files?.[0] || null); setPilihanResult(null); setPilihanError(null); }}
                className="w-full text-xs text-[var(--text-secondary)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-500/10 file:text-amber-400 hover:file:bg-amber-500/20 cursor-pointer bg-[var(--bg-inset)] border border-[var(--border-strong)] rounded-lg"
              />
              {pilihanError && <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/5"><p className="text-xs text-rose-400">{pilihanError}</p></div>}
              {pilihanResult && (
                <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Tersimpan {pilihanResult.inserted} Member Pilihan. Daftar lama periode ini: {pilihanResult.replaced}.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(pilihanResult.per_advisor).map(([adv, count]) => <span key={adv} className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400">{adv.toUpperCase()}: {count}</span>)}
                  </div>
                  {pilihanResult.skipped_count > 0 && <div className="max-h-32 overflow-y-auto">{pilihanResult.skipped.map((x, i) => <p key={i} className="text-[10px] text-amber-300">Baris {x.row}: {x.reason}</p>)}</div>}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1 justify-center" onClick={handlePilihanUpload} disabled={pilihanUploading || !pilihanFile}>
                  {pilihanUploading ? 'Mengupload...' : <><UploadCloud className="w-3.5 h-3.5" /> Upload & Ganti Daftar</>}
                </Button>
                <Button variant="ghost" onClick={closePilihanModal}>{pilihanResult ? 'Selesai' : 'Tutup'}</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Modal Import Jadwal via Excel */}
      {showImportModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-md flex flex-col bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-2xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <FileUp className="w-4 h-4 text-amber-400" /> Import Jadwal via Excel
              </h2>
              <button onClick={closeImportModal} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  Belum punya file? Unduh dulu template-nya, isi datanya, lalu upload kembali di sini.
                </p>
                <Button variant="ghost" className="w-full justify-center" onClick={handleDownloadTemplate}>
                  <Download className="w-3.5 h-3.5" /> Download Template Excel
                </Button>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  File Excel (.xlsx) yang Sudah Diisi
                </label>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] || null);
                    setImportResult(null);
                    setImportError(null);
                  }}
                  className="w-full text-xs text-[var(--text-secondary)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-500/10 file:text-amber-400 hover:file:bg-amber-500/20 cursor-pointer bg-[var(--bg-inset)] border border-[var(--border-strong)] rounded-lg"
                />
                <p className="text-[11px] text-[var(--text-faint)] mt-1.5">
                  Cabang aktif saat ini: <span className="text-amber-400 font-semibold">{cabang}</span> (dipakai jika kolom Cabang di file dikosongkan).
                </p>
              </div>

              {importError && (
                <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/5">
                  <p className="text-xs text-rose-400">{importError}</p>
                </div>
              )}

              {importResult && (
                <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Berhasil import {importResult.inserted} dari {importResult.total_baris} baris.
                  </p>
                  {importResult.skipped_count > 0 && (
                    <div>
                      <p className="text-[11px] text-amber-400 mb-1">{importResult.skipped_count} baris dilewati:</p>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                        {importResult.skipped.map((s, i) => (
                          <p key={i} className="text-[10px] text-[var(--text-muted)] font-mono">
                            Baris {s.row}: {s.reason}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  className="flex-1 justify-center"
                  onClick={handleImportSubmit}
                  disabled={importing || !importFile}
                >
                  {importing ? 'Mengimport...' : (
                    <>
                      <UploadCloud className="w-3.5 h-3.5" /> Upload &amp; Push
                    </>
                  )}
                </Button>
                <button
                  onClick={closeImportModal}
                  className="bg-[var(--wash-2)] hover:bg-[var(--wash-4)] text-[var(--text-muted)] px-4 py-2.5 rounded-xl text-xs border border-[var(--border-strong)]"
                >
                  Tutup
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function uniqueKey(tanggal: string, kode: string) {
  return `${tanggal}_${kode}`;
}

function fmtDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}