import { config } from '../config.js';
import { ProviderError, collectPages, providerRequest } from './http.js';

/**
 * Adaptador da Bzzoiro Sports API v2 (https://sports.bzzoiro.com/api/v2/).
 *
 * Contrato observado nas respostas reais:
 *   GET /events/live/        -> { count, events: [...] }
 *   GET /events/             -> { count, next, previous, results: [...] }  (paginação DRF, limit/offset)
 *   GET /events/?status=finished
 *   GET /events/{id}/        -> evento detalhado
 *
 * Cada evento traz: id, league_id, season_id, home_team_id/home_team, away_team_id/away_team,
 * event_date (ISO UTC), status, period, current_minute, home_score/away_score,
 * home_score_ht/away_score_ht, round_label, stage_name, weather e head_to_head.
 *
 * A chave é enviada apenas no backend (header Authorization: Token <chave>).
 */

const CACHE_TTL = {
  live: 30_000,
  fixtures: 5 * 60_000,
  statistics: 60_000,
  events: 120_000,
  lineups: 10 * 60_000,
  injuries: 30 * 60_000,
  odds: 5 * 60_000,
  teamMatches: 6 * 60 * 60_000,
  headToHead: 12 * 60 * 60_000,
  leagues: 24 * 60 * 60_000,
};

const PAGE_SIZE = 100;

function baseUrl() {
  return (config.apiBaseUrl || 'https://sports.bzzoiro.com/api/v2').replace(/\/+$/, '');
}

function requestHeaders() {
  const header = config.apiKeyHeader || 'Authorization';
  if (header.toLowerCase() === 'authorization') {
    return { Authorization: `Token ${config.apiKey}` };
  }
  return { [header]: config.apiKey };
}

async function call(path, { cacheKey, ttlMs } = {}) {
  const result = await providerRequest(`${baseUrl()}${path}`, {
    headers: requestHeaders(),
    cacheKey: cacheKey ? `bz:${cacheKey}` : null,
    ttlMs,
  });
  const payload = result.data ?? {};
  if (payload && payload.error) {
    throw new ProviderError(`Bzzoiro retornou erro: ${payload.detail ?? payload.error}`, {
      status: Number(payload.status) || 400,
      retryable: false,
    });
  }
  return { ...result, payload };
}

export function normalizeStatus(rawStatus, period) {
  const value = String(rawStatus || '').toLowerCase().trim();
  const half = String(period || '').toLowerCase().trim();
  if (['notstarted', 'not_started', 'scheduled', 'tbd', 'fixture'].includes(value)) return 'SCHEDULED';
  if (['finished', 'ft', 'ended', 'afterpenalties', 'after_penalties', 'aet', 'fulltime'].includes(value)) {
    return 'FINISHED';
  }
  if (['halftime', 'half_time', 'half-time', 'ht'].includes(value) || half === 'halftime') return 'HT';
  if (['live', 'inplay', 'in_play', '1h', '2h', 'playing', 'extra_time', 'penalties', 'suspended', 'interrupted'].includes(value)) {
    return 'LIVE';
  }
  if (['postponed', 'pst', 'delayed'].includes(value)) return 'POSTPONED';
  if (['cancelled', 'canceled', 'abandoned', 'awarded', 'walkover'].includes(value)) return 'CANCELLED';
  return value ? 'UNKNOWN' : 'SCHEDULED';
}

const STAT_ALIASES = {
  corners: 'corners',
  corner_kicks: 'corners',
  total_corners: 'corners',
  corners_total: 'corners',
  shots: 'shots',
  total_shots: 'shots',
  shots_total: 'shots',
  shots_on_goal: 'shotsOn',
  shots_on_target: 'shotsOn',
  shotsontarget: 'shotsOn',
  possession: 'possession',
  ball_possession: 'possession',
  possession_pct: 'possession',
  yellow_cards: 'yellowCards',
  yellowcards: 'yellowCards',
  cards_yellow: 'yellowCards',
  red_cards: 'redCards',
  redcards: 'redCards',
  passes: 'passes',
  total_passes: 'passes',
  xg: 'xg',
  expected_goals: 'xg',
  dangerous_attacks: 'dangerousAttacks',
  dangerousattacks: 'dangerousAttacks',
  attacks: 'attacks',
  total_attacks: 'attacks',
  fouls: 'fouls',
  offsides: 'offsides',
  saves: 'saves',
  shots_off_goal: 'shotsOff',
  shots_off_target: 'shotsOff',
  blocked_shots: 'shotsBlocked',
  yellow_red_cards: 'yellowRedCards',
  goalkeeper_saves: 'saves',
};

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.endsWith('%')) {
    const pct = Number(text.slice(0, -1));
    return Number.isFinite(pct) ? pct : null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function statEntry(teamId, source) {
  const stats = {};
  for (const [key, value] of Object.entries(source || {})) {
    const mapped = STAT_ALIASES[key.toLowerCase()];
    if (!mapped) continue;
    const parsed = numeric(value);
    if (parsed === null) continue;
    stats[mapped] = parsed;
  }
  return Object.keys(stats).length ? { teamId, stats } : null;
}

/**
 * Normaliza estatísticas aceitando os formatos que a API expõe (lista por equipe
 * ou objeto com estatísticas dentro de cada equipe). Nunca inventa valores:
 * apenas campos numéricos realmente presentes na resposta.
 */
export function normalizeStatistics(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.statistics)
        ? payload.statistics
        : payload && typeof payload === 'object'
          ? Object.entries(payload).map(([key, value]) => ({ team_id: key, ...(value || {}) }))
          : [];

  const byTeam = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const teamId = String(row.team_id ?? row.teamId ?? row.team?.id ?? row.id ?? '');
    if (!teamId) continue;
    const source = row.statistics ?? row.stats ?? row;
    const entry = statEntry(teamId, source);
    if (entry) byTeam[teamId] = entry.stats;
  }
  return byTeam;
}

const leagueNames = new Map();
let leaguesLoadedAt = 0;

/**
 * Nomes das competições. Os eventos trazem apenas `league_id`, então o mapa é
 * carregado de /leagues/ e mantido em cache (24h) — sem inventar nomes.
 */
export async function loadLeagueNames({ force = false } = {}) {
  if (!force && leagueNames.size && Date.now() - leaguesLoadedAt < CACHE_TTL.leagues) return leagueNames;
  try {
    const result = await collectPages(
      async (page) => {
        const offset = (page - 1) * PAGE_SIZE;
        const response = await call(`/leagues/?limit=${PAGE_SIZE}&offset=${offset}`, {
          cacheKey: `leagues:${offset}`,
          ttlMs: CACHE_TTL.leagues,
        });
        const payload = response.payload ?? {};
        const rows = payload.results ?? payload.leagues ?? [];
        const count = Number(payload.count) || 0;
        return {
          items: rows,
          payload: { paging: { current: page, total: Math.max(1, Math.ceil(count / PAGE_SIZE)) } },
        };
      },
      { maxPages: Math.max(1, config.maxPages) },
    );
    for (const league of result.items) {
      const id = league?.id ?? league?.league_id;
      const name = league?.name ?? league?.league_name ?? league?.title;
      if (id != null && name) leagueNames.set(String(id), name);
    }
    leaguesLoadedAt = Date.now();
  } catch {
    // Sem o mapa, a competição fica identificada pelo id — nunca por um nome inventado.
  }
  return leagueNames;
}

export function normalizeEvent(item, { leagueMap = leagueNames } = {}) {
  const leagueId = item?.league_id ?? item?.league?.id ?? null;
  const leagueName =
    item?.league?.name ??
    item?.league_name ??
    (leagueId != null ? leagueMap.get(String(leagueId)) : null) ??
    (leagueId != null ? `Liga ${leagueId}` : null);
  const homeId = item?.home_team_id ?? item?.home?.id ?? null;
  const awayId = item?.away_team_id ?? item?.away?.id ?? null;
  const kickoff = item?.event_date ?? item?.kickoff ?? null;

  return {
    providerId: item?.id != null ? String(item.id) : '',
    competition: {
      providerId: leagueId != null ? String(leagueId) : '',
      name: leagueName,
      country: item?.country ?? item?.league?.country ?? null,
      season: item?.season_id != null ? String(item.season_id) : null,
    },
    home: {
      providerId: homeId != null ? String(homeId) : '',
      name: item?.home_team ?? item?.home?.name ?? null,
      logo: item?.home_logo ?? item?.home?.logo ?? null,
    },
    away: {
      providerId: awayId != null ? String(awayId) : '',
      name: item?.away_team ?? item?.away?.name ?? null,
      logo: item?.away_logo ?? item?.away?.logo ?? null,
    },
    kickoffUtc: kickoff ? new Date(kickoff).toISOString() : null,
    status: normalizeStatus(item?.status, item?.period),
    statusRaw: item?.status ?? null,
    minute: item?.current_minute ?? null,
    period: item?.period ?? null,
    round: item?.round_label ?? item?.round_name ?? null,
    stage: item?.stage_name ?? item?.stage ?? null,
    score: {
      home: item?.home_score ?? null,
      away: item?.away_score ?? null,
      htHome: item?.home_score_ht ?? null,
      htAway: item?.away_score_ht ?? null,
    },
    venueId: item?.venue_id ?? null,
    weather: item?.weather ?? null,
    hasXg: Boolean(item?.has_xg),
    stats: null,
    odds: null,
    lineups: null,
    source: 'bzzoiro',
  };
}

/** Histórico de confrontos já embutido no evento (sem requisição extra). */
export function normalizeHeadToHead(headToHead) {
  const recent = Array.isArray(headToHead?.recent_matches) ? headToHead.recent_matches : [];
  return recent
    .map((match) => ({
      providerId: match?.event_id != null ? String(match.event_id) : '',
      competition: { providerId: '', name: null, country: null, season: null },
      home: { providerId: String(match?.home_team_id ?? ''), name: match?.home ?? null, logo: null },
      away: { providerId: String(match?.away_team_id ?? ''), name: match?.away ?? null, logo: null },
      kickoffUtc: match?.date ? new Date(match.date).toISOString() : null,
      status: 'FINISHED',
      statusRaw: 'finished',
      minute: null,
      score: { home: match?.home_score ?? null, away: match?.away_score ?? null, htHome: null, htAway: null },
      stats: null,
      odds: null,
      lineups: null,
      source: 'bzzoiro',
    }))
    .filter((match) => match.kickoffUtc && match.home.name && match.away.name);
}

function usable(fixture) {
  return Boolean(fixture?.providerId && fixture?.home?.providerId && fixture?.away?.providerId && fixture.kickoffUtc);
}

/**
 * Coleta TODAS as páginas de uma consulta de eventos (paginação DRF por
 * limit/offset). Nenhuma liga é filtrada e nenhuma página é descartada: se uma
 * página falhar, as anteriores são mantidas e o resultado é marcado como parcial.
 */
async function collectEvents(path, { cachePrefix, ttlMs, pageSize = PAGE_SIZE, maxPages } = {}) {
  const leagueMap = await loadLeagueNames();
  const separator = path.includes('?') ? '&' : '?';
  let stale = false;
  let fetchedAt = null;

  const result = await collectPages(
    async (page) => {
      const offset = (page - 1) * pageSize;
      const response = await call(`${path}${separator}limit=${pageSize}&offset=${offset}`, {
        cacheKey: `${cachePrefix}:o${offset}`,
        ttlMs,
      });
      stale = stale || Boolean(response.stale);
      fetchedAt = response.fetchedAt ?? fetchedAt;
      const payload = response.payload ?? {};
      const rows = payload.results ?? payload.events ?? [];
      const count = Number(payload.count) || rows.length;
      const total = Math.max(1, Math.ceil(count / pageSize));
      return {
        items: rows.map((row) => normalizeEvent(row, { leagueMap })).filter(usable),
        payload: { paging: { current: page, total } },
      };
    },
    { maxPages: Math.max(1, maxPages ?? config.maxPages) },
  );

  const leagues = new Set();
  for (const item of result.items) {
    const key = item.competition?.providerId ?? item.competition?.name;
    if (key) leagues.add(String(key));
  }

  return {
    fixtures: result.items,
    pages: result.pages.length,
    totalPages: result.totalPages,
    partial: result.partial,
    error: result.error,
    leagues: leagues.size,
    stale,
    fetchedAt,
  };
}

export const bzzoiroProvider = {
  id: 'bzzoiro',
  label: 'Bzzoiro Sports API (v2)',
  get configured() {
    return Boolean(config.apiKey && config.apiKey.length >= 8);
  },
  capabilities: {
    statistics: true,
    odds: false,
    lineups: true,
    injuries: true,
    halftimeCorners: false,
  },

  async fetchLiveFixtures() {
    const leagueMap = await loadLeagueNames();
    const { payload, stale, fetchedAt } = await call('/events/live/', {
      cacheKey: 'live',
      ttlMs: CACHE_TTL.live,
    });
    const rows = payload.events ?? payload.results ?? [];
    const fixtures = rows.map((row) => normalizeEvent(row, { leagueMap })).filter(usable);
    const leagues = new Set(fixtures.map((f) => f.competition?.providerId).filter(Boolean));
    return {
      fixtures,
      pages: 1,
      totalPages: 1,
      partial: false,
      error: null,
      leagues: leagues.size,
      stale,
      fetchedAt,
    };
  },

  async fetchFixturesByDate(dateIso) {
    const date = dateIso.slice(0, 10);
    return collectEvents(`/events/?date=${date}`, {
      cachePrefix: `date:${date}`,
      ttlMs: CACHE_TTL.fixtures,
    });
  },

  async fetchFixtureStatistics(fixtureId, teams = {}) {
    const { payload, stale, fetchedAt } = await call(`/events/${fixtureId}/stats/`, {
      cacheKey: `stats:${fixtureId}`,
      ttlMs: CACHE_TTL.statistics,
    });
    // A API devolve { event_id, stats: { home: {...}, away: {...} } }.
    // As chaves são trocadas pelos ids reais das equipes quando conhecidos.
    const raw = normalizeStatistics(payload?.stats ?? payload);
    const statsByTeam = {};
    if (raw.home && teams.homeId) statsByTeam[String(teams.homeId)] = raw.home;
    if (raw.away && teams.awayId) statsByTeam[String(teams.awayId)] = raw.away;
    if (!Object.keys(statsByTeam).length) {
      if (raw.home) statsByTeam.home = raw.home;
      if (raw.away) statsByTeam.away = raw.away;
    }
    return { statsByTeam, stale, fetchedAt, raw };
  },

  async fetchFixtureEvents(fixtureId) {
    const { payload } = await call(`/events/${fixtureId}/incidents/`, {
      cacheKey: `events:${fixtureId}`,
      ttlMs: CACHE_TTL.events,
    });
    return payload.results ?? payload.incidents ?? [];
  },

  async fetchLineups(fixtureId) {
    try {
      const { payload } = await call(`/events/${fixtureId}/lineups/`, {
        cacheKey: `lineups:${fixtureId}`,
        ttlMs: CACHE_TTL.lineups,
      });
      return normalizeLineups(payload);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return null;
      throw error;
    }
  },

  async fetchInjuries(fixtureId) {
    try {
      const { payload } = await call(`/events/${fixtureId}/injuries/`, {
        cacheKey: `injuries:${fixtureId}`,
        ttlMs: CACHE_TTL.injuries,
      });
      return normalizeInjuries(payload);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return [];
      throw error;
    }
  },

  async fetchOdds() {
    // A Bzzoiro não expõe odds; a análise mostra a odd justa e sinaliza a ausência
    // de odd de mercado em vez de inventar um preço.
    return { odds: [], stale: false };
  },

  async fetchTeamMatches(teamId, last = 10) {
    const result = await collectEvents(
      `/events/?team_id=${encodeURIComponent(teamId)}&status=finished`,
      { cachePrefix: `team:${teamId}`, ttlMs: CACHE_TTL.teamMatches, pageSize: Math.max(10, last), maxPages: 1 },
    );
    return result.fixtures
      .sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc))
      .slice(0, last);
  },

  async fetchHeadToHead(homeId, awayId, last = 10) {
    const leagueMap = await loadLeagueNames();
    const { payload } = await call(`/events/?home_team_id=${encodeURIComponent(homeId)}&away_team_id=${encodeURIComponent(awayId)}&limit=${last}`, {
      cacheKey: `h2h:${homeId}:${awayId}:${last}`,
      ttlMs: CACHE_TTL.headToHead,
    });
    const rows = payload.results ?? [];
    if (rows.length) {
      return rows.map((row) => normalizeEvent(row, { leagueMap })).filter(usable);
    }
    return normalizeHeadToHead(payload?.head_to_head);
  },
};

export function normalizeLineups(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.lineups)
        ? payload.lineups
        : [];
  if (rows.length < 2) return null;
  const map = {};
  for (const team of rows) {
    const teamId = String(team?.team_id ?? team?.team?.id ?? team?.id ?? '');
    if (!teamId) continue;
    const players = team?.players ?? team?.start_xi ?? team?.startXI ?? [];
    map[teamId] = {
      teamName: team?.team_name ?? team?.team?.name ?? null,
      formation: team?.formation ?? null,
      coach: team?.coach ?? team?.coach_name ?? null,
      startXI: (Array.isArray(players) ? players : []).map((entry) => ({
        name: entry?.name ?? entry?.player?.name ?? null,
        position: entry?.position ?? entry?.player?.position ?? null,
        number: entry?.number ?? entry?.shirt_number ?? null,
      })),
      substitutes: (team?.substitutes ?? team?.bench ?? []).map((entry) => ({
        name: entry?.name ?? entry?.player?.name ?? null,
        position: entry?.position ?? entry?.player?.position ?? null,
      })),
    };
  }
  const [homeId, awayId] = Object.keys(map);
  if (!homeId || !awayId) return null;
  return { [homeId]: map[homeId], [awayId]: map[awayId] };
}

export function normalizeInjuries(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.injuries)
        ? payload.injuries
        : [];
  return rows
    .map((item) => ({
      teamId: String(item?.team_id ?? item?.team?.id ?? ''),
      teamName: item?.team_name ?? item?.team?.name ?? null,
      playerName: item?.player_name ?? item?.player?.name ?? item?.name ?? null,
      type: item?.type ?? item?.status ?? null,
      reason: item?.reason ?? item?.description ?? null,
    }))
    .filter((entry) => entry.teamId && entry.playerName);
}
