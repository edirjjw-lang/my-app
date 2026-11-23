import { config } from '../config.js';
import { providerRequest } from './http.js';

const BASE = 'https://api.football-data.org/v4';

const CACHE_TTL = {
  live: 60_000,
  fixtures: 15 * 60_000,
  teamMatches: 6 * 60 * 60_000,
  headToHead: 12 * 60 * 60_000,
};

const STATUS_MAP = {
  SCHEDULED: 'SCHEDULED',
  TIMED: 'SCHEDULED',
  IN_PLAY: 'LIVE',
  PAUSED: 'HT',
  FINISHED: 'FINISHED',
  SUSPENDED: 'POSTPONED',
  POSTPONED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
  AWARDED: 'FINISHED',
};

async function call(path, { cacheKey, ttlMs }) {
  const result = await providerRequest(`${BASE}${path}`, {
    headers: { 'X-Auth-Token': config.apiKey },
    cacheKey: cacheKey ? `fd:${cacheKey}` : null,
    ttlMs,
  });
  return { ...result, payload: result.data ?? {} };
}

function teamRef(team) {
  return {
    providerId: team?.id != null ? String(team.id) : '',
    name: team?.name ?? team?.shortName ?? null,
    logo: team?.crest ?? null,
  };
}

export function normalizeMatch(match) {
  const full = match?.score?.fullTime || {};
  const half = match?.score?.halfTime || {};
  return {
    providerId: String(match?.id ?? ''),
    competition: {
      providerId: match?.competition?.id != null ? String(match.competition.id) : '',
      name: match?.competition?.name ?? null,
      country: match?.area?.name ?? null,
      season: match?.season?.startDate ? String(match.season.startDate).slice(0, 4) : null,
    },
    home: teamRef(match?.homeTeam),
    away: teamRef(match?.awayTeam),
    kickoffUtc: match?.utcDate ? new Date(match.utcDate).toISOString() : null,
    status: STATUS_MAP[match?.status] || 'UNKNOWN',
    statusRaw: match?.status ?? null,
    minute: Number.isFinite(match?.minute) ? match.minute : null,
    score: {
      home: full.home ?? null,
      away: full.away ?? null,
      htHome: half.home ?? null,
      htAway: half.away ?? null,
    },
    stats: null,
    odds: null,
    lineups: null,
    source: 'football-data.org',
  };
}

/**
 * Provedor alternativo. A API pública do football-data.org não fornece
 * escanteios, finalizações, posse, odds nem escalações — o app marca esses
 * dados como indisponíveis e bloqueia recomendações em vez de inventar valores.
 */
export const footballDataProvider = {
  id: 'football-data',
  label: 'football-data.org (v4)',
  capabilities: {
    statistics: false,
    odds: false,
    lineups: false,
    injuries: false,
    halftimeCorners: false,
  },

  async fetchLiveFixtures() {
    const { payload, cached, stale, fetchedAt } = await call('/matches?status=IN_PLAY,PAUSED', {
      cacheKey: 'live',
      ttlMs: CACHE_TTL.live,
    });
    return {
      fixtures: (payload.matches || []).map(normalizeMatch).filter((item) => item.providerId),
      cached,
      stale,
      fetchedAt,
    };
  },

  async fetchFixturesByDate(dateIso) {
    const date = dateIso.slice(0, 10);
    const { payload, stale, fetchedAt } = await call(`/matches?dateFrom=${date}&dateTo=${date}`, {
      cacheKey: `date:${date}`,
      ttlMs: CACHE_TTL.fixtures,
    });
    return {
      fixtures: (payload.matches || []).map(normalizeMatch).filter((item) => item.providerId),
      stale,
      fetchedAt,
    };
  },

  async fetchFixtureStatistics() {
    return { statsByTeam: {}, stale: false, fetchedAt: new Date().toISOString() };
  },

  async fetchFixtureEvents() {
    return [];
  },

  async fetchLineups() {
    return null;
  },

  async fetchInjuries() {
    return [];
  },

  async fetchOdds() {
    return { odds: [], stale: false };
  },

  async fetchTeamMatches(teamId, last = 10) {
    const { payload } = await call(`/teams/${teamId}/matches?status=FINISHED&limit=${last}`, {
      cacheKey: `team:${teamId}:${last}`,
      ttlMs: CACHE_TTL.teamMatches,
    });
    return (payload.matches || []).map(normalizeMatch).filter((item) => item.providerId);
  },

  async fetchHeadToHead(homeId, awayId, last = 10) {
    const { payload } = await call(`/teams/${homeId}/matches?status=FINISHED&limit=${last}`, {
      cacheKey: `h2h:${homeId}:${awayId}:${last}`,
      ttlMs: CACHE_TTL.headToHead,
    });
    return (payload.matches || [])
      .map(normalizeMatch)
      .filter(
        (item) =>
          item.providerId &&
          ((item.home.providerId === String(homeId) && item.away.providerId === String(awayId)) ||
            (item.home.providerId === String(awayId) && item.away.providerId === String(homeId))),
      );
  },
};
