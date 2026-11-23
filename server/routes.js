import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from './config.js';
import { all, get, logEvent, nowIso } from './db.js';
import { MODEL_VERSION } from './analysis/engine.js';
import { getProvider } from './provider/index.js';
import { getProviderHealth } from './provider/http.js';
import {
  analyzeRow,
  collectOpportunities,
  countFixtures,
  ensureFixtureHistory,
  getFixtureRow,
  listFixtureRows,
  refreshFixtureData,
  serializeFixture,
} from './services/analysis.js';
import {
  countRecommendations,
  fixtureRecommendations,
  historySummary,
  listRecommendations,
  settlePendingRecommendations,
} from './services/history.js';
import { backtestDiagnostics, getBacktestRun, listBacktestRuns, runBacktest } from './services/backtest.js';
import { lastSyncRuns, syncDate, syncLive, syncRecentFinished, syncSchedule, syncTeamHistory } from './services/ingest.js';
import { schedulerState } from './scheduler.js';

export const apiRouter = Router();

const refreshThrottle = new Map();
// Quantos jogos da lista recebem análise completa por requisição (o resto abre sob demanda).
const ANALYSIS_LIMIT = Number(process.env.ANALYSIS_LIMIT || 120);

function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function requireAdmin(req, res, next) {
  if (!config.adminToken) {
    return res.status(403).json({
      error: 'admin_token_required',
      message:
        'Ações administrativas exigem ADMIN_TOKEN. Defina essa variável em Settings → Environment variables para liberar.',
    });
  }
  const provided = req.get('x-admin-token') || req.body?.adminToken || '';
  if (!safeEqual(provided, config.adminToken)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Token administrativo inválido.' });
  }
  return next();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function cacheStats() {
  const row = get('SELECT COUNT(*) AS entries, COALESCE(SUM(hits), 0) AS hits, MAX(fetched_at) AS lastFetch FROM api_cache');
  return { entries: row?.entries ?? 0, hits: row?.hits ?? 0, lastFetch: row?.lastFetch ?? null };
}

function buildStatus() {
  const provider = getProvider();
  const health = getProviderHealth();
  const fixtures = countFixtures();
  const recommendations = countRecommendations();
  const events = all('SELECT level, scope, message, created_at FROM app_events ORDER BY id DESC LIMIT 15');
  const limitations = [];
  if (!provider.configured) {
    limitations.push(
      'Sem FOOTBALL_API_KEY o app não busca jogos reais e bloqueia todas as recomendações — nenhum dado é simulado.',
    );
  }
  if (!config.adminToken) {
    limitations.push(
      'ADMIN_TOKEN não configurado: sincronização manual e backtest pela interface ficam bloqueados (a sincronização automática continua ativa).',
    );
  }
  return {
    app: { name: 'FUTEBOL PRO', version: config.version, modelVersion: MODEL_VERSION, now: nowIso() },
    provider: {
      id: provider.id,
      label: provider.label,
      configured: provider.configured,
      capabilities: provider.capabilities,
      health,
      staleAfterMs: config.freshness.providerMaxAgeMs,
    },
    data: {
      fixtures,
      recommendations,
      competitions: get('SELECT COUNT(*) AS n FROM competitions')?.n ?? 0,
      teams: get('SELECT COUNT(*) AS n FROM teams')?.n ?? 0,
      teamMatchStats: get('SELECT COUNT(*) AS n FROM team_match_stats')?.n ?? 0,
      cache: cacheStats(),
    },
    sync: {
      enabled: config.sync.enabled,
      intervalsMs: {
        live: config.sync.liveIntervalMs,
        scheduled: config.sync.scheduledIntervalMs,
        history: config.sync.historyIntervalMs,
      },
      state: schedulerState,
      recentRuns: lastSyncRuns(6),
    },
    filters: config.filters,
    freshness: config.freshness,
    security: {
      adminTokenConfigured: Boolean(config.adminToken),
      apiKeyServerSideOnly: true,
      corsPolicy: 'same-origin',
    },
    limitations,
    events,
  };
}

apiRouter.get('/health', (req, res) => {
  let dbOk = true;
  try {
    get('SELECT 1 AS ok');
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    version: config.version,
    modelVersion: MODEL_VERSION,
    providerConfigured: getProvider().configured,
    database: dbOk ? 'ok' : 'error',
    now: nowIso(),
  });
});

apiRouter.get('/status', (req, res) => {
  res.json(buildStatus());
});

apiRouter.get('/config', (req, res) => {
  res.json({
    filters: config.filters,
    freshness: config.freshness,
    modelVersion: MODEL_VERSION,
    provider: { id: getProvider().id, configured: getProvider().configured },
  });
});

apiRouter.get('/fixtures', (req, res) => {
  const status = String(req.query.status || 'LIVE').toUpperCase();
  const allowed = ['LIVE', 'SCHEDULED', 'FINISHED'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed });
  }
  // "limit=all" devolve TODOS os jogos coletados (todas as ligas), não só a primeira página.
  const rows = listFixtureRows({ status, limit: req.query.limit ?? 'all', date: req.query.date });
  const analysisLimit = Math.min(Number(req.query.analyze) || ANALYSIS_LIMIT, rows.length);
  const analyses = rows.length ? analyzeRowsSafe(rows, analysisLimit) : [];
  return res.json({
    status,
    count: analyses.length,
    total: rows.length,
    analyzed: Math.min(analysisLimit, rows.length),
    providerConfigured: getProvider().configured,
    emptyReason: analyses.length
      ? null
      : getProvider().configured
        ? 'Nenhuma partida encontrada para este filtro. A sincronização roda automaticamente.'
        : 'Configure FOOTBALL_API_KEY para buscar partidas reais.',
    items: analyses,
    generatedAt: nowIso(),
  });
});

function analyzeRowsSafe(rows, analysisLimit = rows.length) {
  return rows.map((row, index) => {
    if (index >= analysisLimit) {
      // Lista completa não corta jogos: os excedentes voltam prontos para abrir a análise.
      return {
        fixture: serializeFixture(row),
        quality: null,
        blocked: false,
        analysisPending: true,
        recommendedCount: 0,
        best: null,
        noEntryReasons: ['Análise sob demanda: abra a partida para calcular as probabilidades.'],
        live: null,
        lambdas: null,
      };
    }
    try {
      const analysis = analyzeRow(row, { persist: true });
      const best = analysis.recommended?.[0] ?? null;
      return {
        fixture: serializeFixture(row),
        quality: analysis.quality,
        blocked: analysis.blocked,
        recommendedCount: analysis.recommended?.length ?? 0,
        best: best
          ? {
              marketKey: best.marketKey,
              label: best.label,
              group: best.group,
              probability: best.probability,
              fairOdds: best.fairOdds,
              bookmakerOdds: best.bookmakerOdds,
              edge: best.edge,
              confidence: best.confidence,
              preferred: best.preferred,
            }
          : null,
        noEntryReasons: analysis.noEntryReasons ?? [],
        live: analysis.live,
        lambdas: analysis.lambdas,
      };
    } catch (error) {
      logEvent('error', 'api-fixtures', `Jogo ${row.provider_id}: ${error.message}`);
      return {
        fixture: serializeFixture(row),
        quality: { level: 'INSUFICIENTE', score: 0, sample: 0, missing: ['erro de análise'] },
        blocked: true,
        recommendedCount: 0,
        best: null,
        noEntryReasons: [`Falha ao analisar: ${error.message}`],
        live: null,
        lambdas: null,
      };
    }
  });
}

apiRouter.get(
  '/fixtures/:id',
  asyncRoute(async (req, res) => {
    let row = getFixtureRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Partida não encontrada.' });

    let refresh = null;
    if (['LIVE', 'HT'].includes(row.status) && req.query.refresh === '1') {
      const last = refreshThrottle.get(row.id) ?? 0;
      if (Date.now() - last > 20_000) {
        refreshThrottle.set(row.id, Date.now());
        refresh = await refreshFixtureData(row);
        row = getFixtureRow(req.params.id) ?? row;
      } else {
        refresh = { refreshed: false, reason: 'Atualização recente: aguarde alguns segundos.' };
      }
    }

    await ensureFixtureHistory(row);
    row = getFixtureRow(req.params.id) ?? row;

    const analysis = analyzeRow(row, { persist: true });
    return res.json({
      fixture: serializeFixture(row),
      analysis,
      recommendations: fixtureRecommendations(row.id),
      refresh,
      generatedAt: nowIso(),
    });
  }),
);

apiRouter.get(
  '/fixtures/:id/analysis',
  asyncRoute(async (req, res) => {
    let row = getFixtureRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Partida não encontrada.' });
    await ensureFixtureHistory(row);
    row = getFixtureRow(req.params.id) ?? row;
    const analysis = analyzeRow(row, { persist: true });
    return res.json({
      fixture: serializeFixture(row),
      analysis,
      recommendations: fixtureRecommendations(row.id),
      generatedAt: nowIso(),
    });
  }),
);

apiRouter.get('/opportunities', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 60);
  const result = collectOpportunities({ limit });
  return res.json({
    ...result,
    providerConfigured: getProvider().configured,
    emptyReason: result.opportunities.length
      ? null
      : getProvider().configured
        ? 'Nenhuma oportunidade atende aos filtros (odd mínima, vantagem e confiança). O app não força recomendações.'
        : 'Configure FOOTBALL_API_KEY para analisar partidas reais.',
  });
});

apiRouter.get('/history', (req, res) => {
  settlePendingRecommendations();
  const summary = historySummary({ group: req.query.group, status: req.query.status, limit: req.query.limit });
  res.json(summary);
});

apiRouter.get('/recommendations', (req, res) => {
  res.json({
    items: listRecommendations({ status: req.query.status, group: req.query.group, limit: req.query.limit }),
  });
});

apiRouter.get('/backtest', (req, res) => {
  res.json({ runs: listBacktestRuns(req.query.limit), diagnostics: backtestDiagnostics() });
});

apiRouter.get('/backtest/:id', (req, res) => {
  const run = getBacktestRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'not_found', message: 'Backtest não encontrado.' });
  return res.json(run);
});

apiRouter.post(
  '/backtest/run',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { from, to, maxFixtures } = req.body ?? {};
    const result = runBacktest({ fromDate: from, toDate: to, maxFixtures });
    res.json(result);
  }),
);

apiRouter.post(
  '/sync',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const provider = getProvider();
    if (!provider.configured) {
      return res.status(503).json({
        error: 'provider_not_configured',
        message: 'FOOTBALL_API_KEY não configurada: nenhuma sincronização é possível.',
      });
    }
    const scope = String(req.body?.scope || 'live');
    let result;
    if (scope === 'live') result = await syncLive();
    else if (scope === 'history') result = await syncRecentFinished();
    else if (scope === 'schedule' || scope === 'scheduled' || scope === 'all') {
      result = await syncSchedule({ days: config.sync.scheduleDays });
    } else if (scope === 'team') {
      if (!req.body?.teamId) return res.status(400).json({ error: 'teamId_required' });
      result = await syncTeamHistory(String(req.body.teamId), { last: 10, force: true, budget: 8 });
    } else if (scope === 'date') {
      const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
      result = await syncDate(date);
    } else {
      return res.status(400).json({ error: 'invalid_scope', allowed: ['live', 'history', 'schedule', 'scheduled', 'all', 'team', 'date'] });
    }
    return res.json({ scope, result, status: buildStatus() });
  }),
);

apiRouter.post('/settle', requireAdmin, (req, res) => {
  res.json(settlePendingRecommendations());
});

apiRouter.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Rota de API inexistente.' });
});
