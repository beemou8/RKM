import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  keyPrefix?: string;
}) {
  const buckets = new Map<string, Bucket>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(30_000, options.windowMs));
  cleanup.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
      return next();
    }
    const key = `${options.keyPrefix || 'rate'}:${ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;
    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: options.message || 'Terlalu banyak request. Coba lagi sebentar.' });
      return;
    }
    next();
  };
}

export function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  return (_req: Request, res: Response, next: NextFunction) => {
    if (active >= maxConcurrent) {
      res.status(503).json({ error: 'Server sedang memproses export lain. Coba lagi setelah export sebelumnya selesai.' });
      return;
    }

    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function requireProxySecret(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production') return next();
  if (process.env.REQUIRE_PROXY_SECRET === 'false') return next();

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
    return next();
  }

  const expected = process.env.APP_PROXY_SECRET || '';
  if (!expected) {
    res.status(503).json({ error: 'APP_PROXY_SECRET belum dikonfigurasi pada server.' });
    return;
  }

  const supplied = String(req.header('x-rkm-proxy-secret') || '');
  if (!supplied || !safeEqual(supplied, expected)) {
    res.status(403).json({ error: 'Akses langsung ditolak. Gunakan reverse proxy aplikasi.' });
    return;
  }
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
