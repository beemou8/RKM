import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapContainer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { CartoTileLayer, FitBounds, FlyTo } from '../components/mapUtils';
import {
  Moon, UserX, UserCheck, Users, FileSpreadsheet, UploadCloud, Download, X, Tag,
  PieChart as PieChartIcon, Star, LayoutDashboard, Search,
  MapPin, List, ExternalLink, Navigation, Copy, Check, RotateCcw, Layers,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  fetchMemberTipe, exportMemberTipeUrl, applyTipeMember,
  tipeMemberUploadTemplateUrl, uploadTipeMember, type TipeMemberUploadResult,
  memberPilihanTemplateUrl, uploadMemberPilihan, type MemberPilihanUploadResult,
} from '../lib/api';
import type { MemberTipeRow } from '../types';
import { Card, CardHeader, StatCard, Badge, EmptyState, Button, Select, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

const TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'slate'> = {
  Aktif: 'emerald',
  Sleeper: 'amber',
  'Belum Aktivasi': 'rose',
  'Tidak Aktif': 'slate',
};
const PIE_COLORS: Record<string, string> = {
  Aktif: '#10b981',
  Sleeper: '#f59e0b',
  'Belum Aktivasi': '#f43f5e',
  'Tidak Aktif': '#64748b',
};
const STATUS_CONFIG: Record<string, { color: string; border: string; label: string }> = {
  Aktif: { color: '#10b981', border: '#059669', label: 'Aktif' },
  Sleeper: { color: '#f59e0b', border: '#d97706', label: 'Sleeper (>3 bln)' },
  'Belum Aktivasi': { color: '#f43f5e', border: '#e11d48', label: 'Belum Aktivasi' },
  'Tidak Aktif': { color: '#64748b', border: '#475569', label: 'Tidak Aktif' },
};

const storeBranchIcon = L.divIcon({
  className: 'branch-marker',
  html: `<div style="background:#2563eb;color:#ffffff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid #ffffff;box-shadow:0 4px 10px rgba(0,0,0,0.4);cursor:pointer;" title="Pusat Cabang">🏢</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
});

type FilterTipe = 'semua' | 'Member Pilihan' | 'Sleeper' | 'Belum Aktivasi' | 'Tidak Aktif';
const now = new Date();

export default function MemberSleeper() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [data, setData] = useState<MemberTipeRow[]>([]);
  const [tokoCabang, setTokoCabang] = useState<{ nama_toko?: string; lat: number; lng: number } | null>(null);
  const [totals, setTotals] = useState({ aktif: 0, sleeper: 0, belum_aktivasi: 0, tidak_aktif: 0, member_pilihan: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTipe, setFilterTipe] = useState<FilterTipe>('semua');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showUploadTipeModal, setShowUploadTipeModal] = useState(false);
  const [showPilihanModal, setShowPilihanModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [bulan, setBulan] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [tahun, setTahun] = useState(String(now.getFullYear()));
  const [refreshKey, setRefreshKey] = useState(0);

  // Map state
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const [advisorFilter, setAdvisorFilter] = useState<string>('semua');
  const [statusFilter, setStatusFilter] = useState({
    Aktif: true,
    Sleeper: true,
    'Belum Aktivasi': true,
    'Tidak Aktif': false,
    'Member Pilihan': false,
  });
  const [selectedMember, setSelectedMember] = useState<MemberTipeRow | null>(null);
  const [flyPoint, setFlyPoint] = useState<[number, number] | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData([]);
    setChecked({});

    fetchMemberTipe(cabang, { limit: 3000, tipe: filterTipe, bulan, tahun, search: debouncedSearch })
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        setTotals(r.totals);
        if (r.toko_cabang) setTokoCabang(r.toko_cabang);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [cabang, filterTipe, bulan, tahun, debouncedSearch, refreshKey]);

  const filteredTotal = useMemo(() => {
    if (filterTipe === 'Member Pilihan') return totals.member_pilihan;
    if (filterTipe === 'Sleeper') return totals.sleeper;
    if (filterTipe === 'Belum Aktivasi') return totals.belum_aktivasi;
    if (filterTipe === 'Tidak Aktif') return totals.tidak_aktif;
    return totals.total;
  }, [filterTipe, totals]);

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (d) =>
        (d.kode_member || '').toLowerCase().includes(q) ||
        (d.nama_member || '').toLowerCase().includes(q) ||
        (d.advisor || '').toLowerCase().includes(q) ||
        (d.tipe || '').toLowerCase().includes(q)
    );
  }, [data, searchQuery]);

  const pagedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const selectedRows = useMemo(() => filteredData.filter((d) => checked[d.kode_member]), [filteredData, checked]);
  const toggleAll = () => {
    const allChecked = pagedData.length > 0 && pagedData.every((d) => checked[d.kode_member]);
    const next = { ...checked };
    pagedData.forEach((d) => (next[d.kode_member] = !allChecked));
    setChecked(next);
  };

  const advisorList = useMemo(() => {
    const set = new Set<string>();
    for (const d of data) {
      if (d.advisor) set.add(d.advisor.toUpperCase());
    }
    return Array.from(set).sort();
  }, [data]);

  const withCoordsCount = useMemo(() => data.filter((d) => d.lat && d.lng).length, [data]);

  const mapPoints = useMemo(() => {
    return filteredData.filter((d) => {
      if (!d.lat || !d.lng) return false;
      if (advisorFilter !== 'semua' && (d.advisor || '').toUpperCase() !== advisorFilter) return false;
      if (statusFilter['Member Pilihan'] && !d.member_pilihan) return false;
      if (!statusFilter[d.tipe as keyof typeof statusFilter]) return false;
      return true;
    });
  }, [filteredData, advisorFilter, statusFilter]);

  const mapBoundsPoints = useMemo<[number, number][]>(() => {
    const pts = mapPoints.map((d) => [d.lat!, d.lng!] as [number, number]);
    if (tokoCabang?.lat && tokoCabang?.lng) {
      pts.push([tokoCabang.lat, tokoCabang.lng]);
    }
    return pts;
  }, [mapPoints, tokoCabang]);

  const copyCoords = (lat: number, lng: number, code: string) => {
    const text = `${lat},${lng}`;
    navigator.clipboard?.writeText(text);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const pieData = useMemo(() => {
    if (filterTipe === 'Member Pilihan') {
      const counts: Record<string, number> = {};
      for (const row of data) counts[row.tipe] = (counts[row.tipe] || 0) + 1;
      return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }
    return [
      { name: 'Aktif', value: totals.aktif },
      { name: 'Sleeper', value: totals.sleeper },
      { name: 'Belum Aktivasi', value: totals.belum_aktivasi },
      { name: 'Tidak Aktif', value: totals.tidak_aktif },
    ].filter((d) => d.value > 0);
  }, [filterTipe, data, totals]);

  const tabs: Array<{ value: FilterTipe; label: string; icon?: any }> = [
    { value: 'semua', label: 'Semua Member', icon: LayoutDashboard },
    { value: 'Member Pilihan', label: 'Member Pilihan', icon: Star },
    { value: 'Sleeper', label: 'Sleeper', icon: Moon },
    { value: 'Belum Aktivasi', label: 'Belum Aktivasi', icon: UserX },
    { value: 'Tidak Aktif', label: 'Tidak Aktif', icon: UserX },
  ];

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <Card className="p-5">
        <div className="flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Moon className="w-4.5 h-4.5 text-amber-400" /> Dashboard Member &amp; Follow Up
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Cabang <span className="text-amber-400 font-semibold">{cabang}</span> &middot; Member Pilihan aktif dijadwalkan 2x setiap bulan.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* View Mode Toggle Button Group */}
            <div className="flex items-center gap-1 bg-[var(--wash-1)] p-1 rounded-xl border border-[var(--border)] mr-1">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  viewMode === 'table'
                    ? 'bg-amber-500 text-slate-900 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <List className="w-3.5 h-3.5" /> Tabel Data
              </button>
              <button
                type="button"
                onClick={() => setViewMode('map')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  viewMode === 'map'
                    ? 'bg-amber-500 text-slate-900 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" /> Peta Zonasi
              </button>
            </div>

            <Select value={bulan} onChange={(e) => setBulan(e.target.value)} className="w-28">
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => <option key={m} value={m}>Bulan {m}</option>)}
            </Select>
            <Select value={tahun} onChange={(e) => setTahun(e.target.value)} className="w-28">
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </Select>
            <Button variant="primary" onClick={() => setShowPilihanModal(true)}>
              <Star className="w-3.5 h-3.5" /> Upload Member Pilihan
            </Button>
            <Button variant="ghost" onClick={() => setShowUploadTipeModal(true)}>
              <UploadCloud className="w-3.5 h-3.5" /> Upload Tipe Member
            </Button>
            <a href={exportMemberTipeUrl(cabang, bulan, tahun)}>
              <Button variant="success"><FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel</Button>
            </a>
          </div>
        </div>
      </Card>

      <Card className="p-2">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = filterTipe === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => {
                  setFilterTipe(tab.value);
                  setPage(1);
                }}
                className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-2 ${
                  active
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-[var(--wash-1)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}{tab.label}
              </button>
            );
          })}
        </div>
      </Card>

      {error && <Card className="p-4 border-rose-500/30 bg-rose-500/5"><p className="text-sm text-rose-400">{error}</p></Card>}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard icon={Users} tone="slate" label="Total Member" value={totals.total.toLocaleString('id-ID')} />
        <StatCard icon={Star} tone="blue" label="Member Pilihan" value={totals.member_pilihan.toLocaleString('id-ID')} />
        <StatCard icon={UserCheck} tone="emerald" label="Aktif" value={totals.aktif.toLocaleString('id-ID')} />
        <StatCard icon={Moon} tone="amber" label="Sleeper (>3 bulan)" value={totals.sleeper.toLocaleString('id-ID')} />
        <StatCard icon={UserX} tone="rose" label="Belum Aktivasi" value={totals.belum_aktivasi.toLocaleString('id-ID')} />
        <StatCard icon={UserX} tone="slate" label="Tidak Aktif" value={totals.tidak_aktif.toLocaleString('id-ID')} />
      </div>

      {/* Tampilan Peta Zonasi vs Tampilan Tabel */}
      {viewMode === 'map' ? (
        <Card className="overflow-hidden border border-[var(--border)]">
          {/* Header Map Toolbar */}
          <div className="p-4 border-b border-[var(--border)] bg-[var(--wash-1)] space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Left: Advisor & Search */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] font-medium">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span>Advisor:</span>
                </div>
                <Select
                  value={advisorFilter}
                  onChange={(e) => setAdvisorFilter(e.target.value)}
                  className="w-40 text-xs py-1"
                >
                  <option value="semua">Semua Advisor</option>
                  {advisorList.map((adv) => (
                    <option key={adv} value={adv}>{adv}</option>
                  ))}
                </Select>

                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Cari toko / kode member di peta..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              {/* Right: Stats & Reset View */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">
                  Menampilkan <strong className="text-[var(--text-primary)]">{mapPoints.length.toLocaleString('id-ID')}</strong> titik ({withCoordsCount.toLocaleString('id-ID')} terpetakan)
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFlyPoint(null);
                    setSelectedMember(null);
                    setResetSignal((s) => s + 1);
                  }}
                  title="Zoom ke seluruh titik sebaran"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset Peta
                </Button>
              </div>
            </div>

            {/* Layer Toggle Chips */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--border)]/60">
              <span className="text-[11px] text-[var(--text-muted)] font-medium">Layer Sebaran:</span>
              <button
                type="button"
                onClick={() => setStatusFilter((s) => ({ ...s, Aktif: !s.Aktif }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter.Aktif
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-[var(--bg-card)] text-[var(--text-faint)] border-[var(--border)] opacity-60'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Aktif ({data.filter((d) => d.tipe === 'Aktif' && d.lat).length})
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter((s) => ({ ...s, Sleeper: !s.Sleeper }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter.Sleeper
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-[var(--bg-card)] text-[var(--text-faint)] border-[var(--border)] opacity-60'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Sleeper ({data.filter((d) => d.tipe === 'Sleeper' && d.lat).length})
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter((s) => ({ ...s, 'Belum Aktivasi': !s['Belum Aktivasi'] }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter['Belum Aktivasi']
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : 'bg-[var(--bg-card)] text-[var(--text-faint)] border-[var(--border)] opacity-60'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Belum Aktivasi ({data.filter((d) => d.tipe === 'Belum Aktivasi' && d.lat).length})
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter((s) => ({ ...s, 'Tidak Aktif': !s['Tidak Aktif'] }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter['Tidak Aktif']
                    ? 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                    : 'bg-[var(--bg-card)] text-[var(--text-faint)] border-[var(--border)] opacity-60'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                Tidak Aktif ({data.filter((d) => d.tipe === 'Tidak Aktif' && d.lat).length})
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter((s) => ({ ...s, 'Member Pilihan': !s['Member Pilihan'] }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  statusFilter['Member Pilihan']
                    ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40 ring-1 ring-yellow-400/50'
                    : 'bg-[var(--bg-card)] text-[var(--text-faint)] border-[var(--border)]'
                }`}
              >
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                Hanya Member Pilihan ({data.filter((d) => d.member_pilihan && d.lat).length})
              </button>
            </div>
          </div>

          {/* Leaflet Map Container */}
          <div className="relative h-[650px] w-full">
            <MapContainer
              preferCanvas={true}
              center={tokoCabang?.lat ? [tokoCabang.lat, tokoCabang.lng] : [-6.9946, 107.5657]}
              zoom={12}
              style={{ height: '100%', width: '100%' }}
            >
              <CartoTileLayer />

              {flyPoint ? (
                <FlyTo point={flyPoint} zoom={17} />
              ) : (
                <FitBounds points={mapBoundsPoints} resetSignal={resetSignal} />
              )}

              {/* Toko Cabang / Depo Marker */}
              {tokoCabang && (
                <Marker position={[tokoCabang.lat, tokoCabang.lng]} icon={storeBranchIcon}>
                  <Popup>
                    <div className="text-xs p-1 space-y-1">
                      <p className="font-bold text-blue-600 flex items-center gap-1">
                        🏢 {tokoCabang.nama_toko || `Pusat Cabang ${cabang}`}
                      </p>
                      <p className="text-[11px] text-gray-600">Titik Acuan Depo / Cabang</p>
                      <p className="font-mono text-[10px] text-gray-500">{tokoCabang.lat}, {tokoCabang.lng}</p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Member Circle Markers */}
              {mapPoints.map((m) => {
                const conf = STATUS_CONFIG[m.tipe] || STATUS_CONFIG['Tidak Aktif'];
                const isSelected = selectedMember?.kode_member === m.kode_member;
                return (
                  <CircleMarker
                    key={m.kode_member}
                    center={[m.lat!, m.lng!]}
                    radius={m.member_pilihan ? 8 : (isSelected ? 9 : 5.5)}
                    pathOptions={{
                      fillColor: conf.color,
                      fillOpacity: 0.85,
                      color: m.member_pilihan ? '#eab308' : (isSelected ? '#ffffff' : conf.border),
                      weight: m.member_pilihan ? 3 : (isSelected ? 3 : 1.5),
                    }}
                    eventHandlers={{
                      click: () => {
                        setSelectedMember(m);
                      },
                    }}
                  >
                    <Popup>
                      <div className="text-xs p-1 space-y-2 min-w-[220px]">
                        <div>
                          <p className="font-bold text-gray-900 leading-tight">{m.nama_member}</p>
                          <p className="font-mono text-blue-600 font-semibold text-[11px]">{m.kode_member}</p>
                        </div>

                        <div className="flex flex-wrap gap-1">
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                            style={{ background: conf.color }}
                          >
                            {m.tipe}
                          </span>
                          {m.member_pilihan && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500 text-slate-900 flex items-center gap-0.5">
                              ⭐ Member Pilihan (2x)
                            </span>
                          )}
                          {m.advisor && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-800">
                              Advisor: {m.advisor.toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-gray-600 space-y-0.5 pt-1 border-t border-gray-200">
                          <p>Belanja Terakhir: <strong>{m.belanja_terakhir || '-'}</strong></p>
                          <p>Belanja Pertama: <strong>{m.belanja_pertama || '-'}</strong></p>
                          <p className="font-mono text-[10px] text-gray-500 pt-0.5">
                            {m.lat?.toFixed(6)}, {m.lng?.toFixed(6)}
                          </p>
                        </div>

                        <div className="pt-2 flex gap-1.5 border-t border-gray-200">
                          <a
                            href={`https://www.google.com/maps?q=${m.lat},${m.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-center rounded text-[11px] font-semibold flex items-center justify-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" /> G-Maps
                          </a>
                          <button
                            type="button"
                            onClick={() => copyCoords(m.lat!, m.lng!, m.kode_member)}
                            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-[11px] font-medium flex items-center gap-1"
                          >
                            {copiedCode === m.kode_member ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-gray-600" />}
                            {copiedCode === m.kode_member ? 'Tersalin' : 'Salin'}
                          </button>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>

            {/* Floating selected member quick card overlay (bottom right) */}
            {selectedMember && (
              <div className="absolute bottom-4 right-4 z-[1000] w-80 bg-[var(--bg-card)]/95 backdrop-blur-md border border-[var(--border-strong)] rounded-xl p-3 shadow-xl space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-[var(--text-primary)] leading-snug">{selectedMember.nama_member}</h4>
                    <span className="font-mono text-[11px] text-blue-400 font-semibold">{selectedMember.kode_member}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMember(null)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 text-[10px]">
                  <Badge tone={TONE[selectedMember.tipe] || 'slate'}>{selectedMember.tipe}</Badge>
                  {selectedMember.member_pilihan && <Badge tone="blue">⭐ Pilihan (2x)</Badge>}
                  {selectedMember.advisor && <Badge tone="slate">Adv: {selectedMember.advisor.toUpperCase()}</Badge>}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] space-y-0.5">
                  <p>Belanja Terakhir: <strong className="text-[var(--text-secondary)]">{selectedMember.belanja_terakhir || '-'}</strong></p>
                  <p>Koordinat: <span className="font-mono text-[10px]">{selectedMember.lat}, {selectedMember.lng}</span></p>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-[11px] justify-center"
                    onClick={() => {
                      if (selectedMember.lat && selectedMember.lng) {
                        setFlyPoint([selectedMember.lat, selectedMember.lng]);
                      }
                    }}
                  >
                    <Navigation className="w-3 h-3 text-amber-400" /> Pusatkan
                  </Button>
                  <a
                    href={`https://www.google.com/maps?q=${selectedMember.lat},${selectedMember.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1"
                  >
                    <Button variant="primary" size="sm" className="w-full text-[11px] justify-center">
                      <ExternalLink className="w-3 h-3" /> G-Maps
                    </Button>
                  </a>
                </div>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={filterTipe === 'Member Pilihan' ? 'Komposisi Member Pilihan' : 'Distribusi Tipe Member'}
              icon={PieChartIcon}
              right={<Badge tone="slate">{filterTipe === 'Member Pilihan' ? totals.member_pilihan : totals.total} member</Badge>}
            />
            {pieData.length === 0 ? <EmptyState icon={PieChartIcon} text="Belum ada data untuk filter ini" /> : (
              <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                        {pieData.map((d, i) => <Cell key={i} fill={PIE_COLORS[d.name] || '#3b82f6'} stroke="var(--bg-card)" strokeWidth={2} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2.5 text-sm">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[d.name] || '#3b82f6' }} />
                      <span className="text-[var(--text-secondary)] flex-1">{d.name}</span>
                      <span className="text-[var(--text-primary)] font-semibold">{d.value}</span>
                    </div>
                  ))}
                  {filterTipe === 'Member Pilihan' && (
                    <p className="text-xs text-[var(--text-muted)] pt-2">Target jadwal: <strong className="text-amber-400">2 kunjungan/member/bulan</strong>.</p>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title={`Daftar ${filterTipe === 'semua' ? 'Semua Member' : filterTipe}`}
              icon={Users}
              right={
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="slate">{filteredData.length.toLocaleString('id-ID')} / {filteredTotal.toLocaleString('id-ID')}</Badge>
                  <Button variant="primary" disabled={selectedRows.length === 0} onClick={() => setShowApplyModal(true)}>
                    <Tag className="w-3.5 h-3.5" /> Terapkan Tipe ({selectedRows.length})
                  </Button>
                </div>
              }
            />
            <div className="p-3 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Cari kode member / nama toko / advisor..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--wash-1)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {searchQuery ? `Ditemukan ${filteredData.length} member` : `Total: ${filteredTotal.toLocaleString('id-ID')} member (${withCoordsCount.toLocaleString('id-ID')} terpetakan)`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="p-3.5 w-10"><input type="checkbox" checked={pagedData.length > 0 && pagedData.every((d) => checked[d.kode_member])} onChange={toggleAll} /></th>
                  <th className="p-3.5 font-semibold">Kode Member</th><th className="p-3.5 font-semibold">Nama Toko</th><th className="p-3.5 font-semibold">Advisor</th>
                  <th className="p-3.5 font-semibold">Belanja Pertama</th><th className="p-3.5 font-semibold">Belanja Terakhir</th><th className="p-3.5 font-semibold text-center">Tipe</th><th className="p-3.5 font-semibold text-center">Pilihan</th>
                  <th className="p-3.5 font-semibold text-center">Peta</th>
                </tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {!loading && pagedData.length === 0 && (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState icon={Users} text={searchQuery ? 'Tidak ada member yang cocok dengan pencarian' : 'Tidak ada member pada filter ini'} />
                      </td>
                    </tr>
                  )}
                  {pagedData.map((d) => (
                    <tr key={d.kode_member} className="hover:bg-[var(--wash-1)] transition-colors text-sm">
                      <td className="p-3.5"><input type="checkbox" checked={!!checked[d.kode_member]} onChange={(e) => setChecked((c) => ({ ...c, [d.kode_member]: e.target.checked }))} /></td>
                      <td className="p-3.5 font-mono text-blue-400 text-xs">{d.kode_member}</td>
                      <td className="p-3.5 text-[var(--text-secondary)]">{d.nama_member}</td>
                      <td className="p-3.5 text-[var(--text-muted)]">{(d.advisor || '-').toUpperCase()}</td>
                      <td className="p-3.5 text-[var(--text-muted)]">{d.belanja_pertama || '-'}</td>
                      <td className="p-3.5 text-[var(--text-muted)]">{d.belanja_terakhir || '-'}</td>
                      <td className="p-3.5 text-center"><Badge tone={TONE[d.tipe] || 'slate'}>{d.tipe}</Badge></td>
                      <td className="p-3.5 text-center">{d.member_pilihan ? <Badge tone="blue">2x/Bulan</Badge> : <span className="text-[var(--text-faint)]">-</span>}</td>
                      <td className="p-3.5 text-center">
                        {d.lat && d.lng ? (
                          <button
                            type="button"
                            title="Buka titik toko di Peta Zonasi"
                            onClick={() => {
                              setSelectedMember(d);
                              setFlyPoint([d.lat!, d.lng!]);
                              setViewMode('map');
                            }}
                            className="p-1.5 rounded-lg hover:bg-amber-500/15 text-amber-400 hover:text-amber-300 transition-colors cursor-pointer inline-flex items-center gap-1 text-xs"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span title="Koordinat belum ada" className="text-[var(--text-faint)] text-[10px]">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
        </>
      )}

      {loading && <p className="text-sm text-[var(--text-faint)] text-center py-10">Memuat data...</p>}

      {showApplyModal && <ApplyTipeModal items={selectedRows} onClose={() => setShowApplyModal(false)} onDone={() => { setShowApplyModal(false); setChecked({}); }} />}
      {showUploadTipeModal && <UploadTipeMemberModal onClose={() => setShowUploadTipeModal(false)} />}
      {showPilihanModal && (
        <UploadMemberPilihanModal
          cabang={cabang} bulan={bulan} tahun={tahun}
          onClose={() => setShowPilihanModal(false)}
          onDone={() => { setShowPilihanModal(false); setFilterTipe('Member Pilihan'); setRefreshKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

function ApplyTipeModal({ items, onClose, onDone }: { items: MemberTipeRow[]; onClose: () => void; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setSubmitting(true); setError(null);
    try { await applyTipeMember(items.map((i) => ({ kode_member: i.kode_member, tipe: i.tipe }))); onDone(); }
    catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5"><h3 className="font-display text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><Tag className="w-4 h-4 text-amber-400" /> Terapkan Tipe Member</h3><button onClick={onClose}><X className="w-4 h-4" /></button></div>
        <p className="text-xs text-[var(--text-muted)]">Tipe member {items.length} member terpilih akan diterapkan ke semua jadwal milik kode tersebut.</p>
        {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
        <div className="flex gap-3 mt-6"><Button variant="ghost" className="flex-1" onClick={onClose}>Batal</Button><Button variant="primary" className="flex-1" disabled={submitting} onClick={submit}>{submitting ? 'Menyimpan...' : 'Terapkan'}</Button></div>
      </Card>
    </div>
  );
}

function UploadMemberPilihanModal({ cabang, bulan, tahun, onClose, onDone }: { cabang: string; bulan: string; tahun: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<MemberPilihanUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!file) { setError('Pilih file .xlsx terlebih dahulu.'); return; }
    setUploading(true); setError(null); setResult(null);
    try { const r = await uploadMemberPilihan(file, cabang, bulan, tahun); setResult(r); setFile(null); }
    catch (e: any) { setError(e.message); }
    finally { setUploading(false); }
  };
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-5">
        <div className="flex justify-between items-center mb-4"><h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2"><Star className="w-4 h-4 text-amber-400" /> Upload Member Pilihan</h2><button onClick={onClose}><X className="w-5 h-5" /></button></div>
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-[var(--text-secondary)]">
            Cabang <strong>{cabang}</strong>. Upload terbaru akan <strong>mengganti</strong> daftar Member Pilihan aktif cabang ini dan berlaku untuk generate setiap bulan sampai daftar diupload ulang. Maksimal 50 member unik per MR; masing-masing ditargetkan 2x kunjungan setiap bulan.
          </div>
          <a href={memberPilihanTemplateUrl()} target="_blank" rel="noreferrer"><Button variant="ghost" className="w-full justify-center"><Download className="w-3.5 h-3.5" /> Download Template Member Pilihan</Button></a>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-xs text-[var(--text-secondary)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-amber-600 file:text-white file:text-xs file:font-semibold" />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          {result && (
            <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-lg p-3 text-xs text-[var(--text-secondary)] space-y-2">
              <p>Berhasil: <strong className="text-emerald-400">{result.inserted}</strong> · Daftar lama diganti: <strong>{result.replaced}</strong> · Dilewati: <strong className="text-rose-400">{result.skipped_count}</strong></p>
              <div className="flex flex-wrap gap-1.5">{Object.entries(result.per_advisor).map(([adv, count]) => <Badge key={adv} tone="blue">{adv.toUpperCase()}: {count}</Badge>)}</div>
              {result.skipped.length > 0 && <div className="max-h-28 overflow-y-auto">{result.skipped.map((s, i) => <p key={i} className="text-[10px] text-rose-300/80">Baris {s.row}: {s.reason}</p>)}</div>}
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-5"><Button variant="ghost" className="flex-1" onClick={result ? onDone : onClose}>{result ? 'Selesai' : 'Tutup'}</Button><Button variant="primary" className="flex-1" disabled={uploading || !file} onClick={submit}>{uploading ? 'Mengupload...' : 'Upload & Ganti Daftar'}</Button></div>
      </Card>
    </div>
  );
}

function UploadTipeMemberModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<TipeMemberUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!file) { setError('Pilih file .xlsx terlebih dahulu.'); return; }
    setUploading(true); setError(null); setResult(null);
    try { const r = await uploadTipeMember(file); setResult(r); setFile(null); }
    catch (e: any) { setError(e.message); }
    finally { setUploading(false); }
  };
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex justify-between items-center mb-4"><h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2"><UploadCloud className="w-4 h-4 text-amber-400" /> Upload Tipe Member</h2><button onClick={onClose}><X className="w-5 h-5" /></button></div>
        <div className="space-y-4">
          <a href={tipeMemberUploadTemplateUrl()} target="_blank" rel="noreferrer"><Button variant="ghost" className="w-full justify-center"><Download className="w-3.5 h-3.5" /> Download Template</Button></a>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-xs text-[var(--text-secondary)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-amber-600 file:text-white file:text-xs file:font-semibold" />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          {result && <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-lg p-3 text-xs text-[var(--text-secondary)]">Total {result.total_baris} · Berhasil {result.diproses} · Dilewati {result.skipped_count}</div>}
        </div>
        <div className="flex gap-3 mt-5"><Button variant="ghost" className="flex-1" onClick={onClose}>Tutup</Button><Button variant="primary" className="flex-1" disabled={uploading || !file} onClick={submit}>{uploading ? 'Mengupload...' : 'Upload'}</Button></div>
      </Card>
    </div>
  );
}
