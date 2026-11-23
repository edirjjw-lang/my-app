import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() !== 'false';
};

/**
 * Configuração central. A chave da API do futebol vive apenas no backend e
 * nunca é serializada para o cliente (ver server/routes/api.js).
 */
export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),
  host: '0.0.0.0',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'futebolpro.db'),
  distPath: path.join(__dirname, '..', 'dist'),

  provider: (process.env.FOOTBALL_API_PROVIDER || 'bzzoiro').trim().toLowerCase(),
  apiKey: (process.env.FOOTBALL_API_KEY || '').trim(),
  apiBaseUrl: (process.env.FOOTBALL_API_BASE_URL || '').trim(),
  apiHost: (process.env.FOOTBALL_API_HOST || '').trim(),
  apiKeyHeader: (process.env.FOOTBALL_API_KEY_HEADER || '').trim(),

  requestTimeoutMs: num(process.env.API_TIMEOUT_MS, 12000),
  maxRequestsPerMinute: num(process.env.API_RATE_LIMIT_PER_MIN, 240),
  // Teto de páginas seguidas por consulta paginada (todas as ligas, sem filtro).
  maxPages: num(process.env.API_MAX_PAGES, 60),
  maxRetries: num(process.env.API_MAX_RETRIES, 2),

  sync: {
    enabled: bool(process.env.SYNC_ENABLED, true),
    liveIntervalMs: num(process.env.LIVE_SYNC_INTERVAL_MS, 60_000),
    scheduledIntervalMs: num(process.env.SCHEDULED_SYNC_INTERVAL_MS, 15 * 60_000),
    historyIntervalMs: num(process.env.HISTORY_SYNC_INTERVAL_MS, 6 * 60 * 60_000),
    historyDays: num(process.env.HISTORY_DAYS, 120),
    // Janela da agenda: todos os jogos de todas as ligas por N dias.
    scheduleDays: num(process.env.SCHEDULE_DAYS, 7),
  },

  freshness: {
    liveMaxAgeMs: num(process.env.LIVE_STALE_MS, 4 * 60_000),
    prematchMaxAgeMs: num(process.env.PREMATCH_STALE_MS, 6 * 60 * 60_000),
    providerMaxAgeMs: num(process.env.PROVIDER_STALE_MS, 20 * 60_000),
  },

  filters: {
    minOdd: num(process.env.MIN_ODD, 1.5),
    preferredMinOdd: num(process.env.PREFERRED_MIN_ODD, 1.5),
    preferredMaxOdd: num(process.env.PREFERRED_MAX_ODD, 1.8),
    minEdge: num(process.env.MIN_EDGE, 0.03),
    // Sem odds de mercado a indicação exige probabilidade calculada mínima.
    minProbability: num(process.env.MIN_PROBABILITY, 0.6),
    minConfidence: (process.env.MIN_CONFIDENCE || 'MODERADA').toUpperCase(),
    stake: num(process.env.UNIT_STAKE, 1),
  },

  adminToken: (process.env.ADMIN_TOKEN || '').trim(),
  version: '1.0.0',
};

export function providerConfigured() {
  return Boolean(config.apiKey && config.apiKey.length >= 8);
}

export function providerLabel() {
  if (!providerConfigured()) return 'não configurado';
  return config.provider;
}
