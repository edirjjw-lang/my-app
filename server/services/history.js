import { config } from '../config.js';
import { all, get, logEvent, nowIso, run } from '../db.js';
import { brierScore, calibrationBuckets, logLoss } from '../analysis/math.js';
import { settleMarket } from '../analysis/markets.js';

const SETTLEMENT_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Reconstrói tipo/período/equipe do mercado a partir da chave persistida.
 * Necessário para liquidar recomendações antigas sem depender do motor.
 */
export function parseMarketKey(marketKey) {
  if (marketKey === '1x2') return { marketType: '1x2', period: 'FT', team: null };
  if (marketKey === 'double_chance') return { marketType: 'dc', period: 'FT', team: null };
  if (marketKey === 'draw_no_bet') return { marketType: 'dnb', period: 'FT', team: null };
  if (marketKey === 'btts') return { marketType: 'btts', period: 'FT', team: null };
  const parts = String(marketKey).split('_');
  const marketType = parts[parts.length - 1];
  const team = parts.includes('home') ? 'home' : parts.includes('away') ? 'away' : null;
  const period = parts.includes('1h') ? '1H' : parts.includes('2h') ? '2H' : 'FT';
  return { marketType, period, team };
}

export function settlePendingRecommendations() {
  const rows = all(
    `SELECT r.id, r.market_group, r.market_key, r.selection, r.line, r.stake, r.bookmaker_odds,
            f.status AS fixture_status, f.home_goals, f.away_goals, f.ht_home_goals, f.ht_away_goals,
            f.home_corners, f.away_corners, f.home_ht_corners, f.away_ht_corners, f.kickoff_utc
       FROM recommendations r
       JOIN fixtures f ON f.id = r.fixture_id
      WHERE r.status = 'PENDING' AND f.status = 'FINISHED'`,
  );

  let settled = 0;
  let voided = 0;
  for (const row of rows) {
    const parsed = parseMarketKey(row.market_key);
    const outcome = settleMarket(
      {
        group: row.market_group,
        marketType: parsed.marketType,
        period: parsed.period,
        team: parsed.team,
        selection: row.selection,
        line: row.line,
      },
      row,
    );

    if (outcome === null) {
      const kickoff = Date.parse(row.kickoff_utc);
      if (Number.isFinite(kickoff) && Date.now() - kickoff > SETTLEMENT_GRACE_MS) {
        run(
          `UPDATE recommendations SET status = 'VOID', profit = 0, settled_at = ?,
                  reason = COALESCE(reason, ?), updated_at = ? WHERE id = ?`,
          [nowIso(), 'Liquidação impossível: o provedor não forneceu os dados necessários.', nowIso(), row.id],
        );
        voided += 1;
      }
      continue;
    }

    const stake = Number.isFinite(row.stake) ? row.stake : config.filters.stake;
    const odds = row.bookmaker_odds;
    const profit =
      outcome === 'GREEN' && Number.isFinite(odds) ? stake * (odds - 1) : outcome === 'RED' ? -stake : 0;
    run(
      `UPDATE recommendations SET status = ?, profit = ?, settled_at = ?, updated_at = ? WHERE id = ?`,
      [outcome, profit, nowIso(), nowIso(), row.id],
    );
    settled += 1;
  }

  if (settled || voided) {
    logEvent('info', 'settlement', `${settled} recomendação(ões) liquidada(s), ${voided} anulada(s).`);
  }
  return { settled, voided, candidates: rows.length };
}

function serializeRecommendation(row) {
  let factors = [];
  let risks = [];
  try {
    factors = JSON.parse(row.factors ?? '[]');
  } catch {
    factors = [];
  }
  try {
    risks = JSON.parse(row.risks ?? '[]');
  } catch {
    risks = [];
  }
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    fixtureProviderId: row.fixture_provider_id,
    group: row.market_group,
    marketKey: row.market_key,
    label: row.market_label,
    selection: row.selection,
    line: row.line,
    probability: row.probability,
    fairOdds: row.fair_odds,
    bookmakerOdds: row.bookmaker_odds,
    edge: row.edge,
    confidence: row.confidence,
    confidenceScore: row.confidence_score,
    entry: row.entry,
    status: row.status,
    reason: row.reason,
    factors,
    risks,
    rationale: row.rationale,
    modelVersion: row.model_version,
    isLive: Boolean(row.is_live),
    minute: row.minute,
    stake: row.stake,
    profit: row.profit,
    settledAt: row.settled_at,
    createdAt: row.created_at,
    fixture: row.home_name
      ? {
          home: row.home_name,
          away: row.away_name,
          competition: row.competition_name,
          kickoffUtc: row.kickoff_utc,
          homeGoals: row.home_goals,
          awayGoals: row.away_goals,
          status: row.fixture_status,
        }
      : null,
  };
}

function groupMetrics(rows) {
  const decided = rows.filter((row) => row.status === 'GREEN' || row.status === 'RED');
  const wins = decided.filter((row) => row.status === 'GREEN').length;
  const staked = decided.reduce((acc, row) => acc + (Number.isFinite(row.stake) ? row.stake : config.filters.stake), 0);
  const profit = decided.reduce((acc, row) => acc + (Number.isFinite(row.profit) ? row.profit : 0), 0);
  const predictions = decided.map((row) => ({ probability: row.probability, outcome: row.status === 'GREEN' ? 1 : 0 }));
  return {
    count: decided.length,
    wins,
    losses: decided.length - wins,
    hitRate: decided.length ? wins / decided.length : null,
    staked,
    profit,
    roi: staked > 0 ? profit / staked : null,
    avgProbability: decided.length
      ? decided.reduce((acc, row) => acc + row.probability, 0) / decided.length
      : null,
    brier: brierScore(predictions),
    logLoss: logLoss(predictions),
  };
}

/**
 * Lê JSON persistido sem deixar um registro corrompido derrubar a tela.
 */
function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Desempenho real do modelo, medido no backtest cronológico: cada partida é
 * prevista usando apenas jogos anteriores a ela (sem vazamento de futuro).
 * É o que dá sentido ao histórico: sem isto a aba só listaria recomendações
 * em aberto e não provaria se as análises acertam.
 */
export function modelPerformance({ limit = 8 } = {}) {
  const runs = all('SELECT * FROM backtest_runs ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 8, 50)]);
  if (!runs.length) {
    return {
      available: false,
      reason:
        'O backtest roda sozinho assim que houver partidas encerradas com histórico suficiente das equipes (mínimo de 20 jogos).',
      runs: [],
      latest: null,
      byMarket: [],
      calibration: [],
    };
  }

  const latest = runs[0];
  const perMarket = safeJson(latest.per_market, {});

  return {
    available: true,
    latest: {
      id: latest.id,
      from: latest.from_date,
      to: latest.to_date,
      fixturesEvaluated: latest.fixtures_evaluated,
      marketsEvaluated: latest.markets_evaluated,
      hitRate: latest.hit_rate,
      roi: latest.roi,
      profit: latest.profit,
      brier: latest.brier,
      logLoss: latest.log_loss,
      createdAt: latest.created_at,
      durationMs: latest.duration_ms,
    },
    byMarket: (perMarket.groups ?? perMarket.markets ?? [])
      .filter((row) => (row.markets ?? row.count ?? 0) > 0)
      .slice(0, 14),
    recommended: perMarket.recommended ?? null,
    calibration: safeJson(latest.calibration, []),
    runs: runs.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      fixturesEvaluated: row.fixtures_evaluated,
      hitRate: row.hit_rate,
      roi: row.roi,
      brier: row.brier,
      logLoss: row.log_loss,
    })),
  };
}

export function historySummary({ group = null, status = null, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (group) {
    where.push('r.market_group = ?');
    params.push(group);
  }
  if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = all(
    `SELECT r.*, f.status AS fixture_status, f.home_goals, f.away_goals, f.kickoff_utc,
            ht.name AS home_name, awt.name AS away_name, c.name AS competition_name
       FROM recommendations r
       JOIN fixtures f ON f.id = r.fixture_id
       LEFT JOIN teams ht ON ht.id = f.home_team_id
       LEFT JOIN teams awt ON awt.id = f.away_team_id
       LEFT JOIN competitions c ON c.id = f.competition_id
       ${clause}
      ORDER BY r.created_at DESC
      LIMIT ?`,
    [...params, Math.min(Number(limit) || 200, 1000)],
  );

  const decided = rows.filter((row) => row.status === 'GREEN' || row.status === 'RED');
  const overall = groupMetrics(rows);

  const byMarket = {};
  for (const row of decided) {
    const key = row.market_group;
    if (!byMarket[key]) byMarket[key] = [];
    byMarket[key].push(row);
  }
  const marketBreakdown = Object.entries(byMarket).map(([key, list]) => ({ group: key, ...groupMetrics(list) }));

  const byLabel = {};
  for (const row of decided) {
    const key = row.market_key;
    if (!byLabel[key]) byLabel[key] = [];
    byLabel[key].push(row);
  }
  const marketKeyBreakdown = Object.entries(byLabel)
    .map(([key, list]) => ({ marketKey: key, ...groupMetrics(list) }))
    .sort((a, b) => b.count - a.count);

  const predictions = decided.map((row) => ({
    probability: row.probability,
    outcome: row.status === 'GREEN' ? 1 : 0,
  }));

  return {
    totals: {
      ...overall,
      voided: rows.filter((row) => row.status === 'VOID').length,
      pending: all("SELECT COUNT(*) AS n FROM recommendations WHERE status = 'PENDING'")[0]?.n ?? 0,
      recorded: rows.length,
      unitStake: config.filters.stake,
    },
    byGroup: marketBreakdown,
    byMarket: marketKeyBreakdown,
    calibration: calibrationBuckets(predictions),
    model: modelPerformance(),
    recommendations: rows.slice(0, 100).map(serializeRecommendation),
    generatedAt: nowIso(),
  };
}

export function listRecommendations({ status = null, group = null, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  if (group) {
    where.push('r.market_group = ?');
    params.push(group);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT r.*, f.status AS fixture_status, f.home_goals, f.away_goals, f.kickoff_utc,
            ht.name AS home_name, awt.name AS away_name, c.name AS competition_name
       FROM recommendations r
       JOIN fixtures f ON f.id = r.fixture_id
       LEFT JOIN teams ht ON ht.id = f.home_team_id
       LEFT JOIN teams awt ON awt.id = f.away_team_id
       LEFT JOIN competitions c ON c.id = f.competition_id
       ${clause}
      ORDER BY r.created_at DESC
      LIMIT ?`,
    [...params, Math.min(Number(limit) || 100, 500)],
  );
  return rows.map(serializeRecommendation);
}

export function fixtureRecommendations(fixtureId) {
  const rows = all('SELECT * FROM recommendations WHERE fixture_id = ? ORDER BY confidence_score DESC', [
    Number(fixtureId),
  ]);
  return rows.map(serializeRecommendation);
}

export function countRecommendations() {
  const row = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'GREEN' THEN 1 ELSE 0 END) AS green,
            SUM(CASE WHEN status = 'RED' THEN 1 ELSE 0 END) AS red
       FROM recommendations`,
  );
  return {
    total: row?.total ?? 0,
    pending: row?.pending ?? 0,
    green: row?.green ?? 0,
    red: row?.red ?? 0,
  };
}
