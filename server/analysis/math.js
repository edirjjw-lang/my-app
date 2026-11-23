/**
 * Matemática probabilística do motor FUTEBOL PRO.
 * Nenhum valor aqui é estimado "a olho": tudo deriva de distribuições
 * (Poisson para gols, binomial negativa para escanteios) e das amostras reais.
 */

const LOG_FACTORIAL = [0, 0];
function logFactorial(n) {
  if (n < 2) return 0;
  for (let i = LOG_FACTORIAL.length; i <= n; i += 1) {
    LOG_FACTORIAL[i] = LOG_FACTORIAL[i - 1] + Math.log(i);
  }
  return LOG_FACTORIAL[n];
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(z) {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const x = z - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i += 1) a += LANCZOS[i] / (x + i + 1);
  const t = x + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function poissonPmf(k, lambda) {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (!(lambda > 0)) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

export function poissonCdf(k, lambda) {
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= k; i += 1) sum += poissonPmf(i, lambda);
  return clamp01(sum);
}

/** P(X > line), considerando gols/escanteios já observados (`current`). */
export function tailAbove(mean, line, { current = 0, dispersion = Infinity, maxIterations = 200 } = {}) {
  const needed = Math.floor(line - current) + 1;
  if (needed <= 0) return 1;
  if (!(mean > 0)) return 0;

  if (!Number.isFinite(dispersion) || dispersion <= 0) {
    return clamp01(1 - poissonCdf(needed - 1, mean));
  }

  let cdf = 0;
  const limit = Math.min(maxIterations, needed);
  for (let k = 0; k < limit; k += 1) cdf += negativeBinomialPmf(k, mean, dispersion);
  return clamp01(1 - cdf);
}

export function negativeBinomialPmf(k, mean, dispersion) {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (!(mean > 0)) return k === 0 ? 1 : 0;
  if (!Number.isFinite(dispersion) || dispersion <= 0) return poissonPmf(k, mean);
  const p = dispersion / (dispersion + mean);
  const logProb =
    logGamma(k + dispersion) -
    logGamma(dispersion) -
    logGamma(k + 1) +
    dispersion * Math.log(p) +
    k * Math.log(1 - p);
  return Math.exp(logProb);
}

export function fairOdds(probability) {
  if (!(probability > 0) || probability >= 1) return null;
  return Number((1 / probability).toFixed(3));
}

export function impliedProbability(odds) {
  if (!(odds > 1)) return null;
  return 1 / odds;
}

/** Vantagem estatística: probabilidade do modelo x odd disponível - 1. */
export function edgeOf(probability, odds) {
  if (!(odds > 1) || !(probability > 0)) return null;
  return probability * odds - 1;
}

export function scoreMatrix(lambdaHome, lambdaAway, maxGoals = 10) {
  const matrix = [];
  let total = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    matrix[home] = [];
    for (let away = 0; away <= maxGoals; away += 1) {
      const prob = poissonPmf(home, lambdaHome) * poissonPmf(away, lambdaAway);
      matrix[home][away] = prob;
      total += prob;
    }
  }
  if (total > 0) {
    for (let home = 0; home <= maxGoals; home += 1) {
      for (let away = 0; away <= maxGoals; away += 1) {
        matrix[home][away] /= total;
      }
    }
  }
  return matrix;
}

export function outcomeProbabilities(matrix) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      const p = matrix[h][a];
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (h > 0 && a > 0) bttsYes += p;
    }
  }
  const total = home + draw + away || 1;
  return { home: home / total, draw: draw / total, away: away / total, bttsYes: bttsYes / total };
}

/** Probabilidades de resultado a partir de um placar em andamento. */
export function liveOutcomeProbabilities(lambdaHome, lambdaAway, currentHome, currentAway, maxGoals = 8) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  let total = 0;
  for (let h = 0; h <= maxGoals; h += 1) {
    const ph = poissonPmf(h, lambdaHome);
    for (let a = 0; a <= maxGoals; a += 1) {
      const p = ph * poissonPmf(a, lambdaAway);
      const finalHome = currentHome + h;
      const finalAway = currentAway + a;
      total += p;
      if (finalHome > finalAway) home += p;
      else if (finalHome === finalAway) draw += p;
      else away += p;
      if (finalHome > 0 && finalAway > 0) bttsYes += p;
    }
  }
  const norm = total || 1;
  return { home: home / norm, draw: draw / norm, away: away / norm, bttsYes: bttsYes / norm };
}

export function weightedMean(values, weights) {
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const weight = weights?.[i] ?? 1;
    if (!(weight > 0)) continue;
    sum += value * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? sum / weightSum : null;
}

export function standardDeviation(values) {
  const clean = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (clean.length < 2) return null;
  const mean = clean.reduce((acc, v) => acc + v, 0) / clean.length;
  const variance = clean.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

/** Brier Score: média de (probabilidade - resultado)². Menor é melhor. */
export function brierScore(predictions) {
  const valid = predictions.filter((p) => Number.isFinite(p.probability) && (p.outcome === 0 || p.outcome === 1));
  if (!valid.length) return null;
  const total = valid.reduce((acc, p) => acc + (p.probability - p.outcome) ** 2, 0);
  return total / valid.length;
}

/** Log Loss com clip para evitar log(0). Menor é melhor. */
export function logLoss(predictions, epsilon = 1e-12) {
  const valid = predictions.filter((p) => Number.isFinite(p.probability) && (p.outcome === 0 || p.outcome === 1));
  if (!valid.length) return null;
  const total = valid.reduce((acc, p) => {
    const prob = Math.min(1 - epsilon, Math.max(epsilon, p.probability));
    return acc - (p.outcome * Math.log(prob) + (1 - p.outcome) * Math.log(1 - prob));
  }, 0);
  return total / valid.length;
}

/** Calibração em faixas de 10%: probabilidade média vs frequência observada. */
export function calibrationBuckets(predictions) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}-${index * 10 + 10}%`,
    from: index / 10,
    to: (index + 1) / 10,
    count: 0,
    avgProbability: 0,
    observed: 0,
  }));
  for (const prediction of predictions) {
    if (!Number.isFinite(prediction.probability) || ![0, 1].includes(prediction.outcome)) continue;
    const index = Math.min(9, Math.max(0, Math.floor(prediction.probability * 10)));
    const bucket = buckets[index];
    bucket.count += 1;
    bucket.avgProbability += prediction.probability;
    bucket.observed += prediction.outcome;
  }
  return buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      avgProbability: bucket.avgProbability / bucket.count,
      observed: bucket.observed / bucket.count,
    }));
}

/**
 * Correção de Dixon-Coles para placares baixos.
 * O Poisson independente subestima 0-0 e 1-1 e superestima 1-0 / 0-1, porque
 * os gols das duas equipes não são de fato independentes nos placares baixos.
 * rho negativo (padrão -0.05) devolve massa a 0-0 e 1-1.
 */
export function dixonColesTau(home, away, lambdaHome, lambdaAway, rho) {
  if (!rho) return 1;
  if (home === 0 && away === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (home === 0 && away === 1) return 1 + lambdaHome * rho;
  if (home === 1 && away === 0) return 1 + lambdaAway * rho;
  if (home === 1 && away === 1) return 1 - rho;
  return 1;
}

/** Matriz de placares com correção de Dixon-Coles, normalizada. */
export function dixonColesMatrix(lambdaHome, lambdaAway, { maxGoals = 10, rho = -0.05 } = {}) {
  const matrix = [];
  let total = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    matrix[home] = [];
    for (let away = 0; away <= maxGoals; away += 1) {
      const base = poissonPmf(home, lambdaHome) * poissonPmf(away, lambdaAway);
      const prob = Math.max(0, base * dixonColesTau(home, away, lambdaHome, lambdaAway, rho));
      matrix[home][away] = prob;
      total += prob;
    }
  }
  if (total > 0) {
    for (let home = 0; home <= maxGoals; home += 1) {
      for (let away = 0; away <= maxGoals; away += 1) {
        matrix[home][away] /= total;
      }
    }
  }
  return matrix;
}

/** P(total de gols > line) lendo a matriz de placares (respeita Dixon-Coles). */
export function matrixTailAbove(matrix, line) {
  let above = 0;
  let total = 0;
  for (let home = 0; home < matrix.length; home += 1) {
    for (let away = 0; away < matrix[home].length; away += 1) {
      const p = matrix[home][away];
      total += p;
      if (home + away > line) above += p;
    }
  }
  return total > 0 ? clamp01(above / total) : 0;
}

/** Média de gols totais implícita na matriz de placares. */
export function matrixMeanGoals(matrix) {
  let total = 0;
  let sum = 0;
  for (let home = 0; home < matrix.length; home += 1) {
    for (let away = 0; away < matrix[home].length; away += 1) {
      const p = matrix[home][away];
      total += p;
      sum += (home + away) * p;
    }
  }
  return total > 0 ? sum / total : 0;
}
