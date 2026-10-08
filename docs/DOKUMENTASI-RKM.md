markdown
# 📚 Dokumentasi Lengkap API & Fungsi Sistem RKM
Dokumentasi ini mencakup arsitektur sistem, seluruh endpoint REST API Express, fungsi helper backend, mekanisme sinkronisasi database ganda (PostgreSQL Lokal & Supabase Cloud Relay), serta fungsi API client di frontend React (`src/lib/api.ts`).
---
## 📑 Daftar Isi
1. [Arsitektur Sistem & Database](#1-arsitektur-sistem--database)
2. [Konfigurasi Lingkungan (.env) & Keamanan](#2-konfigurasi-lingkungan-env--keamanan)
3. [Daftar Endpoint REST API Backend](#3-daftar-endpoint-rest-api-backend)
   - [Modul 1: System & Database Health](#modul-1-system--database-health)
   - [Modul 2: Supabase Cloud Relay (/api/relay)](#modul-2-supabase-cloud-relay-apirelay)
   - [Modul 3: Penjadwalan / Schedule (/api/schedule)](#modul-3-penjadwalan--schedule-apischedule)
   - [Modul 4: Dashboard Monitoring (/api/dashboard)](#modul-4-dashboard-monitoring-apidashboard)
   - [Modul 5: Tracking & Monitoring Advisor (/api/tracking)](#modul-5-tracking--monitoring-advisor-apitracking)
   - [Modul 6: Member & CRM (/api/member, /api/member-tipe, /api/member-status)](#modul-6-member--crm)
   - [Modul 7: Survei Harga Kompetitor (/api/survei-harga)](#modul-7-survei-harga-kompetitor-apisurvei-harga)
   - [Modul 8: Member Pareto (/api/member-pareto)](#modul-8-member-pareto-apimember-pareto)
   - [Modul 9: Master Data (/api/master)](#modul-9-master-data-apimaster)
   - [Modul 10: Modul Khusus SPV (/api/schedule-spv & /api/dashboard-spv)](#modul-10-modul-khusus-spv)
4. [Dokumentasi Fungsi Frontend Client (src/lib/api.ts)](#4-dokumentasi-fungsi-frontend-client-srclibapits)
5. [Struktur Payload Data & Standar Error](#5-struktur-payload-data--standar-error)
---
## 1. Arsitektur Sistem & Database
Aplikasi RKM menggunakan arsitektur **Hybrid Dual-Database**:
1. **PostgreSQL On-Premise (Jaringan Kantor / VPN)**:
   - Digunakan untuk data transaksional internal, master toko cabang, data salesman, histori omset belanja (`tbtr_jualheader`), dan data koordinat GPS CRM (`tbmaster_customercrm`).
   - Jika koneksi DB lokal terputus, backend **tidak akan crash**, melainkan masuk ke mode terdegradasi (*degraded state*) dengan `db_lokal_connected: false`.
2. **Supabase Cloud (via Relay)**:
   - Digunakan untuk data operasional lapangan, penyimpanan jadwal kunjungan bulanan (`tbtr_jadwal_bulanan`), absensi check-in mobile advisor, master member pilihan, titik koordinat toko cabang (`tbmaster_tikortoko`), dan status toko tutup.
   - Akses Supabase dilakukan melalui perantara HTTPS Relay (`SUPABASE_RELAY_URL`) menggunakan token rahasia `RELAY_SHARED_SECRET` untuk keamanan.
---
## 2. Konfigurasi Lingkungan (`.env`) & Keamanan
| Variabel | Deskripsi | Default / Contoh |
| :--- | :--- | :--- |
| `PORT` | Port server Express berjalan | `3456` |
| `RELAY_ONLY` | Flag hanya mengizinkan operasi database cloud via relay | `true` |
| `SUPABASE_RELAY_URL` | URL endpoint reverse relay Supabase | `https://rkm.bimoporto.my.id/api/relay` |
| `RELAY_SHARED_SECRET` | Secret token HMAC/Bearer otentikasi relay | `fQfYuQv9...` |
| `SUPABASE_TIMEOUT_MS` | Timeout maksimal request relay ke Supabase (ms) | `15000` |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Konfigurasi koneksi PostgreSQL lokal kantor | `172.31.147.186:5432 / spibdg2t` |
| `DB_USER`, `DB_PASS` | Kredensial PostgreSQL lokal | `edp` |
| `CABANG_DEFAULT` | Kode cabang default | `2T` |
| `API_RATE_LIMIT_PER_MINUTE` | Batas request API per menit per IP | `240` |
| `EXPORT_RATE_LIMIT_PER_MINUTE` | Batas request export Excel per menit per IP | `6` |
| `EXPORT_MAX_CONCURRENT` | Batas maksimal antrean export bersamaan | `2` |
---
## 3. Daftar Endpoint REST API Backend
### Modul 1: System & Database Health
#### `GET /health`
- **Fungsi**: Memeriksa ketersediaan server (liveness probe).
- **Akses**: Publik / Orchestrator.
- **Response**: `{ "ok": true }`
#### `GET /api/db-status`
- **Fungsi**: Mengecek status koneksi real-time antara server dengan database PostgreSQL lokal kantor.
- **Response**:
  ```json
  {
    "connected": true,
    "last_checked": "2026-10-05T06:30:00.000Z",
    "error": null
  }

  

  
Modul 2: Supabase Cloud Relay (/api/relay)

  

Endpoint ini bertindak sebagai proksi transparan antara backend lokal dengan database Supabase Cloud.


  
ALL /api/relay/*

  

  
Fungsi: Meneruskan query REST PostgREST/Supabase (SELECT, INSERT, UPDATE, DELETE).

  
Headers yang Diteruskan: Authorization, apikey, Prefer, Range.

  
Keamanan: Dilindungi RELAY_SHARED_SECRET. Payload JSON upload didukung hingga 20 MB.

  

  

  
Modul 3: Penjadwalan / Schedule (/api/schedule)

  

Modul inti untuk pembuatan otomatis jadwal harian sales/advisor, filter radius kilometer, perutean koordinat, dan manajemen riwayat jadwal.


  
GET /api/schedule/generate

  

  
Fungsi: Menghasilkan (generate) rancangan matriks jadwal kunjungan bulanan advisor berbasis algoritma klaster spasial.

  
Logika Algoritma:
  
  

  
Mengambil master toko binaan salesman (tbmaster_customer) dan titik koordinat GPS (tbmaster_customercrm).

  
Menyaring toko yang terdaftar di Toko Tutup (tbtr_status_toko) dan kode member yang diblokir.

  
Membaca koordinat acuan toko cabang (tbmaster_tikortoko). Jika maks_km diisi, toko di luar batas radius toko cabang disaring keluar.

  
Menghitung sudut derajat (bearing) tiap toko terhadap titik acuan untuk menjamin rute kunjungan searah dan tidak bolak-balik.

  
Menghitung hari kerja aktif (melewati hari Minggu dan tanggal merah nasional).

  
Opsi Member Pilihan (utamakan_member_pilihan):
  
  

  
Jika true: Member Pilihan diprioritaskan terlebih dahulu dengan target 2x kunjungan per bulan (minggu ke-1/2 dan minggu ke-3/4). Sisa kuota harian diisi member reguler terdekat.

  
Jika false: Semua member digabung merata ke dalam pool klaster, dijadwalkan secara natural berdasarkan kedekatan geografis tanpa memaksakan 2x kunjungan.

  

  

  
Query Parameters:
  
  

  
bulan (string, wajib, contoh: '10'): Angka bulan dua digit.

  
tahun (number, wajib, contoh: 2026): Tahun jadwal.

  
cabang (string, opsional, default: '2T'): Kode cabang.

  
petugas (string, opsional): Username advisor/salesman spesifik (kosong = semua advisor).

  
mode (string, opsional): 'full' untuk generate utuh satu bulan kalender.

  
tgl_dari, tgl_sampai (string YYYY-MM-DD): Filter rentang tanggal spesifik.

  
maks_per_hari (number, opsional, default: 15): Batas jumlah toko per hari per advisor.

  
maks_km (number, opsional): Batas maksimal radius kilometer dari titik toko cabang atau klaster hari.

  
utamakan_member_pilihan (boolean, opsional, default: true): Flag mengutamakan Member Pilihan atau menjadwalkan semua member secara rata.

  

  
Response:
  
json
{
  "advisor_list": ["edp", "adv1"],
  "matrix": {
    "adv1": [
      {
        "tanggal": "2026-10-01",
        "total_km": 12.4,
        "max_radius_km": 6.2,
        "toko": [
          {
            "cus_kodemember": "2T0001",
            "cus_namamember": "TOKO MAJU",
            "lat": -6.998194,
            "lng": 107.555972,
            "tipe_member": "Aktif",
            "member_pilihan": true,
            "dist_from_cabang_km": 3.5
          }
        ]
      }
    ]
  },
  "hari_libur_dilewati": [],
  "member_pilihan_info": { "adv1": { "uploaded": 10, "already_scheduled": 4, "generated": 16, "unresolved": 0 } },
  "toko_cabang": { "cabang": "2T", "nama_toko": "SPI KATAPANG", "lat": -6.998194, "lng": 107.555972 },
  "utamakan_member_pilihan": true,
  "db_lokal_connected": true
}

  

  

  
POST /api/schedule/push

  

  
Fungsi: Mendorong dan menyimpan daftar jadwal hasil generate ke tabel aktif Supabase (tbtr_jadwal_bulanan).

  
Body:
  
json
{
  "items": [
    {
      "tanggal_jadwal": "2026-10-01",
      "username": "adv1",
      "kode_member": "2T0001",
      "cabang": "2T",
      "nama_member": "TOKO MAJU",
      "latitude": -6.998194,
      "longitude": 107.555972,
      "tipe_member": "Aktif"
    }
  ]
}

  

  
Response: { "success": true, "count": 1 }

  

  
GET /api/schedule/tikor-toko

  

  
Fungsi: Mengambil titik koordinat acuan toko cabang dari Supabase Cloud (tabel tbmaster_tikortoko), dengan fallback ke PostgreSQL lokal.

  
Query: cabang=2T

  

  
POST /api/schedule/tikor-toko

  

  
Fungsi: Menyimpan atau memperbarui (upsert) titik koordinat toko cabang ke Supabase Cloud dan database lokal.

  
Body:
  
json
{
  "cabang": "2T",
  "nama_toko": "SPI KATAPANG",
  "latitude": -6.998194,
  "longitude": 107.555972,
  "koordinat": "-6.998194, 107.555972"
}

  

  

  
GET /api/schedule/riwayat

  

  
Fungsi: Mengambil seluruh riwayat jadwal kunjungan yang sudah aktif tersimpan di Supabase Cloud (tbtr_jadwal_bulanan).

  
Query: bulan=10&tahun=2026&cabang=2T&petugas=adv1

  

  
GET /api/schedule/hari-ini

  

  
Fungsi: Mengambil jadwal kunjungan khusus hari ini untuk monitoring advisor.

  
Query: cabang=2T&petugas=adv1

  

  
POST /api/schedule/ganti-hari

  

  
Fungsi: Memindahkan satu titik jadwal kunjungan dari tanggal lama ke tanggal baru.

  
Body: { "id": 12345, "tanggal_baru": "2026-10-15" }

  

  
POST /api/schedule/delete

  

  
Fungsi: Menghapus seluruh jadwal aktif pada periode bulan dan tahun tertentu per cabang atau advisor.

  
Body: { "bulan": "10", "tahun": 2026, "cabang": "2T", "petugas": "" }

  

  
POST /api/schedule/hapus-satuan

  

  
Fungsi: Menghapus satu entri jadwal kunjungan berdasarkan ID baris.

  
Body: { "id": 12345 }

  

  
POST /api/schedule/import

  

  
Fungsi: Mengimpor jadwal kunjungan massal dari file Excel (.xlsx), memvalidasi kode member dan koordinat toko, lalu otomatis mem-push ke Supabase Cloud.

  
Body: { "fileBase64": "data:application/vnd.openxmlformats-officedocument...", "cabang": "2T" }

  

  
GET /api/schedule/import-template

  

  
Fungsi: Mengunduh template resmi file Excel untuk fitur Import Jadwal.

  

  
GET /api/schedule/member-pilihan

  

  
Fungsi: Mengambil daftar master Member Pilihan aktif cabang untuk periode bulan & tahun tertentu dari tabel tbtr_member_pilihan.

  
Query: cabang=2T&bulan=10&tahun=2026

  

  
POST /api/schedule/member-pilihan-upload

  

  
Fungsi: Mengunggah daftar Member Pilihan baru dari file Excel. Data lama cabang pada periode tsb akan digantikan (replace).

  
Body: { "fileBase64": "...", "cabang": "2T", "bulan": 10, "tahun": 2026 }

  

  
GET /api/schedule/member-pilihan-template

  

  
Fungsi: Mengunduh file Excel template Member Pilihan.

  

  
GET /api/schedule/status-toko

  

  
Fungsi: Mengambil daftar toko yang ditandai tutup / tidak aktif (tbtr_status_toko). Toko di daftar ini otomatis dikecualikan dari proses generate jadwal.

  
Query: cabang=2T

  

  
POST /api/schedule/status-toko

  

  
Fungsi: Menambahkan toko ke daftar Toko Tutup.

  
Body: { "kode_member": "2T0002", "nama_member": "TOKO ABC", "cabang": "2T", "alasan": "Toko Tutup Permanen" }

  

  
POST /api/schedule/status-toko/delete

  

  
Fungsi: Menghapus toko dari daftar Toko Tutup sehingga dapat dijadwalkan kembali.

  
Body: { "kode_member": "2T0002", "cabang": "2T" }

  

  
POST /api/schedule/export

  

  
Fungsi: Mengekspor data jadwal hasil generate atau riwayat aktif ke file spreadsheet Excel (.xlsx).

  

  

  
Modul 4: Dashboard Monitoring (/api/dashboard)

  
GET /api/dashboard/summary

  

  
Fungsi: Mengambil rekapitulasi performa kunjungan harian/bulanan (Total Rencana, Realisasi Kunjungan, Berhasil Order, Gagal Order, Total Omset RPH).

  
Query: tgl_dari=2026-10-01&tgl_sampai=2026-10-31&cabang=2T&petugas=

  

  
GET /api/dashboard/advisors

  

  
Fungsi: Rekapitulasi ranking dan statistik performa per advisor (tingkat kepatuhan kunjungan, rasio sukses order).

  

  
GET /api/dashboard/by-call

  

  
Fungsi: Statistik kunjungan dan order khusus yang dilakukan secara remote / pemesanan lewat telepon (BY CALL).

  

  
GET /api/dashboard/export

  

  
Fungsi: Export laporan dashboard monitoring ke Excel.

  

  

  
Modul 5: Tracking & Monitoring Advisor (/api/tracking)

  
GET /api/tracking/live

  

  
Fungsi: Mengambil posisi GPS terkini dan jejak aktivitas check-in kunjungan advisor di lapangan.

  
Query: tanggal=2026-10-05&cabang=2T

  

  

  
Modul 6: Member & CRM

  
GET /api/member/lookup

  

  
Fungsi: Pencarian autocomplete toko/member berdasarkan kode atau nama toko.

  
Query: q=MAJU&cabang=2T

  

  
GET /api/member-status/list

  

  
Fungsi: Menampilkan status toko yang sudah dikunjungi vs belum dikunjungi pada hari/rentang tanggal yang dipilih, lengkap dengan alasan jika toko menolak order.

  
Query: cabang=2T&tanggal=2026-10-05&source=rkm

  

  
GET /api/member-tipe/list

  

  
Fungsi: Analisis segmentasi member (Member Baru, Member Aktif, Member Belum Aktivasi, dan Member Sleeper / tidak belanja > 3 bulan).

  
Query: cabang=2T

  

  

  
Modul 7: Survei Harga Kompetitor (/api/survei-harga)

  
GET /api/survei-harga/list

  

  
Fungsi: Mengambil data laporan survei harga barang kompetitor yang diinput oleh advisor di lapangan saat kunjungan.

  
Query: cabang=2T&tgl_dari=&tgl_sampai=

  

  
POST /api/survei-harga/export

  

  
Fungsi: Export hasil survei harga pasar ke Excel.

  

  

  
Modul 8: Member Pareto (/api/member-pareto)

  
GET /api/member-pareto/list

  

  
Fungsi: Mengambil data pelanggan dengan kontribusi omset terbesar (Pareto 80/20).

  
Query: cabang=2T&bulan=10&tahun=2026

  

  
POST /api/member-pareto/upload

  

  
Fungsi: Mengunggah daftar klasifikasi target Pareto dari file Excel.

  

  

  
Modul 9: Master Data (/api/master)

  
GET /api/master/alasan-menolak

  

  
Fungsi: Mengambil daftar alasan toko tidak order (misal: "Stok Masih Banyak", "Harga Terlalu Mahal", "Toko Tutup Sementara").

  
Tabel Sumber: tbtr_alasan_menolak (Supabase Cloud).

  

  
POST /api/master/alasan-menolak

  

  
Fungsi: Menambah, mengedit, atau menonaktifkan master alasan menolak.

  

  

  
Modul 10: Modul Khusus SPV (/api/schedule-spv & /api/dashboard-spv)

  
GET /api/schedule-spv/generate

  

  
Fungsi: Algoritma penjadwalan khusus Supervisor (SPV) untuk mendampingi atau mensurvei titik toko tanpa mengganggu jadwal reguler advisor.

  
Tabel Penyimpanan: tbtr_jadwal_bulanan_spv.

  

  
GET /api/dashboard-spv/summary

  

  
Fungsi: Rekapitulasi kunjungan dan validasi lapangan khusus level Supervisor.

  

  

  
4. Dokumentasi Fungsi Frontend Client (src/lib/api.ts)

  

Seluruh komunikasi frontend React ke backend dienkapsulasi dalam file src/lib/api.ts. Berikut rincian fungsinya:


  
A. Fungsi Terkait Penjadwalan (Scheduling)

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
Nama Fungsi	Parameter	Tipe Kembalian	Keterangan & Kegunaan
fetchScheduleGenerate(params)	bulan, tahun, petugas, mode, tglDari, tglSampai, cabang, maksPerHari, maksKm, utamakanMemberPilihan	Promise<ScheduleResponse>	Memanggil API /api/schedule/generate untuk kalkulasi matriks rute klaster radius dan prioritas Member Pilihan.
pushSchedule(items)	items: any[]	Promise<{ success: boolean; count: number }>	Menyimpan jadwal hasil generate ke tabel aktif Supabase (/api/schedule/push).
fetchScheduleAdvisors(cabang)	cabang: string	Promise<{ advisors: string[] }>	Mengambil daftar salesman/advisor aktif di cabang terpilih.
fetchTikorToko(cabang)	cabang: string	Promise<{ success: boolean; data: any }>	Mengambil titik koordinat toko cabang (tbmaster_tikortoko).
saveTikorToko(payload)	cabang, nama_toko, latitude, longitude, koordinat	Promise<{ success: boolean; data: any }>	Menyimpan koordinat acuan toko cabang baru/edit ke backend.
fetchRiwayatJadwal(params)	bulan, tahun, cabang, petugas	Promise<RiwayatResponse>	Mengambil jadwal aktif dari Supabase untuk halaman Riwayat / Jadwal Aktif.
deleteSchedule(params)	bulan, tahun, cabang, petugas	Promise<{ success: boolean; count: number }>	Menghapus jadwal aktif satu bulan penuh per cabang/advisor.
hapusJadwalSatuan(id)	id: number	Promise<{ success: boolean }>	Menghapus satu item jadwal berdasarkan ID.
gantiHariJadwal(id, tanggal_baru)	id: number, tanggal_baru: string	Promise<{ success: boolean }>	Memindahkan tanggal jadwal toko tertentu.
importSchedule(file, cabang)	file: File, cabang: string	Promise<ImportScheduleResult>	Membaca file Excel jadwal, mengubah ke Base64, dan mengirim ke server.
uploadMemberPilihan(file, cabang, bulan, tahun)	file: File, cabang, bulan, tahun	Promise<MemberPilihanUploadResult>	Mengunggah file master Member Pilihan Excel.
exportSchedule(rows, filename)	rows: any[], filename: string	Promise<void>	Mengirim data jadwal ke server untuk diubah menjadi file Excel lalu diunduh otomatis.

  
B. Fungsi Terkait Toko Tutup (Blacklist Sementara)

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
Nama Fungsi	Parameter	Tipe Kembalian	Keterangan & Kegunaan
fetchStatusToko(cabang)	cabang: string	Promise<{ data: StatusToko[] }>	Mengambil daftar toko yang statusnya tutup agar tidak ikut dijadwalkan.
tambahStatusToko(payload)	kode_member, nama_member, cabang, alasan	Promise<{ success: boolean }>	Menandai toko sebagai toko tutup.
hapusStatusToko(kode_member, cabang)	kode_member: string, cabang: string	Promise<{ success: boolean }>	Mengaktifkan kembali toko yang sebelumnya ditandai tutup.

  
C. Helper Utility Download File

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
Nama Fungsi	Parameter	Keterangan
downloadBlob(blob, filename)	blob: Blob, filename: string	Memicu download otomatis file browser lewat elemen <a> sementara.
importScheduleTemplateUrl()	-	Mengembalikan string URL unduhan template Excel Import Jadwal.
memberPilihanTemplateUrl()	-	Mengembalikan string URL unduhan template Excel Member Pilihan.

  

  
5. Struktur Payload Data & Standar Error

A. Struktur Standar Respon Error

Jika terjadi kendala pada server atau validasi gagal, seluruh endpoint mengembalikan HTTP status 4xx / 5xx dengan payload JSON seragam:

```json
{
  "error": "Pesan deskripsi kesalahan yang mudah dipahami pengguna",
  "db_lokal_connected": false
}
```

B. Mekanisme Keamanan Multi-Cabang & Validasi Parameter

1. **Validasi Akses Cabang (`resolveCabang`)**:
   - Seluruh endpoint REST API di modul `schedule`, `tracking`, `dashboard`, `member`, `member-status`, `member-tipe`, `survei-harga`, `master`, dan `member-pareto` memvalidasi parameter `cabang` (baik via `req.query.cabang` maupun `req.body.cabang`) melalui fungsi `resolveCabang`.
   - Jika cabang yang diminta tidak sesuai dengan cabang yang dikunci pada instance server (`CABANG_DEFAULT`), server mengembalikan HTTP status **403 Forbidden**:
     ```json
     {
       "error": "Akses cabang ditolak. Instance ini terkunci ke cabang 2T.",
       "cabang": "2T"
     }
     ```

2. **Isolasi Mutasi Data Berbasis `:id` & Validasi Numerik**:
   - Endpoint mutasi `PATCH` dan `DELETE` berbasis `:id` (pada `/api/schedule/riwayat/:id`, `/api/schedule/status-toko/:id`, `/api/master/alasan-menolak/:id`, `/api/member-pareto/status/:id`, `/api/member-pareto/:id`, dan `/api/member-pareto/master-items/:id`) memvalidasi format parameter `:id` harus berupa angka (`/^\d+$/`). Jika tidak valid, server mengembalikan status **400 Bad Request**:
     ```json
     {
       "error": "ID tidak valid. Harus berupa angka."
     }
     ```
   - Operasi perubahan atau penghapusan dibatasi secara ketat dengan filter `cabang=eq.<cabang>` pada kueri PostgREST untuk memastikan instans satu cabang tidak dapat memanipulasi baris data milik cabang lain.

C. Struktur Model Data Utama

1. Model Data Toko Kandidat Kunjungan (CustomerCandidate)

  
typescript
interface CustomerCandidate {
  cus_kodemember: string;       // Kode unik member (contoh: '2T0001')
  cus_namamember: string;       // Nama toko / member
  cus_nosalesman?: string;      // Kode / username advisor yang membina
  cus_kodeigr?: string;         // Kode cabang (contoh: '2T')
  lat: number;                  // Latitude GPS toko
  lng: number;                  // Longitude GPS toko
  tipe_member?: string;         // 'Aktif' | 'Belum Aktivasi' | 'Sleeper'
  member_pilihan?: boolean;     // Menandakan apakah termasuk Member Pilihan
  dist_from_cabang_km?: number; // Jarak garis lurus dari toko cabang (km)
  sudut?: number;               // Sudut kompas (bearing 0 - 360 derajat)
}

  
2. Model Data Titik Koordinat Toko Cabang (tbmaster_tikortoko)

  
typescript
interface TokoCabangInfo {
  cabang: string;               // Kode cabang ('2T')
  nama_toko: string;            // Nama cabang ('SPI KATAPANG')
  lat: number;                  // Latitude acuan (-6.998194)
  lng: number;                  // Longitude acuan (107.555972)
  koordinat: string;            // '-6.998194,107.555972'
}