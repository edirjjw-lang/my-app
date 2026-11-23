import { useState } from 'react';
import { api, fmt, getAdminToken, setAdminToken, useApi } from '../api.js';
import { Alert, Chip, Kpi, Loading, Panel, SectionHead } from '../components/ui.jsx';

function isoDate(offsetDays) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export default function Backtest() {
  const { data, loading, reload } = useApi('/backtest?limit=10', { refreshMs: 120_000 });
  const [token, setToken] = useState(getAdminToken());
  const [from, setFrom] = useState(isoDate(-30));
  const [to, setTo] = useState(isoDate(0));
  const [maxFixtures, setMaxFixtures] = useState(120);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    setAdminToken(token.trim());
    try {
      const response = await api('/backtest/run', {
        method: 'POST',
        body: { from, to, maxFixtures: Number(maxFixtures) || 120 },
      });
      setResult(response);
      await reload(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRunning(false);
    }
  }

  const totals = result?.totals;

  return (
    <>
      <div className="section">
        <SectionHead
          eyebrow="Módulo 2"
          title="Testes e validação"
          subtitle="O backtest reconstrói o modelo usando apenas partidas anteriores ao jogo avaliado — sem vazamento de dados futuros."
        />
        <Panel>
          <div className="grid form-grid">
            <label className="field">
              <span>De</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="field">
              <span>Até</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <label className="field">
              <span>Máx. de partidas</span>
              <input
                type="number"
                min="10"
                max="300"
                value={maxFixtures}
                onChange={(event) => setMaxFixtures(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Token administrativo</span>
              <input
                type="password"
                placeholder="ADMIN_TOKEN"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="between" style={{ marginTop: 12 }}>
            <span className="tiny muted">
              O token fica apenas neste navegador e é validado no backend. Sem ADMIN_TOKEN configurado, a rota responde bloqueada.
            </span>
            <button type="button" className="btn primary" onClick={run} disabled={running}>
              {running ? 'Executando…' : 'Rodar backtest'}
            </button>
          </div>
        </Panel>
      </div>

      {error ? (
        <div className="section">
          <Alert tone="error" title="Backtest não executado">{error}</Alert>
        </div>
      ) : null}

      {result?.empty ? (
        <div className="section">
          <Alert tone="warn" title="Nenhuma partida para avaliar">{result.reason}</Alert>
        </div>
      ) : null}

      {totals ? (
        <>
          <section className="section">
            <SectionHead eyebrow="Resultado" title={`${result.fixturesEvaluated} partida(s) avaliada(s)`} subtitle={`Período ${result.from?.slice(0, 10)} a ${result.to?.slice(0, 10)}`} />
            <div className="grid kpi">
              <Kpi label="Mercados avaliados" value={totals.markets} hint={`${totals.withOdds} com odd real`} />
              <Kpi label="Taxa de acerto" value={fmt.pct(totals.hitRate)} hint={`${totals.wins} acertos`} />
              <Kpi label="ROI teórico" value={fmt.pct(totals.roi)} hint={`${fmt.money(totals.profit)} sobre ${fmt.money(totals.staked)}`} tone={totals.roi >= 0 ? 'var(--green)' : 'var(--red)'} />
              <Kpi label="Brier / Log Loss" value={fmt.num(totals.brier, 4)} hint={`Log Loss ${fmt.num(totals.logLoss, 4)}`} />
            </div>
          </section>

          <section className="section">
            <SectionHead eyebrow="Por mercado" title="Desempenho no backtest" />
            <Panel className="tight">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mercado</th>
                      <th>Avaliações</th>
                      <th>Taxa</th>
                      <th>ROI</th>
                      <th>Brier</th>
                      <th>Log Loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.perMarket ?? []).map((row) => (
                      <tr key={row.marketKey}>
                        <td className="mono tiny">{row.marketKey}</td>
                        <td className="mono">{row.markets}</td>
                        <td className="mono">{fmt.pct(row.hitRate)}</td>
                        <td className="mono" style={{ color: row.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt.pct(row.roi)}</td>
                        <td className="mono">{fmt.num(row.brier, 3)}</td>
                        <td className="mono">{fmt.num(row.logLoss, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          <section className="section">
            <SectionHead eyebrow="Calibração" title="Probabilidade x frequência" />
            <Panel className="tight">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Faixa</th>
                      <th>Amostras</th>
                      <th>Prob. média</th>
                      <th>Frequência real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.calibration ?? []).map((bucket) => (
                      <tr key={bucket.label}>
                        <td>{bucket.label}</td>
                        <td className="mono">{bucket.count}</td>
                        <td className="mono">{fmt.pct(bucket.avgProbability)}</td>
                        <td className="mono">{fmt.pct(bucket.observed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>
        </>
      ) : null}

      <section className="section">
        <SectionHead eyebrow="Execuções" title="Backtests salvos" action={<button type="button" className="btn sm" onClick={() => reload()}>Atualizar</button>} />
        {loading && !data ? (
          <Loading rows={2} />
        ) : (
          <div className="stack">
            {(data?.runs ?? []).length ? (
              data.runs.map((run) => (
                <Panel key={run.id} className="tight">
                  <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div className="small" style={{ fontWeight: 700 }}>
                        {run.from_date?.slice(0, 10)} → {run.to_date?.slice(0, 10)}
                      </div>
                      <div className="tiny muted">
                        {run.fixtures ?? run.fixtures_evaluated ?? 0} partidas · {fmt.dateTime(run.created_at)}
                      </div>
                    </div>
                    <div className="wrap">
                      <Chip tone="blue">Acerto {fmt.pct(run.hit_rate)}</Chip>
                      <Chip tone={run.roi >= 0 ? 'green' : 'red'}>ROI {fmt.pct(run.roi)}</Chip>
                      <Chip tone="muted">Brier {fmt.num(run.brier, 3)}</Chip>
                    </div>
                  </div>
                </Panel>
              ))
            ) : (
              <Panel><p className="small muted">Nenhum backtest executado ainda.</p></Panel>
            )}
          </div>
        )}
      </section>
    </>
  );
}
