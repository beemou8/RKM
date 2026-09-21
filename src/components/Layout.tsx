import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  MapPinned,
  Route,
  UserPlus,
  Radio,
  DatabaseZap,
  Store,
  Moon,
  Sun,
  CalendarCheck2,
  CalendarX2,
  ClipboardList,
  PackageCheck,
} from 'lucide-react';
import { fetchDbStatus, fetchCabangList } from '../lib/api';
import type { DbStatus } from '../types';
import { useTheme } from '../lib/theme';

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }>;
}> = [
  {
    label: 'Monitoring',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/dashboard-by-call', label: 'Dashboard By Call', icon: Radio },
      { to: '/tracking', label: 'Tracking', icon: MapPinned },
      { to: '/survei-harga', label: 'Survei Harga', icon: ClipboardList },
    ],
  },
  {
    label: 'Penjadwalan',
    items: [
      { to: '/penjadwalan', label: 'Penjadwalan', icon: Route },
      { to: '/jadwal-aktif', label: 'Jadwal Aktif', icon: CalendarCheck2 },
      { to: '/jadwal-belum-terkunjungi', label: 'Jadwal Member Belum Terkunjungi', icon: CalendarX2 },
      { to: '/toko-tutup', label: 'Toko Tutup', icon: Store },
    ],
  },
  {
    label: 'Member',
    items: [
      { to: '/status-kunjungan-member', label: 'Status Kunjungan Member', icon: CalendarCheck2 },
      { to: '/member-baru', label: 'Member Baru', icon: UserPlus },
      { to: '/member-sleeper', label: 'Member Sleeper', icon: Moon },
      { to: '/member-pareto', label: 'Member Belum Belanja Pareto', icon: PackageCheck },
    ],
  },
];

export type LayoutContext = { dbStatus: DbStatus | null; cabang: string };

export default function Layout() {
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [theme, , setTheme] = useTheme();
  // Cabang is not user-switchable in the UI — it's fixed via CABANG_DEFAULT (or
  // CABANG_LIST's first entry) in .env. To change it, edit .env and restart.
  // `cabang` stays null until it's actually been resolved from the server, so
  // pages never fire a request with a wrong placeholder value first.
  const [cabang, setCabang] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = () => fetchDbStatus().then((s) => mounted && setDbStatus(s)).catch(() => {});
    poll();
    const id = setInterval(poll, 20000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchCabangList()
      .then((r) => {
        if (mounted) setCabang(r.default || r.cabang[0] || '2T');
      })
      .catch(() => {
        if (mounted) setCabang('2T');
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen flex bg-[var(--bg-app)] text-[var(--text-primary)]">
      <aside className="w-16 lg:w-60 shrink-0 border-r border-[var(--border)] bg-[var(--bg-app-alt)] flex flex-col">
        <div className="h-16 flex items-center justify-center lg:justify-start lg:px-5 border-b border-[var(--border)]">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft-bg)] border border-[var(--accent-soft-border)] flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <span className="hidden lg:block ml-2.5 font-display font-semibold text-sm tracking-tight text-[var(--text-primary)]">
            RKM Monitor
          </span>
        </div>

        <nav className="flex-1 py-3 space-y-4 px-2 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="hidden lg:block px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors justify-center lg:justify-start ${
                        isActive
                          ? 'bg-[var(--accent-soft-bg)] text-[var(--accent)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                      }`
                    }
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="hidden lg:block truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-2 border-t border-[var(--border)] flex flex-col gap-2">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--wash-1)] border border-[var(--border)] justify-center lg:justify-stretch">
            <button
              onClick={() => setTheme('light')}
              title="Light Mode"
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                theme === 'light'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'
              }`}
            >
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:block">Light</span>
            </button>
            <button
              onClick={() => setTheme('dark')}
              title="Dark Mode"
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                theme === 'dark'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'
              }`}
            >
              <Moon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:block">Dark</span>
            </button>
          </div>
          <div className="hidden lg:block">
            <DbStatusPill status={dbStatus} compact={false} />
          </div>
          <div className="lg:hidden flex justify-center">
            <DbStatusPill status={dbStatus} compact />
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 min-w-0 p-4 lg:p-6">
          {cabang === null ? (
            <div className="flex items-center justify-center h-full min-h-[60vh] text-sm text-[var(--text-faint)]">
              Memuat konfigurasi cabang...
            </div>
          ) : (
            <Outlet context={{ dbStatus, cabang } satisfies LayoutContext} />
          )}
        </main>
      </div>
    </div>
  );
}

function DbStatusPill({ status, compact }: { status: DbStatus | null; compact: boolean }) {
  const connected = status?.connected;
  const tone = connected
    ? { dot: 'bg-emerald-400', wrap: 'bg-emerald-500/10 border-emerald-500/20', icon: 'text-emerald-500', text: 'text-emerald-500' }
    : status
    ? { dot: 'bg-rose-400', wrap: 'bg-rose-500/10 border-rose-500/20', icon: 'text-rose-500', text: 'text-rose-500' }
    : { dot: 'bg-slate-500', wrap: 'bg-slate-500/10 border-slate-500/20', icon: 'text-slate-400', text: 'text-slate-400' };

  if (compact) {
    return (
      <div
        className={`w-2.5 h-2.5 rounded-full ${tone.dot}`}
        title={connected ? 'DB lokal terhubung' : status?.error || 'Memeriksa koneksi...'}
      />
    );
  }
  return (
    <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${tone.wrap}`}>
      <DatabaseZap className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tone.icon}`} />
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold ${tone.text}`}>
          {connected ? 'DB Lokal Online' : status ? 'DB Lokal Offline' : 'Mengecek...'}
        </p>
        <p className="text-[10px] text-[var(--text-muted)] truncate" title={status?.error || undefined}>
          {connected ? status?.host : status?.error || 'Menghubungkan ke server...'}
        </p>
      </div>
    </div>
  );
}
