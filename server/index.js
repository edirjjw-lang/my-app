import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { closeDb, logEvent } from './db.js';
import { apiRouter } from './routes.js';
import { startScheduler, stopScheduler } from './scheduler.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  next();
});

app.use(express.json({ limit: '64kb' }));

const rateBuckets = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 240;

app.use('/api', (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    rateBuckets.set(key, { start: now, count: 1 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    res.setHeader('Retry-After', Math.ceil((WINDOW_MS - (now - bucket.start)) / 1000));
    return res.status(429).json({ error: 'rate_limited', message: 'Muitas requisições. Tente novamente em instantes.' });
  }
  return next();
});

app.use('/api', apiRouter);

if (fs.existsSync(config.distPath)) {
  app.use(
    express.static(config.distPath, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  const sendIndex = (req, res) => res.sendFile(path.join(config.distPath, 'index.html'));
  app.get('/', sendIndex);
  app.get('/*splat', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return sendIndex(req, res);
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .type('html')
      .send('<h1>FUTEBOL PRO</h1><p>Build do frontend não encontrado. Rode <code>npm run build</code>.</p>');
  });
}

app.use((error, req, res, next) => {
  logEvent('error', 'http', `${req.method} ${req.originalUrl}: ${error.message}`);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: 'internal_error', message: 'Erro interno ao processar a solicitação.' });
});

const server = app.listen(config.port, config.host, () => {
  logEvent('info', 'server', `FUTEBOL PRO ouvindo em http://${config.host}:${config.port}`);
  startScheduler();
});

function shutdown(signal) {
  logEvent('info', 'server', `Encerrando por ${signal}.`);
  stopScheduler();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logEvent('error', 'unhandled-rejection', String(reason?.message ?? reason));
});
process.on('uncaughtException', (error) => {
  logEvent('error', 'uncaught-exception', error.message);
});

export { app, server };
