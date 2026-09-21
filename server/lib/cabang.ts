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
  const configured = getConfiguredCabang();
  const incoming = String(requested ?? '').trim();

  if (!configured) {
    if (!incoming) {
      return { ok: false, cabang: '', reason: 'CABANG_DEFAULT belum dikonfigurasi di server.' };
    }
    return { ok: true, cabang: incoming };
  }

  if (incoming && incoming !== configured) {
    return {
      ok: false,
      cabang: configured,
      reason: `Akses cabang ditolak. Instance ini terkunci ke cabang ${configured}.`,
    };
  }

  return { ok: true, cabang: configured };
}
