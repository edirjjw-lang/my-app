import { config } from '../config.js';
import { get, nowIso, run } from '../db.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bucket = {
  tokens: Math.max(1, config.maxRequestsPerMinute),
  updatedAt: Date.now(),
};

export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, body = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
    this.body = body;
  }
}

async function acquireToken() {
  const ratePerMs = Math.max(1, config.maxRequestsPerMinute) / 60_000;
  for (let guard = 0; guard < 600; guard += 1) {
    const now = Date.now();
    bucket.tokens = Math.min(
      config.maxRequestsPerMinute,
      bucket.tokens + (now - bucket.updatedAt) * ratePerMs,
    );
    bucket.updatedAt = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }
    await sleep(80);
  }
  throw new ProviderError('Limite interno de requisições atingido; tente novamente em instantes.', {
    status: 429,
    retryable: true,
  });
}

function healthRow() {
  return get('SELECT * FROM provider_health WHERE provider = ?', [config.provider]);
}

export function markSuccess() {
  const existing = healthRow();
  if (existing) {
    run(
      `UPDATE provider_health
          SET last_success_at = ?, consecutive_failures = 0, requests_total = requests_total + 1, updated_at = ?
        WHERE provider = ?`,
      [nowIso(), nowIso(), config.provider],
    );
  } else {
    run(
      `INSERT INTO provider_health (provider, last_success_at, consecutive_failures, requests_total, updated_at)
       VALUES (?, ?, 0, 1, ?)`,
      [config.provider, nowIso(), nowIso()],
    );
  }
}

export function markFailure(message) {
  const existing = healthRow();
  if (existing) {
    run(
      `UPDATE provider_health
          SET last_error = ?, last_error_at = ?, consecutive_failures = consecutive_failures + 1,
              requests_total = requests_total + 1, updated_at = ?
        WHERE provider = ?`,
      [String(message).slice(0, 500), nowIso(), nowIso(), config.provider],
    );
  } else {
    run(
      `INSERT INTO provider_health (provider, last_error, last_error_at, consecutive_failures, requests_total, updated_at)
       VALUES (?, ?, ?, 1, 1, ?)`,
      [config.provider, String(message).slice(0, 500), nowIso(), nowIso()],
    );
  }
}

export function getProviderHealth() {
  const row = healthRow();
  if (!row) {
    return {
      provider: config.provider,
      configured: Boolean(config.apiKey),
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      requestsTotal: 0,
      healthy: false,
      stale: true,
      ageMs: null,
    };
  }
  const ageMs = row.last_success_at ? Date.now() - Date.parse(row.last_success_at) : null;
  return {
    provider: row.provider,
    configured: Boolean(config.apiKey),
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    consecutiveFailures: row.consecutive_failures,
    requestsTotal: row.requests_total,
    healthy: row.consecutive_failures < 3,
    stale: ageMs === null || ageMs > config.freshness.providerMaxAgeMs,
    ageMs,
  };
}

export function readCache(cacheKey) {
  const row = get('SELECT payload, fetched_at FROM api_cache WHERE cache_key = ?', [cacheKey]);
  if (!row) return null;
  run('UPDATE api_cache SET hits = hits + 1 WHERE cache_key = ?', [cacheKey]);
  try {
    return {
      payload: JSON.parse(row.payload),
      fetchedAt: row.fetched_at,
      ageMs: Date.now() - Date.parse(row.fetched_at),
    };
  } catch {
    return null;
  }
}

export function writeCache(cacheKey, payload, ttlMs) {
  run(
    `INSERT INTO api_cache (cache_key, payload, fetched_at, ttl_seconds) VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at,
       ttl_seconds = excluded.ttl_seconds`,
    [cacheKey, JSON.stringify(payload), nowIso(), Math.max(1, Math.round(ttlMs / 1000))],
  );
}

/**
 * Requisição protegida ao provedor: cache em SQLite, rate limit interno,
 * retry com backoff e fallback para cache antigo (marcado como stale).
 */
export async function providerRequest(url, { headers = {}, cacheKey = null, ttlMs = 0 } = {}) {
  if (!config.apiKey) {
    throw new ProviderError(
      'Chave da API de futebol não configurada. Defina FOOTBALL_API_KEY no ambiente do servidor.',
      { status: 401, retryable: false },
    );
  }

  if (cacheKey && ttlMs > 0) {
    const cached = readCache(cacheKey);
    if (cached && cached.ageMs < ttlMs) {
      return { data: cached.payload, cached: true, stale: false, fetchedAt: cached.fetchedAt };
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await acquireToken();
      const response = await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });

      if (response.status === 429 || response.status >= 500) {
        const body = await response.text().catch(() => '');
        lastError = new ProviderError(
          `Provedor indisponível (HTTP ${response.status})${body ? `: ${body.slice(0, 160)}` : ''}`,
          { status: response.status, retryable: true },
        );
        if (attempt < config.maxRetries) await sleep(600 * (attempt + 1));
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new ProviderError(
          `API respondeu HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`,
          { status: response.status, retryable: false, body },
        );
        markFailure(error.message);
        throw error;
      }

      const data = await response.json();
      markSuccess();
      if (cacheKey && ttlMs > 0) writeCache(cacheKey, data, ttlMs);
      return { data, cached: false, stale: false, fetchedAt: nowIso() };
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) throw error;
      lastError = error;
      if (attempt < config.maxRetries) await sleep(500 * (attempt + 1));
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Falha desconhecida ao consultar a API.';
  markFailure(message);

  if (cacheKey) {
    const cached = readCache(cacheKey);
    if (cached) {
      return {
        data: cached.payload,
        cached: true,
        stale: true,
        fetchedAt: cached.fetchedAt,
        error: message,
      };
    }
  }

  throw lastError instanceof ProviderError
    ? lastError
    : new ProviderError(message, { retryable: false });
}
