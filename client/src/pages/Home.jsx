import { fmt, GROUP_LABEL, useApi } from '../api.js';
import {
  Alert,
  Chip,
  ConfidenceChip,
  EdgeText,
  EmptyState,
  Kpi,
  Loading,
  Panel,
  ProbBar,
  SectionHead,
  StatusChip,
} from '../components/ui.jsx';

function FixtureLine({ item, navigate }) {
  const { fixture, best, recommendedCount, blocked, quality } = item;
  return (
    <Panel className="fixture-card">
      <div className="between" style={{ alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <div className="wrap" style={{ gap: 6 }}>
            <StatusChip status={fixture.status} minute={fixture.minute} />
            {fixture.competition?.name ? <span className="tiny muted">{fixture.competition.name}</span> : null}
          </div>
          <div style={{ marginTop: 8, fontWeight: 700, fontSize: '1.02rem' }}>
            {fixture.home.name} <span className="muted">x</span> {fixture.away.name}
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {fixture.status === 'SCHEDULED'
              ? `Início ${fmt.dateTime(fixture.kickoffUtc)}`
              : `${fixture.score.home ?? 0} – ${fixture.score.away ?? 0}${fixture.minute ? ` · ${fixture.minute}'` : ''}`}
            {quality?.level ? ` · dados: ${quality.level.toLowerCase()}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: '0 1 200px' }}>
          {blocked ? (
            <Chip tone="amber">Bloqueado</Chip>
          ) : best ? (
            <>
              <div className="tiny muted">{GROUP_LABEL[best.group] ?? best.group}</div>
              <div className="small" style={{ fontWeight: 700, marginTop: 2 }}>{best.label}</div>
              <div className="wrap" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                <ConfidenceChip value={best.confidence} />
                <Chip tone="green">Odd {fmt.odds(best.bookmakerOdds)}</Chip>
              </div>
              <div className="tiny muted" style={{ marginTop: 6 }}>
                Prob. {fmt.pct(best.probability)} · justa {fmt.odds(best.fairOdds)} · <EdgeText edge={best.edge} />
              </div>
            </>
          ) : (
            <Chip tone="muted">Sem entrada</Chip>
          )}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn sm" onClick={() => navigate(`/jogo/${fixture.id}`)}>
              Analisar
            </button>
          </div>
        </div>
      </div>
      {!blocked && recommendedCount > 1 ? (
        <div className="tiny muted" style={{ marginTop: 8 }}>{recommendedCount} entradas recomendadas nesta partida.</div>
      ) : null}
    </Panel>
  );
}

export default function Home({ navigate }) {
  const status = useApi('/status', { refreshMs: 60_000 });
  const live = useApi('/fixtures?status=LIVE&limit=12', { refreshMs: 45_000 });
  const upcoming = useApi('/fixtures?status=SCHEDULED&limit=10', { refreshMs: 120_000 });
  const opportunities = useApi('/opportunities?limit=12', { refreshMs: 45_000 });
  const history = useApi('/history?limit=1', { refreshMs: 120_000 });

  const provider = status.data?.provider;
  const configured = provider?.configured;
  const lastUpdate = live.data?.generatedAt ?? status.data?.app?.now;
  const opportunitiesList = opportunities.data?.opportunities ?? [];
  const liveItems = live.data?.items ?? [];
  const upcomingItems = upcoming.data?.items ?? [];
  const totals = history.data?.totals ?? {};
  const highConfidence = opportunitiesList.filter((item) => item.market?.confidence === 'ALTA');

  return (
    <>
      <Panel className="hero">
        <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="eyebrow">Análise estatística com modelos probabilísticos</div>
            <h1 style={{ marginTop: 8 }}>
              Decisões com <span style={{ color: 'var(--green)' }}>probabilidade calculada</span>
            </h1>
            <p className="muted small" style={{ marginTop: 8, maxWidth: 620 }}>
              Poisson para gols, binomial negativa para escanteios e avaliação de vantagem contra a odd real do mercado.
              Sem dados suficientes, o app mostra <b>SEM ENTRADA RECOMENDADA</b> — nunca inventa probabilidades.
            </p>
          </div>
          <div className="stack" style={{ minWidth: 200 }}>
            <div className="wrap">
              <Chip tone={configured ? 'green' : 'amber'} dot>
                {configured ? `Provedor: ${provider?.label ?? 'conectado'}` : 'API não configurada'}
              </Chip>
              {status.data?.sync?.state?.enabled ? <Chip tone="green">Auto-sync ativo</Chip> : null}
            </div>
            <div className="tiny muted">Última atualização: {lastUpdate ? fmt.relative(lastUpdate) : '—'}</div>
          </div>
        </div>
      </Panel>

      {!configured && status.data ? (
        <div className="section">
          <Alert tone="warn" title="Falta conectar sua API de futebol">
            O sistema já está completo, mas sem a chave não há jogos reais para analisar. Adicione{' '}
            <b>FOOTBALL_API_KEY</b> em Settings → Environment variables (a chave fica só no backend). Depois a sincronização
            automática busca jogos ao vivo, estatísticas, odds, escalações e desfalques.
          </Alert>
        </div>
      ) : null}

      <section className="section">
        <div className="grid kpi">
          <Kpi label="Jogos ao vivo" value={liveItems.length} hint={live.data?.count ? `${live.data.count} em análise` : 'sem jogos no momento'} />
          <Kpi label="Oportunidades" value={opportunitiesList.length} hint="filtro de odd 1.50–1.80 e vantagem" />
          <Kpi label="Alta confiança" value={highConfidence.length} hint="somente dados completos" />
          <Kpi
            label="Taxa de acerto"
            value={fmt.pct(totals.hitRate)}
            hint={`ROI ${fmt.pct(totals.roi)} · ${totals.count ?? 0} liquidadas`}
            tone={Number.isFinite(totals.roi) ? (totals.roi >= 0 ? 'var(--green)' : 'var(--red)') : undefined}
          />
        </div>
      </section>

      <section className="section">
        <SectionHead
          eyebrow="Ao vivo"
          title="Jogos em andamento"
          subtitle="Análises recalculadas com minuto, placar, escanteios, finalizações e pressão quando o provedor envia esses dados."
          action={
            <button type="button" className="btn sm" onClick={() => { live.reload(); opportunities.reload(); }}>
              Atualizar
            </button>
          }
        />
        {live.loading && !live.data ? (
          <Loading rows={3} />
        ) : liveItems.length ? (
          <div className="stack">
            {liveItems.map((item) => (
              <FixtureLine key={item.fixture.id} item={item} navigate={navigate} />
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhum jogo ao vivo agora">
            {live.data?.emptyReason ?? 'A sincronização automática atualiza esta lista a cada minuto.'}
          </EmptyState>
        )}
      </section>

      <section className="section">
        <SectionHead eyebrow="Filtro de oportunidades" title="Entradas com vantagem estatística" subtitle="Odd mínima 1.50 · faixa preferencial 1.50 a 1.80 · descarta dados incompletos" />
        {opportunities.loading && !opportunities.data ? (
          <Loading rows={2} />
        ) : opportunitiesList.length ? (
          <div className="stack">
            {opportunitiesList.map((item) => (
              <Panel key={`${item.fixture.id}-${item.market.marketKey}`} className="tight">
                <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="wrap" style={{ gap: 6 }}>
                      <StatusChip status={item.fixture.status} minute={item.fixture.minute} />
                      <Chip tone="muted">{GROUP_LABEL[item.market.group] ?? item.market.group}</Chip>
                      {item.market.preferred ? <Chip tone="green">Faixa preferencial</Chip> : null}
                    </div>
                    <div className="small" style={{ fontWeight: 700, marginTop: 6 }}>
                      {item.fixture.home.name} x {item.fixture.away.name}
                    </div>
                    <div className="tiny muted">{item.market.label}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="wrap" style={{ justifyContent: 'flex-end' }}>
                      <ConfidenceChip value={item.market.confidence} />
                      <Chip tone="green">Odd {fmt.odds(item.market.bookmakerOdds)}</Chip>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                      Prob. {fmt.pct(item.market.probability)} · justa {fmt.odds(item.market.fairOdds)} · <EdgeText edge={item.market.edge} />
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <ProbBar probability={item.market.probability} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="btn sm" onClick={() => navigate(`/jogo/${item.fixture.id}`)}>
                        Ver análise
                      </button>
                    </div>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        ) : (
          <EmptyState title="Sem entrada recomendada">
            {opportunities.data?.emptyReason ?? 'Nenhuma oportunidade atende aos filtros neste momento.'}
          </EmptyState>
        )}
      </section>

      <section className="section">
        <SectionHead eyebrow="Agenda" title="Próximos jogos" subtitle="Análise pré-jogo com histórico das equipes, casa/fora, H2H e desfalques." />
        {upcoming.loading && !upcoming.data ? (
          <Loading rows={2} />
        ) : upcomingItems.length ? (
          <div className="stack">
            {upcomingItems.map((item) => (
              <FixtureLine key={item.fixture.id} item={item} navigate={navigate} />
            ))}
          </div>
        ) : (
          <EmptyState title="Sem jogos agendados">
            {upcoming.data?.emptyReason ?? 'A agenda é preenchida pela sincronização automática.'}
          </EmptyState>
        )}
      </section>

      <section className="section">
        <SectionHead eyebrow="Transparência" title="Como o motor decide" />
        <Panel>
          <div className="list">
            <div className="list-item"><span className="bullet">1</span><span className="small">Perfil de cada equipe com últimos 5 e 10 jogos, peso maior para os mais recentes, casa/fora, gols, escanteios, finalizações e posse.</span></div>
            <div className="list-item"><span className="bullet">2</span><span className="small">Força ofensiva e defensiva ajustadas pela média da liga e encolhidas para amostras pequenas.</span></div>
            <div className="list-item"><span className="bullet">3</span><span className="small">Poisson bivariado para gols, binomial negativa para escanteios, com ajuste de H2H, primeiro/segundo tempo e ritmo ao vivo.</span></div>
            <div className="list-item"><span className="bullet">4</span><span className="small">Probabilidade comparada à odd real: sem vantagem, sem entrada. Dados velhos ou incompletos bloqueiam a recomendação.</span></div>
          </div>
        </Panel>
      </section>
    </>
  );
}
