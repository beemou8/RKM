import React from 'react';
import type { LucideIcon } from 'lucide-react';

export function Card({
  children,
  className = '',
  style,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)] ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, icon: Icon, right }: { title: React.ReactNode; icon?: LucideIcon; right?: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-[var(--accent)]" />}
        {title}
      </h3>
      {right}
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'slate',
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue';
}) {
  const toneMap: Record<string, string> = {
    slate: 'bg-slate-500/15 text-slate-500',
    emerald: 'bg-emerald-500/15 text-emerald-500',
    amber: 'bg-amber-500/15 text-amber-500',
    rose: 'bg-rose-500/15 text-rose-500',
    blue: 'bg-blue-500/15 text-blue-500',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-xl font-display font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-[var(--text-faint)] mt-1">{sub}</div>}
    </Card>
  );
}

export function Badge({ tone, children }: { tone: 'emerald' | 'rose' | 'slate' | 'amber' | 'blue'; children: React.ReactNode }) {
  const toneMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    slate: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
    amber: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border ${toneMap[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <div className="w-11 h-11 rounded-full bg-[var(--bg-hover)] border border-[var(--border-strong)] flex items-center justify-center mb-3">
        <Icon className="w-4.5 h-4.5 text-[var(--text-faint)]" />
      </div>
      <p className="text-sm text-[var(--text-faint)]">{text}</p>
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)] transition-colors ${props.className || ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors ${props.className || ''}`}
    />
  );
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'success' | 'danger' }) {
  const variants: Record<string, string> = {
    primary: 'bg-[var(--accent)] hover:bg-[var(--accent-strong)] text-[var(--text-on-accent)]',
    ghost: 'bg-[var(--bg-hover)] hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)] border border-[var(--border-strong)]',
    success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    danger: 'bg-rose-600 hover:bg-rose-500 text-white',
  };
  return (
    <button
      {...rest}
      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 justify-center disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Pagination({
  currentPage,
  totalItems,
  pageSize = 25,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  className = '',
}: {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}) {
  const safeTotal = Math.max(0, Number(totalItems) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || 25);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const page = Math.min(Math.max(1, Number(currentPage) || 1), totalPages);

  const startIdx = safeTotal === 0 ? 0 : (page - 1) * safePageSize + 1;
  const endIdx = Math.min(page * safePageSize, safeTotal);

  if (safeTotal <= 0) return null;

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)] ${className}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span>
          Menampilkan <strong className="text-[var(--text-primary)] font-semibold">{startIdx}-{endIdx}</strong> dari{' '}
          <strong className="text-[var(--text-primary)] font-semibold">{safeTotal.toLocaleString('id-ID')}</strong> data
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-2">
            <span>Batas:</span>
            <select
              value={safePageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="bg-[var(--wash-1)] border border-[var(--border-strong)] rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)] outline-none cursor-pointer"
            >
              {(pageSizeOptions || [25, 50, 100]).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
              <option value={999999}>Semua</option>
            </select>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-2.5 py-1 rounded border border-[var(--border-strong)] bg-[var(--wash-1)] hover:bg-[var(--wash-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium text-[var(--text-primary)] cursor-pointer"
          >
            Sebelumnya
          </button>

          <span className="px-1 text-xs text-[var(--text-secondary)]">
            Hal <strong className="text-[var(--text-primary)]">{page}</strong> dari {totalPages}
          </span>

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-2.5 py-1 rounded border border-[var(--border-strong)] bg-[var(--wash-1)] hover:bg-[var(--wash-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium text-[var(--text-primary)] cursor-pointer"
          >
            Selanjutnya
          </button>
        </div>
      )}
    </div>
  );
}

