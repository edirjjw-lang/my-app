import { standardDeviation, weightedMean } from './math.js';

export const WINDOWS = { primary: 5, secondary: 10 };
const DECAY = 0.88;
const SHRINK_MATCHES = 3;
const CLAMP_STRENGTH = [0.2, 3.5];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function weightsFor(length, decay = DECAY) {
  return Array.from({ length }, (_, index) => decay ** index);
}

/**
 * Constrói o perfil de uma equipe a partir das partidas reais armazenadas.
 * `rows` deve vir ordenado da partida mais recente para a mais antiga.
 */
export function buildProfile(rows, { window = 10 } = {}) {
  const sample = rows.slice(0, window);
  const weights = weightsFor(sample.length);
  const pick = (selector) => sample.map(selector);

  const goalsFor = pick((r) => r.goals_for);
  const goalsAgainst = pick((r) => r.goals_against);
  const cornersFor = pick((r) => r.corners_for);
  const cornersAgainst = pick((r) => r.corners_against);
  const htGoalsFor = pick((r) => r.ht_goals_for);
  const htCornersFor = pick((r) => r.ht_corners_for);

  const homeRows = sample.filter((r) => r.is_home === 1 || r.is_home === true);
  const awayRows = sample.filter((r) => r.is_home === 0 || r.is_home === false);

  const meanOrNull = (values, list = sample) =>
    list.length ? weightedMean(values, weights) : null;

  const matchesWith = (selector) => sample.filter((r) => r[selector] !== null && r[selector] !== undefined).length;

  const totals = sample
    .filter((r) => Number.isFinite(r.goals_for) && Number.isFinite(r.goals_against))
    .map((r) => r.goals_for + r.goals_against);

  const cornersSample = matchesWith('corners_for');
  const htGoalsSample = matchesWith('ht_goals_for');
  const htCornersSample = matchesWith('ht_corners_for');

  const sumGoals = goalsFor.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  const sumHtGoals = htGoalsFor.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  const sumCorners = cornersFor.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  const sumHtCorners = htCornersFor.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);

  let wins = 0;
  let draws = 0;
  let losses = 0;
  const lastFive = [];
  for (const row of sample.slice(0, 5)) {
    if (!Number.isFinite(row.goals_for) || !Number.isFinite(row.goals_against)) continue;
    if (row.goals_for > row.goals_against) {
      wins += 1;
      lastFive.push('V');
    } else if (row.goals_for === row.goals_against) {
      draws += 1;
      lastFive.push('E');
    } else {
      losses += 1;
      lastFive.push('D');
    }
  }

  return {
    matches: sample.length,
    matchesHome: homeRows.length,
    matchesAway: awayRows.length,
    goalsFor: meanOrNull(goalsFor),
    goalsAgainst: meanOrNull(goalsAgainst),
    goalsTotal: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
    goalsTotalStd: standardDeviation(totals),
    goalsForStd: standardDeviation(goalsFor),
    goalsAgainstStd: standardDeviation(goalsAgainst),
    goalsForHome: meanOrNull(homeRows.map((r) => r.goals_for), homeRows),
    goalsAgainstHome: meanOrNull(homeRows.map((r) => r.goals_against), homeRows),
    goalsForAway: meanOrNull(awayRows.map((r) => r.goals_for), awayRows),
    goalsAgainstAway: meanOrNull(awayRows.map((r) => r.goals_against), awayRows),
    cornersFor: meanOrNull(cornersFor),
    cornersAgainst: meanOrNull(cornersAgainst),
    cornersForHome: meanOrNull(homeRows.map((r) => r.corners_for), homeRows),
    cornersAgainstHome: meanOrNull(homeRows.map((r) => r.corners_against), homeRows),
    cornersForAway: meanOrNull(awayRows.map((r) => r.corners_for), awayRows),
    cornersAgainstAway: meanOrNull(awayRows.map((r) => r.corners_against), awayRows),
    cornersForStd: standardDeviation(cornersFor),
    cornersSample,
    htGoalsFor: meanOrNull(htGoalsFor),
    htGoalsSample,
    htGoalsShare: htGoalsSample >= 5 && sumGoals > 0 ? clamp(sumHtGoals / sumGoals, 0.15, 0.85) : null,
    htCornersFor: meanOrNull(htCornersFor),
    htCornersSample,
    htCornersShare:
      htCornersSample >= 5 && sumCorners > 0 ? clamp(sumHtCorners / sumCorners, 0.1, 0.9) : null,
    shotsFor: meanOrNull(pick((r) => r.shots_for)),
    shotsAgainst: meanOrNull(pick((r) => r.shots_against)),
    shotsOnFor: meanOrNull(pick((r) => r.shots_on_for)),
    possession: meanOrNull(pick((r) => r.possession)),
    form: { wins, draws, losses, points: wins * 3 + draws, lastFive },
  };
}

const RATE_KEYS = [
  'goalsFor', 'goalsAgainst', 'goalsForHome', 'goalsAgainstHome', 'goalsForAway', 'goalsAgainstAway',
  'cornersFor', 'cornersAgainst', 'cornersForHome', 'cornersAgainstHome', 'cornersForAway',
  'cornersAgainstAway', 'htGoalsFor', 'htCornersFor', 'shotsFor', 'shotsAgainst', 'shotsOnFor',
  'possession', 'goalsTotal', 'goalsTotalStd', 'goalsForStd', 'goalsAgainstStd', 'cornersForStd',
  'htGoalsShare', 'htCornersShare',
];

/**
 * Combina as janelas de 5 e 10 jogos. A janela curta recebe mais peso
 * (forma recente), a longa estabiliza a estimativa.
 */
export function blendProfiles(shortProfile, longProfile, shortWeight = 0.65) {
  const blended = {
    matches: longProfile.matches,
    matchesHome: longProfile.matchesHome,
    matchesAway: longProfile.matchesAway,
    cornersSample: Math.min(shortProfile.cornersSample, longProfile.cornersSample),
    htGoalsSample: Math.min(shortProfile.htGoalsSample, longProfile.htGoalsSample),
    htCornersSample: Math.min(shortProfile.htCornersSample, longProfile.htCornersSample),
    form: shortProfile.form,
    window: { short: shortProfile.matches, long: longProfile.matches },
  };
  for (const key of RATE_KEYS) {
    const shortValue = shortProfile[key];
    const longValue = longProfile[key];
    if (Number.isFinite(shortValue) && Number.isFinite(longValue)) {
      blended[key] = shortValue * shortWeight + longValue * (1 - shortWeight);
    } else {
      blended[key] = Number.isFinite(shortValue) ? shortValue : Number.isFinite(longValue) ? longValue : null;
    }
  }
  return blended;
}

function shrink(value, sampleSize, prior = 1, strength = SHRINK_MATCHES) {
  if (!Number.isFinite(value)) return prior;
  const n = Math.max(0, sampleSize);
  return (n * value + strength * prior) / (n + strength);
}

function shrinkToward(value, sampleSize, prior, strength = SHRINK_MATCHES) {
  if (!Number.isFinite(value)) return prior;
  if (!Number.isFinite(prior) || prior <= 0) return value;
  const n = Math.max(0, sampleSize);
  return (n * value + strength * prior) / (n + strength);
}

/**
 * Modelo de forças (ataque/defesa) com encolhimento bayesiano para amostras
 * pequenas e médias da competição como linha de base.
 */
export function estimateLambdas({ homeProfile, awayProfile, baseline }) {
  if (!baseline || !(baseline.homeGoals > 0) || !(baseline.awayGoals > 0)) return null;

  const homeAttackRaw = (homeProfile.goalsForHome ?? homeProfile.goalsFor ?? 0) / baseline.homeGoals;
  const awayDefenceRaw = (awayProfile.goalsAgainstAway ?? awayProfile.goalsAgainst ?? 0) / baseline.homeGoals;
  const awayAttackRaw = (awayProfile.goalsForAway ?? awayProfile.goalsFor ?? 0) / baseline.awayGoals;
  const homeDefenceRaw = (homeProfile.goalsAgainstHome ?? homeProfile.goalsAgainst ?? 0) / baseline.awayGoals;

  const homeSample = Math.max(1, Math.min(homeProfile.matches, homeProfile.matchesHome || homeProfile.matches));
  const awaySample = Math.max(1, Math.min(awayProfile.matches, awayProfile.matchesAway || awayProfile.matches));

  const homeAttack = clamp(shrink(homeAttackRaw, homeSample), ...CLAMP_STRENGTH);
  const awayDefence = clamp(shrink(awayDefenceRaw, awaySample), ...CLAMP_STRENGTH);
  const awayAttack = clamp(shrink(awayAttackRaw, awaySample), ...CLAMP_STRENGTH);
  const homeDefence = clamp(shrink(homeDefenceRaw, homeSample), ...CLAMP_STRENGTH);

  const home = clamp(homeAttack * awayDefence * baseline.homeGoals, 0.05, 6);
  const away = clamp(awayAttack * homeDefence * baseline.awayGoals, 0.05, 6);

  const homeCornersRaw =
    ((homeProfile.cornersForHome ?? homeProfile.cornersFor ?? 0) +
      (awayProfile.cornersAgainstAway ?? awayProfile.cornersAgainst ?? 0)) /
    2;
  const awayCornersRaw =
    ((awayProfile.cornersForAway ?? awayProfile.cornersFor ?? 0) +
      (homeProfile.cornersAgainstHome ?? homeProfile.cornersAgainst ?? 0)) /
    2;

  const cornerPrior = baseline.cornersPerTeam > 0 ? baseline.cornersPerTeam : null;
  const cornersHome = cornerPrior
    ? clamp(shrinkToward(homeCornersRaw, Math.min(homeProfile.cornersSample, awayProfile.cornersSample), cornerPrior), 0.5, 12)
    : null;
  const cornersAway = cornerPrior
    ? clamp(shrinkToward(awayCornersRaw, Math.min(homeProfile.cornersSample, awayProfile.cornersSample), cornerPrior), 0.5, 12)
    : null;

  const meanTotalCorners = cornersHome !== null && cornersAway !== null ? cornersHome + cornersAway : null;
  let cornerDispersion = Infinity;
  if (meanTotalCorners && homeProfile.cornersForStd && awayProfile.cornersForStd) {
    const variance = homeProfile.cornersForStd ** 2 + awayProfile.cornersForStd ** 2;
    if (variance > meanTotalCorners) cornerDispersion = (meanTotalCorners ** 2) / (variance - meanTotalCorners);
  }

  return {
    home,
    away,
    total: home + away,
    cornersHome,
    cornersAway,
    cornersTotal: meanTotalCorners,
    cornerDispersion,
    strength: { homeAttack, awayDefence, awayAttack, homeDefence },
    samples: { homeSample, awaySample },
  };
}

/**
 * Ajuste pequeno e limitado por histórico de confrontos diretos (máx. ±6%).
 * Só é aplicado quando existem pelo menos 3 confrontos reais.
 */
export function adjustForH2H(lambdas, h2h, baseline) {
  if (!lambdas || !h2h || h2h.matches < 3 || !baseline) return { lambdas, applied: false, delta: 0 };
  const expected = baseline.homeGoals + baseline.awayGoals;
  const observed = h2h.goalsPerMatch;
  if (!Number.isFinite(observed) || !(expected > 0)) return { lambdas, applied: false, delta: 0 };
  const rawDelta = observed / expected - 1;
  const delta = clamp(rawDelta, -0.06, 0.06);
  const factor = 1 + delta;
  return {
    lambdas: {
      ...lambdas,
      home: lambdas.home * factor,
      away: lambdas.away * factor,
      total: lambdas.total * factor,
      cornersHome: lambdas.cornersHome,
      cornersAway: lambdas.cornersAway,
      cornersTotal: lambdas.cornersTotal,
      h2hFactor: factor,
    },
    applied: Math.abs(delta) > 0.005,
    delta,
    observed,
    expected,
  };
}

const FULL_MATCH_MINUTES = 90;

/**
 * Ritmo ao vivo: compara o volume de finalizações/ataques perigosos observados
 * com o esperado do perfil. Só entra quando há amostra mínima no jogo.
 */
export function liveTempoFactor({ fixture, homeProfile, awayProfile, minute }) {
  const shotsHome = fixture.home_shots;
  const shotsAway = fixture.away_shots;
  const expectedHome = homeProfile.shotsFor;
  const expectedAway = awayProfile.shotsFor;

  if (minute < 20 || !Number.isFinite(shotsHome) || !Number.isFinite(shotsAway)) {
    return { factor: 1, source: 'tempo padrão (amostra ao vivo insuficiente)' };
  }
  if (!(expectedHome > 0) || !(expectedAway > 0)) {
    return { factor: 1, source: 'tempo padrão (sem média histórica de finalizações)' };
  }

  const elapsed = Math.max(1, minute);
  const observedRate = (shotsHome + shotsAway) / elapsed;
  const expectedRate = (expectedHome + expectedAway) / FULL_MATCH_MINUTES;
  if (!(expectedRate > 0)) return { factor: 1, source: 'tempo padrão' };

  const ratio = observedRate / expectedRate;
  const factor = clamp(ratio, 0.8, 1.3);
  return {
    factor,
    source: `finalizações ${shotsHome + shotsAway} em ${elapsed}min vs ritmo histórico`,
    ratio,
  };
}
