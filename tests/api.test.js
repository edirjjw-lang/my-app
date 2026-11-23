import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

async function waitForServer(baseUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return response.json();
    } catch {
      /* servidor ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('servidor não respondeu dentro do prazo');
}

test('API funciona sem chave: estado honesto, zero jogos fictícios e filtros padrão', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'futebolpro-'));
  const port = 3900 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dir, 'test.db'),
      FOOTBALL_API_KEY: '',
      SYNC_ENABLED: 'false',
      ADMIN_TOKEN: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const status = await waitForServer(baseUrl);

  assert.equal(status.provider.configured, false, 'sem chave o provedor não pode aparecer configurado');
  assert.equal(status.app.version, '1.0.0');
  assert.ok(Array.isArray(status.limitations) && status.limitations.length > 0, 'limitações devem ser explícitas');

  const fixtures = await (await fetch(`${baseUrl}/api/fixtures?status=LIVE`)).json();
  assert.deepEqual(fixtures.items, [], 'nenhum jogo fictício deve existir');
  assert.ok(fixtures.emptyReason, 'o motivo da lista vazia deve ser informado');

  const opportunities = await (await fetch(`${baseUrl}/api/opportunities`)).json();
  assert.deepEqual(opportunities.opportunities, [], 'sem dados reais não há oportunidades');

  const config = await (await fetch(`${baseUrl}/api/config`)).json();
  assert.equal(config.filters.minOdd, 1.5);
  assert.equal(config.filters.preferredMinOdd, 1.5);
  assert.equal(config.filters.preferredMaxOdd, 1.8);
  assert.equal(config.provider.configured, false);

  const history = await (await fetch(`${baseUrl}/api/history`)).json();
  assert.equal(history.totals.count, 0, 'histórico começa vazio, sem resultados inventados');

  const settle = await fetch(`${baseUrl}/api/settle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok([401, 403].includes(settle.status), 'rota administrativa exige token quando ADMIN_TOKEN está definido');

  const notFound = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(notFound.status, 404);

  const headers = await fetch(`${baseUrl}/api/status`);
  assert.equal(headers.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(!logs.join('').includes('undefined'), 'o servidor não deve registrar erros de undefined na inicialização');
});
