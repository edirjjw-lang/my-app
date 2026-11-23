import { config } from '../config.js';
import { all, get, logEvent, nowIso, run, transaction } from '../db.js';
import { getProvider } from '../provider/index.js';

const ENRICH_BUDGET = Number(process.env.ENRICH_BUDGET || 12);
const LIVE_ENRICH_WINDOW_MS = 90_000;

function upsertCompetition(competition) {
  if (!competition?.providerId) return null;
  const existing = get('SELECT id FROM competitions WHERE provider_id = ?', [competition.providerId]);
  if (existing) {
    run(
      `UPDATE competitions SET name = COALESCE(?, name), country = COALESCE(?, country),
              season = COALESCE(?, season), updated_at = ? WHERE id = ?`,
      [competition.name, competition.country, competition.season, nowIso(), existing.id],
    );
    return existing.id;
  }
  const result = run(
    'INSERT INTO competitions (provider_id, name, country, season, updated_at) VALUES (?, ?, ?, ?, ?)',
    [competition.providerId, competition.name ?? null, competition.country ?? null, competition.season ?? null, nowIso()],
  );
  return Number(result.lastInsertRowid);
}

function upsertTeam(team) {
  if (!team?.providerId) return null;
  const existing = get('SELECT id FROM teams WHERE provider_id = ?', [team.providerId]);
  if (existing) {
    run(
      `UPDATE teams SET name = COALESCE(?, name), logo = COALESCE(?, logo), updated_at = ? WHERE id = ?`,
      [team.name, team.logo, nowIso(), existing.id],
    );
    return existing.id;
  }
  const result = run('INSERT INTO teams (provider_id, name, logo, updated_at) VALUES (?, ?, ?, ?)', [
    team.providerId,
    team.name ?? team.providerId,
    team.logo ?? null,
    nowIso(),
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Grava/atualiza um jogo vindo do provedor. Campos estatísticos ausentes
 * no payload não apagam dados já coletados.
 */
export function upsertFixture(item) {
  if (!item?.providerId || !item.home?.providerId || !item.away?.providerId) return null;
  const competitionId = upsertCompetition(item.competition);
  const homeTeamId = upsertTeam(item.home);
  const awayTeamId = upsertTeam(item.away);
  const existing = get('SELECT * FROM fixtures WHERE provider_id = ?', [item.providerId]);

  if (existing) {
    run(
      `UPDATE fixtures SET competition_id = COALESCE(?, competition_id),
              home_team_id = ?, away_team_id = ?, kickoff_utc = ?, status = ?, status_raw = ?,
              minute = COALESCE(?, minute),
              home_goals = COALESCE(?, home_goals), away_goals = COALESCE(?, away_goals),
              ht_home_goals = COALESCE(?, ht_home_goals), ht_away_goals = COALESCE(?, ht_away_goals),
              data_source = ?, updated_at = ?
        WHERE id = ?`,
      [
        competitionId,
        homeTeamId,
        awayTeamId,
        item.kickoffUtc,
        item.status,
        item.statusRaw ?? null,
        item.minute ?? null,
        item.score?.home ?? null,
        item.score?.away ?? null,
        item.score?.htHome ?? null,
        item.score?.htAway ?? null,
        item.source ?? config.provider,
        nowIso(),
        existing.id,
      ],
    );
    return existing.id;
  }

  const result = run(
    `INSERT INTO fixtures (provider_id, competition_id, home_team_id, away_team_id, kickoff_utc, status,
        status_raw, minute, home_goals, away_goals, ht_home_goals, ht_away_goals, data_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.providerId,
      competitionId,
      homeTeamId,
      awayTeamId,
      item.kickoffUtc,
      item.status,
      item.statusRaw ?? null,
      item.minute ?? null,
      item.score?.home ?? null,
      item.score?.away ?? null,
      item.score?.htHome ?? null,
      item.score?.htAway ?? null,
      item.source ?? config.provider,
      nowIso(),
      nowIso(),
    ],
  );
  return Number(result.lastInsertRowid);
}

function deriveTeamMatchStats(fixtureRow) {
  if (!fixtureRow || fixtureRow.status !== 'FINISHED') return 0;
  if (!Number.isFinite(fixtureRow.home_goals) || !Number.isFinite(fixtureRow.away_goals)) return 0;

  const entries = [
    {
      teamId: fixtureRow.home_team_id,
      opponentId: fixtureRow.away_team_id,
      isHome: 1,
      goalsFor: fixtureRow.home_goals,
      goalsAgainst: fixtureRow.away_goals,
      htFor: fixtureRow.ht_home_goals,
      htAgainst: fixtureRow.ht_away_goals,
      cornersFor: fixtureRow.home_corners,
      cornersAgainst: fixtureRow.away_corners,
      htCornersFor: fixtureRow.home_ht_corners,
      htCornersAgainst: fixtureRow.away_ht_corners,
      shotsFor: fixtureRow.home_shots,
      shotsAgainst: fixtureRow.away_shots,
      shotsOnFor: fixtureRow.home_shots_on,
      shotsOnAgainst: fixtureRow.away_shots_on,
      possession: fixtureRow.home_possession,
    },
    {
      teamId: fixtureRow.away_team_id,
      opponentId: fixtureRow.home_team_id,
      isHome: 0,
      goalsFor: fixtureRow.away_goals,
      goalsAgainst: fixtureRow.home_goals,
      htFor: fixtureRow.ht_away_goals,
      htAgainst: fixtureRow.ht_home_goals,
      cornersFor: fixtureRow.away_corners,
      cornersAgainst: fixtureRow.home_corners,
      htCornersFor: fixtureRow.away_ht_corners,
      htCornersAgainst: fixtureRow.home_ht_corners,
      shotsFor: fixtureRow.away_shots,
      shotsAgainst: fixtureRow.home_shots,
      shotsOnFor: fixtureRow.away_shots_on,
      shotsOnAgainst: fixtureRow.home_shots_on,
      possession: fixtureRow.away_possession,
    },
  ];

  let count = 0;
  for (const entry of entries) {
    if (!entry.teamId) continue;
    run(
      `INSERT INTO team_match_stats (fixture_provider_id, team_id, opponent_id, competition_id, kickoff_utc,
          is_home, goals_for, goals_against, ht_goals_for, ht_goals_against, corners_for, corners_against,
          ht_corners_for, ht_corners_against, shots_for, shots_against, shots_on_for, shots_on_against,
          possession, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fixture_provider_id, team_id) DO UPDATE SET
          goals_for = excluded.goals_for, goals_against = excluded.goals_against,
          ht_goals_for = excluded.ht_goals_for, ht_goals_against = excluded.ht_goals_against,
          corners_for = excluded.corners_for, corners_against = excluded.corners_against,
          ht_corners_for = excluded.ht_corners_for, ht_corners_against = excluded.ht_corners_against,
          shots_for = excluded.shots_for, shots_against = excluded.shots_against,
          shots_on_for = excluded.shots_on_for, shots_on_against = excluded.shots_on_against,
          possession = excluded.possession`,
      [
        fixtureRow.provider_id,
        entry.teamId,
        entry.opponentId,
        fixtureRow.competition_id,
        fixtureRow.kickoff_utc,
        entry.isHome,
        entry.goalsFor,
        entry.goalsAgainst,
        entry.htFor,
        entry.htAgainst,
        entry.cornersFor,
        entry.cornersAgainst,
        entry.htCornersFor,
        entry.htCornersAgainst,
        entry.shotsFor,
        entry.shotsAgainst,
        entry.shotsOnFor,
        entry.shotsOnAgainst,
        entry.possession,
        nowIso(),
      ],
    );
    count += 1;
  }
  return count;
}

function statPair(statsByTeam, homeProviderId, awayProviderId, key) {
  const home = statsByTeam?.[homeProviderId]?.[key];
  const away = statsByTeam?.[awayProviderId]?.[key];
  return [Number.isFinite(home) ? home : null, Number.isFinite(away) ? away : null];
}

export function applyStatistics(fixtureId, statsByTeam) {
  const fixtureRow = get('SELECT * FROM fixtures WHERE provider_id = ?', [fixtureId]);
  if (!fixtureRow) return 0;
  const homeTeam = get('SELECT provider_id FROM teams WHERE id = ?', [fixtureRow.home_team_id]);
  const awayTeam = get('SELECT provider_id FROM teams WHERE id = ?', [fixtureRow.away_team_id]);
  if (!homeTeam || !awayTeam) return 0;

  const [homeCorners, awayCorners] = statPair(statsByTeam, homeTeam.provider_id, awayTeam.provider_id, 'corners');
  const [homeShots, awayShots] = statPair(statsByTeam, homeTeam.provider_id, awayTeam.provider_id, 'shots');
  const [homeShotsOn, awayShotsOn] = statPair(statsByTeam, homeTeam.provider_id, awayTeam.provider_id, 'shotsOn');
  const [homePossession, awayPossession] = statPair(statsByTeam, homeTeam.provider_id, awayTeam.provider_id, 'possession');
  const [homeDangerous, awayDangerous] = statPair(
    statsByTeam,
    homeTeam.provider_id,
    awayTeam.provider_id,
    'dangerousAttacks',
  );
  const [homeYellow, awayYellow] = statPair(statsByTeam, homeTeam.provider_id, awayTeam.provider_id, 'yellowCards');
  const [homeRed, awayRed] = statPair(statsByTeam, homeTeam.provider_id, awayTeam.provider_id, 'redCards');

  run(
    `UPDATE fixtures SET home_corners = COALESCE(?, home_corners), away_corners = COALESCE(?, away_corners),
        home_shots = COALESCE(?, home_shots), away_shots = COALESCE(?, away_shots),
        home_shots_on = COALESCE(?, home_shots_on), away_shots_on = COALESCE(?, away_shots_on),
        home_possession = COALESCE(?, home_possession), away_possession = COALESCE(?, away_possession),
        home_dangerous_attacks = COALESCE(?, home_dangerous_attacks),
        away_dangerous_attacks = COALESCE(?, away_dangerous_attacks),
        home_cards = COALESCE(?, home_cards), away_cards = COALESCE(?, away_cards),
        stats_updated_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      homeCorners,
      awayCorners,
      homeShots,
      awayShots,
      homeShotsOn,
      awayShotsOn,
      homePossession,
      awayPossession,
      homeDangerous,
      awayDangerous,
      homeYellow !== null || homeRed !== null ? (homeYellow ?? 0) + (homeRed ?? 0) : null,
      awayYellow !== null || awayRed !== null ? (awayYellow ?? 0) + (awayRed ?? 0) : null,
      nowIso(),
      nowIso(),
      fixtureRow.id,
    ],
  );

  const updated = get('SELECT * FROM fixtures WHERE id = ?', [fixtureRow.id]);
  return deriveTeamMatchStats(updated);
}

export function applyOdds(fixtureId, odds) {
  run('UPDATE fixtures SET odds_json = ?, odds_updated_at = ?, updated_at = ? WHERE provider_id = ?', [
    JSON.stringify(odds ?? []),
    nowIso(),
    nowIso(),
    fixtureId,
  ]);
}

export function applyLineupsAndInjuries(fixtureId, { lineups, injuries }) {
  const payload = {
    lineups: lineups ?? null,
    injuries: injuries ?? [],
    updatedAt: nowIso(),
  };
  run('UPDATE fixtures SET lineups_json = ?, has_lineups = ?, updated_at = ? WHERE provider_id = ?', [
    JSON.stringify(payload),
    lineups ? 1 : 0,
    nowIso(),
    fixtureId,
  ]);
}

/**
 * Busca e aplica estatísticas/odds/escalações de um jogo, respeitando as
 * capacidades do provedor e o orçamento de requisições.
 */
export async function enrichFixture(fixtureRow, { stats = true, odds = true, lineups = true } = {}) {
  const provider = getProvider();
  const capabilities = provider.capabilities;
  let statsApplied = 0;

  if (stats && capabilities.statistics) {
    const age = fixtureRow.stats_updated_at ? Date.now() - Date.parse(fixtureRow.stats_updated_at) : Infinity;
    if (age > LIVE_ENRICH_WINDOW_MS) {
      const result = await provider.fetchFixtureStatistics(fixtureRow.provider_id);
      statsApplied = applyStatistics(fixtureRow.provider_id, result.statsByTeam);
    }
  }

  if (odds && capabilities.odds) {
    const age = fixtureRow.odds_updated_at ? Date.now() - Date.parse(fixtureRow.odds_updated_at) : Infinity;
    if (age > 5 * 60_000) {
      const result = await provider.fetchOdds(fixtureRow.provider_id);
      applyOdds(fixtureRow.provider_id, result.odds);
    }
  }

  if (lineups && capabilities.lineups && !fixtureRow.has_lineups) {
    const [lineupData, injuryData] = await Promise.all([
      provider.fetchLineups(fixtureRow.provider_id).catch(() => null),
      capabilities.injuries ? provider.fetchInjuries(fixtureRow.provider_id).catch(() => []) : Promise.resolve([]),
    ]);
    if (lineupData || (injuryData && injuryData.length)) {
      applyLineupsAndInjuries(fixtureRow.provider_id, { lineups: lineupData, injuries: injuryData });
    }
  }

  return statsApplied;
}

async function recordSyncRun(kind, startedAt, payload) {
  run(
    `INSERT INTO sync_runs (kind, started_at, finished_at, ok, fixtures_upserted, stats_upserted, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      kind,
      startedAt,
      nowIso(),
      payload.ok ? 1 : 0,
      payload.fixtures ?? 0,
      payload.stats ?? 0,
      payload.error ? String(payload.error).slice(0, 500) : null,
    ],
  );
}

export async function syncLive() {
  const startedAt = nowIso();
  const provider = getProvider();
  try {
    const { fixtures, pages = 1, partial = false, error: partialError } = await provider.fetchLiveFixtures();
    let upserted = 0;
    for (const item of fixtures) {
      if (upsertFixture(item)) upserted += 1;
    }

    let statsApplied = 0;
    let budget = ENRICH_BUDGET;
    for (const item of fixtures.slice(0, ENRICH_BUDGET)) {
      if (budget <= 0) break;
      const row = get('SELECT * FROM fixtures WHERE provider_id = ?', [item.providerId]);
      if (!row) continue;
      try {
        statsApplied += await enrichFixture(row, { stats: true, odds: true, lineups: true });
        budget -= 1;
      } catch (error) {
        logEvent('warn', 'enrich', `Falha ao enriquecer ${item.providerId}: ${error.message}`);
      }
    }

    if (partial) logEvent('warn', 'sync-live', `Coleta parcial (${pages} páginas): ${partialError}`);
    await recordSyncRun('live', startedAt, {
      ok: !partial,
      fixtures: upserted,
      stats: statsApplied,
      error: partial ? partialError : null,
    });
    return { ok: !partial, fixtures: upserted, stats: statsApplied, pages, partial };
  } catch (error) {
    logEvent('error', 'sync-live', error.message);
    await recordSyncRun('live', startedAt, { ok: false, error: error.message });
    throw error;
  }
}

export async function syncDate(dateIso) {
  const startedAt = nowIso();
  const provider = getProvider();
  try {
    const { fixtures, pages = 1, partial = false, error: partialError } = await provider.fetchFixturesByDate(dateIso);
    let upserted = 0;
    for (const item of fixtures) {
      if (upsertFixture(item)) upserted += 1;
    }
    if (partial) logEvent('warn', 'sync-date', `${dateIso}: coleta parcial (${pages} páginas): ${partialError}`);
    await recordSyncRun('date', startedAt, {
      ok: !partial,
      fixtures: upserted,
      error: partial ? partialError : null,
    });
    return { ok: !partial, fixtures: upserted, pages, partial };
  } catch (error) {
    logEvent('error', 'sync-date', error.message);
    await recordSyncRun('date', startedAt, { ok: false, error: error.message });
    throw error;
  }
}

/**
 * Agenda completa: todos os jogos de TODAS as ligas para cada dia da janela
 * (SCHEDULE_DAYS, padrão 7). Nenhum campeonato é filtrado; cada data lê todas
 * as páginas que o provedor devolver.
 */
export async function syncSchedule({ days = config.sync.scheduleDays, from = Date.now() } = {}) {
  const startedAt = nowIso();
  const windowSize = Math.max(1, Number(days) || 1);
  const total = { ok: true, fixtures: 0, pages: 0, days: 0, dates: [], partial: false, errors: [] };

  for (let offset = 0; offset < windowSize; offset += 1) {
    const date = new Date(from + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
      const result = await syncDate(date);
      total.fixtures += result.fixtures ?? 0;
      total.pages += result.pages ?? 0;
      total.days += 1;
      total.dates.push(date);
      if (result.partial) total.partial = true;
    } catch (error) {
      total.ok = false;
      total.errors.push(`${date}: ${error.message}`);
      logEvent('error', 'sync-schedule', `${date}: ${error.message}`);
    }
  }

  if (total.partial) total.ok = false;
  await recordSyncRun('schedule', startedAt, {
    ok: total.ok,
    fixtures: total.fixtures,
    error: total.errors.join('; ') || null,
  });
  return total;
}

/**
 * Histórico de uma equipe: jogos encerrados + estatísticas por partida
 * (escanteios, finalizações, posse) limitadas por orçamento.
 */
export async function syncTeamHistory(teamProviderId, { last = 10, force = false, budget = 8 } = {}) {
  const provider = getProvider();
  const key = `team_history:${teamProviderId}`;
  if (!force) {
    const row = get('SELECT value FROM settings WHERE key = ?', [key]);
    if (row && Date.now() - Date.parse(JSON.parse(row.value).at) < config.sync.historyIntervalMs) {
      return { skipped: true };
    }
  }

  const matches = await provider.fetchTeamMatches(teamProviderId, last);
  let fixturesUpserted = 0;
  for (const item of matches) {
    if (upsertFixture(item)) fixturesUpserted += 1;
  }

  let statsApplied = 0;
  let remaining = budget;
  for (const item of matches) {
    if (remaining <= 0) break;
    const row = get('SELECT * FROM fixtures WHERE provider_id = ?', [item.providerId]);
    if (!row || row.status !== 'FINISHED') continue;
    if (Number.isFinite(row.home_corners) && Number.isFinite(row.away_corners)) {
      deriveTeamMatchStats(row);
      continue;
    }
    try {
      statsApplied += await enrichFixture(row, { stats: true, odds: false, lineups: false });
      remaining -= 1;
    } catch (error) {
      logEvent('warn', 'team-history', `Sem estatísticas de ${item.providerId}: ${error.message}`);
    }
  }

  run('UPDATE teams SET history_synced_at = ? WHERE provider_id = ?', [nowIso(), teamProviderId]);
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify({ at: nowIso(), fixtures: fixturesUpserted, stats: statsApplied }), nowIso()],
  );
  return { skipped: false, fixtures: fixturesUpserted, stats: statsApplied };
}

export function deriveAllFinishedStats() {
  const rows = all("SELECT * FROM fixtures WHERE status = 'FINISHED' ORDER BY kickoff_utc DESC LIMIT 500");
  let count = 0;
  transaction(() => {
    for (const row of rows) count += deriveTeamMatchStats(row);
  });
  return count;
}

export async function syncRecentFinished() {
  const startedAt = nowIso();
  const windowDays = Math.min(Math.max(1, config.sync.historyDays), 14);
  let upserted = 0;
  let pages = 0;
  try {
    for (let offset = 0; offset < windowDays; offset += 1) {
      const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const result = await syncDate(date);
      upserted += result.fixtures ?? 0;
      pages += result.pages ?? 0;
    }
    const stats = deriveAllFinishedStats();
    await recordSyncRun('finished', startedAt, { ok: true, fixtures: upserted, stats });
    return { ok: true, fixtures: upserted, stats, pages, days: windowDays };
  } catch (error) {
    logEvent('error', 'sync-finished', error.message);
    await recordSyncRun('finished', startedAt, { ok: false, error: error.message });
    throw error;
  }
}

export function lastSyncRuns(limit = 10) {
  return all('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', [limit]);
}
