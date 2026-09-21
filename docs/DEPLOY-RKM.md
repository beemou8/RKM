# Deployment RKM setelah perubahan

## Instance aplikasi / cabang

```bash
cd /path/ke/RKM-MIGRASI
npm install
npm run build
pm2 restart <nama-process>
```

Cek:

```bash
curl -s http://127.0.0.1:3000/health
```

Hasil sehat:

```json
{"ok":true}
```

## Relay

Deploy kode relay yang sudah memakai `RELAY_GET_CACHE_TTL_MS=5000`, lalu restart container/service relay.

## Catatan

- Jangan menyalin `.env.example` menjadi `.env` lalu mengisinya ke Git.
- Isi `.env` hanya di server.
- `SUPABASE_ORIGIN_URL` dan `SUPABASE_ORIGIN_KEY` hanya di relay.
- `APP_PROXY_SECRET` hanya di app + reverse proxy.
- `RELAY_SHARED_SECRET` hanya di app + relay.
