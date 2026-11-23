import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeFixture } from '../server/analysis/engine.js';
import { ENTRY } from '../server/analysis/markets.js';
import { blendProfiles, buildProfile, estimateLambdas } from '../server/analysis/profile.js';

/**
 * Dados SINTÉTICOS de teste (não representam partidas reais).
 * Servem apenas para validar a matemática e o bloqueio por dados insuficientes.
 */
function syntheticRows({ goalsFor = 1.6, goalsAgainst = 1.0, isHome = 1, corners = 5, matches = 10 }) {
  return Array.from({ length: matches }, (_, index) => ({
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    is_home: isHome,
    corners_for: corners,
    corners_against: corners - 1,
    ht_goals_for: 0.7,
    ht_corners_for: 2,
    shots_for: 13,
    shots_against: 10,
    shots_on_for: 5,
    possession: 52,
    kickoff_utc: new Date(Date.now() - (index + 1) * 7 * 86400000).toISOString(),
  }));
}

const baseline = { homeGoals: 1.55, awayGoals: 1.2, cornersPerTeam: 5.1, htGoalsPerMatch: 1.15, matches: 40, source: 'test' };

const fixture = {
  id: 1,
  provider_id: 'test-fixture',
  status: 'SCHEDULED',
  minute: null,
  home_goals: null,
  away_goals: null,
  home_corners: null,
  away_corners: null,
  ht_home_goals: null,
  ht_away_goals: null,
  home_shots: null,
  away_shots: null,
  home_dangerous_attacks: null,
  away_dangerous_attacks: null,
  home_possession: null,
  away_possession: null,
};

function profiles() {
  const homeShort = buildProfile(syntheticRows({ goalsFor: 1.9, goalsAgainst: 0.8, isHome: 1 }), { window: 5 });
  const homeLong = buildProfile(syntheticRows({ goalsFor: 1.7, goalsAgainst: 0.95, isHome: 1 }), { window: 10 });
  const awayShort = buildProfile(syntheticRows({ goalsFor: 1.1, goalsAgainst: 1.3, isHome: 0 }), { window: 5 });
  const awayLong = buildProfile(syntheticRows({ goalsFor: 1.2, goalsAgainst: 1.25, isHome: 0 }), { window: 10 });
  return { homeProfile: blendProfiles(homeShort, homeLong), awayProfile: blendProfiles(awayShort, awayLong) };
}

test('Perfis combinam janelas de 5 e 10 jogos e calculam forma', () => {
  const { homeProfile } = profiles();
  assert.equal(homeProfile.matches, 10);
  assert.ok(homeProfile.goalsFor > 1.5);
  assert.ok(homeProfile.cornersFor > 4);
  assert.equal(homeProfile.form.wins + homeProfile.form.draws + homeProfile.form.losses, 5);
});

test('Lambdas usam força ofensiva/defensiva e respeitam a média da liga', () => {
  const { homeProfile, awayProfile } = profiles();
  const lambdas = estimateLambdas({ homeProfile, awayProfile, baseline });
  assert.ok(lambdas);
  assert.ok(lambdas.home > 0 && lambdas.home < 6);
  assert.ok(lambdas.away > 0 && lambdas.away < 6);
  assert.ok(lambdas.home > lambdas.away, 'mandante mais forte deve ter lambda maior');
  assert.ok(lambdas.cornersHome > 0 && lambdas.cornersTotal > 0);
});

test('Sem odds reais o motor não recomenda nada (nunca inventa odd)', () => {
  const { homeProfile, awayProfile } = profiles();
  const analysis = analyzeFixture({
    fixture,
    homeProfile,
    awayProfile,
    baseline,
    h2h: null,
    odds: [],
    lineups: null,
    injuries: [],
    filters: { minOdd: 1.5, preferredMinOdd: 1.5, preferredMaxOdd: 1.8, minEdge: 0.03, minConfidence: 'MODERADA' },
    freshness: { stale: false, ageMs: 1000 },
  });
  assert.ok(analysis.markets.length > 10);
  assert.equal(analysis.recommended.length, 0);
  assert.ok(analysis.noEntryReasons.some((reason) => /odd/i.test(reason)));
  for (const market of analysis.markets) {
    assert.equal(market.entry, ENTRY.NO_ENTRY);
    assert.ok(market.probability >= 0 && market.probability <= 1);
    assert.ok(market.fairOdds === null || market.fairOdds >= 1);
    assert.equal(market.bookmakerOdds, null);
  }
});

test('Dados desatualizados bloqueiam todas as recomendações', () => {
  const { homeProfile, awayProfile } = profiles();
  const analysis = analyzeFixture({
    fixture: { ...fixture, status: 'LIVE', minute: 63, home_goals: 1, away_goals: 0, home_corners: 4, away_corners: 3 },
    homeProfile,
    awayProfile,
    baseline,
    odds: [],
    filters: { minOdd: 1.5, preferredMinOdd: 1.5, preferredMaxOdd: 1.8, minEdge: 0.03, minConfidence: 'MODERADA' },
    freshness: { stale: true, ageMs: 9_000_000, limitMs: 240_000 },
  });
  assert.equal(analysis.blocked, true);
  assert.equal(analysis.recommended.length, 0);
  assert.ok(analysis.noEntryReasons.length > 0);
});

test('Mercados exigidos existem: gols, escanteios e resultados', () => {
  const { homeProfile, awayProfile } = profiles();
  const analysis = analyzeFixture({
    fixture,
    homeProfile,
    awayProfile,
    baseline,
    odds: [],
    filters: { minOdd: 1.5, preferredMinOdd: 1.5, preferredMaxOdd: 1.8, minEdge: 0.03, minConfidence: 'MODERADA' },
    freshness: { stale: false, ageMs: 1000 },
  });
  const keys = analysis.markets.map((market) => market.marketKey);
  for (const expected of ['over', 'under']) {
    assert.ok(keys.some((key) => key.includes(expected)), `mercado ${expected} ausente`);
  }
  assert.ok(keys.some((key) => key.includes('1x2')));
  assert.ok(keys.some((key) => key.includes('btts')));
  assert.ok(keys.some((key) => key.includes('double_chance')));
  assert.ok(analysis.markets.some((market) => market.group === 'ESCANTEIO'));
  assert.ok(analysis.markets.some((market) => market.group === 'GOLS' && market.period === '1H'));
});
