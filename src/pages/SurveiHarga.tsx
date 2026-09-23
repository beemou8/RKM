import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  PackageSearch,
  ReceiptText,
  Search,
  FileSpreadsheet,
  Trophy,
  XCircle,
} from 'lucide-react';
import { exportSurveiHargaUrl, fetchSurveiHarga } from '../lib/api';
import type {
  SurveiCompareStatus,
  SurveiHargaProduct,
  SurveiHargaResponse,
  SurveiHargaStruk,
} from '../types';
import { Badge, Button, Card, EmptyState, Input, Select, StatCard, Pagination } from '../components/ui';
import type { LayoutContext } from '../components/Layout';

type TabKey = 'preview' | 'detail' | 'struk';

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

function rupiah(value: number) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '-';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(date: string) {
  if (!date) return '-';
  const [y, m, d] = date.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

function statusTone(status: SurveiCompareStatus): 'emerald' | 'rose' | 'slate' | 'amber' {
  if (status === 'MENANG') return 'emerald';
  if (status === 'KALAH') return 'rose';
  if (status === 'SERI') return 'slate';
  return 'amber';
}

function statusLabel(status: SurveiCompareStatus) {
  if (status === 'TIDAK_ADA_HARGA') return 'BELUM MATCH';
  return status;
}

function FotoStruk({ url, compact = false }: { url: string | null; compact?: boolean }) {
  if (!url) return <span className="text-[10px] text-[var(--text-faint)]">Tidak ada foto</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`group relative overflow-hidden border border-[var(--border)] bg-[var(--wash-1)] block ${compact ? 'w-14 h-14 rounded-lg' : 'w-full max-w-sm aspect-[4/3] rounded-xl'}`}
      title="Buka foto struk"
    >
      <img src={url} alt="Foto struk" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors flex items-center justify-center">
        <ExternalLink className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </a>
  );
}

export default function SurveiHarga() {
  const { cabang } = useOutletContext<LayoutContext>();
  const [tglDari, setTglDari] = useState(firstDayOfMonthStr());
  const [tglSampai, setTglSampai] = useState(todayStr());
  const [petugas, setPetugas] = useState('');
  const [kompetitor, setKompetitor] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('preview');
  const [data, setData] = useState<SurveiHargaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPlu, setExpandedPlu] = useState<string | null>(null);
  const [expandedStruk, setExpandedStruk] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pageStruk, setPageStruk] = useState(1);
  const [pageSizeStruk, setPageSizeStruk] = useState(25);

  useEffect(() => {
    if (!cabang) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    fetchSurveiHarga(tglDari, tglSampai, petugas, kompetitor, cabang)
      .then((result) => {
        if (!mounted) return;
        setData(result);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e.message || 'Gagal mengambil data survei harga');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [tglDari, tglSampai, petugas, kompetitor, cabang]);

  const userOptions = useMemo(() => {
    const names = new Set(data?.users || []);
    if (petugas) names.add(petugas);
    return Array.from(names).sort();
  }, [data?.users, petugas]);

  const competitorOptions = useMemo(() => {
    const names = new Set(data?.competitors || []);
    if (kompetitor) names.add(kompetitor);
    return Array.from(names).sort();
  }, [data?.competitors, kompetitor]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.products || [];
    return (data?.products || []).filter((p) =>
      p.plu.toLowerCase().includes(q) ||
      p.nama_barang.toLowerCase().includes(q)
    );
  }, [data?.products, search]);

  const pagedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, page, pageSize]);

  const filteredStruk = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.struk || [];
    return (data?.struk || []).filter((s) =>
      s.detail.some((d) => d.plu.toLowerCase().includes(q) || d.nama_barang.toLowerCase().includes(q))
    );
  }, [data?.struk, search]);

  const pagedStruk = useMemo(() => {
    const start = (pageStruk - 1) * pageSizeStruk;
    return filteredStruk.slice(start, start + pageSizeStruk);
  }, [filteredStruk, pageStruk, pageSizeStruk]);

  return (
    <div className="max-w-[1700px] mx-auto space-y-5">
      <Card className="p-5">
        <div className="flex flex-col 2xl:flex-row gap-4 2xl:items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-[var(--accent)]" /> Survei Harga
            </h1>
            <div className="text-xs text-amber-400 font-semibold mt-1">Cabang {cabang}</div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-faint)]" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setPageStruk(1);
                }}
                placeholder="Cari PLU / nama barang"
                className="pl-9 w-60"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-faint)]" />
              <Input
                list="survei-kompetitor-list"
                value={kompetitor}
                onChange={(e) => {
                  setKompetitor(e.target.value);
                  setPage(1);
                  setPageStruk(1);
                }}
                placeholder="Cari kompetitor"
                className="pl-9 w-52"
              />
              <datalist id="survei-kompetitor-list">
                {competitorOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>
            <Select
              value={petugas}
              onChange={(e) => {
                setPetugas(e.target.value);
                setPage(1);
                setPageStruk(1);
              }}
              className="w-48"
            >
              <option value="">Semua Penginput</option>
              {userOptions.map((name) => (
                <option key={name} value={name}>{name.toUpperCase()}</option>
              ))}
            </Select>
            <Input type="date" value={tglDari} onChange={(e) => setTglDari(e.target.value)} />
            <Input type="date" value={tglSampai} onChange={(e) => setTglSampai(e.target.value)} />
            <a href={exportSurveiHargaUrl(tglDari, tglSampai, petugas, kompetitor, cabang)}>
              <Button variant="success" disabled={loading}>
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
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


      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={PackageSearch} tone="blue" label="Produk" value={loading ? '...' : data?.totals.total_produk ?? 0} />
        <StatCard icon={Trophy} tone="emerald" label="Menang" value={loading ? '...' : data?.totals.menang ?? 0} />
        <StatCard icon={XCircle} tone="rose" label="Kalah" value={loading ? '...' : data?.totals.kalah ?? 0} />
        <StatCard icon={BarChart3} tone="slate" label="Seri" value={loading ? '...' : data?.totals.seri ?? 0} />
        <StatCard icon={ReceiptText} tone="amber" label="Struk" value={loading ? '...' : data?.totals.total_struk ?? 0} />
      </div>

      <Card>
        <div className="px-4 pt-4 border-b border-[var(--border)] flex flex-wrap gap-2">
          <TabButton
            active={tab === 'preview'}
            onClick={() => {
              setTab('preview');
              setPage(1);
            }}
            icon={PackageSearch}
            label={`Preview Terbaru (${filteredProducts.length})`}
          />
          <TabButton
            active={tab === 'detail'}
            onClick={() => {
              setTab('detail');
              setPage(1);
            }}
            icon={Eye}
            label={`Detail per PLU (${filteredProducts.length})`}
          />
          <TabButton
            active={tab === 'struk'}
            onClick={() => {
              setTab('struk');
              setPageStruk(1);
            }}
            icon={ReceiptText}
            label={`View Struk (${filteredStruk.length})`}
          />
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--text-faint)]">Memuat dan membandingkan harga...</div>
        ) : tab === 'preview' ? (
          <>
            <PreviewTable products={pagedProducts} onDetail={(plu) => { setExpandedPlu(plu); setTab('detail'); setPage(1); }} />
            <Pagination
              currentPage={page}
              totalItems={filteredProducts.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : tab === 'detail' ? (
          <>
            <DetailPerPlu products={pagedProducts} expandedPlu={expandedPlu} setExpandedPlu={setExpandedPlu} />
            <Pagination
              currentPage={page}
              totalItems={filteredProducts.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <>
            <ViewStruk rows={pagedStruk} expandedStruk={expandedStruk} setExpandedStruk={setExpandedStruk} />
            <Pagination
              currentPage={pageStruk}
              totalItems={filteredStruk.length}
              pageSize={pageSizeStruk}
              onPageChange={setPageStruk}
              onPageSizeChange={setPageSizeStruk}
            />
          </>
        )}
      </Card>

    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof PackageSearch; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-3 -mb-px border-b-2 text-xs font-semibold flex items-center gap-2 transition-colors ${
        active
          ? 'border-[var(--accent)] text-[var(--accent)]'
          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

function PreviewTable({ products, onDetail }: { products: SurveiHargaProduct[]; onDetail: (plu: string) => void }) {
  if (products.length === 0) return <EmptyState icon={PackageSearch} text="Tidak ada produk survei sesuai filter" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left min-w-[1200px]">
        <thead>
          <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            <th className="p-3.5 font-semibold">PLU / Produk</th>
            <th className="p-3.5 font-semibold">Kompetitor Terbaru</th>
            <th className="p-3.5 font-semibold text-right">Harga Kita</th>
            <th className="p-3.5 font-semibold text-right">Harga Kompetitor</th>
            <th className="p-3.5 font-semibold text-right">Selisih</th>
            <th className="p-3.5 font-semibold text-center">Status</th>
            <th className="p-3.5 font-semibold">Penginput</th>
            <th className="p-3.5 font-semibold text-center">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {products.map((product) => {
            const row = product.latest;
            return (
              <tr key={product.plu || row.detail_id} className="hover:bg-[var(--wash-1)] transition-colors text-sm">
                <td className="p-3.5 max-w-[320px]">
                  <div className="font-mono text-xs text-[var(--accent)]">{product.plu || '-'}</div>
                  <div className="font-semibold text-[var(--text-primary)] mt-1 truncate" title={product.nama_barang}>{product.nama_barang}</div>
                </td>
                <td className="p-3.5">
                  <div className="font-semibold text-[var(--text-secondary)]">{row.nama_kompetitor}</div>
                  <div className="text-[10px] text-[var(--text-faint)] mt-1">{formatDate(row.tanggal_struk)}</div>
                </td>
                <td className="p-3.5 text-right">
                  <div className="font-semibold text-[var(--text-primary)]">{rupiah(row.harga_kita)}</div>
                </td>
                <td className="p-3.5 text-right font-semibold text-[var(--text-primary)]">{rupiah(row.harga_kompetitor)}</td>
                <td className={`p-3.5 text-right font-semibold ${row.selisih > 0 ? 'text-emerald-500' : row.selisih < 0 ? 'text-rose-500' : 'text-[var(--text-muted)]'}`}>
                  {row.harga_kita > 0 ? (
                    <>
                      <div>{row.selisih > 0 ? '+' : ''}{rupiah(Math.abs(row.selisih))}</div>
                      <div className="text-[10px] mt-1">{row.selisih_persen > 0 ? '+' : ''}{row.selisih_persen.toFixed(1)}%</div>
                    </>
                  ) : '-'}
                </td>
                <td className="p-3.5 text-center"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></td>
                <td className="p-3.5">
                  <div className="font-mono text-xs text-[var(--text-secondary)]">{row.nama_user.toUpperCase()}</div>
                </td>
                <td className="p-3.5">
                  <button type="button" onClick={() => onDetail(product.plu || `detail-${row.detail_id}`)} className="mx-auto px-3 py-2 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5" /> Detail
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailPerPlu({
  products,
  expandedPlu,
  setExpandedPlu,
}: {
  products: SurveiHargaProduct[];
  expandedPlu: string | null;
  setExpandedPlu: (plu: string | null) => void;
}) {
  if (products.length === 0) return <EmptyState icon={PackageSearch} text="Tidak ada detail PLU sesuai filter" />;

  return (
    <div className="divide-y divide-[var(--border)]">
      {products.map((product) => {
        const key = product.plu || `detail-${product.latest.detail_id}`;
        const open = expandedPlu === product.plu || (!product.plu && expandedPlu === key);
        return (
          <div key={key}>
            <button
              type="button"
              onClick={() => setExpandedPlu(open ? null : (product.plu || key))}
              className="w-full p-4 text-left hover:bg-[var(--wash-1)] transition-colors"
            >
              <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_0.7fr_0.7fr_0.7fr_auto] gap-3 lg:items-center">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-[var(--accent)]">{product.plu || '-'}</span>
                    <Badge tone={statusTone(product.latest.status)}>{statusLabel(product.latest.status)}</Badge>
                  </div>
                  <div className="text-sm font-semibold text-[var(--text-primary)] mt-1">{product.nama_barang}</div>
                </div>
                <MiniValue label="Riwayat" value={`${product.total_survei}x`} />
                <MiniValue label="Kompetitor" value={String(product.total_kompetitor)} />
                <div className="flex gap-2 lg:justify-end">
                  <Badge tone="emerald">M {product.menang}</Badge>
                  <Badge tone="rose">K {product.kalah}</Badge>
                  <Badge tone="slate">S {product.seri}</Badge>
                </div>
                <div className="flex justify-end">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
              </div>
            </button>

            {open && <ProductHistory product={product} />}
          </div>
        );
      })}
    </div>
  );
}

function ProductHistory({ product }: { product: SurveiHargaProduct }) {
  return (
    <div className="px-4 pb-5 bg-[var(--wash-1)]/35">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 pb-4">
        <MiniCard label="Harga Kita Saat Ini" value={rupiah(product.harga_kita)} />
        <MiniCard label="Harga Normal" value={rupiah(product.harga_normal)} />
        <MiniCard label="Harga Promo" value={rupiah(product.harga_promo)} />
        <MiniCard label="Unit / Frac" value={`${product.unit || '-'} / ${product.frac_master || product.frac || '-'}`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <table className="w-full text-left min-w-[1100px]">
          <thead>
            <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <th className="p-3 font-semibold">Tanggal</th>
              <th className="p-3 font-semibold">Kompetitor</th>
              <th className="p-3 font-semibold text-right">Harga Kita</th>
              <th className="p-3 font-semibold text-right">Harga Input</th>
              <th className="p-3 font-semibold text-right">Selisih</th>
              <th className="p-3 font-semibold text-center">Status</th>
              <th className="p-3 font-semibold">Penginput</th>
              <th className="p-3 font-semibold text-center">Struk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {product.history.map((row) => (
              <tr key={row.detail_id} className="text-sm hover:bg-[var(--wash-1)] transition-colors">
                <td className="p-3 text-[var(--text-secondary)]">{formatDate(row.tanggal_struk)}</td>
                <td className="p-3 font-semibold text-[var(--text-primary)]">{row.nama_kompetitor}</td>
                <td className="p-3 text-right">{rupiah(row.harga_kita)}</td>
                <td className="p-3 text-right font-semibold">{rupiah(row.harga_kompetitor)}</td>
                <td className={`p-3 text-right font-semibold ${row.selisih > 0 ? 'text-emerald-500' : row.selisih < 0 ? 'text-rose-500' : ''}`}>
                  {row.harga_kita > 0 ? `${row.selisih > 0 ? '+' : ''}${rupiah(Math.abs(row.selisih))}` : '-'}
                </td>
                <td className="p-3 text-center"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></td>
                <td className="p-3 font-mono text-xs">{row.nama_user.toUpperCase()}</td>
                <td className="p-3"><div className="flex justify-center"><FotoStruk url={row.foto_struk} compact /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ViewStruk({
  rows,
  expandedStruk,
  setExpandedStruk,
}: {
  rows: SurveiHargaStruk[];
  expandedStruk: number | null;
  setExpandedStruk: (id: number | null) => void;
}) {
  if (rows.length === 0) return <EmptyState icon={ReceiptText} text="Tidak ada struk sesuai filter" />;

  return (
    <div className="divide-y divide-[var(--border)]">
      {rows.map((row) => {
        const open = expandedStruk === row.id;
        return (
          <div key={row.id}>
            <button type="button" onClick={() => setExpandedStruk(open ? null : row.id)} className="w-full p-4 text-left hover:bg-[var(--wash-1)] transition-colors">
              <div className="grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr_0.8fr_0.6fr_auto] gap-3 md:items-center">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{row.nama_kompetitor}</div>
                  <div className="text-[10px] text-[var(--text-faint)] mt-1">Struk #{row.id}</div>
                </div>
                <MiniValue label="Tanggal Struk" value={formatDate(row.tanggal_struk)} />
                <MiniValue label="Penginput" value={row.nama_user.toUpperCase()} />
                <MiniValue label="Item" value={String(row.jumlah_item)} />
                <div className="flex justify-end">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
              </div>
            </button>

            {open && (
              <div className="px-4 pb-5 bg-[var(--wash-1)]/35">
                <div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-4 pt-4">
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Foto Struk</div>
                    <FotoStruk url={row.foto_struk} />
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
                    <table className="w-full text-left min-w-[850px]">
                      <thead>
                        <tr className="bg-[var(--wash-1)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                          <th className="p-3">PLU</th>
                          <th className="p-3">Produk</th>
                          <th className="p-3 text-right">Harga Kita</th>
                          <th className="p-3 text-right">Harga Struk</th>
                          <th className="p-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {row.detail.map((item) => (
                          <tr key={item.detail_id} className="text-sm">
                            <td className="p-3 font-mono text-xs text-[var(--accent)]">{item.plu || '-'}</td>
                            <td className="p-3 text-[var(--text-primary)]">{item.nama_barang}</td>
                            <td className="p-3 text-right">{rupiah(item.harga_kita)}</td>
                            <td className="p-3 text-right font-semibold">{rupiah(item.harga_kompetitor)}</td>
                            <td className="p-3 text-center"><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
      <div className="text-sm text-[var(--text-secondary)] mt-1">{value}</div>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
      <div className="text-sm font-semibold text-[var(--text-primary)] mt-1">{value}</div>
    </div>
  );
}
