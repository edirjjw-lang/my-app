import assert from 'node:assert/strict';
import test from 'node:test';
import {
  brierScore,
  calibrationBuckets,
  edgeOf,
  fairOdds,
  impliedProbability,
  logLoss,
  outcomeProbabilities,
  poissonPmf,
  scoreMatrix,
  tailAbove,
} from '../server/analysis/math.js';

test('Poisson: massa de probabilidade confere com a fórmula fechada', () => {
  assert.ok(Math.abs(poissonPmf(0, 2) - Math.exp(-2)) < 1e-12);
  assert.ok(Math.abs(poissonPmf(3, 1.5) - (Math.exp(-1.5) * 1.5 ** 3) / 6) < 1e-12);
  const sum = Array.from({ length: 40 }, (_, k) => poissonPmf(k, 2.4)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `soma das probabilidades = ${sum}`);
});

test('Poisson: cauda acima da linha decresce com a linha', () => {
  const p15 = tailAbove(2.7, 1.5);
  const p25 = tailAbove(2.7, 2.5);
  const p35 = tailAbove(2.7, 3.5);
  assert.ok(p15 > p25 && p25 > p35, `${p15} > ${p25} > ${p35}`);
  assert.ok(p15 > 0 && p15 < 1);
});

test('Poisson: cauda considera gols já marcados no ao vivo', () => {
  const before = tailAbove(2.7, 2.5);
  const live = tailAbove(2.7, 2.5, { current: 2 });
  assert.equal(live, 1, 'com 2 gols e linha 2.5, mais de 2.5 é certeza');
  assert.ok(before < 1);
});

test('Matriz de placar normaliza e o 1X2 soma 100%', () => {
  const matrix = scoreMatrix(1.6, 1.1, 10);
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-6, `matriz soma ${total}`);
  const outcome = outcomeProbabilities(matrix);
  const sum = outcome.home + outcome.draw + outcome.away;
  assert.ok(Math.abs(sum - 1) < 1e-9, `1X2 soma ${sum}`);
  assert.ok(outcome.home > outcome.away, 'mandante mais forte deve ter probabilidade maior');
  assert.ok(outcome.bttsYes > 0 && outcome.bttsYes < 1);
});

test('Odd justa é o inverso da probabilidade e a vantagem compara com a odd real', () => {
  assert.equal(fairOdds(0.5), 2);
  assert.ok(Math.abs(impliedProbability(2.5) - 0.4) < 1e-12);
  assert.ok(Math.abs(edgeOf(0.5, 2.2) - 0.1) < 1e-12, 'edge = p*odd - 1');
  assert.ok(edgeOf(0.4, 2.2) < 0);
  assert.equal(fairOdds(0), null);
});

test('Brier Score e Log Loss conferem com valores conhecidos', () => {
  const predictions = [
    { probability: 0.7, outcome: 1 },
    { probability: 0.7, outcome: 0 },
  ];
  assert.ok(Math.abs(brierScore(predictions) - 0.09) < 1e-12);
  assert.ok(Math.abs(logLoss(predictions) - -Math.log(0.7)) < 1e-9);
  assert.equal(brierScore([]), null);
  assert.equal(logLoss([]), null);
});

test('Calibração agrupa previsões em faixas e expõe desvio', () => {
  const buckets = calibrationBuckets([
    { probability: 0.55, outcome: 1 },
    { probability: 0.58, outcome: 0 },
    { probability: 0.72, outcome: 1 },
  ]);
  assert.ok(Array.isArray(buckets));
  const used = buckets.filter((bucket) => bucket.count > 0);
  assert.ok(used.length >= 2);
  for (const bucket of used) {
    assert.ok(bucket.predicted >= 0 && bucket.predicted <= 1);
    assert.ok(bucket.observed >= 0 && bucket.observed <= 1);
  }
});
