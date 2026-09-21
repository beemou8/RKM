# Aturan Member Pilihan

## Perilaku saat ini

`tbtr_member_pilihan` adalah master daftar Member Pilihan aktif per cabang.

- Tombol **Full** = blast bulanan. Sistem memakai master Member Pilihan untuk menjadwalkan target 2x/bulan.
- Tombol **Cari** = generate berdasarkan periode tanggal yang dipilih (termasuk 1 hari). Sistem **tidak** menjalankan blast Member Pilihan.
- Jadwal yang sudah tersimpan sebagai `tipe_member = Member Pilihan` tetap membawa status tersebut ketika dijadwalkan ulang.
- Push hasil generate harian tidak lagi mengubah semua member yang kebetulan ada di master Member Pilihan menjadi `Member Pilihan`.

## Kenapa ini penting

Jangan menggunakan master `tbtr_member_pilihan` sebagai penentu bahwa setiap kemunculan member pada hari tertentu otomatis merupakan kunjungan MP. Master hanya menjadi sumber target ketika proses **Full/bulanan** dijalankan.

## Pola yang dipakai untuk modul baru

1. **Generator bulanan** menentukan slot khusus Member Pilihan.
2. **Generator harian** hanya mengisi member biasa sesuai tanggal.
3. **Reschedule** hanya memindahkan tanggal dan mempertahankan `tipe_member` dari jadwal asal.
4. **Push** memvalidasi flag MP yang dikirim generator dan mencatat `tipe_member` sesuai konteks tersebut.
