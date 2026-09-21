import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Polyline, Marker, Popup } from 'react-leaflet';
import {
  Route,
  Zap,
  RotateCcw,
  UploadCloud,
  FileSpreadsheet,
  Compass,
  CheckCircle2,
  AlertCircle,
  UserRound,
} from 'lucide-react';
import {
  fetchSpvUsers,
  fetchSpvCandidates,
  generateSpvSchedule,
  pushSchedule,
  exportSchedule,
  downloadBlob,
  type SpvUser,
  type SpvCandidatesResponse,
  type SpvGenerateResponse,
} from '../lib/api';
import { Card, Select, Input, Button, EmptyState } from '../components/ui';
import { FitBounds, numberedIcon, useRoadRoute, CartoTileLayer } from '../components/mapUtils';
import { useTheme } from '../lib/theme';

interface PenjadwalanSpvSubPageProps {
  cabang: string;
}

const now = new Date();

function uniqueKey(tanggal: string, kode: string) {
  return `${tanggal}_${kode}`;
}

function fmtDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function PenjadwalanSpvSubPage({ cabang }: PenjadwalanSpvSubPageProps) {
  const [theme] = useTheme();
  const routeColor = theme === 'light' ? '#2563eb' : '#60a5fa';

  // State User SPV
  const [spvList, setSpvList] = useState<SpvUser[]>([]);
  const [selectedSpv, setSelectedSpv] = useState<string>('');
  const [loadingSpv, setLoadingSpv] = useState<boolean>(false);

  // Filter Waktu & Limit
  const [bulan, setBulan] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [tahun, setTahun] = useState(String(now.getFullYear()));
  const [tglDari, setTglDari] = useState('');
  const [tglSampai, setTglSampai] = useState('');
  const [maksPerHari, setMaksPerHari] = useState('5');

  // State Kandidat Member Pilihan
  const [candidateData, setCandidateData] = useState<SpvCandidatesResponse | null>(null);

  // State Hasil Generate Jadwal
  const [generateResult, setGenerateResult] = useState<SpvGenerateResponse | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ tanggal: string; toko: any[] } | null>(null);

  // Status & Pesan
  const [error, setError] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushing, setPushing] = useState<boolean>(false);

  // 1. Ambil daftar user SPV saat cabang berubah
  useEffect(() => {
    setLoadingSpv(true);
    fetchSpvUsers(cabang)
      .then((res) => {
        setSpvList(res.users);
        if (res.users.length > 0) {
          setSelectedSpv(res.users[0].username);
        } else {
          setSelectedSpv('');
        }
      })
      .catch((err) => {
        setError('Gagal memuat daftar SPV: ' + err.message);
      })
      .finally(() => setLoadingSpv(false));
  }, [cabang]);

  // 2. Ambil ringkasan kandidat Member Pilihan untuk bulan & SPV terpilih
  const reloadCandidates = () => {
    fetchSpvCandidates({ cabang, bulan, tahun, spv: selectedSpv })
      .then((res) => {
        setCandidateData(res);
      })
      .catch((err) => {
        setError('Gagal memuat data kandidat: ' + err.message);
      });
  };

  useEffect(() => {
    reloadCandidates();
  }, [cabang, bulan, tahun, selectedSpv]);

  // 3. Jalankan Generate Jadwal SPV
  const handleGenerate = async () => {
    if (!selectedSpv) {
      alert('Pilih SPV terlebih dahulu!');
      return;
    }
    setGenerating(true);
    setError(null);
    setPushMsg(null);
    try {
      const res = await generateSpvSchedule({
        spvUsername: selectedSpv,
        cabang,
        bulan,
        tahun: parseInt(tahun, 10),
        tglDari: tglDari || undefined,
        tglSampai: tglSampai || undefined,
        maksPerHari: parseInt(maksPerHari, 10) || 5,
      });

      setGenerateResult(res);

      // Default centang semua jadwal
      const initialChecked: Record<string, boolean> = {};
      const spvDays = res.matrix[selectedSpv] || [];
      for (const day of spvDays) {
        for (const t of day.toko) {
          initialChecked[uniqueKey(day.tanggal, t.cus_kodemember)] = true;
        }
      }
      setChecked(initialChecked);

      // Preview hari pertama jika ada
      if (spvDays.length > 0) {
        setPreview({ tanggal: spvDays[0].tanggal, toko: spvDays[0].toko });
      } else {
        setPreview(null);
      }
    } catch (err: any) {
      setError(err.message || 'Gagal generate jadwal SPV');
    } finally {
      setGenerating(false);
    }
  };

  const handleReset = () => {
    setGenerateResult(null);
    setPreview(null);
    setChecked({});
    setPushMsg(null);
    setError(null);
    setTglDari('');
    setTglSampai('');
    setMaksPerHari('5');
  };

  // Toggle checklist toko
  const toggleStoreCheck = (tanggal: string, kode: string) => {
    const k = uniqueKey(tanggal, kode);
    setChecked((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const toggleAllForDay = (tanggal: string, toko: any[], value: boolean) => {
    setChecked((prev) => {
      const next = { ...prev };
      toko.forEach((t) => (next[uniqueKey(tanggal, t.cus_kodemember)] = value));
      return next;
    });
  };

  // Kumpulkan item jadwal yang tercentang untuk push / export
  const gatherSelectedItems = () => {
    if (!generateResult || !selectedSpv) return [];
    const items: Array<{
      tanggal: string;
      username: string;
      kode_member: string;
      cabang: string;
      lat: number | null;
      lng: number | null;
      nama_toko: string;
      tipe_member: string;
      member_pilihan: boolean;
      advisor_asli?: string;
    }> = [];

    const days = generateResult.matrix[selectedSpv] || [];
    for (const day of days) {
      for (const t of day.toko) {
        if (checked[uniqueKey(day.tanggal, t.cus_kodemember)]) {
          items.push({
            tanggal: day.tanggal,
            username: selectedSpv,
            kode_member: t.cus_kodemember,
            cabang: t.cus_kodeigr || cabang,
            lat: t.lat ?? null,
            lng: t.lng ?? null,
            nama_toko: t.cus_namamember,
            tipe_member: 'Member Pilihan',
            member_pilihan: true,
            advisor_asli: t.advisor_asli,
          });
        }
      }
    }
    return items;
  };

  const selectedCount = Object.values(checked).filter(Boolean).length;

  // Push ke Supabase
  const handlePush = async () => {
    const items = gatherSelectedItems();
    if (items.length === 0) {
      alert('Pilih minimal 1 jadwal toko untuk di-push.');
      return;
    }

    const konfirmasi = window.confirm(
      `Anda yakin ingin push ${items.length} jadwal kunjungan SPV (${selectedSpv}) ke Supabase Cloud?\n\nData akan tersimpan ke tbtr_jadwal_bulanan.`
    );
    if (!konfirmasi) return;

    setPushing(true);
    setError(null);
    try {
      const res = await pushSchedule(items);
      setPushMsg(`Sukses upload ${res.count} rute terpilih ke Supabase Cloud.`);
      reloadCandidates();
    } catch (err: any) {
      setError('Gagal push: ' + err.message);
    } finally {
      setPushing(false);
    }
  };

  // Export Excel
  const handleExport = async () => {
    const items = gatherSelectedItems();
    if (items.length === 0) {
      alert('Pilih minimal 1 jadwal toko untuk di-export.');
      return;
    }
    try {
      const blob = await exportSchedule(items);
      downloadBlob(blob, `Jadwal_SPV_${selectedSpv}_${bulan}_${tahun}.xlsx`);
    } catch (err: any) {
      setError('Gagal export: ' + err.message);
    }
  };

  // Koordinat polyline untuk Leaflet
  const previewLine: [number, number][] = useMemo(
    () => (preview ? preview.toko.filter((t) => t.lat && t.lng).map((t) => [t.lat, t.lng] as [number, number]) : []),
    [preview]
  );

  const { route: roadRoute } = useRoadRoute(previewLine);

  const daysList = generateResult && selectedSpv ? generateResult.matrix[selectedSpv] || [] : [];
  const selectedSpvObj = spvList.find((u) => u.username === selectedSpv);

  return (
    <div className="space-y-4">
      {/* Satu Form Filter Simple & Padat (Mirip Penjadwalan Reguler) */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-3 items-end">
          {/* Dropdown SPV */}
          <div className="sm:col-span-2">
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                Pilih SPV
              </label>
              {candidateData && (
                <span className="text-[11px] text-amber-400 font-medium">
                  {candidateData.stats.belum_dikunjungi} toko belum dikunjungi
                </span>
              )}
            </div>
            <Select
              value={selectedSpv}
              onChange={(e) => setSelectedSpv(e.target.value)}
              className="w-full"
              disabled={loadingSpv || spvList.length === 0}
            >
              {spvList.length === 0 ? (
                <option value="">(Tidak ada user role SPV/Admin)</option>
              ) : (
                spvList.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.nama_lengkap} ({u.username})
                  </option>
                ))
              )}
            </Select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Dari Tanggal
            </label>
            <Input type="date" value={tglDari} onChange={(e) => setTglDari(e.target.value)} className="w-full" />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Sampai Tanggal
            </label>
            <Input type="date" value={tglSampai} onChange={(e) => setTglSampai(e.target.value)} className="w-full" />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Bulan
            </label>
            <Select value={bulan} onChange={(e) => setBulan(e.target.value)} className="w-full">
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Tahun
            </label>
            <Select value={tahun} onChange={(e) => setTahun(e.target.value)} className="w-full">
              {[now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              className="block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
              title="Maksimal kunjungan toko per hari"
            >
              Member / Hari
            </label>
            <Input
              type="number"
              min={1}
              max={50}
              value={maksPerHari}
              onChange={(e) => setMaksPerHari(e.target.value)}
              className="w-full font-bold"
              placeholder="5"
            />
          </div>
        </div>

        {/* Tombol Aksi */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={generating || !selectedSpv}
              className="text-xs"
            >
              <Zap className="w-3.5 h-3.5" />
              {generating ? 'Mengatur Rute...' : 'Generate Jadwal SPV'}
            </Button>
            <button
              onClick={handleReset}
              className="bg-[var(--wash-2)] hover:bg-[var(--wash-4)] text-[var(--text-muted)] p-2 rounded-xl text-xs border border-[var(--border-strong)] transition-all cursor-pointer"
              title="Reset"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {generateResult && (
            <div className="flex items-center gap-2">
              <Button
                variant="success"
                onClick={handleExport}
                disabled={selectedCount === 0}
                className="text-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export Selected ({selectedCount})
              </Button>
              <Button
                variant="danger"
                onClick={handlePush}
                disabled={pushing || selectedCount === 0}
                className="text-xs"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                {pushing ? 'Mengirim...' : `Push ke Supabase (${selectedCount})`}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Notifikasi & Error */}
      {error && (
        <Card className="p-3 border-rose-500/30 bg-rose-500/5">
          <p className="text-xs text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </p>
        </Card>
      )}
      {pushMsg && (
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <p className="text-xs text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {pushMsg}
          </p>
        </Card>
      )}

      {/* Grid Rute & Peta (Format Persis Penjadwalan Reguler) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Kolom Kiri: Daftar Hari & Toko */}
        <div className="xl:col-span-5 space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
          {!generateResult ? (
            <Card className="p-8">
              <EmptyState
                icon={Route}
                text="Pilih SPV dan klik 'Generate Jadwal SPV' untuk melihat rute klaster Member Pilihan."
              />
            </Card>
          ) : daysList.length === 0 ? (
            <Card className="p-8">
              <EmptyState
                icon={CheckCircle2}
                text="Semua Member Pilihan di cabang ini sudah dikunjungi pada bulan ini."
              />
            </Card>
          ) : (
            <Card className="p-4 space-y-2.5">
              <h2 className="text-xs font-bold text-[var(--text-primary)] flex items-center justify-between border-b border-[var(--border)] pb-2">
                <span className="flex items-center gap-1.5">
                  <UserRound className="w-3.5 h-3.5 text-amber-400" /> SPV:{' '}
                  <span className="text-amber-400 font-mono">
                    {selectedSpvObj ? `${selectedSpvObj.nama_lengkap} (${selectedSpvObj.username})` : selectedSpv}
                  </span>
                </span>
                <span className="text-[10px] text-[var(--text-muted)] font-normal">
                  {generateResult.stats.scheduled_count} Toko &middot; {daysList.length} Hari Kerja
                </span>
              </h2>

              {daysList.map((day) => (
                <div
                  key={day.tanggal}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-2.5 hover:border-emerald-500/40 transition-colors cursor-pointer"
                  onMouseEnter={() => setPreview({ tanggal: day.tanggal, toko: day.toko })}
                >
                  <div className="flex justify-between items-center bg-[var(--wash-1)] p-1.5 rounded-lg mb-1.5">
                    <span className="text-xs font-bold text-[var(--text-secondary)] font-mono flex items-center gap-1">
                      <Compass className="w-3 h-3 text-emerald-400" /> {fmtDate(day.tanggal)}
                    </span>
                    <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={day.toko.every((t: any) => checked[uniqueKey(day.tanggal, t.cus_kodemember)])}
                        onChange={(e) => toggleAllForDay(day.tanggal, day.toko, e.target.checked)}
                        className="accent-amber-500"
                      />
                      semua
                    </label>
                  </div>

                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {day.toko.map((t: any, idx: number) => (
                      <label
                        key={t.cus_kodemember}
                        className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/[0.03] cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <input
                            type="checkbox"
                            checked={!!checked[uniqueKey(day.tanggal, t.cus_kodemember)]}
                            onChange={() => toggleStoreCheck(day.tanggal, t.cus_kodemember)}
                            className="accent-amber-500 w-3 h-3 cursor-pointer"
                          />
                          <span className="font-bold text-[var(--text-faint)]">{idx + 1}.</span>
                          <span className="font-mono text-blue-400 font-bold">{t.cus_kodemember}</span>
                          <span className="text-[var(--text-secondary)] truncate">{t.cus_namamember}</span>
                          <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-400">
                            MEMBER PILIHAN
                          </span>
                          {t.advisor_asli && (
                            <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-mono bg-[var(--wash-2)] text-[var(--text-muted)]">
                              MR: {t.advisor_asli}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-[var(--text-faint)] font-mono shrink-0 ml-2">
                          {t.crm_koordinat || '-'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Kolom Kanan: Peta Rute Leaflet */}
        <div className="xl:col-span-7">
          <Card className="p-3 sticky top-4 h-[calc(100vh-260px)] min-h-[480px]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-1">
                <Route className="w-3.5 h-3.5 text-blue-400" />
                {preview ? `Rute: ${fmtDate(preview.tanggal)} (${preview.toko.length} Toko)` : 'Peta Rute'}
              </span>
            </div>

            <MapContainer center={[-6.9175, 107.6191]} zoom={12} className="w-full h-[calc(100%-28px)] rounded-xl">
              <CartoTileLayer />

              {previewLine.length > 0 && <FitBounds points={previewLine} />}

              {roadRoute.length > 0 ? (
                <Polyline positions={roadRoute} pathOptions={{ color: routeColor, weight: 4, opacity: 0.85 }} />
              ) : (
                previewLine.length > 1 && (
                  <Polyline
                    positions={previewLine}
                    pathOptions={{ color: routeColor, weight: 3, opacity: 0.7, dashArray: '6, 6' }}
                  />
                )
              )}

              {preview?.toko.map((t, idx) => {
                if (!t.lat || !t.lng) return null;
                return (
                  <Marker key={t.cus_kodemember} position={[t.lat, t.lng]} icon={numberedIcon(idx + 1)}>
                    <Popup>
                      <div className="text-xs p-1 space-y-1">
                        <div className="font-bold text-sm text-[var(--text-primary)]">
                          #{idx + 1} {t.cus_namamember}
                        </div>
                        <div className="font-mono text-amber-500 text-xs">{t.cus_kodemember}</div>
                        {t.advisor_asli && (
                          <div className="text-[11px] text-[var(--text-muted)]">
                            Salesman Asli: <strong className="text-indigo-400">{t.advisor_asli}</strong>
                          </div>
                        )}
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Tipe: <strong className="text-emerald-400">Member Pilihan</strong>
                        </div>
                        {t.lat && t.lng && (
                          <div className="text-[9px] text-[var(--text-muted)] font-mono">
                            {t.lat.toFixed(5)}, {t.lng.toFixed(5)}
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </Card>
        </div>
      </div>
    </div>
  );
}
