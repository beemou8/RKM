/** Server-side branch context for a one-branch-per-instance RKM deployment. */
export function getConfiguredCabang(): string {
  const envDefault = String(process.env.CABANG_DEFAULT || '').trim();
  if (envDefault) return envDefault;
  return String(process.env.CABANG_LIST || '')
    .split(',')
    .map((s) => s.trim())
    .find(Boolean) || '';
}

export function resolveCabang(requested: unknown):
  | { ok: true; cabang: string }
  | { ok: false; cabang: string; reason: string } {
  const configured = getConfiguredCabang().toUpperCase();
  const incoming = String(requested ?? '').trim().toUpperCase();

  if (!configured) {
    if (!incoming) {
      return { ok: false, cabang: '', reason: 'CABANG_DEFAULT belum dikonfigurasi di server.' };
    }
    return { ok: true, cabang: incoming };
  }

  const allowedList = String(process.env.CABANG_LIST || configured)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (incoming && incoming !== configured && !allowedList.includes(incoming)) {
    return {
      ok: false,
      cabang: configured,
      reason: `Akses cabang ditolak. Instance ini terkunci ke cabang ${configured}.`,
    };
  }

  return { ok: true, cabang: incoming || configured };
}
