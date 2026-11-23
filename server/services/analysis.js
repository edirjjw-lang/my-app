import { config } from '../config.js';
import { all, get, logEvent, nowIso, run } from '../db.js';
import { MODEL_VERSION, analyzeFixture } from '../analysis/engine.js';
import { blendProfiles, buildProfile } from '../analysis/profile.js';
import { getProvider } from '../provider/index.js';
import { enrichFixture } from './ingest.js';

const HISTORY_WINDOW = 20;
const MAX_ANALYSES = 60;
// Exibição completa: "limit=all" devolve todos os jogos coletados, de todas as ligas.
const FIXTURE_LIST_CAP = Number(process.env.FIXTURE_LIST_CAP || 5000);

export function teamHistoryRows(teamId, beforeIso, limit = HISTORY_WINDOW) {
  return all(
    `SELECT tms.* FROM team_match_stats tms
       JOIN fixtures f ON f.provider_id = tms.fixture_provider_id
      WHERE tms.team_id = ? AND f.status = 'FINISHED' AND f.kickoff_utc < ?
      ORDER BY tms.kickoff_utc DESC
      LIMIT ?`,
    [teamId, beforeIso, limit],
  );
}

export function buildTeamProfile(teamId, beforeIso) {
  const rows = teamHistoryRows(teamId, beforeIso);
  const short = buildProfile(rows, { window: 5 });
  const long = buildProfile(rows, { window: 10 });
  return blendProfiles(short, long);
}

function baselineQuery(competitionId, beforeIso) {
  const params = [beforeIso];
  let clause = '';
  if (competitionId !== null && competitionId !== undefined) {
    clause = 'AND competition_id = ?';
    params.push(competitionId);
  }
  return get(
    `SELECT COUNT(*) AS matches,
            AVG(home_goals) AS homeGoals,
            AVG(away_goals) AS awayGoals,
            AVG(CASE WHEN home_corners IS NOT NULL AND away_corners IS NOT NULL
                     THEN (home_corners + away_corners) / 2.0 END) AS cornersPerTeam,
            AVG(CASE WHEN ht_home_goals IS NOT NULL AND ht_away_goals IS NOT NULL
                     THEN (ht_home_goals + ht_away_goals) END) AS htGoalsPerMatch
       FROM fixtures
      WHERE status = 'FINISHED' AND kickoff_utc < ?
        AND home_goals IS NOT NULL AND away_goals IS NOT NULL ${clause}`,
    params,
  );
}

/**
 * Linha de base da competição. Usa a própria competição; se houver menos de
 * 5 partidas encerradas, cai para a base global de partidas reais já coletadas.
 */
export function computeBaseline(competitionId, beforeIso) {
  const own = baselineQuery(competitionId, beforeIso);
  if (own && own.matches >= 5 && own.homeGoals > 0 && own.awayGoals > 0) {
    return {
      matches: own.matches,
      homeGoals: own.homeGoals,
      awayGoals: own.awayGoals,
      cornersPerTeam: own.cornersPerTeam ?? 0,
      htGoalsPerMatch: own.htGoalsPerMatch ?? null,
      source: 'competition',
    };
  }
  const global = baselineQuery(null, beforeIso);
  if (global && global.matches >= 5 && global.homeGoals > 0 && global.awayGoals > 0) {
    return {
      matches: global.matches,
      homeGoals: global.homeGoals,
      awayGoals: global.awayGoals,
      cornersPerTeam: global.cornersPerTeam ?? 0,
      htGoalsPerMatch: global.htGoalsPerMatch ?? null,
      source: 'global',
    };
  }
  return null;
}

export function computeH2H(homeTeamId, awayTeamId, beforeIso) {
  const rows = all(
    `SELECT * FROM fixtures
      WHERE status = 'FINISHED' AND kickoff_utc < ?
        AND ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
      ORDER BY kickoff_utc DESC
      LIMIT 10`,
    [beforeIso, homeTeamId, awayTeamId, awayTeamId, homeTeamId],
  ).filter((row) => Number.isFinite(row.home_goals) && Number.isFinite(row.away_goals));

  if (!rows.length) return { matches: 0, goalsPerMatch: null, avgCorners: null, homeWins: 0, draws: 0, awayWins: 0, recent: [] };

  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let cornersTotal = 0;
  let cornersCount = 0;

  for (const row of rows) {
    goals += row.home_goals + row.away_goals;
    if (row.home_goals > row.away_goals) homeWins += 1;
    else if (row.home_goals === row.away_goals) draws += 1;
    else awayWins += 1;
    if (Number.isFinite(row.home_corners) && Number.isFinite(row.away_corners)) {
      cornersTotal += row.home_corners + row.away_corners;
      cornersCount += 1;
    }
  }

  return {
    matches: rows.length,
    goalsPerMatch: goals / rows.length,
    avgCorners: cornersCount ? cornersTotal / cornersCount : null,
    homeWins,
    draws,
    awayWins,
    recent: rows.slice(0, 5).map((row) => ({
      kickoffUtc: row.kickoff_utc,
      homeGoals: row.home_goals,
      awayGoals: row.away_goals,
      corners: Number.isFinite(row.home_corners) && Number.isFinite(row.away_corners)
        ? row.home_corners + row.away_corners
        : null,
    })),
  };
}

export function fixtureFreshness(fixtureRow) {
  const isLive = ['LIVE', 'HT'].includes(fixtureRow.status);
  const limitMs = isLive ? config.sync.liveMaxAgeMs : config.sync.prematchMaxAgeMs;
  const reference = fixtureRow.stats_updated_at ?? fixtureRow.updated_at;
  const ageMs = reference ? Date.now() - Date.parse(reference) : null;
  return { stale: ageMs === null || ageMs > limitMs, ageMs, limitMs, reference };
}

export function parseStoredJson(row) {
  let odds = [];
  let lineups = null;
  let injuries = [];
  try {
    const parsed = JSON.parse(row.odds_json ?? '[]');
    if (Array.isArray(parsed)) odds = parsed;
  } catch {
    odds = [];
  }
  try {
    const parsed = JSON.parse(row.lineups_json ?? 'null');
    if (parsed) {
      lineups = parsed.lineups ?? null;
      injuries = Array.isArray(parsed.injuries) ? parsed.injuries : [];
    }
  } catch {
    lineups = null;
    injuries = [];
  }
  return { odds, lineups, injuries };
}

export function buildContext(fixtureRow) {
  const before = fixtureRow.kickoff_utc;
  const { odds, lineups, injuries } = parseStoredJson(fixtureRow);
  return {
    homeProfile: buildTeamProfile(fixtureRow.home_team_id, before),
    awayProfile: buildTeamProfile(fixtureRow.away_team_id, before),
    baseline: computeBaseline(fixtureRow.competition_id, before),
    h2h: computeH2H(fixtureRow.home_team_id, fixtureRow.away_team_id, before),
    odds,
    lineups,
    injuries,
    freshness: fixtureFreshness(fixtureRow),
  };
}

export function persistRecommendations(fixtureRow, analysis) {
  if (analysis.blocked) return 0;
  let count = 0;
  for (const market of analysis.recommended) {
    run(
      `INSERT INTO recommendations (fixture_id, fixture_provider_id, market_group, market_key, market_label,
          selection, line, probability, fair_odds, bookmaker_odds, edge, confidence, confidence_score,
          factors, risks, rationale, entry, status, reason, model_version, is_live, minute, stake,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fixture_id, market_key, selection, line) DO UPDATE SET
          probability = excluded.probability, fair_odds = excluded.fair_odds,
          bookmaker_odds = excluded.bookmaker_odds, edge = excluded.edge,
          confidence = excluded.confidence, confidence_score = excluded.confidence_score,
          factors = excluded.factors, risks = excluded.risks, rationale = excluded.rationale,
          entry = excluded.entry, reason = excluded.reason, model_version = excluded.model_version,
          is_live = excluded.is_live, minute = excluded.minute, updated_at = excluded.updated_at`,
      [
        fixtureRow.id,
        fixtureRow.provider_id,
        market.group,
        market.marketKey,
        market.label,
        market.selection,
        market.line ?? 0,
        market.probability,
        market.fairOdds,
        market.bookmakerOdds,
        market.edge,
        market.confidence,
        market.confidenceScore,
        JSON.stringify(market.factors ?? []),
        JSON.stringify(market.risks ?? []),
        market.rationale ?? null,
        market.entry,
        market.reason ?? null,
        analysis.modelVersion ?? MODEL_VERSION,
        market.isLive ? 1 : 0,
        market.minute ?? null,
        config.filters.stake,
        nowIso(),
        nowIso(),
      ],
    );
    count += 1;
  }
  return count;
}

export function analyzeRow(fixtureRow, { persist = true } = {}) {
  const context = buildContext(fixtureRow);
  const analysis = analyzeFixture({
    fixture: fixtureRow,
    homeProfile: context.homeProfile,
    awayProfile: context.awayProfile,
    baseline: context.baseline,
    h2h: context.h2h,
    odds: context.odds,
    lineups: context.lineups,
    injuries: context.injuries,
    filters: config.filters,
    freshness: context.freshness,
  });
  if (persist) {
    try {
      persistRecommendations(fixtureRow, analysis);
    } catch (error) {
      logEvent('error', 'persist-recommendations', error.message);
    }
  }
  return analysis;
}

export function getFixtureRow(id) {
  return get('SELECT * FROM fixtures WHERE id = ?', [Number(id)]) ?? null;
}

export function getFixtureRowByProvider(providerId) {
  return get('SELECT * FROM fixtures WHERE provider_id = ?', [String(providerId)]) ?? null;
}

export function serializeFixture(row) {
  if (!row) return null;
  const home = get('SELECT name, logo FROM teams WHERE id = ?', [row.home_team_id]);
  const away = get('SELECT name, logo FROM teams WHERE id = ?', [row.away_team_id]);
  const competition = row.competition_id
    ? get('SELECT name, country FROM competitions WHERE id = ?', [row.competition_id])
    : null;
  return {
    id: row.id,
    providerId: row.provider_id,
    competition: competition ? { name: competition.name, country: competition.country } : null,
    home: { id: row.home_team_id, name: home?.name ?? 'Casa', logo: home?.logo ?? null },
    away: { id: row.away_team_id, name: away?.name ?? 'Visitante', logo: away?.logo ?? null },
    kickoffUtc: row.kickoff_utc,
    status: row.status,
    minute: row.minute,
    score: { home: row.home_goals, away: row.away_goals, htHome: row.ht_home_goals, htAway: row.ht_away_goals },
    stats: {
      corners: { home: row.home_corners, away: row.away_corners },
      shots: { home: row.home_shots, away: row.away_shots },
      shotsOn: { home: row.home_shots_on, away: row.away_shots_on },
      possession: { home: row.home_possession, away: row.away_possession },
      cards: { home: row.home_cards, away: row.away_cards },
      dangerousAttacks: { home: row.home_dangerous_attacks, away: row.away_dangerous_attacks },
    },
    hasStats: Boolean(row.stats_updated_at),
    hasOdds: Boolean(row.odds_updated_at),
    hasLineups: Boolean(row.has_lineups),
    dataSource: row.data_source,
    statsUpdatedAt: row.stats_updated_at,
    oddsUpdatedAt: row.odds_updated_at,
    updatedAt: row.updated_at,
  };
}

function summarizeAnalysis(fixtureRow, analysis) {
  const best = analysis.recommended?.[0] ?? null;
  return {
    fixture: serializeFixture(fixtureRow),
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
    lambdas: analysis.lambdas,
    live: analysis.live,
    lastAnalysisAt: nowIso(),
  };
}

export function analyzeFixtures(rows, { persist = true } = {}) {
  return rows.slice(0, MAX_ANALYSES).map((row) => {
    try {
      const analysis = analyzeRow(row, { persist });
      return summarizeAnalysis(row, analysis);
    } catch (error) {
      logEvent('error', 'analyze', `Jogo ${row.provider_id}: ${error.message}`);
      return {
        fixture: serializeFixture(row),
        quality: { level: 'INSUFICIENTE', score: 0, sample: 0, missing: ['erro de análise'] },
        blocked: true,
        recommendedCount: 0,
        best: null,
        noEntryReasons: [`Falha ao analisar: ${error.message}`],
        lambdas: null,
        live: null,
        lastAnalysisAt: nowIso(),
      };
    }
  });
}

export function listFixtureRows({ status = 'LIVE', limit = 30, date = null } = {}) {
  const wantsAll = String(limit).toLowerCase() === 'all';
  const cap = wantsAll ? FIXTURE_LIST_CAP : Math.min(Number(limit) || 30, FIXTURE_LIST_CAP);
  if (status === 'LIVE') {
    return all(
      "SELECT * FROM fixtures WHERE status IN ('LIVE', 'HT') ORDER BY kickoff_utc ASC LIMIT ?",
      [cap],
    );
  }
  if (status === 'SCHEDULED') {
    if (date) {
      return all(
        `SELECT * FROM fixtures WHERE status IN ('SCHEDULED', 'LIVE', 'HT')
            AND substr(kickoff_utc, 1, 10) = ? ORDER BY kickoff_utc ASC LIMIT ?`,
        [date, cap],
      );
    }
    return all(
      "SELECT * FROM fixtures WHERE status = 'SCHEDULED' AND kickoff_utc >= ? ORDER BY kickoff_utc ASC LIMIT ?",
      [nowIso(), cap],
    );
  }
  return all("SELECT * FROM fixtures WHERE status = 'FINISHED' ORDER BY kickoff_utc DESC LIMIT ?", [cap]);
}

/**
 * Atualiza os dados do jogo sob demanda (odds ao vivo, estatísticas, escalações)
 * quando o provedor está configurado. Falhas ficam registradas, não silenciadas.
 */
export async function refreshFixtureData(row) {
  const provider = getProvider();
  if (!provider.configured) {
    return { refreshed: false, reason: 'Provedor de API não configurado (FOOTBALL_API_KEY ausente).' };
  }
  const isLive = ['LIVE', 'HT'].includes(row.status);
  try {
    const statsApplied = await enrichFixture(row, {
      stats: provider.capabilities.statistics,
      odds: provider.capabilities.odds,
      lineups: provider.capabilities.lineups,
    });
    return { refreshed: true, statsApplied, live: isLive };
  } catch (error) {
    logEvent('warn', 'refresh-fixture', `Jogo ${row.provider_id}: ${error.message}`);
    return { refreshed: false, reason: error.message };
  }
}

export function collectOpportunities({ limit = 20 } = {}) {
  const live = listFixtureRows({ status: 'LIVE', limit: 30 });
  const upcoming = listFixtureRows({ status: 'SCHEDULED', limit: 30 });
  const rows = [...live, ...upcoming].slice(0, MAX_ANALYSES);
  const opportunities = [];
  for (const row of rows) {
    let analysis;
    try {
      analysis = analyzeRow(row, { persist: true });
    } catch (error) {
      logEvent('error', 'opportunities', `Jogo ${row.provider_id}: ${error.message}`);
      continue;
    }
    for (const market of analysis.recommended ?? []) {
      opportunities.push({
        fixture: serializeFixture(row),
        market: {
          marketKey: market.marketKey,
          group: market.group,
          label: market.label,
          probability: market.probability,
          fairOdds: market.fairOdds,
          bookmakerOdds: market.bookmakerOdds,
          edge: market.edge,
          confidence: market.confidence,
          confidenceScore: market.confidenceScore,
          preferred: market.preferred,
          isLive: market.isLive,
          minute: market.minute,
          rationale: market.rationale,
          factors: market.factors,
          risks: market.risks,
        },
      });
    }
  }
  opportunities.sort(
    (a, b) => b.market.confidenceScore - a.market.confidenceScore || b.market.edge - a.market.edge,
  );
  return {
    opportunities: opportunities.slice(0, limit),
    total: opportunities.length,
    analyzedFixtures: rows.length,
    generatedAt: nowIso(),
  };
}

export function countFixtures() {
  const row = get(
    `SELECT
       SUM(CASE WHEN status IN ('LIVE','HT') THEN 1 ELSE 0 END) AS live,
       SUM(CASE WHEN status = 'SCHEDULED' THEN 1 ELSE 0 END) AS scheduled,
       SUM(CASE WHEN status = 'FINISHED' THEN 1 ELSE 0 END) AS finished,
       COUNT(*) AS total FROM fixtures`,
  );
  return {
    live: row?.live ?? 0,
    scheduled: row?.scheduled ?? 0,
    finished: row?.finished ?? 0,
    total: row?.total ?? 0,
  };
}
