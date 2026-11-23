/**
 * Diagnóstico do backtest: mostra por que partidas encerradas reais são
 * descartadas (histórico por equipe, linha de base da liga ou bloqueio do motor).
 * Uso: node scripts/diag-backtest.mjs
 */
process.env.HISTORY_DAYS = process.env.HISTORY_DAYS ?? '2';

const { all, get } = await import('../server/db.js');
const { syncRecentFinished } = await import('../server/services/ingest.js');
const { runBacktest } = await import('../server/services/backtest.js');

console.log('--- sincronizando histórico recente ---');
try {
  const result = await syncRecentFinished();
  console.log('sync:', JSON.stringify({ fixtures: result.fixtures, stats: result.stats, days: result.days }));
} catch (error) {
  console.log('sync falhou:', error.message);
}

const byStatus = all('SELECT status, COUNT(*) AS n FROM fixtures GROUP BY status ORDER BY n DESC');
console.log('fixtures por status:', JSON.stringify(byStatus));

const finished = get(
  "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'FINISHED' AND home_goals IS NOT NULL AND away_goals IS NOT NULL",
)?.n ?? 0;
console.log('encerradas com placar:', finished);

const stats = get('SELECT COUNT(*) AS n FROM team_match_stats')?.n ?? 0;
const teams = get('SELECT COUNT(DISTINCT team_id) AS n FROM team_match_stats')?.n ?? 0;
console.log('team_match_stats:', stats, 'times:', teams);

const perTeam = all(
  'SELECT team_id, COUNT(*) AS n FROM team_match_stats GROUP BY team_id ORDER BY n DESC LIMIT 5',
);
console.log('top times por jogos no histórico:', JSON.stringify(perTeam));

const dist = all(
  `SELECT CASE WHEN n >= 5 THEN '5+' WHEN n >= 3 THEN '3-4' WHEN n >= 1 THEN '1-2' ELSE '0' END AS bucket,
          COUNT(*) AS teams
     FROM (SELECT team_id, COUNT(*) AS n FROM team_match_stats GROUP BY team_id) GROUP BY bucket`,
);
console.log('distribuição de jogos por equipe:', JSON.stringify(dist));

const result = runBacktest({ maxFixtures: 150 });
console.log('backtest:', JSON.stringify({
  runId: result.runId,
  empty: result.empty ?? false,
  reason: result.reason ?? null,
  fixturesEvaluated: result.fixturesEvaluated,
  fixturesSkipped: result.fixturesSkipped,
  skipReasons: result.skipReasons ?? null,
  markets: result.totals?.markets ?? 0,
  hitRate: result.totals?.hitRate ?? null,
  brier: result.totals?.brier ?? null,
}));
process.exit(0);
