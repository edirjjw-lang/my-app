import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Banco temporário: o adaptador lê ids de equipes do banco ao aplicar estatísticas.
process.env.DB_PATH = path.join(os.tmpdir(), `bz-test-${process.pid}.db`);
process.env.FOOTBALL_API_KEY = 'chave-de-teste-1234567890';
process.env.FOOTBALL_API_PROVIDER = 'bzzoiro';

const { normalizeEvent, normalizeStatistics, normalizeStatus, normalizeHeadToHead, bzzoiroProvider } =
  await import('../server/provider/bzzoiro.js');

// Evento real de /api/v2/events/603182/ (campos exatamente como a API devolve).
const REAL_EVENT = {
  id: 603182,
  league_id: 95,
  season_id: 1080,
  home_team_id: 718,
  home_team: 'JD Lajense',
  away_team_id: 2249,
  away_team: 'GD Portel',
  event_date: '2026-11-28T15:00:00+00:00',
  status: 'finished',
  period: '',
  current_minute: 90,
  home_score: 2,
  away_score: 1,
  home_score_ht: 1,
  away_score_ht: 0,
  round_label: 'Round 3',
  stage_name: 'Regular Season',
  has_xg: true,
};

test('normalizeStatus traduz os status reais da Bzzoiro', () => {
  assert.equal(normalizeStatus('notstarted'), 'SCHEDULED');
  assert.equal(normalizeStatus('finished'), 'FINISHED');
  assert.equal(normalizeStatus('live'), 'LIVE');
  assert.equal(normalizeStatus('inplay'), 'LIVE');
  assert.equal(normalizeStatus('halftime'), 'HT');
  assert.equal(normalizeStatus('', 'halftime'), 'HT');
  assert.equal(normalizeStatus('postponed'), 'POSTPONED');
  assert.equal(normalizeStatus('cancelled'), 'CANCELLED');
  assert.equal(normalizeStatus(''), 'SCHEDULED');
});

test('normalizeEvent converte o evento real da Bzzoiro no formato do app', () => {
  const fixture = normalizeEvent(REAL_EVENT);
  assert.equal(fixture.providerId, '603182');
  assert.equal(fixture.competition.providerId, '95');
  assert.equal(fixture.competition.season, '1080');
  assert.equal(fixture.home.providerId, '718');
  assert.equal(fixture.home.name, 'JD Lajense');
  assert.equal(fixture.away.providerId, '2249');
  assert.equal(fixture.away.name, 'GD Portel');
  assert.equal(fixture.kickoffUtc, '2026-11-28T15:00:00.000Z');
  assert.equal(fixture.status, 'FINISHED');
  assert.equal(fixture.minute, 90);
  assert.equal(fixture.score.home, 2);
  assert.equal(fixture.score.away, 1);
  assert.equal(fixture.score.htHome, 1);
  assert.equal(fixture.score.htAway, 0);
  assert.equal(fixture.hasXg, true);
  assert.equal(fixture.source, 'bzzoiro');
  // Sem o mapa de ligas o nome é identificado pelo id — nunca inventado.
  assert.equal(fixture.competition.name, 'Liga 95');
});

test('normalizeEvent usa o nome real da competição quando o mapa está carregado', () => {
  const leagueMap = new Map([['95', 'Campeonato de Portugal']]);
  const fixture = normalizeEvent(REAL_EVENT, { leagueMap });
  assert.equal(fixture.competition.name, 'Campeonato de Portugal');
});

test('normalizeStatistics lê o formato real {home:{...}, away:{...}}', () => {
  // Resposta real de /api/v2/events/603182/stats/ (campos relevantes).
  const payload = {
    event_id: 603182,
    stats: {
      home: {
        corner_kicks: 8,
        total_shots: 8,
        shots_on_target: 4,
        ball_possession: 55,
        yellow_cards: 2,
        red_cards: 0,
        passes: 269,
        expected_goals: 1.61,
        xg: { actual: 1.61, estimated: false },
        crosses: { value: 1, total: 10, pct: 10 },
      },
      away: {
        corner_kicks: 3,
        total_shots: 6,
        shots_on_target: 2,
        ball_possession: 45,
        yellow_cards: 3,
        red_cards: 1,
        passes: 217,
        expected_goals: 0.8,
      },
    },
  };
  const byTeam = normalizeStatistics(payload.stats);
  assert.deepEqual(byTeam.home, {
    corners: 8,
    shots: 8,
    shotsOn: 4,
    possession: 55,
    yellowCards: 2,
    redCards: 0,
    passes: 269,
    xg: 1.61,
  });
  assert.deepEqual(byTeam.away, {
    corners: 3,
    shots: 6,
    shotsOn: 2,
    possession: 45,
    yellowCards: 3,
    redCards: 1,
    passes: 217,
    xg: 0.8,
  });
});

test('normalizeStatistics não inventa estatística ausente', () => {
  const byTeam = normalizeStatistics({ home: { corner_kicks: null, unknown_stat: 9 }, away: {} });
  assert.deepEqual(byTeam, {});
});

test('normalizeHeadToHead descarta confrontos sem placar ou data', () => {
  const h2h = normalizeHeadToHead({
    recent_matches: [
      { event_id: 1, home_team_id: 718, away_team_id: 2249, home: 'JD Lajense', away: 'GD Portel', date: '2026-01-10T15:00:00Z', home_score: 1, away_score: 1 },
      { event_id: 2, home: 'Sem data', away: 'GD Portel', home_score: 0, away_score: 2 },
    ],
  });
  assert.equal(h2h.length, 1);
  assert.equal(h2h[0].providerId, '1');
  assert.equal(h2h[0].score.home, 1);
  assert.equal(h2h[0].status, 'FINISHED');
});

test('a coleta percorre todas as páginas DRF (limit/offset) sem perder jogos', async () => {
  const total = 150;
  const events = Array.from({ length: total }, (_, index) => ({
    ...REAL_EVENT,
    id: 700000 + index,
    league_id: index % 2 === 0 ? 95 : 96,
    home_team_id: 1000 + index,
    away_team_id: 2000 + index,
    home_team: `Casa ${index}`,
    away_team: `Fora ${index}`,
  }));

  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    seen.push(target);
    if (target.includes('/leagues/')) {
      return new Response(JSON.stringify({ count: 0, next: null, results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const offset = Number(new URL(target).searchParams.get('offset') ?? 0);
    const limit = Number(new URL(target).searchParams.get('limit') ?? 100);
    const page = events.slice(offset, offset + limit);
    return new Response(
      JSON.stringify({
        count: total,
        next: offset + limit < total ? `next-${offset + limit}` : null,
        previous: null,
        results: page,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const result = await bzzoiroProvider.fetchFixturesByDate('2026-11-28');
    assert.equal(result.partial, false);
    assert.equal(result.fixtures.length, total, 'todos os jogos das duas páginas devem ser mantidos');
    assert.equal(result.pages, 2);
    assert.equal(result.leagues, 2, 'as duas ligas retornadas devem aparecer');
    assert.equal(new Set(result.fixtures.map((f) => f.providerId)).size, total, 'sem duplicatas');
    const eventCalls = seen.filter((u) => u.includes('/events/'));
    assert.equal(eventCalls.length, 2, 'uma requisição por página, sem repetição');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
