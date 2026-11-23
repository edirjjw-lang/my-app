import assert from 'node:assert/strict';
import test from 'node:test';
import { settleMarket } from '../server/analysis/markets.js';

const final = {
  home_goals: 2,
  away_goals: 1,
  ht_home_goals: 1,
  ht_away_goals: 0,
  home_corners: 6,
  away_corners: 4,
  ht_home_corners: 3,
  ht_away_corners: 2,
};

test('Gols: mais e menos de 2.5 liquidam corretamente', () => {
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 2.5, period: 'FT' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'under', line: 2.5, period: 'FT' }, final), 'RED');
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 3.5, period: 'FT' }, final), 'RED');
});

test('Gols: mercados de primeiro e segundo tempo usam os gols do período', () => {
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 0.5, period: '1H' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 1.5, period: '1H' }, final), 'RED');
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 1.5, period: '2H' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'under', line: 1.5, period: '2H' }, final), 'RED');
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 2.5, period: '2H' }, final), 'RED');
});

test('Gols: sem dados do intervalo o mercado não é liquidado', () => {
  const partial = { ...final, ht_home_goals: null, ht_away_goals: null };
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 0.5, period: '1H' }, partial), null);
});

test('Escanteios: total, por equipe e primeiro tempo', () => {
  assert.equal(settleMarket({ group: 'ESCANTEIO', marketType: 'over', line: 9.5, period: 'FT' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'ESCANTEIO', marketType: 'over', line: 10.5, period: 'FT' }, final), 'RED');
  assert.equal(settleMarket({ group: 'ESCANTEIO', marketType: 'over', line: 5.5, period: 'FT', team: 'home' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'ESCANTEIO', marketType: 'over', line: 5.5, period: 'FT', team: 'away' }, final), 'RED');
  assert.equal(settleMarket({ group: 'ESCANTEIO', marketType: 'over', line: 4.5, period: '1H' }, final), 'GREEN');
});

test('Resultado: 1X2, dupla chance, empate anula e ambas marcam', () => {
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: '1x2', selection: 'home' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: '1x2', selection: 'away' }, final), 'RED');
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: 'dc', selection: 'home_draw' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: 'dc', selection: 'home_away' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: 'btts', selection: 'yes' }, final), 'GREEN');
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: 'btts', selection: 'no' }, final), 'RED');

  const draw = { ...final, home_goals: 1, away_goals: 1 };
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: 'dnb', selection: 'home' }, draw), 'VOID');
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: '1x2', selection: 'draw' }, draw), 'GREEN');
});

test('Sem placar final nenhum mercado é liquidado (evita resultado inventado)', () => {
  assert.equal(settleMarket({ group: 'GOLS', marketType: 'over', line: 2.5, period: 'FT' }, { home_goals: null, away_goals: null }), null);
  assert.equal(settleMarket({ group: 'RESULTADO', marketType: '1x2', selection: 'home' }, null), null);
});
