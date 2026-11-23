import { config } from '../config.js';
import { ProviderError, providerRequest } from './http.js';

const LIVE_CODES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP']);
const FINISHED_CODES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
const SCHEDULED_CODES = new Set(['NS', 'TBD']);
const POSTPONED_CODES = new Set(['PST', 'SUSP']);
const CANCELLED_CODES = new Set(['CANC', 'ABD']);

const CACHE_TTL = {
  live: 45_000,
  fixtures: 10 * 60_000,
  statistics: 90_000,
  events: 120_000,
  lineups: 10 * 60_000,
  injuries: 30 * 60_000,
  odds: 5 * 60_000,
  teamMatches: 6 * 60 * 60_000,
  headToHead: 12 * 60 * 60_000,
};

function baseUrl() {
  return (config.apiBaseUrl || 'https://v3.football.api-sports.io').replace(/\/+$/, '');
}

function requestHeaders() {
  if (config.apiHost) {
    return { 'x-rapidapi-key': config.apiKey, 'x-rapidapi-host': config.apiHost };
  }
  if (config.apiKeyHeader) {
    return { [config.apiKeyHeader]: config.apiKey };
  }
  return { 'x-apisports-key': config.apiKey };
}

async function call(path, { cacheKey, ttlMs }) {
  const result = await providerRequest(`${baseUrl()}${path}`, {
    headers: requestHeaders(),
    cacheKey: cacheKey ? `af:${cacheKey}` : null,
    ttlMs,
  });
  const payload = result.data ?? {};
  const errors = payload.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : Boolean(errors && typeof errors === 'object' && Object.keys(errors).length > 0);
  if (hasErrors) {
    const message = Array.isArray(errors) ? errors.join('; ') : Object.values(errors).join('; ');
    throw new ProviderError(`API-Football retornou erro: ${message}`, { status: 400, retryable: false });
  }
  return { ...result, payload };
}

export function normalizeStatus(shortCode) {
  const code = String(shortCode || '').toUpperCase();
  if (FINISHED_CODES.has(code)) return 'FINISHED';
  if (code === 'HT') return 'HT';
  if (LIVE_CODES.has(code)) return 'LIVE';
  if (SCHEDULED_CODES.has(code)) return 'SCHEDULED';
  if (POSTPONED_CODES.has(code)) return 'POSTPONED';
  if (CANCELLED_CODES.has(code)) return 'CANCELLED';
  return 'UNKNOWN';
}

export function parseStatValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.endsWith('%')) {
    const pct = Number(text.slice(0, -1));
    return Number.isFinite(pct) ? pct : null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeStatistics(entries) {
  const byTeam = {};
  for (const entry of entries || []) {
    const teamId = String(entry?.team?.id ?? '');
    if (!teamId) continue;
    const stats = {};
    for (const stat of entry.statistics || []) {
      const type = String(stat?.type || '').toLowerCase();
      const value = parseStatValue(stat?.value);
      if (value === null) continue;
      if (type === 'corner kicks') stats.corners = value;
      else if (type === 'total shots') stats.shots = value;
      else if (type === 'shots on goal') stats.shotsOn = value;
      else if (type === 'ball possession') stats.possession = value;
      else if (type === 'yellow cards') stats.yellowCards = value;
      else if (type === 'red cards') stats.redCards = value;
      else if (type === 'total passes') stats.passes = value;
      else if (type === 'expected_goals') stats.xg = value;
      else if (type === 'dangerous attacks') stats.dangerousAttacks = value;
    }
    byTeam[teamId] = stats;
  }
  return byTeam;
}

export function normalizeFixture(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const teams = item.teams || {};
  const goals = item.goals || {};
  const score = item.score || {};
  const statusShort = fixture.status?.short ?? null;
  return {
    providerId: String(fixture.id ?? ''),
    competition: {
      providerId: league.id != null ? String(league.id) : '',
      name: league.name ?? null,
      country: league.country ?? null,
      season: league.season != null ? String(league.season) : null,
    },
    home: {
      providerId: String(teams.home?.id ?? ''),
      name: teams.home?.name ?? null,
      logo: teams.home?.logo ?? null,
    },
    away: {
      providerId: String(teams.away?.id ?? ''),
      name: teams.away?.name ?? null,
      logo: teams.away?.logo ?? null,
    },
    kickoffUtc: fixture.date ? new Date(fixture.date).toISOString() : null,
    status: normalizeStatus(statusShort),
    statusRaw: statusShort,
    minute: fixture.status?.elapsed ?? null,
    score: {
      home: goals.home ?? null,
      away: goals.away ?? null,
      htHome: score.halftime?.home ?? null,
      htAway: score.halftime?.away ?? null,
    },
    stats: null,
    odds: null,
    lineups: null,
    source: 'api-football',
  };
}

const MARKET_ALIASES = {
  'match winner': '1x2',
  '1x2': '1x2',
  'double chance': 'double_chance',
  'both teams score': 'btts',
  'both teams to score': 'btts',
  'draw no bet': 'draw_no_bet',
  'goals over/under': 'goals_total',
  'total goals': 'goals_total',
  'goals 1st half': 'goals_1h',
  '1st half goals': 'goals_1h',
  'goals 2nd half': 'goals_2h',
  '2nd half goals': 'goals_2h',
  'corners over under': 'corners_total',
  'total corners': 'corners_total',
  'corners 1st half': 'corners_1h',
  '1st half corners': 'corners_1h',
  'home team corners': 'corners_home',
  'away team corners': 'corners_away',
};

const SELECTION_ALIASES = {
  home: 'home',
  '1': 'home',
  draw: 'draw',
  x: 'draw',
  away: 'away',
  '2': 'away',
  yes: 'yes',
  no: 'no',
  'home/draw': 'home_draw',
  'home/away': 'home_away',
  'draw/away': 'draw_away',
  over: 'over',
  under: 'under',
};

/**
 * Converte as odds do provedor para o formato interno
 * { marketKey, selection, line, price, bookmaker }.
 */
export function normalizeOdds(responseItems) {
  const entries = [];
  for (const item of responseItems || []) {
    for (const bookmaker of item?.bookmakers || []) {
      for (const bet of bookmaker?.bets || []) {
        const betName = String(bet?.name || '').toLowerCase().trim();
        const market = MARKET_ALIASES[betName];
        if (!market) continue;
        for (const value of bet?.values || []) {
          const price = Number(value?.odd);
          if (!Number.isFinite(price) || price <= 1) continue;
          const rawValue = String(value?.value || '').trim();
          const lineMatch = rawValue.match(/(\d+(?:\.\d+)?)/);
          const line = lineMatch ? Number(lineMatch[1]) : null;
          const sideMatch = rawValue.match(/^(over|under|yes|no)/i);
          const side = sideMatch ? SELECTION_ALIASES[sideMatch[1].toLowerCase()] : null;

          let marketKey = null;
          let selection = null;

          if (market === '1x2') {
            const key = rawValue.toLowerCase();
            if (SELECTION_ALIASES[key] && ['home', 'draw', 'away'].includes(SELECTION_ALIASES[key])) {
              marketKey = '1x2';
              selection = SELECTION_ALIASES[key];
            }
          } else if (market === 'double_chance') {
            const key = rawValue.toLowerCase().replace(/\s+/g, '');
            const mapped = SELECTION_ALIASES[key];
            if (mapped) {
              marketKey = 'double_chance';
              selection = mapped;
            }
          } else if (market === 'draw_no_bet') {
            const key = rawValue.toLowerCase();
            if (['home', 'away'].includes(SELECTION_ALIASES[key])) {
              marketKey = 'draw_no_bet';
              selection = SELECTION_ALIASES[key];
            }
          } else if (market === 'btts') {
            const key = rawValue.toLowerCase();
            if (['yes', 'no'].includes(SELECTION_ALIASES[key])) {
              marketKey = 'btts';
              selection = SELECTION_ALIASES[key];
            }
          } else if (side && line !== null) {
            marketKey = side === 'over' ? market : `${market}_under`;
            if (market === 'goals_total') marketKey = side === 'over' ? 'goals_over' : 'goals_under';
            else if (market === 'goals_1h') marketKey = side === 'over' ? 'goals_1h_over' : 'goals_1h_under';
            else if (market === 'goals_2h') marketKey = side === 'over' ? 'goals_2h_over' : 'goals_2h_under';
            else if (market === 'corners_total') marketKey = side === 'over' ? 'corners_over' : 'corners_under';
            else if (market === 'corners_1h') marketKey = side === 'over' ? 'corners_1h_over' : 'corners_1h_under';
            else if (market === 'corners_home') marketKey = side === 'over' ? 'corners_home_over' : 'corners_home_under';
            else if (market === 'corners_away') marketKey = side === 'over' ? 'corners_away_over' : 'corners_away_under';
            selection = side;
          }

          if (!marketKey || !selection) continue;
          entries.push({
            marketKey,
            selection,
            line,
            price,
            bookmaker: bookmaker?.name ?? null,
          });
        }
      }
    }
  }
  // Melhor odd por mercado/seleção/linha (sem inventar valores).
  const best = new Map();
  for (const entry of entries) {
    const key = `${entry.marketKey}|${entry.line ?? ''}|${entry.selection}`;
    const current = best.get(key);
    if (!current || entry.price > current.price) best.set(key, entry);
  }
  return [...best.values()];
}

export function normalizeLineups(responseItems) {
  if (!Array.isArray(responseItems) || responseItems.length < 2) return null;
  const map = {};
  for (const team of responseItems) {
    const teamId = String(team?.team?.id ?? '');
    if (!teamId) continue;
    map[teamId] = {
      teamName: team?.team?.name ?? null,
      formation: team?.formation ?? null,
      coach: team?.coach?.name ?? null,
      startXI: (team?.startXI || []).map((entry) => ({
        name: entry?.player?.name ?? null,
        position: entry?.player?.pos ?? null,
        number: entry?.player?.number ?? null,
      })),
      substitutes: (team?.substitutes || []).map((entry) => ({
        name: entry?.player?.name ?? null,
        position: entry?.player?.pos ?? null,
      })),
    };
  }
  const [homeId, awayId] = Object.keys(map);
  if (!homeId || !awayId) return null;
  return { [homeId]: map[homeId], [awayId]: map[awayId] };
}

export function normalizeInjuries(responseItems) {
  return (responseItems || [])
    .map((item) => ({
      teamId: String(item?.team?.id ?? ''),
      teamName: item?.team?.name ?? null,
      playerName: item?.player?.name ?? null,
      type: item?.player?.type ?? null,
      reason: item?.player?.reason ?? null,
    }))
    .filter((entry) => entry.teamId && entry.playerName);
}

export const apiFootballProvider = {
  id: 'api-football',
  label: 'API-Football (v3)',
  // Reflete a configuração real da chave (lida apenas no backend).
  get configured() {
    return Boolean(config.apiKey && config.apiKey.length >= 8);
  },
  capabilities: {
    statistics: true,
    odds: true,
    lineups: true,
    injuries: true,
    halftimeCorners: false,
  },

  async fetchLiveFixtures() {
    const { payload, cached, stale, fetchedAt } = await call('/fixtures?live=all', {
      cacheKey: 'live',
      ttlMs: CACHE_TTL.live,
    });
    const fixtures = (payload.response || [])
      .map(normalizeFixture)
      .filter((item) => item.providerId && item.home.providerId && item.away.providerId && item.kickoffUtc);
    return { fixtures, cached, stale, fetchedAt };
  },

  async fetchFixturesByDate(dateIso) {
    const date = dateIso.slice(0, 10);
    const { payload, stale, fetchedAt } = await call(`/fixtures?date=${date}&timezone=UTC`, {
      cacheKey: `date:${date}`,
      ttlMs: CACHE_TTL.fixtures,
    });
    return {
      fixtures: (payload.response || [])
        .map(normalizeFixture)
        .filter((item) => item.providerId && item.home.providerId && item.away.providerId && item.kickoffUtc),
      stale,
      fetchedAt,
    };
  },

  async fetchFixtureStatistics(fixtureId) {
    const { payload, stale, fetchedAt } = await call(`/fixtures/statistics?fixture=${fixtureId}`, {
      cacheKey: `stats:${fixtureId}`,
      ttlMs: CACHE_TTL.statistics,
    });
    return { statsByTeam: normalizeStatistics(payload.response), stale, fetchedAt };
  },

  async fetchFixtureEvents(fixtureId) {
    const { payload } = await call(`/fixtures/events?fixture=${fixtureId}`, {
      cacheKey: `events:${fixtureId}`,
      ttlMs: CACHE_TTL.events,
    });
    return payload.response || [];
  },

  async fetchLineups(fixtureId) {
    const { payload } = await call(`/fixtures/lineups?fixture=${fixtureId}`, {
      cacheKey: `lineups:${fixtureId}`,
      ttlMs: CACHE_TTL.lineups,
    });
    return normalizeLineups(payload.response);
  },

  async fetchInjuries(fixtureId) {
    const { payload } = await call(`/injuries?fixture=${fixtureId}`, {
      cacheKey: `injuries:${fixtureId}`,
      ttlMs: CACHE_TTL.injuries,
    });
    return normalizeInjuries(payload.response);
  },

  async fetchOdds(fixtureId) {
    const { payload, stale } = await call(`/odds?fixture=${fixtureId}`, {
      cacheKey: `odds:${fixtureId}`,
      ttlMs: CACHE_TTL.odds,
    });
    return { odds: normalizeOdds(payload.response), stale };
  },

  async fetchTeamMatches(teamId, last = 10) {
    const { payload } = await call(`/fixtures?team=${teamId}&last=${last}`, {
      cacheKey: `team:${teamId}:${last}`,
      ttlMs: CACHE_TTL.teamMatches,
    });
    return (payload.response || [])
      .map(normalizeFixture)
      .filter((item) => item.providerId && item.home.providerId && item.away.providerId);
  },

  async fetchHeadToHead(homeId, awayId, last = 10) {
    const { payload } = await call(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=${last}`, {
      cacheKey: `h2h:${homeId}:${awayId}:${last}`,
      ttlMs: CACHE_TTL.headToHead,
    });
    return (payload.response || [])
      .map(normalizeFixture)
      .filter((item) => item.providerId && item.home.providerId && item.away.providerId);
  },
};
