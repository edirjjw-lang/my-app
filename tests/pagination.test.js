import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectPages, pagingInfo } from '../server/provider/http.js';

function fixtureResponse(items, { current = 1, total = 1 } = {}) {
  return { payload: { paging: { current, total }, response: items }, items };
}

test('pagingInfo lê a paginação real e assume 1 página sem metadados', () => {
  assert.deepEqual(pagingInfo({ paging: { current: 2, total: 5 } }), { current: 2, total: 5 });
  assert.deepEqual(pagingInfo({}), { current: 1, total: 1 });
  assert.deepEqual(pagingInfo(null), { current: 1, total: 1 });
});

test('collectPages percorre TODAS as páginas e não perde nenhum item', async () => {
  const pageSize = 4;
  const totalPages = 5;
  const requested = [];
  const result = await collectPages(
    async (page) => {
      requested.push(page);
      const items = Array.from({ length: pageSize }, (_, index) => ({ id: (page - 1) * pageSize + index }));
      return fixtureResponse(items, { current: page, total: totalPages });
    },
    { maxPages: 60 },
  );

  assert.deepEqual(requested, [1, 2, 3, 4, 5], 'todas as páginas foram requisitadas em ordem');
  assert.equal(result.items.length, pageSize * totalPages, 'nenhum item foi descartado');
  assert.equal(result.pages.length, totalPages);
  assert.equal(result.partial, false);
  assert.equal(result.capped, false);
  const ids = new Set(result.items.map((item) => item.id));
  assert.equal(ids.size, pageSize * totalPages, 'sem duplicatas');
});

test('collectPages mantém as páginas já lidas quando uma página posterior falha', async () => {
  const result = await collectPages(async (page) => {
    if (page === 3) throw new Error('provedor instável na página 3');
    return fixtureResponse([{ id: page }], { current: page, total: 4 });
  });

  assert.equal(result.items.length, 2, 'páginas 1 e 2 foram preservadas');
  assert.equal(result.partial, true, 'resultado marcado como parcial, nunca como completo');
  assert.match(result.error, /página 3/);
});

test('collectPages sinaliza quando o teto de páginas impede a coleta completa', async () => {
  const result = await collectPages(
    async (page) => fixtureResponse([{ id: page }], { current: page, total: 10 }),
    { maxPages: 3 },
  );

  assert.equal(result.items.length, 3);
  assert.equal(result.capped, true);
  assert.equal(result.partial, true);
  assert.equal(result.totalPages, 10, 'total real informado para o operador');
});

function rawFixture(id, leagueId, leagueName, kickoffUtc) {
  return {
    fixture: { id, date: kickoffUtc, status: { short: 'NS', elapsed: null }, venue: { name: 'Estádio' } },
    league: { id: leagueId, name: leagueName, country: 'Teste', season: 2025, round: 'Rodada 1', logo: null },
    teams: {
      home: { id: leagueId * 100 + 1, name: `Casa ${id}`, logo: null },
      away: { id: leagueId * 100 + 2, name: `Fora ${id}`, logo: null },
    },
    goals: { home: null, away: null },
  };
}

test('provedor API-Football coleta todas as páginas de todas as ligas sem filtrar campeonato', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'futebolpro-pagination-'));
  process.env.DB_PATH = path.join(tmp, 'test.db');
  process.env.FOOTBALL_API_KEY = 'chave-de-teste-nao-real';
  process.env.API_MAX_PAGES = '60';

  const pages = [
    [rawFixture(1, 71, 'Serie A', '2026-11-23T18:00:00+00:00'), rawFixture(2, 128, 'Liga Profesional', '2026-11-23T20:00:00+00:00')],
    [rawFixture(3, 140, 'La Liga', '2026-11-23T21:00:00+00:00'), rawFixture(4, 39, 'Premier League', '2026-11-23T22:00:00+00:00')],
    [rawFixture(5, 235, 'Liga 1', '2026-11-23T23:00:00+00:00'), rawFixture(6, 2, 'Champions League', '2026-11-24T00:00:00+00:00')],
  ];
  const requestedPages = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const page = Number(new URL(String(url)).searchParams.get('page') || '1');
    requestedPages.push(page);
    return new Response(JSON.stringify({ paging: { current: page, total: pages.length }, response: pages[page - 1] ?? [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const { apiFootballProvider } = await import('../server/provider/apiFootball.js');
    const result = await apiFootballProvider.fetchLiveFixtures();

    assert.deepEqual(requestedPages, [1, 2, 3], 'o provedor leu todas as páginas');
    assert.equal(result.fixtures.length, 6, 'os 6 jogos das 3 páginas foram mantidos');
    assert.equal(result.leagues, 6, 'todas as 6 ligas distintas foram preservadas');
    assert.equal(result.pages, 3);
    assert.equal(result.partial, false);
    const competitionIds = new Set(result.fixtures.map((item) => item.competition.providerId));
    assert.equal(competitionIds.size, 6, 'nenhuma liga foi descartada por filtro');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
