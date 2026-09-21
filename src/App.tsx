import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { Loader2 } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-app,#0f172a)] text-[var(--text-primary,#f8fafc)]">
          <div className="max-w-md w-full bg-[var(--bg-card,#1e293b)] border border-[var(--border,#334155)] rounded-xl p-6 text-center shadow-xl">
            <h2 className="text-lg font-bold text-rose-400 mb-2">Terjadi Kendala Tampilan</h2>
            <p className="text-xs text-[var(--text-muted,#94a3b8)] mb-4">
              {this.state.error?.message || 'Terjadi kesalahan tidak terduga pada komponen halaman ini.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const Dashboard = lazy(() => import('./pages/Dashboard'));
const DashboardByCall = lazy(() => import('./pages/DashboardByCall'));
const Tracking = lazy(() => import('./pages/Tracking'));
const Penjadwalan = lazy(() => import('./pages/Penjadwalan'));
const JadwalAktif = lazy(() => import('./pages/JadwalAktif'));
const JadwalBelumTerkunjungi = lazy(() => import('./pages/JadwalBelumTerkunjungi'));
const MemberBaru = lazy(() => import('./pages/MemberBaru'));
const TokoTutup = lazy(() => import('./pages/TokoTutup'));
const MemberSleeper = lazy(() => import('./pages/MemberSleeper'));
const SurveiHarga = lazy(() => import('./pages/SurveiHarga'));
const StatusKunjunganMember = lazy(() => import('./pages/StatusKunjunganMember'));
const MasterAlasanMenolak = lazy(() => import('./pages/MasterAlasanMenolak'));
const MemberPareto = lazy(() => import('./pages/MemberPareto'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="dashboard-by-call" element={<DashboardByCall />} />
              <Route path="tracking" element={<Tracking />} />
              <Route path="survei-harga" element={<SurveiHarga />} />
              <Route path="penjadwalan" element={<Penjadwalan />} />
              <Route path="jadwal-aktif" element={<JadwalAktif />} />
              <Route path="jadwal-belum-terkunjungi" element={<JadwalBelumTerkunjungi />} />
              <Route path="member-baru" element={<MemberBaru />} />
              <Route path="member-sleeper" element={<MemberSleeper />} />
              <Route path="status-kunjungan-member" element={<StatusKunjunganMember />} />
              <Route path="toko-tutup" element={<TokoTutup />} />
              <Route path="master-alasan-menolak" element={<MasterAlasanMenolak />} />
              <Route path="member-pareto" element={<MemberPareto />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
