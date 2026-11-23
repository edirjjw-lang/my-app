import { config } from './config.js';
import { get, logEvent, nowIso } from './db.js';
import { getProvider } from './provider/index.js';
import { syncDate, syncLive, syncRecentFinished, syncSchedule, syncTeamHistory } from './services/ingest.js';
import { settlePendingRecommendations } from './services/history.js';
import { runBacktest } from './services/backtest.js';

export const schedulerState = {
  running: false,
  enabled: config.sync.enabled,
  providerConfigured: false,
  startedAt: null,
  lastLiveAt: null,
  lastLiveResult: null,
  lastScheduledAt: null,
  lastScheduledResult: null,
  lastHistoryAt: null,
  lastSettlementAt: null,
  lastBacktestAt: null,
  lastBacktestResult: null,
  lastError: null,
  cycles: 0,
};

const timers = [];

async function guard(name, fn) {
  try {
    return await fn();
  } catch (error) {
    schedulerState.lastError = { scope: name, message: error.message, at: nowIso() };
    logEvent('error', `scheduler:${name}`, error.message);
    return null;
  }
}

/**
 * Aquece o histórico das equipes que estão jogando agora, com orçamento
 * limitado de requisições para não estourar a cota do provedor.
 */
async function warmLiveHistories() {
  const { all } = await import('./db.js');
  const rows = all(
    "SELECT DISTINCT home_team_id, away_team_id FROM fixtures WHERE status IN ('LIVE','HT') LIMIT 4",
  );
  const teamIds = new Set();
  for (const row of rows) {
    teamIds.add(row.home_team_id);
    teamIds.add(row.away_team_id);
  }
  let budget = 6;
  for (const teamId of teamIds) {
    if (budget <= 0) break;
    const team = all('SELECT provider_id, history_synced_at FROM teams WHERE id = ?', [teamId])[0];
    if (!team?.provider_id) continue;
    if (team.history_synced_at && Date.now() - Date.parse(team.history_synced_at) < config.sync.historyIntervalMs) {
      continue;
    }
    await guard('history', () => syncTeamHistory(team.provider_id, { last: 10, budget: 4 }));
    budget -= 1;
  }
}

/**
 * Aquece o histórico das equipes dos próximos jogos, algumas por ciclo.
 * Sem isso as partidas agendadas ficam com amostra zero e nunca geram
 * análise — é o que libera as recomendações pré-jogo aos poucos.
 */
async function warmUpcomingHistories() {
  const { all } = await import('./db.js');
  const from = nowIso();
  const to = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const staleBefore = new Date(Date.now() - config.sync.historyIntervalMs).toISOString();
  const teams = all(
    `SELECT t.id, t.provider_id, MIN(f.kickoff_utc) AS next_kickoff
       FROM teams t
       JOIN fixtures f ON f.home_team_id = t.id OR f.away_team_id = t.id
      WHERE f.status = 'SCHEDULED' AND f.kickoff_utc BETWEEN ? AND ?
        AND (t.history_synced_at IS NULL OR t.history_synced_at < ?)
      GROUP BY t.id
      ORDER BY next_kickoff ASC
      LIMIT 25`,
    [from, to, staleBefore],
  );
  for (const team of teams) {
    if (!team.provider_id) continue;
    await guard('history-upcoming', () => syncTeamHistory(team.provider_id, { last: 10, budget: 5 }));
  }
}

async function liveCycle() {
  const result = await guard('live', () => syncLive());
  schedulerState.lastLiveAt = nowIso();
  schedulerState.lastLiveResult = result;
  schedulerState.cycles += 1;
  await guard('settlement', () => settlePendingRecommendations());
  schedulerState.lastSettlementAt = nowIso();
  await warmLiveHistories();
  await warmUpcomingHistories();
}

async function scheduledCycle() {
  // Janela completa: todos os jogos de todas as ligas em todos os dias configurados.
  const result = await guard('scheduled', () => syncSchedule({ days: config.sync.scheduleDays }));
  schedulerState.lastScheduledResult = result;
  schedulerState.lastScheduledAt = nowIso();
}

const BACKTEST_MIN_FINISHED = 20;
const BACKTEST_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Valida o modelo contra partidas já encerradas (backtest cronológico: cada
 * jogo é previsto só com dados anteriores a ele, sem vazamento de futuro) e
 * grava o resultado no banco. É isso que faz o histórico provar algo: sem a
 * validação, a aba só mostraria recomendações em aberto.
 */
async function modelValidationCycle() {
  const finished =
    get(
      "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'FINISHED' AND home_goals IS NOT NULL AND away_goals IS NOT NULL",
    )?.n ?? 0;
  if (finished < BACKTEST_MIN_FINISHED) return;

  const last = get('SELECT created_at FROM backtest_runs ORDER BY id DESC LIMIT 1');
  if (last?.created_at && Date.now() - Date.parse(last.created_at) < BACKTEST_INTERVAL_MS) return;

  const result = await guard('backtest', () => runBacktest({ maxFixtures: 150 }));
  schedulerState.lastBacktestAt = nowIso();
  schedulerState.lastBacktestResult = result
    ? {
        runId: result.runId,
        fixturesEvaluated: result.fixturesEvaluated,
        markets: result.totals?.markets ?? 0,
      }
    : null;
}

async function historyCycle() {
  await guard('history-finished', () => syncRecentFinished());
  await warmUpcomingHistories();
  await modelValidationCycle();
  schedulerState.lastHistoryAt = nowIso();
}

export function startScheduler() {
  const provider = getProvider();
  schedulerState.providerConfigured = provider.configured;
  if (!config.sync.enabled) {
    logEvent('info', 'scheduler', 'Sincronização automática desativada por configuração.');
    return schedulerState;
  }
  if (!provider.configured) {
    logEvent('warn', 'scheduler', 'Sincronização automática em espera: a fonte de dados não está configurada.');
    return schedulerState;
  }
  if (schedulerState.running) return schedulerState;
  schedulerState.running = true;
  schedulerState.startedAt = nowIso();

  const boot = async () => {
    await scheduledCycle();
    await historyCycle();
    await liveCycle();
  };
  boot();

  timers.push(setInterval(liveCycle, config.sync.liveIntervalMs));
  timers.push(setInterval(scheduledCycle, config.sync.scheduledIntervalMs));
  timers.push(setInterval(historyCycle, config.sync.historyIntervalMs));
  logEvent('info', 'scheduler', 'Sincronização automática iniciada.');
  return schedulerState;
}

export function stopScheduler() {
  while (timers.length) clearInterval(timers.pop());
  schedulerState.running = false;
}
