import { fetchSupabase } from './supabase.js';

export interface MemberPilihanPeriodRow {
  kode_member: string;
  nama_toko?: string | null;
  advisor?: string | null;
  cabang?: string | null;
  catatan?: string | null;
  created_at?: string | null;
  bulan?: number | string | null;
  tahun?: number | string | null;
  [key: string]: unknown;
}

function monthBounds(tahun: number, bulan: number) {
  const start = new Date(Date.UTC(tahun, bulan - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(bulan === 12 ? tahun + 1 : tahun, bulan === 12 ? 0 : bulan, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function rowMatchesPeriod(row: MemberPilihanPeriodRow, tahun: number, bulan: number): boolean {
  const rowMonth = Number(row.bulan);
  const rowYear = Number(row.tahun);

  // New schema takes priority whenever both values are present and valid.
  if (Number.isInteger(rowMonth) && rowMonth >= 1 && rowMonth <= 12 && Number.isInteger(rowYear)) {
    return rowMonth === bulan && rowYear === tahun;
  }

  // Backward-compatible fallback for existing rows: derive the period from created_at.
  if (!row.created_at) return false;
  const created = new Date(row.created_at);
  return Number.isFinite(created.getTime())
    && created.getUTCFullYear() === tahun
    && created.getUTCMonth() + 1 === bulan;
}

/**
 * Reads Member Pilihan for a specific month/year without requiring the new
 * bulan/tahun columns to exist yet. If those columns are absent in Supabase,
 * the query transparently falls back to created_at.
 */
export async function getMemberPilihanPeriode(
  cabang: string,
  tahun: number,
  bulan: number,
  options: { username?: string; kodeMembers?: string[] } = {},
): Promise<MemberPilihanPeriodRow[]> {
  const base = `cabang=eq.${encodeURIComponent(cabang)}`;
  const advisor = options.username ? `&advisor=eq.${encodeURIComponent(options.username)}` : '';
  const codes = options.kodeMembers?.map(normalizeCode).filter(Boolean) ?? [];
  const codeFilter = codes.length ? `&kode_member=in.(${codes.join(',')})` : '';

  // First try the future schema. This is intentionally best-effort.
  try {
    const rows = await fetchSupabase<MemberPilihanPeriodRow>(
      `tbtr_member_pilihan?select=*&${base}${advisor}${codeFilter}&order=advisor.asc,kode_member.asc`
    );
    return (rows || []).filter((row) => rowMatchesPeriod(row, tahun, bulan));
  } catch {
    // Existing database has no bulan/tahun columns yet.
    const { start, end } = monthBounds(tahun, bulan);
    const rows = await fetchSupabase<MemberPilihanPeriodRow>(
      `tbtr_member_pilihan?select=*&${base}&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}${advisor}${codeFilter}&order=advisor.asc,kode_member.asc`
    ).catch(() => []);
    return rows || [];
  }
}
