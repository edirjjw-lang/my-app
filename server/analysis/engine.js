import {
  clamp01,
  edgeOf,
  fairOdds,
  liveOutcomeProbabilities,
  outcomeProbabilities,
  scoreMatrix,
  tailAbove,
} from './math.js';
import { adjustForH2H, estimateLambdas, liveTempoFactor } from './profile.js';
import {
  CONFIDENCE_RANK,
  ENTRY,
  GROUPS,
  buildFactors,
  buildRationale,
  buildRisks,
  computeConfidence,
  selectionLabel,
} from './markets.js';

export const MODEL_VERSION = 'poisson-nb-v1';
const MAX_GOALS = 10;
const GOAL_LINES = [0.5, 1.5, 2.5];
const CORNER_LINES = [3.5, 4.5, 5.5, 6.5];

function keyFor(market) {
  if (market.marketType === '1x2') return '1x2';
  if (market.marketType === 'dc') return 'double_chance';
  if (market.marketType === 'dnb') return 'draw_no_bet';
  if (market.marketType === 'btts') return 'btts';
  const base = market.group === GROUPS.GOALS ? 'goals' : 'corners';
  const parts = [base];
  if (market.period === '1H') parts.push('1h');
  else if (market.period === '2H') parts.push('2h');
  if (market.team) parts.push(market.team);
  parts.push(market.marketType);
  return parts.join('_');
}

function dispersionFor(mean, std) {
  if (!(mean > 0) || !(std > 0)) return Infinity;
  const variance = std ** 2;
  if (variance <= mean) return Infinity;
  return (mean ** 2) / (variance - mean);
}

/**
 * Qualidade/cobertura dos dados. Dados desatualizados ou amostra insuficiente
 * bloqueiam recomendações em vez de gerar probabilidades frágeis.
 */
export function assessQuality({ homeProfile, awayProfile, baseline, freshness, liveIncomplete }) {
  const missing = [];
  const sample = Math.min(homeProfile?.matches ?? 0, awayProfile?.matches ?? 0);
  let score = 1;

  if (!baseline) {
    missing.push('linha de base da competição');
    score -= 0.6;
  }
  if (sample < 5) {
    missing.push(`amostra de ${sample} jogo(s) por equipe`);
    score -= 0.5;
  } else if (sample < 10) {
    score -= 0.2;
  }
  if (!(homeProfile?.cornersSample >= 5 && awayProfile?.cornersSample >= 5)) {
    missing.push('escanteios por partida');
    score -= 0.15;
  }
  if (!(homeProfile?.htGoalsSample >= 5 && awayProfile?.htGoalsSample >= 5)) {
    missing.push('gols do primeiro tempo');
    score -= 0.1;
  }
  if (!(homeProfile?.shotsFor > 0 && awayProfile?.shotsFor > 0)) {
    missing.push('finalizações');
    score -= 0.05;
  }
  if (freshness?.stale) {
    missing.push('dados desatualizados');
    score = 0;
  }
  if (liveIncomplete) {
    missing.push('placar ao vivo indisponível');
    score = 0;
  }

  let level = 'OK';
  if (freshness?.stale || liveIncomplete || !baseline || sample < 5) level = 'INSUFICIENTE';
  else if (missing.length) level = 'LIMITADA';

  return { level, score: Math.max(0, Math.min(1, score)), sample, missing };
}

function coefficientOfVariation(group, { lambdas, homeProfile, awayProfile }) {
  if (group === GROUPS.GOALS) {
    const stds = [homeProfile.goalsForStd, awayProfile.goalsForStd].filter((v) => Number.isFinite(v));
    if (!stds.length || !(lambdas.total > 0)) return 0.5;
    const std = stds.reduce((a, b) => a + b, 0) / stds.length;
    return clamp01(std / Math.max(0.8, lambdas.total / 2));
  }
  if (group === GROUPS.CORNERS) {
    const stds = [homeProfile.cornersForStd, awayProfile.cornersForStd].filter((v) => Number.isFinite(v));
    if (stds.length < 2 || !(lambdas.cornersTotal > 0)) return 0.5;
    const std = Math.sqrt(stds[0] ** 2 + stds[1] ** 2);
    return clamp01(std / lambdas.cornersTotal);
  }
  return 0.35;
}

function decideEntry({ probability, bookmakerOdds, edge, confidence, filters, quality, liveIncomplete }) {
  if (quality.level === 'INSUFICIENTE' || liveIncomplete) {
    return { entry: ENTRY.NO_ENTRY, reason: 'Dados insuficientes ou desatualizados — recomendações bloqueadas.' };
  }
  const confidenceOk = CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[filters.minConfidence];
  if (!Number.isFinite(bookmakerOdds)) {
    // Sem odd de mercado a indicação usa apenas a probabilidade calculada e a
    // confiança do modelo. Nenhuma odd é inventada e nenhuma vantagem é alegada.
    if (!confidenceOk) {
      return {
        entry: ENTRY.NO_ENTRY,
        reason: `Confiança ${confidence} abaixo do mínimo exigido (${filters.minConfidence}).`,
      };
    }
    if (probability < filters.minProbability) {
      return {
        entry: ENTRY.NO_ENTRY,
        reason: `Probabilidade ${(probability * 100).toFixed(1)}% abaixo do mínimo ${(filters.minProbability * 100).toFixed(0)}%.`,
      };
    }
    if (probability >= 0.92) {
      return { entry: ENTRY.NO_ENTRY, reason: 'Probabilidade extrema: sem valor esperado confiável.' };
    }
    return { entry: ENTRY.RECOMMENDED, reason: null };
  }
  if (bookmakerOdds < filters.minOdd) {
    return {
      entry: ENTRY.NO_ENTRY,
      reason: `Odd ${bookmakerOdds.toFixed(2)} abaixo da odd mínima ${filters.minOdd.toFixed(2)}.`,
    };
  }
  if (!Number.isFinite(edge) || edge < filters.minEdge) {
    return {
      entry: ENTRY.NO_ENTRY,
      reason: `Sem vantagem estatística (${(edge * 100).toFixed(1)}% < ${(filters.minEdge * 100).toFixed(1)}% mínimo).`,
    };
  }
  if (!confidenceOk) {
    return {
      entry: ENTRY.NO_ENTRY,
      reason: `Confiança ${confidence} abaixo do mínimo exigido (${filters.minConfidence}).`,
    };
  }
  if (probability <= 0.08 || probability >= 0.92) {
    return { entry: ENTRY.NO_ENTRY, reason: 'Probabilidade extrema: sem valor esperado confiável.' };
  }
  return { entry: ENTRY.RECOMMENDED, reason: null };
}

/**
 * Motor principal. Função pura: recebe perfis, linha de base, odds reais e
 * devolve mercados com probabilidade, odd justa, vantagem e confiança.
 */
export function analyzeFixture({
  fixture,
  homeProfile,
  awayProfile,
  baseline,
  h2h = null,
  odds = [],
  lineups = null,
  injuries = [],
  filters = {},
  freshness = { stale: false, ageMs: null },
}) {
  const resolvedFilters = {
    minOdd: filters.minOdd ?? 1.5,
    preferredMinOdd: filters.preferredMinOdd ?? 1.5,
    preferredMaxOdd: filters.preferredMaxOdd ?? 1.8,
    minEdge: filters.minEdge ?? 0.03,
    minConfidence: filters.minConfidence ?? 'MODERADA',
    minProbability: filters.minProbability ?? 0.6,
  };

  const isLive = ['LIVE', 'HT'].includes(fixture.status);
  const minute = isLive ? Math.min(120, Math.max(0, fixture.minute ?? (fixture.status === 'HT' ? 45 : 0))) : null;
  const liveIncomplete = isLive && (fixture.home_goals === null || fixture.away_goals === null);

  const quality = assessQuality({ homeProfile, awayProfile, baseline, freshness, liveIncomplete });
  const baseLambdas = estimateLambdas({ homeProfile, awayProfile, baseline });

  const emptyResult = (reason) => ({
    fixtureProviderId: fixture.provider_id,
    status: fixture.status,
    minute,
    quality,
    lambdas: null,
    live: null,
    markets: [],
    recommended: [],
    unavailable: [{ group: 'TODOS', reason }],
    blocked: true,
    noEntryReasons: [reason],
    modelVersion: MODEL_VERSION,
    h2h: h2h ?? null,
    injuries,
    lineups,
  });

  if (!baseLambdas) {
    return emptyResult('Linha de base da competição insuficiente (mínimo de 5 partidas encerradas com placar).');
  }

  const h2hAdjustment = adjustForH2H(baseLambdas, h2h, baseline);
  const lambdas = h2hAdjustment.lambdas;

  if (quality.level === 'INSUFICIENTE') {
    return emptyResult(
      quality.missing.length
        ? `Análise bloqueada: ${quality.missing.join(', ')}.`
        : 'Análise bloqueada por dados insuficientes.',
    );
  }

  const current = {
    home: fixture.home_goals ?? 0,
    away: fixture.away_goals ?? 0,
    total: (fixture.home_goals ?? 0) + (fixture.away_goals ?? 0),
    corners: (fixture.home_corners ?? 0) + (fixture.away_corners ?? 0),
    htTotal:
      Number.isFinite(fixture.ht_home_goals) && Number.isFinite(fixture.ht_away_goals)
        ? fixture.ht_home_goals + fixture.ht_away_goals
        : null,
  };

  const remainingFraction = isLive ? Math.max(0.02, (90 - minute) / 90) : null;
  const tempo = isLive ? liveTempoFactor({ fixture, homeProfile, awayProfile, minute }) : null;
  const tempoFactor = tempo?.factor ?? 1;
  const lambdaHomeRemaining = isLive ? lambdas.home * remainingFraction * tempoFactor : null;
  const lambdaAwayRemaining = isLive ? lambdas.away * remainingFraction * tempoFactor : null;

  const htShare =
    Number.isFinite(homeProfile.htGoalsShare) && Number.isFinite(awayProfile.htGoalsShare)
      ? (homeProfile.htGoalsShare + awayProfile.htGoalsShare) / 2
      : null;
  const htCornerShare =
    Number.isFinite(homeProfile.htCornersShare) && Number.isFinite(awayProfile.htCornersShare)
      ? (homeProfile.htCornersShare + awayProfile.htCornersShare) / 2
      : null;

  const oddsMap = new Map();
  for (const entry of odds) {
    if (!entry?.marketKey) continue;
    oddsMap.set(`${entry.marketKey}|${entry.line ?? ''}|${entry.selection}`, entry);
  }

  const markets = [];
  const unavailable = [];

  const add = (meta, probability) => {
    if (!Number.isFinite(probability)) return;
    const p = Math.min(0.999, Math.max(0.001, probability));
    const marketKey = keyFor(meta);
    const oddsEntry = oddsMap.get(`${marketKey}|${meta.line ?? ''}|${meta.selection}`) ?? null;
    const bookmakerOdds = Number.isFinite(oddsEntry?.price) ? oddsEntry.price : null;
    const edge = edgeOf(p, bookmakerOdds);
    const cv = coefficientOfVariation(meta.group, { lambdas, homeProfile, awayProfile });
    const confidence = computeConfidence({
      probability: p,
      edge,
      sample: quality.sample,
      qualityScore: quality.score,
      coefficientOfVariation: cv,
      group: meta.group,
      hasOdds: Number.isFinite(bookmakerOdds),
      live: isLive,
    });
    const decision = decideEntry({
      probability: p,
      bookmakerOdds,
      edge,
      confidence: confidence.label,
      filters: resolvedFilters,
      quality,
      liveIncomplete,
    });
    const market = {
      marketKey,
      group: meta.group,
      marketType: meta.marketType,
      period: meta.period ?? 'FT',
      team: meta.team ?? null,
      selection: meta.selection,
      line: meta.line ?? null,
      label: selectionLabel({ ...meta, group: meta.group }),
      probability: p,
      fairOdds: fairOdds(p),
      bookmakerOdds,
      edge,
      confidence: confidence.label,
      confidenceScore: confidence.score,
      preferred:
        Number.isFinite(bookmakerOdds) &&
        bookmakerOdds >= resolvedFilters.preferredMinOdd &&
        bookmakerOdds <= resolvedFilters.preferredMaxOdd,
      entry: decision.entry,
      reason: decision.reason,
      isLive,
      minute: isLive ? minute : null,
      bookmaker: oddsEntry?.bookmaker ?? null,
    };
    market.factors = buildFactors({
      market,
      lambdas,
      profiles: { home: homeProfile, away: awayProfile },
      h2h,
      odds: bookmakerOdds,
      live: isLive
        ? {
            minute,
            tempoFactor,
            tempoSource: tempo.source,
            score: `${current.home}-${current.away}`,
            corners: current.corners,
            shots: (fixture.home_shots ?? 0) + (fixture.away_shots ?? 0),
          }
        : null,
      injuries,
      lineups,
    });
    market.risks = buildRisks({
      market,
      quality,
      live: isLive,
      odds: bookmakerOdds,
      profiles: { home: homeProfile, away: awayProfile },
      injuries,
      lineups,
    });
    market.rationale = buildRationale({
      market,
      lambdas,
      profiles: { home: homeProfile, away: awayProfile },
      h2h,
      quality,
      live: isLive
        ? {
            minute,
            tempoFactor,
            score: `${current.home}-${current.away}`,
            corners: current.corners,
            shots: (fixture.home_shots ?? 0) + (fixture.away_shots ?? 0),
          }
        : null,
      odds: bookmakerOdds,
    });
    markets.push(market);
  };

  // ---------------- GOLS ----------------
  if (isLive) {
    const remGoals = lambdaHomeRemaining + lambdaAwayRemaining;
    for (const line of GOAL_LINES) {
      add(
        { group: GROUPS.GOALS, marketType: 'over', period: 'FT', selection: 'over', line },
        tailAbove(remGoals, line, { current: current.total }),
      );
    }
    add(
      { group: GROUPS.GOALS, marketType: 'under', period: 'FT', selection: 'under', line: 2.5 },
      1 - tailAbove(remGoals, 2.5, { current: current.total }),
    );
  } else {
    for (const line of GOAL_LINES) {
      add(
        { group: GROUPS.GOALS, marketType: 'over', period: 'FT', selection: 'over', line },
        tailAbove(lambdas.total, line),
      );
    }
    add(
      { group: GROUPS.GOALS, marketType: 'under', period: 'FT', selection: 'under', line: 2.5 },
      1 - tailAbove(lambdas.total, 2.5),
    );
  }

  if (htShare === null) {
    unavailable.push({ group: GROUPS.GOALS, reason: 'Gols por tempo indisponíveis: histórico sem placar de intervalo suficiente.' });
  } else {
    if (!isLive) {
      const firstHalf = lambdas.total * htShare;
      for (const line of [0.5, 1.5]) {
        add(
          { group: GROUPS.GOALS, marketType: 'over', period: '1H', selection: 'over', line },
          tailAbove(firstHalf, line),
        );
      }
      const secondHalf = lambdas.total * (1 - htShare);
      for (const line of [0.5, 1.5]) {
        add(
          { group: GROUPS.GOALS, marketType: 'over', period: '2H', selection: 'over', line },
          tailAbove(secondHalf, line),
        );
      }
    } else if (minute < 45) {
      const remainingFirstHalf = lambdas.total * htShare * ((45 - minute) / 45) * tempoFactor;
      for (const line of [0.5, 1.5]) {
        add(
          { group: GROUPS.GOALS, marketType: 'over', period: '1H', selection: 'over', line },
          tailAbove(remainingFirstHalf, line, { current: current.total }),
        );
      }
    } else if (current.htTotal !== null) {
      const remainingSecondHalf = lambdas.total * (1 - htShare) * ((90 - minute) / 45) * tempoFactor;
      const secondHalfSoFar = current.total - current.htTotal;
      for (const line of [0.5, 1.5]) {
        add(
          { group: GROUPS.GOALS, marketType: 'over', period: '2H', selection: 'over', line },
          tailAbove(remainingSecondHalf, line, { current: secondHalfSoFar }),
        );
      }
    }
  }

  // ---------------- ESCANTEIOS ----------------
  const cornersAvailable = Number.isFinite(lambdas.cornersTotal) && lambdas.cornersTotal > 0;
  if (!cornersAvailable) {
    unavailable.push({
      group: GROUPS.CORNERS,
      reason: 'Escanteios insuficientes no histórico (mínimo de 5 partidas com estatística por equipe).',
    });
  } else {
    const dispersion = lambdas.cornerDispersion;
    const cornerRemaining = isLive ? lambdas.cornersTotal * remainingFraction * tempoFactor : null;
    for (const line of CORNER_LINES) {
      add(
        { group: GROUPS.CORNERS, marketType: 'over', period: 'FT', selection: 'over', line },
        isLive
          ? tailAbove(cornerRemaining, line, { current: current.corners, dispersion })
          : tailAbove(lambdas.cornersTotal, line, { dispersion }),
      );
    }

    const teamCorners = [
      { team: 'home', mean: lambdas.cornersHome, std: homeProfile.cornersForStd, current: fixture.home_corners ?? 0 },
      { team: 'away', mean: lambdas.cornersAway, std: awayProfile.cornersForStd, current: fixture.away_corners ?? 0 },
    ];
    for (const entry of teamCorners) {
      if (!(entry.mean > 0)) continue;
      const teamDispersion = dispersionFor(entry.mean, entry.std);
      for (const line of [3.5, 4.5]) {
        add(
          { group: GROUPS.CORNERS, marketType: 'over', period: 'FT', team: entry.team, selection: 'over', line },
          isLive
            ? tailAbove(entry.mean * remainingFraction * tempoFactor, line, {
                current: entry.current,
                dispersion: teamDispersion,
              })
            : tailAbove(entry.mean, line, { dispersion: teamDispersion }),
        );
      }
    }

    if (htCornerShare === null) {
      unavailable.push({
        group: GROUPS.CORNERS,
        reason: 'Escanteios do primeiro tempo indisponíveis no histórico do provedor.',
      });
    } else if (!isLive) {
      const firstHalfCorners = lambdas.cornersTotal * htCornerShare;
      for (const line of [1.5, 2.5]) {
        add(
          { group: GROUPS.CORNERS, marketType: 'over', period: '1H', selection: 'over', line },
          tailAbove(firstHalfCorners, line, { dispersion }),
        );
      }
    } else if (minute < 45) {
      const remainingFirstHalfCorners =
        lambdas.cornersTotal * htCornerShare * ((45 - minute) / 45) * tempoFactor;
      for (const line of [1.5, 2.5]) {
        add(
          { group: GROUPS.CORNERS, marketType: 'over', period: '1H', selection: 'over', line },
          tailAbove(remainingFirstHalfCorners, line, { current: current.corners, dispersion }),
        );
      }
    }
  }

  // ---------------- RESULTADOS ----------------
  const outcome = isLive
    ? liveOutcomeProbabilities(lambdaHomeRemaining, lambdaAwayRemaining, current.home, current.away)
    : outcomeProbabilities(scoreMatrix(lambdas.home, lambdas.away, MAX_GOALS));

  add({ group: GROUPS.RESULT, marketType: '1x2', selection: 'home', line: null }, outcome.home);
  add({ group: GROUPS.RESULT, marketType: '1x2', selection: 'draw', line: null }, outcome.draw);
  add({ group: GROUPS.RESULT, marketType: '1x2', selection: 'away', line: null }, outcome.away);
  add({ group: GROUPS.RESULT, marketType: 'dc', selection: 'home_draw', line: null }, outcome.home + outcome.draw);
  add({ group: GROUPS.RESULT, marketType: 'dc', selection: 'home_away', line: null }, outcome.home + outcome.away);
  add({ group: GROUPS.RESULT, marketType: 'dc', selection: 'draw_away', line: null }, outcome.draw + outcome.away);
  const decisive = outcome.home + outcome.away;
  if (decisive > 0) {
    add({ group: GROUPS.RESULT, marketType: 'dnb', selection: 'home', line: null }, outcome.home / decisive);
    add({ group: GROUPS.RESULT, marketType: 'dnb', selection: 'away', line: null }, outcome.away / decisive);
  }
  add({ group: GROUPS.RESULT, marketType: 'btts', selection: 'yes', line: null }, outcome.bttsYes);
  add({ group: GROUPS.RESULT, marketType: 'btts', selection: 'no', line: null }, 1 - outcome.bttsYes);

  const recommended = markets
    .filter((market) => market.entry === ENTRY.RECOMMENDED)
    .sort((a, b) => b.confidenceScore - a.confidenceScore || b.probability - a.probability);

  const noEntryReasons = [];
  if (!recommended.length) {
    const rejectionReasons = markets
      .map((market) => market.reason)
      .filter(Boolean)
      .slice(0, 3);
    if (rejectionReasons.length) noEntryReasons.push(...rejectionReasons);
    else noEntryReasons.push('Nenhum mercado atingiu o mínimo de probabilidade e confiança.');
  }

  return {
    fixtureProviderId: fixture.provider_id,
    status: fixture.status,
    minute,
    quality,
    lambdas: {
      home: lambdas.home,
      away: lambdas.away,
      total: lambdas.total,
      cornersHome: lambdas.cornersHome,
      cornersAway: lambdas.cornersAway,
      cornersTotal: lambdas.cornersTotal,
      strength: lambdas.strength,
      h2hAdjustment: h2hAdjustment.applied ? h2hAdjustment.delta : 0,
    },
    live: isLive
      ? {
          minute,
          score: `${current.home}-${current.away}`,
          corners: current.corners,
          shots: (fixture.home_shots ?? 0) + (fixture.away_shots ?? 0),
          dangerousAttacks: (fixture.home_dangerous_attacks ?? 0) + (fixture.away_dangerous_attacks ?? 0),
          possessionHome: fixture.home_possession,
          possessionAway: fixture.away_possession,
          tempoFactor,
          tempoSource: tempo.source,
          remainingFraction,
          projectedRemainingGoals: lambdaHomeRemaining + lambdaAwayRemaining,
        }
      : null,
    markets,
    recommended,
    unavailable,
    blocked: false,
    noEntryReasons,
    modelVersion: MODEL_VERSION,
    h2h: h2h ?? null,
    injuries,
    lineups,
  };
}
