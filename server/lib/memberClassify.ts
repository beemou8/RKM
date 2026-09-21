const SLEEPER_BULAN = 3; // > 3 bulan sejak belanja terakhir dianggap "Sleeper"

/**
 * Klasifikasi member berdasarkan riwayat transaksi di tbtr_jualheader:
 *  - belanja_pertama kosong (belum pernah transaksi sama sekali) -> "Belum Aktivasi"
 *  - belanja_terakhir lebih dari 3 bulan yang lalu -> "Sleeper"
 *  - selain itu -> "Aktif" (tidak butuh perhatian khusus)
 */
export function classifyTipeMember(
  belanjaPertama: string | null,
  belanjaTerakhir: string | null
): 'Aktif' | 'Sleeper' | 'Belum Aktivasi' {
  if (!belanjaPertama) return 'Belum Aktivasi';
  if (belanjaTerakhir) {
    const batas = new Date();
    batas.setMonth(batas.getMonth() - SLEEPER_BULAN);
    if (new Date(belanjaTerakhir) < batas) return 'Sleeper';
  }
  return 'Aktif';
}
