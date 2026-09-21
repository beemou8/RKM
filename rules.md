# Aturan & Panduan Project RKM Monitoring

## 1. File Sakral (DILARANG DIUBAH)
- `src/pages/Penjadwalan.tsx`
- `src/pages/JadwalAktif.tsx`
Jangan pernah mengubah, memodifikasi, atau menghapus kode pada kedua file ini kecuali diminta secara langsung dan eksplisit oleh user.

## 2. Standar Pagination & Pencarian (Search)
- Semua halaman / view yang menampilkan data (tabel, list card detail di dashboard, member, survei, dsb.) wajib menerapkan batas default 25 data per halaman menggunakan komponen `<Pagination />`.
- Menyediakan opsi ukuran baris: 25 / hal, 50 / hal, 100 / hal, dan Semua.
- Setiap ada perubahan pada kata kunci pencarian atau tab filter, halaman aktif harus di-reset kembali ke halaman 1 (`setPage(1)`).
- Total Count Tetap Utuh: Angka penghitung pada badge header, stat card, dan tab counter wajib selalu menampilkan total riil seluruh data (tidak boleh terpotong menjadi 25).

## 3. Query & Batas 1.000 Data Supabase
- Supabase PostgREST membatasi penarikan maksimal 1.000 baris per request.
- Untuk penarikan data yang melebihi 1.000 data (seperti `tbtr_status_toko`, export Excel, dan data blokir jadwal), wajib menggunakan `fetchSupabaseAll` dengan HTTP Range header.
- Pada fitur pencarian data besar (seperti Toko Tutup), pencarian wajib mengeksekusi query SQL server-side baru ke database Supabase dengan filter `or=(nama_toko.ilike.*,kode_member.ilike.*,...)`, bukan sekadar filter client-side dari data lama di memori.

## 4. Layout & Desain Container
- Pilihan/switcher tampilan (seperti Dashboard Reguler vs Dashboard Khusus SPV) wajib dimasukkan ke dalam container Card utama yang rapi dan selaras dengan lebar konten (`max-w-[1600px]`), jangan dibiarkan mengambang di atas tanpa container.

## 5. Keamanan & Git
- File `.env` dan rahasia database tidak boleh di-commit atau di-push ke git repository.
- File `.gitignore` harus selalu mengecualikan: `node_modules`, `dist`, `dist-server`, dan `.env`.

## 6. Standar Anti-Slop (Bahasa Alami & Bebas Gaya Robotik)
- **Teks Antarmuka (UI, Toast, Modal, Error)**: Gunakan bahasa Indonesia yang wajar, padat, dan pas untuk kebutuhan operasional di lapangan (tim sales & supervisor).
- **Hindari Ciri Bahasa AI Kaku**:
  - Dilarang memakai terjemahan harfiah atau calque seperti *"yang mana"* atau *"di mana"* (sebagai kata ganti penghubung/relative pronoun).
  - Hindari kata sambung birokratis yang berbelit-belit (*"sehubungan dengan hal tersebut"*, *"dalam rangka untuk"*).
  - Hindari pembuka definisi istilah klise (*"...merupakan sebuah fitur yang berfungsi untuk..."*).
  - Hindari penambahan kata *"menjadi"* yang tidak perlu (*"berhasil menjadi tersimpan"* -> ganti *"berhasil disimpan"*).
- **Komentar Kode (Code Comments)**: Tulis komentar hanya untuk konteks logika bisnis yang kompleks atau esensial. Hapus komentar repetitif bawaan AI (seperti `// Function to handle click`, `// Render table`).
- **Gaya Komunikasi**: Lugas, to the point, tanpa basa-basi pujian berlebihan atau pembuka/penutup robotik yang seragam.
