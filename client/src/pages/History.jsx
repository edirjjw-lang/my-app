import { fmt, GROUP_LABEL, useApi } from '../api.js';
import { Alert, Chip, Kpi, Loading, Panel, SectionHead } from '../components/ui.jsx';

const STATUS_CHIP = {
  GREEN: { tone: 'green', label: 'GREEN' },
  RED: { tone: 'red', label: 'RED' },
  VOID: { tone: 'muted', label: 'ANULADA' },
  PENDING: { tone: 'blue', label: 'EM ABERTO' },
};

export default function History({ navigate }) {
  const { data, error, loading, reload } = useApi('/history?limit=200', { refreshMs: 60_000 });

  if (loading && !data) return <div style={{ marginTop: 18 }}><Loading rows={4} /></div>;
  if (error && !data) {
    return (
      <div className="section">
        <Alert tone="error" title="Histórico indisponível">{error.message}</Alert>
      </div>
    );
  }

  const totals = data?.totals ?? {};
  const hasDecided = (totals.count ?? 0) > 0;

  return (
    <>
      <div className="section">
        <SectionHead
          eyebrow="Transparência"
          title="Histórico e desempenho"
          subtitle="Todas as recomendações são registradas, inclusive as erradas. Resultados negativos nunca são ocultados."
          action={<button type="button" className="btn sm" onClick={() => reload()}>Atualizar</button>}
        />
        <div className="grid kpi">
          <Kpi label="Taxa de acerto" value={fmt.pct(totals.hitRate)} hint={`${totals.wins ?? 0} acertos em ${totals.count ?? 0}`} />
          <Kpi
            label="ROI teórico"
            value={fmt.pct(totals.roi)}
            hint={`${fmt.money(totals.profit)} sobre ${fmt.money(totals.staked)}`}
            tone={Number.isFinite(totals.roi) ? (totals.roi >= 0 ? 'var(--green)' : 'var(--red)') : undefined}
          />
          <Kpi label="Análises registradas" value={totals.recorded ?? 0} hint={`${totals.pending ?? 0} em aberto · ${totals.voided ?? 0} anuladas`} />
          <Kpi label="Brier Score" value={fmt.num(totals.brier, 4)} hint={`Log Loss ${fmt.num(totals.logLoss, 4)}`} />
        </div>
      </div>

      {!hasDecided ? (
        <div className="section">
          <Alert tone="warn" title="Ainda não há recomendações liquidadas">
            O histórico é preenchido com recomendações reais geradas a partir dos dados da sua API. Quando as partidas
            terminarem, o sistema liquida automaticamente GREEN/RED e calcula ROI, Brier Score e Log Loss.
          </Alert>
        </div>
      ) : null}

      <section className="section">
        <SectionHead eyebrow="Por mercado" title="Desempenho por grupo" />
        <Panel className="tight">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Análises</th>
                  <th>Acertos</th>
                  <th>Taxa</th>
                  <th>ROI</th>
                  <th>Lucro</th>
                  <th>Brier</th>
                  <th>Log Loss</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byGroup ?? []).length ? (
                  data.byGroup.map((row) => (
                    <tr key={row.group}>
                      <td>{GROUP_LABEL[row.group] ?? row.group}</td>
                      <td className="mono">{row.count}</td>
                      <td className="mono">{row.wins}</td>
                      <td className="mono">{fmt.pct(row.hitRate)}</td>
                      <td className="mono" style={{ color: row.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmt.pct(row.roi)}
                      </td>
                      <td className="mono">{fmt.money(row.profit)}</td>
                      <td className="mono">{fmt.num(row.brier, 3)}</td>
                      <td className="mono">{fmt.num(row.logLoss, 3)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="muted small">Sem dados liquidados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="section">
        <SectionHead eyebrow="Calibração" title="Probabilidade estimada x resultado real" subtitle="Quanto mais próximos os pontos da diagonal, melhor calibrado o modelo." />
        <Panel className="tight">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Faixa</th>
                  <th>Amostras</th>
                  <th>Prob. média</th>
                  <th>Frequência real</th>
                  <th>Desvio</th>
                </tr>
              </thead>
              <tbody>
                {(data?.calibration ?? []).length ? (
                  data.calibration.map((bucket) => (
                    <tr key={bucket.label}>
                      <td>{bucket.label}</td>
                      <td className="mono">{bucket.count}</td>
                      <td className="mono">{fmt.pct(bucket.avgProbability)}</td>
                      <td className="mono">{fmt.pct(bucket.observed)}</td>
                      <td className="mono">{fmt.signed((bucket.observed - bucket.avgProbability) * 100, 1)} p.p.</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="muted small">Sem amostras liquidadas para calibrar.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="section">
        <SectionHead eyebrow="Mercados específicos" title="Desempenho por mercado" />
        <Panel className="tight">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th>Análises</th>
                  <th>Taxa</th>
                  <th>ROI</th>
                  <th>Lucro</th>
                  <th>Prob. média</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byMarket ?? []).length ? (
                  data.byMarket.map((row) => (
                    <tr key={row.marketKey}>
                      <td className="mono tiny">{row.marketKey}</td>
                      <td className="mono">{row.count}</td>
                      <td className="mono">{fmt.pct(row.hitRate)}</td>
                      <td className="mono" style={{ color: row.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmt.pct(row.roi)}
                      </td>
                      <td className="mono">{fmt.money(row.profit)}</td>
                      <td className="mono">{fmt.pct(row.avgProbability)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="muted small">Sem dados liquidados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="section">
        <SectionHead eyebrow="Registro completo" title="Recomendações" subtitle="Inclui entradas em aberto, anuladas e perdedoras." />
        <div className="stack">
          {(data?.recommendations ?? []).length ? (
            data.recommendations.map((item) => {
              const chip = STATUS_CHIP[item.status] ?? STATUS_CHIP.PENDING;
              return (
                <Panel key={item.id} className="tight">
                  <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="small" style={{ fontWeight: 700 }}>
                        {item.fixture?.home ?? 'Casa'} x {item.fixture?.away ?? 'Fora'}
                      </div>
                      <div className="tiny muted">
                        {item.fixture?.competition ?? '—'} · {fmt.dateTime(item.fixture?.kickoffUtc ?? item.createdAt)}
                        {item.fixture?.homeGoals !== null && item.fixture?.homeGoals !== undefined
                          ? ` · placar ${item.fixture.homeGoals}-${item.fixture.awayGoals}`
                          : ''}
                      </div>
                    </div>
                    <div className="wrap">
                      <Chip tone={chip.tone}>{chip.label}</Chip>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => navigate(`/jogo/${item.fixtureId}`)}
                      >
                        Abrir jogo
                      </button>
                    </div>
                  </div>
                  <div className="market-numbers" style={{ marginTop: 8 }}>
                    <div className="metric"><span>Mercado</span><b>{item.label}</b></div>
                    <div className="metric"><span>Prob.</span><b>{fmt.pct(item.probability)}</b></div>
                    <div className="metric"><span>Confiança</span><b>{item.confidence}</b></div>
                    <div className="metric">
                      <span>Resultado</span>
                      <b style={{ color: item.profit > 0 ? 'var(--green)' : item.profit < 0 ? 'var(--red)' : undefined }}>
                        {Number.isFinite(item.profit) ? fmt.money(item.profit) : '—'}
                      </b>
                    </div>
                  </div>
                </Panel>
              );
            })
          ) : (
            <Panel><p className="small muted">Nenhuma recomendação registrada ainda.</p></Panel>
          )}
        </div>
      </section>
    </>
  );
}
