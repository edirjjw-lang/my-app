import { useMemo, useState } from 'react';
import { api, fmt, GROUP_LABEL, useApi } from '../api.js';
import {
  Alert,
  Chip,
  ConfidenceChip,
  Loading,
  MarketRow,
  Metric,
  Panel,
  QualityChip,
  SectionHead,
  StatCompare,
  StatusChip,
} from '../components/ui.jsx';

const GROUP_TABS = ['TODOS', 'GOLS', 'ESCANTEIO', 'RESULTADO'];

function injuryText(injury) {
  if (!injury) return '';
  if (typeof injury === 'string') return injury;
  const player = injury.player ?? injury.name ?? injury.playerName ?? '';
  const team = injury.team === 'home' ? 'Casa' : injury.team === 'away' ? 'Fora' : injury.teamName ?? '';
  const reason = injury.reason ?? injury.type ?? '';
  return [player, team, reason].filter(Boolean).join(' · ');
}

export default function Match({ id, navigate }) {
  const { data, error, loading, reload } = useApi(`/fixtures/${id}`, { refreshMs: 30_000 });
  const [tab, setTab] = useState('TODOS');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState(null);

  const analysis = data?.analysis;
  const fixture = data?.fixture;

  const markets = useMemo(() => {
    const list = analysis?.markets ?? [];
    const filtered = tab === 'TODOS' ? list : list.filter((market) => market.group === tab);
    return [...filtered].sort((a, b) => {
      const aRec = a.entry === 'RECOMENDADA' ? 1 : 0;
      const bRec = b.entry === 'RECOMENDADA' ? 1 : 0;
      if (aRec !== bRec) return bRec - aRec;
      return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
    });
  }, [analysis, tab]);

  async function forceRefresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const result = await api(`/fixtures/${id}?refresh=1`);
      setRefreshMsg(result?.refresh?.reason || (result?.refresh?.refreshed ? 'Dados atualizados agora.' : 'Atualização concluída.'));
      await reload(true);
    } catch (requestError) {
      setRefreshMsg(requestError.message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !data) return <div style={{ marginTop: 18 }}><Loading rows={4} /></div>;

  if (error && !data) {
    return (
      <div className="section">
        <Alert tone="error" title="Não foi possível carregar a partida">
          {error.message}
        </Alert>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => navigate('/')}>
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  if (!fixture || !analysis) {
    return (
      <div className="section">
        <Alert title="Partida não encontrada">Volte ao início e escolha uma partida da lista.</Alert>
      </div>
    );
  }

  const stats = fixture.stats ?? {};
  const recommended = analysis.recommended ?? [];
  const blocked = analysis.blocked || analysis.quality?.level === 'INSUFICIENTE';

  return (
    <>
      <div className="section">
        <button type="button" className="btn sm ghost" onClick={() => navigate('/')}>
          ← Voltar
        </button>
      </div>

      <Panel className="hero" style={{ marginTop: 12 }}>
        <div className="wrap">
          <StatusChip status={fixture.status} minute={fixture.minute} />
          {fixture.competition?.name ? <Chip tone="muted">{fixture.competition.name}</Chip> : null}
          <QualityChip quality={analysis.quality} />
          {fixture.hasStats ? <Chip tone="green">Estatísticas</Chip> : <Chip tone="amber">Sem estatísticas</Chip>}
          {fixture.hasOdds ? <Chip tone="blue">Odds reais</Chip> : <Chip tone="amber">Sem odds</Chip>}
          {fixture.hasLineups ? <Chip tone="blue">Escalações</Chip> : null}
        </div>
        <h1 style={{ marginTop: 14 }}>
          {fixture.home.name} <span className="muted" style={{ fontWeight: 500 }}>x</span> {fixture.away.name}
        </h1>
        <div className="wrap" style={{ marginTop: 8 }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 800 }} className="mono">
            {fixture.score.home ?? 0} – {fixture.score.away ?? 0}
          </span>
          <span className="muted small">
            {fixture.status === 'SCHEDULED'
              ? `Início ${fmt.dateTime(fixture.kickoffUtc)}`
              : `1º tempo: ${fixture.score.htHome ?? '—'} – ${fixture.score.htAway ?? '—'}`}
          </span>
        </div>
        <div className="wrap" style={{ marginTop: 10 }}>
          <span className="tiny muted">Dados: {fixture.dataSource ?? 'provedor'} · atualizado {fmt.relative(fixture.updatedAt)}</span>
          {fixture.status === 'LIVE' || fixture.status === 'HT' ? (
            <button type="button" className="btn sm" onClick={forceRefresh} disabled={refreshing}>
              {refreshing ? 'Atualizando…' : 'Atualizar dados'}
            </button>
          ) : null}
        </div>
        {refreshMsg ? <div className="tiny muted" style={{ marginTop: 6 }}>{refreshMsg}</div> : null}
      </Panel>

      {blocked ? (
        <div className="section">
          <Alert tone="warn" title="Recomendações bloqueadas para esta partida">
            {analysis.quality?.missing?.length ? (
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {analysis.quality.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              'Dados insuficientes ou desatualizados. Nenhuma entrada é sugerida.'
            )}
          </Alert>
        </div>
      ) : null}

      <section className="section">
        <SectionHead eyebrow="Modelo" title="Probabilidades estimadas" subtitle={`Versão do modelo: ${analysis.modelVersion}`} />
        <div className="grid kpi">
          <div className="kpi-card">
            <div className="label">Gols esperados (casa)</div>
            <div className="value">{fmt.num(analysis.lambdas?.home)}</div>
            <div className="hint">λ Poisson</div>
          </div>
          <div className="kpi-card">
            <div className="label">Gols esperados (fora)</div>
            <div className="value">{fmt.num(analysis.lambdas?.away)}</div>
            <div className="hint">λ Poisson</div>
          </div>
          <div className="kpi-card">
            <div className="label">Escanteios esperados</div>
            <div className="value">{fmt.num(analysis.lambdas?.cornersTotal, 1)}</div>
            <div className="hint">binomial negativa</div>
          </div>
          <div className="kpi-card">
            <div className="label">Amostra por equipe</div>
            <div className="value">{analysis.quality?.sample ?? 0}</div>
            <div className="hint">últimos jogos analisados</div>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead
          eyebrow="Ao vivo" 
          title="Estatísticas da partida"
          subtitle={fixture.hasStats ? 'Dados reais do provedor' : 'O provedor ainda não enviou estatísticas para esta partida'}
        />
        <Panel>
          {fixture.hasStats ? (
            <div className="stat-compare">
              <StatCompare label="Escanteios" home={stats.corners?.home} away={stats.corners?.away} />
              <StatCompare label="Finalizações" home={stats.shots?.home} away={stats.shots?.away} />
              <StatCompare label="Finalizações no gol" home={stats.shotsOn?.home} away={stats.shotsOn?.away} />
              <StatCompare label="Posse de bola" home={stats.possession?.home} away={stats.possession?.away} suffix="%" />
              <StatCompare label="Cartões" home={stats.cards?.home} away={stats.cards?.away} />
              <StatCompare label="Ataques perigosos" home={stats.dangerousAttacks?.home} away={stats.dangerousAttacks?.away} />
            </div>
          ) : (
            <p className="small muted">
              Sem estatísticas não há cálculo de escanteios, pressão ou ritmo. As recomendações ficam limitadas ou bloqueadas
              em vez de usar números inventados.
            </p>
          )}
          {analysis.live ? (
            <div className="grid kpi" style={{ marginTop: 14 }}>
              <Metric label="Minuto" value={`${analysis.live.minute ?? '—'}'`} />
              <Metric label="Ritmo" value={fmt.num(analysis.live.tempoFactor)} />
              <Metric label="Gols restantes (projeção)" value={fmt.num(analysis.live.projectedRemainingGoals)} />
              <Metric label="Fonte do ritmo" value={analysis.live.tempoSource} />
            </div>
          ) : null}
        </Panel>
      </section>

      {analysis.h2h || analysis.injuries?.length || analysis.lineups ? (
        <section className="section">
          <SectionHead eyebrow="Contexto" title="Confrontos, escalações e desfalques" />
          <div className="grid two">
            <Panel>
              <h3>Histórico de confrontos</h3>
              {analysis.h2h ? (
                <p className="small muted" style={{ marginTop: 6 }}>
                  {analysis.h2h.matches ?? analysis.h2h.count ?? 0} confronto(s) na amostra · média de gols{' '}
                  {fmt.num(analysis.h2h.avgGoals ?? analysis.h2h.avgTotalGoals)} · ajuste aplicado{' '}
                  {fmt.num(analysis.lambdas?.h2hAdjustment, 3)}
                </p>
              ) : (
                <p className="small muted" style={{ marginTop: 6 }}>Sem histórico suficiente entre as equipes.</p>
              )}
            </Panel>
            <Panel>
              <h3>Escalações e desfalques</h3>
              {analysis.lineups ? <p className="small muted" style={{ marginTop: 6 }}>Escalações disponíveis no provedor.</p> : null}
              {analysis.injuries?.length ? (
                <div className="list" style={{ marginTop: 8 }}>
                  {analysis.injuries.slice(0, 8).map((injury, index) => (
                    <div className="list-item risk" key={index}>
                      <span className="bullet">!</span>
                      <span className="small">{injuryText(injury)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small muted" style={{ marginTop: 6 }}>Provedor não informou desfalques para esta partida.</p>
              )}
            </Panel>
          </div>
        </section>
      ) : null}

      <section className="section">
        <SectionHead
          eyebrow="Mercados"
          title={recommended.length ? `${recommended.length} entrada(s) recomendada(s)` : 'Sem entrada recomendada'}
          subtitle="Probabilidade, odd justa, odd de mercado, vantagem e confiança por mercado"
        />
        <div className="tabs" style={{ marginBottom: 12 }}>
          {GROUP_TABS.map((item) => (
            <button
              key={item}
              type="button"
              className={`tab ${tab === item ? 'active' : ''}`}
              onClick={() => setTab(item)}
            >
              {item === 'TODOS' ? 'Todos' : GROUP_LABEL[item] ?? item}
            </button>
          ))}
        </div>
        <div className="stack">
          {markets.length ? (
            markets.map((market) => <MarketRow key={market.marketKey} market={market} />)
          ) : (
            <Panel>
              <p className="small muted">Nenhum mercado calculado para este filtro.</p>
            </Panel>
          )}
        </div>
        {!recommended.length && analysis.noEntryReasons?.length ? (
          <div className="section">
            <Alert tone="warn" title="Motivos para não recomendar">
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {analysis.noEntryReasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </Alert>
          </div>
        ) : null}
      </section>

      {analysis.recommended?.length ? (
        <section className="section">
          <SectionHead eyebrow="IA" title="Justificativas das entradas recomendadas" />
          <div className="stack">
            {analysis.recommended.map((market) => (
              <Panel key={market.marketKey}>
                <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <h3>{market.label}</h3>
                  <div className="wrap">
                    <ConfidenceChip value={market.confidence} />
                    <Chip tone="green">Odd {fmt.odds(market.bookmakerOdds)}</Chip>
                  </div>
                </div>
                <p className="small muted" style={{ marginTop: 8 }}>{market.rationale}</p>
                <div className="grid two" style={{ marginTop: 10 }}>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>Fatores favoráveis</div>
                    <div className="list">
                      {(market.factors ?? []).map((factor, index) => (
                        <div className="list-item" key={index}>
                          <span className="bullet">+</span>
                          <span className="small">{factor}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--amber)' }}>Riscos</div>
                    <div className="list">
                      {(market.risks ?? []).map((risk, index) => (
                        <div className="list-item risk" key={index}>
                          <span className="bullet">!</span>
                          <span className="small">{risk}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
