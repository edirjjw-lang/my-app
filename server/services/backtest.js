import { config } from '../config.js';
import { all, get, nowIso, run, transaction } from '../db.js';
import { brierScore, calibrationBuckets, logLoss } from '../analysis/math.js';
import { settleMarket } from '../analysis/markets.js';
import { analyzeFixture } from '../analysis/engine.js';
import { buildTeamProfileFromRows } from '../analysis/profile.js';
import { computeBaseline, computeH2H, parseStoredJson } from './analysis.js';

const MAX_FIXTURES_PER_RUN = 200;

function metricsFromPredictions(predictions) {
  const valid = predictions.filter((p) => Number.isFinite(p.probability) && (p.outcome === 0 || p.outcome === 1));
  const wins = valid.filter((p) => p.outcome === 1).length;
  const withOdds = valid.filter((p) => Number.isFinite(p.odds) && p.odds > 1);
  let staked = 0;
  let profit = 0;
  for (const prediction of withOdds) {
    staked += config.filters.stake;
    profit += prediction.outcome === 1 ? config.filters.stake * (prediction.odds - 1) : -config.filters.stake;
  }
  return {
    markets: valid.length,
    wins,
    hitRate: valid.length ? wins / valid.length : null,
    brier: brierScore(valid),
    logLoss: logLoss(valid),
    withOdds: withOdds.length,
    staked,
    profit,
    roi: staked > 0 ? profit / staked : null,
  };
}

/**
 * Backtest cronológico: para cada jogo encerrado, o modelo é reconstruído
 * usando APENAS partidas anteriores ao horário do jogo (sem vazamento futuro).
 */
export function runBacktest({ fromDate, toDate, maxFixtures = 120 } = {}) {
  const startedAt = Date.now();
  const from = fromDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = toDate ?? nowIso();

  const fixtures = all(
    `SELECT * FROM fixtures
      WHERE status = 'FINISHED' AND kickoff_utc >= ? AND kickoff_utc <= ?
        AND home_goals IS NOT NULL AND away_goals IS NOT NULL
      ORDER BY kickoff_utc ASC
      LIMIT ?`,
    [from, to, Math.min(Number(maxFixtures) || 120, MAX_FIXTURES_PER_RUN)],
  );

  if (!fixtures.length) {
    return {
      empty: true,
      reason: 'Nenhuma partida encerrada no período informado. Sincronize dados antes de rodar o backtest.',
      from,
      to,
      fixturesEvaluated: 0,
      predictions: [],
      perMarket: [],
      calibration: [],
      totals: null,
      durationMs: Date.now() - startedAt,
    };
  }

  // Estatísticas por equipe carregadas uma única vez e filtradas por data do jogo.
  const statsRows = all('SELECT * FROM team_match_stats WHERE kickoff_utc <= ? ORDER BY kickoff_utc DESC', [to]);
  const byTeam = new Map();
  for (const row of statsRows) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id).push(row);
  }

  const predictions = [];
  let evaluated = 0;
  let skipped = 0;

  for (const fixture of fixtures) {
    const before = fixture.kickoff_utc;
    const homeRows = (byTeam.get(fixture.home_team_id) ?? []).filter((row) => row.kickoff_utc < before);
    const awayRows = (byTeam.get(fixture.away_team_id) ?? []).filter((row) => row.kickoff_utc < before);
    if (homeRows.length < 5 || awayRows.length < 5) {
      skipped += 1;
      continue;
    }

    const baseline = computeBaseline(fixture.competition_id, before);
    if (!baseline) {
      skipped += 1;
      continue;
    }

    const homeProfile = buildTeamProfileFromRows(homeRows);
    const awayProfile = buildTeamProfileFromRows(awayRows);
    const h2h = computeH2H(fixture.home_team_id, fixture.away_team_id, before);
    const { odds } = parseStoredJson(fixture);

    const analysis = analyzeFixture({
      fixture,
      homeProfile,
      awayProfile,
      baseline,
      h2h,
      odds,
      lineups: null,
      injuries: [],
      filters: config.filters,
      freshness: { stale: false, ageMs: 0 },
    });

    if (analysis.blocked) {
      skipped += 1;
      continue;
    }

    for (const market of analysis.markets) {
      const outcome = settleMarket(
        {
          group: market.group,
          marketType: market.marketType,
          period: market.period,
          team: market.team,
          selection: market.selection,
          line: market.line,
        },
        fixture,
      );
      if (outcome !== 'GREEN' && outcome !== 'RED') continue;
      predictions.push({
        fixtureProviderId: fixture.provider_id,
        kickoffUtc: fixture.kickoff_utc,
        marketKey: market.marketKey,
        selection: market.selection,
        line: market.line,
        probability: market.probability,
        fairOdds: market.fairOdds,
        odds: market.bookmakerOdds,
        edge: market.edge,
        confidence: market.confidence,
        entry: market.entry,
        outcome: outcome === 'GREEN' ? 1 : 0,
      });
    }
    evaluated += 1;
  }

  const totals = metricsFromPredictions(predictions);

  const perMarketMap = new Map();
  for (const prediction of predictions) {
    if (!perMarketMap.has(prediction.marketKey)) perMarketMap.set(prediction.marketKey, []);
    perMarketMap.get(prediction.marketKey).push(prediction);
  }
  const perMarket = [...perMarketMap.entries()]
    .map(([marketKey, list]) => ({ marketKey, ...metricsFromPredictions(list) }))
    .sort((a, b) => b.markets - a.markets);

  const recommended = predictions.filter((p) => p.entry === 'RECOMENDADA');
  const recommendedTotals = metricsFromPredictions(recommended);

  const calibration = calibrationBuckets(predictions);
  const durationMs = Date.now() - startedAt;

  const runId = transaction(() => {
    const result = run(
      `INSERT INTO backtest_runs (from_date, to_date, fixtures_evaluated, markets_evaluated, hit_rate, roi,
          profit, brier, log_loss, per_market, calibration, created_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        from,
        to,
        evaluated,
        totals.markets,
        totals.hitRate,
        recommendedTotals.roi,
        recommendedTotals.profit,
        totals.brier,
        totals.logLoss,
        JSON.stringify({ groups: perMarket, recommended: recommendedTotals }),
        JSON.stringify(calibration),
        nowIso(),
        durationMs,
      ],
    );
    const id = Number(result.lastInsertRowid);
    for (const prediction of predictions.slice(0, 5000)) {
      run(
        `INSERT INTO backtest_predictions (run_id, fixture_provider_id, market_key, selection, line, probability,
            fair_odds, odds, edge, outcome, kickoff_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          prediction.fixtureProviderId,
          prediction.marketKey,
          prediction.selection,
          prediction.line ?? 0,
          prediction.probability,
          prediction.fairOdds,
          prediction.odds,
          prediction.edge,
          prediction.outcome,
          prediction.kickoffUtc,
        ],
      );
    }
    return id;
  });

  return {
    runId,
    from,
    to,
    fixturesEvaluated: evaluated,
    fixturesSkipped: skipped,
    totals,
    recommendedTotals,
    perMarket,
    calibration,
    durationMs,
    leakageGuard: 'Perfis, linha de base e H2H usam somente partidas com kickoff anterior ao jogo avaliado.',
    predictions: predictions.slice(0, 200),
  };
}

export function listBacktestRuns(limit = 20) {
  const rows = all('SELECT * FROM backtest_runs ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 20, 100)]);
  return rows.map((row) => ({
    id: row.id,
    from: row.from_date,
    to: row.to_date,
    fixturesEvaluated: row.fixtures_evaluated,
    marketsEvaluated: row.markets_evaluated,
    hitRate: row.hit_rate,
    roi: row.roi,
    profit: row.profit,
    brier: row.brier,
    logLoss: row.log_loss,
    perMarket: safeParse(row.per_market, {}),
    calibration: safeParse(row.calibration, []),
    createdAt: row.created_at,
    durationMs: row.duration_ms,
  }));
}

export function getBacktestRun(id) {
  const row = get('SELECT * FROM backtest_runs WHERE id = ?', [Number(id)]);
  if (!row) return null;
  const predictions = all(
    'SELECT * FROM backtest_predictions WHERE run_id = ? ORDER BY id ASC LIMIT 1000',
    [row.id],
  ).map((prediction) => ({
    fixtureProviderId: prediction.fixture_provider_id,
    marketKey: prediction.market_key,
    selection: prediction.selection,
    line: prediction.line,
    probability: prediction.probability,
    fairOdds: prediction.fair_odds,
    odds: prediction.odds,
    edge: prediction.edge,
    outcome: prediction.outcome,
    kickoffUtc: prediction.kickoff_utc,
  }));
  return {
    id: row.id,
    from: row.from_date,
    to: row.to_date,
    fixturesEvaluated: row.fixtures_evaluated,
    marketsEvaluated: row.markets_evaluated,
    hitRate: row.hit_rate,
    roi: row.roi,
    profit: row.profit,
    brier: row.brier,
    logLoss: row.log_loss,
    perMarket: safeParse(row.per_market, {}),
    calibration: safeParse(row.calibration, []),
    createdAt: row.created_at,
    durationMs: row.duration_ms,
    predictions,
  };
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
