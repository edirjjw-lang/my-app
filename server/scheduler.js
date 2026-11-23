import { config } from './config.js';
import { logEvent, nowIso } from './db.js';
import { getProvider } from './provider/index.js';
import { syncDate, syncLive, syncRecentFinished, syncSchedule, syncTeamHistory } from './services/ingest.js';
import { settlePendingRecommendations } from './services/history.js';

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
  let budget = 2;
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
    `SELECT t.id, t.provider_id
       FROM teams t
      WHERE t.id IN (
              SELECT home_team_id FROM fixtures
               WHERE status = 'SCHEDULED' AND kickoff_utc BETWEEN ? AND ?
              UNION
              SELECT away_team_id FROM fixtures
               WHERE status = 'SCHEDULED' AND kickoff_utc BETWEEN ? AND ?
            )
        AND (t.history_synced_at IS NULL OR t.history_synced_at < ?)
      LIMIT 3`,
    [from, to, from, to, staleBefore],
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

async function historyCycle() {
  await guard('history-finished', () => syncRecentFinished());
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
