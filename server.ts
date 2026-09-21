import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import path from 'path';
import { checkLocalDb, getDbStatus } from './server/lib/db.js';
import { dashboardRouter } from './server/routes/dashboard.js';
import { trackingRouter } from './server/routes/tracking.js';
import { scheduleRouter } from './server/routes/schedule.js';
import { memberRouter } from './server/routes/member.js';
import { memberTipeRouter } from './server/routes/memberTipe.js';
import { surveiHargaRouter } from './server/routes/surveiHarga.js';
import { memberStatusRouter } from './server/routes/memberStatus.js';
import { memberParetoRouter } from './server/routes/memberPareto.js';
import { masterRouter } from './server/routes/master.js';
import { proxyRouter } from './server/routes/proxy.js';
import { createConcurrencyLimiter, createRateLimiter, requireProxySecret, securityHeaders } from './server/lib/security.js';

function envInt(name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(value, min), max);
}

const PORT = envInt('PORT', 3000, 1, 65535);

// Try the local (on-prem) DB once at boot. If it's unreachable — e.g. this
// isn't running inside the office network / VPN where 172.31.x.x lives —
// the app keeps running: Supabase-backed features work normally, and
// features needing local data (RPH revenue, CRM coordinates, scheduling)
// report their degraded state via `db_lokal_connected` instead of a hard
// 500 everywhere.
checkLocalDb();
setInterval(checkLocalDb, 30_000);

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', envInt('TRUST_PROXY_HOPS', 1, 1, 10));
  app.use(securityHeaders);
  app.use(compression());

  // Healthcheck sengaja tidak membawa data sensitif dan boleh dipakai oleh orchestrator.
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Production hanya menerima trafik aplikasi dari reverse proxy yang menambahkan
  // X-RKM-Proxy-Secret. Direct hit ke port container akan ditolak.
  app.use(requireProxySecret);

  const apiLimiter = createRateLimiter({
    windowMs: 60_000,
    max: envInt('API_RATE_LIMIT_PER_MINUTE', 240, 30, 10000),
    keyPrefix: 'api',
  });
  const exportLimiter = createRateLimiter({
    windowMs: 60_000,
    max: envInt('EXPORT_RATE_LIMIT_PER_MINUTE', 6, 1, 120),
    keyPrefix: 'export',
    message: 'Terlalu banyak permintaan export. Coba lagi sebentar.',
  });
  const exportConcurrency = createConcurrencyLimiter(
    envInt('EXPORT_MAX_CONCURRENT', 2, 1, 10)
  );

  app.use('/api', apiLimiter);
  app.use((req, res, next) => {
    const isExport = /^\/api\/(dashboard\/(?:export|by-call\/export|export-bulanan)|member\/export|member-tipe\/export|member-status\/export|survei-harga\/export|schedule\/(?:export|status-toko\/export)|member-pareto\/export)/.test(req.path);
    if (!isExport) return next();
    return exportLimiter(req, res, () => exportConcurrency(req, res, next));
  });

  // Body kecil untuk request normal. Hanya endpoint import/upload Excel/Pareto yang boleh sampai 20 MB.
  const normalJson = express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' });
  const uploadJson = express.json({ limit: process.env.UPLOAD_JSON_BODY_LIMIT || '20mb' });
  app.use((req, res, next) => {
    const largeUpload = /^\/api\/(?:schedule\/(?:import|member-pilihan-upload|tipe-member-upload)|member-pareto\/upload)$/.test(req.path) || req.path.startsWith('/api/relay/');
    return (largeUpload ? uploadJson : normalJson)(req, res, next);
  });

  app.use('/api/relay', proxyRouter);

  app.get('/api/db-status', async (_req, res) => {
    res.json(getDbStatus());
  });

  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/tracking', trackingRouter);
  app.use('/api/schedule', scheduleRouter);
  app.use('/api/member', memberRouter);
  app.use('/api/member-tipe', memberTipeRouter);
  app.use('/api/member-status', memberStatusRouter);
  app.use('/api/survei-harga', surveiHargaRouter);
  app.use('/api/master', masterRouter);
  app.use('/api/member-pareto', memberParetoRouter);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode.`);
  });
}

startServer();
