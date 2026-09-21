# Arsitektur RKM — Aman, Cepat, dan Mudah Diulang

## 1. Jalur data produksi

```text
Browser
  │ HTTPS
  ▼
Traefik / Reverse Proxy
  │ menambahkan X-RKM-Proxy-Secret
  ▼
RKM App (Express)
  │
  ├─ Auth & security headers
  ├─ Rate limit
  ├─ Filter cabang + user aktif
  ├─ Cache GET read-only (singkat)
  ├─ Query PostgreSQL lokal bila perlu RPH/CRM
  │
  ▼
Secure Relay
  │ X-RKM-Relay-Secret
  │ origin key TIDAK pernah dikirim ke browser/cabang
  ▼
Supabase PostgREST
```

## 2. Aturan security yang wajib dipertahankan

- Browser hanya berbicara ke domain aplikasi.
- `SUPABASE_RELAY_URL` adalah endpoint relay, bukan URL project Supabase asli.
- `RELAY_SHARED_SECRET` hanya berada di server aplikasi dan relay.
- `SUPABASE_ORIGIN_KEY` / service key hanya berada di server relay.
- Port aplikasi tidak boleh dibuka publik tanpa reverse proxy; production memakai `X-RKM-Proxy-Secret`.
- Filter data dashboard selalu memuat `cabang=...` dan username dibatasi ke `tbmaster_user` yang `is_active=true` dan `user_type` tidak null.
- Jangan pernah menaruh `SUPABASE_ORIGIN_KEY`, service role key, database password, atau shared secret di React/Vite/frontend.

## 3. Aturan performance dashboard

### Filter frontend

Perubahan tanggal/advisor/member filter hanya mengubah state lokal.
Request baru dilakukan ketika tombol **Filter** ditekan.

### Query backend

1. Ambil daftar user aktif per cabang melalui cache GET singkat.
2. Validasi `petugas` terhadap daftar user cabang.
3. Ambil kunjungan hanya untuk username yang valid dan periode yang diminta.
4. Ambil klasifikasi member hanya untuk `kode_member` yang benar-benar muncul pada hasil dashboard.
5. Query lokal PostgreSQL untuk RPH hanya berdasarkan daftar member yang berhasil order.
6. Jalankan bagian independen secara paralel bila memungkinkan.

### Payload

Gunakan `select=` dan jangan `select=*` untuk dashboard jika hanya membutuhkan beberapa kolom.

## 4. Cache

`SUPABASE_GET_CACHE_TTL_MS` default 15 detik.

Cache hanya untuk GET/read-only. Query POST/PATCH/DELETE tidak memakai cache.

Key cache adalah query PostgREST lengkap, sehingga cabang, periode, username, dan filter tetap terisolasi.

## 5. Pola membuat modul baru

```text
Frontend page
   -> src/lib/api.ts
      -> /api/nama-modul
         -> server/routes/namaModul.ts
            -> validasi user/cabang
            -> fetchSupabase / fetchSupabaseCached
            -> queryLocal bila data lokal diperlukan
            -> return JSON ringkas
```

Untuk halaman dengan filter:

```text
filterState        = apa yang sedang dipilih user
appliedFilterState = filter terakhir yang benar-benar dikirim

Klik Filter
   -> set applied state
   -> 1 request backend
   -> loading=true
   -> tampilkan data lama + indikator loading
   -> selesai -> loading=false
```

## 6. Checklist sebelum membuat modul baru

- [ ] Browser tidak memegang URL/key Supabase asli.
- [ ] Endpoint memakai `/api/...`, bukan direct PostgREST dari browser.
- [ ] Ada validasi cabang.
- [ ] Ada validasi username terhadap `tbmaster_user`.
- [ ] Gunakan `select=` minimal.
- [ ] Batasi periode tanggal dengan rentang inklusif.
- [ ] GET master/read-heavy boleh memakai cache singkat.
- [ ] Jangan memakai `select=*` untuk dashboard jika tidak perlu.
- [ ] Pagination hanya untuk export/data besar.
- [ ] Tambahkan loading state di frontend.
- [ ] Tulis endpoint baru di `src/lib/api.ts` agar pola konsisten.

## 7. ENV inti instance cabang

```env
PORT=3000
RELAY_ONLY=true
SUPABASE_RELAY_URL=https://relay-domain/api/relay
RELAY_SHARED_SECRET=<shared-secret>
SUPABASE_GET_CACHE_TTL_MS=15_000
REQUIRE_PROXY_SECRET=true
APP_PROXY_SECRET=<proxy-secret>
```

Instance cabang **tidak perlu** menyimpan URL Supabase origin atau origin service key.

## 8. ENV inti relay

```env
SUPABASE_ORIGIN_URL=https://<project-ref>.supabase.co
SUPABASE_ORIGIN_KEY=<server-only-key>
RELAY_SHARED_SECRET=<shared-secret>
RELAY_TIMEOUT_MS=15000
```

Relay hanya menerima request yang lolos validasi secret/token.

## 9. Optimasi relay

Relay memiliki cache GET singkat (`RELAY_GET_CACHE_TTL_MS`, default 5 detik) untuk request yang identik.
Cache hanya menyimpan response GET yang sukses dan otomatis dibersihkan saat ada POST/PATCH/DELETE.
Tidak ada secret atau origin key yang dikirim ke browser.
