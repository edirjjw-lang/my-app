import { useState } from 'react';
import { fmt, GROUP_LABEL, useApi } from '../api.js';
import {
  Chip,
  ConfidenceChip,
  EmptyState,
  Kpi,
  Loading,
  Panel,
  ProbBar,
  SectionHead,
  StatusChip,
} from '../components/ui.jsx';

/** Estatísticas reais da partida em andamento (escanteios, finalizações, posse). */
function LiveStats({ fixture }) {
  const stats = fixture.stats ?? {};
  if (!fixture.hasStats) return null;
  const parts = [];
  if (stats.corners) parts.push(`Escanteios ${stats.corners.home ?? 0}–${stats.corners.away ?? 0}`);
  if (stats.shots) parts.push(`Finalizações ${stats.shots.home ?? 0}–${stats.shots.away ?? 0}`);
  if (stats.shotsOn) parts.push(`No gol ${stats.shotsOn.home ?? 0}–${stats.shotsOn.away ?? 0}`);
  if (stats.possession) parts.push(`Posse ${stats.possession.home ?? 0}%–${stats.possession.away ?? 0}%`);
  if (stats.cards) parts.push(`Cartões ${stats.cards.home ?? 0}–${stats.cards.away ?? 0}`);
  if (!parts.length) return null;
  return (
    <div className="wrap" style={{ gap: 10, marginTop: 6 }}>
      {parts.map((part) => (
        <span className="tiny muted" key={part}>
          {part}
        </span>
      ))}
    </div>
  );
}

/** O que a estatística projeta para um jogo que ainda não começou. */
function Projection({ lambdas }) {
  if (!Number.isFinite(lambdas?.home) || !Number.isFinite(lambdas?.away)) return null;
  return (
    <div className="wrap" style={{ gap: 10, marginTop: 6 }}>
      <span className="tiny muted">
        Gols esperados {fmt.num(lambdas.home)} x {fmt.num(lambdas.away)}
      </span>
      {Number.isFinite(lambdas.cornersTotal) ? (
        <span className="tiny muted">Escanteios esperados {fmt.num(lambdas.cornersTotal, 1)}</span>
      ) : null}
    </div>
  );
}

function BetSummary({ item }) {
  const { best } = item;
  if (!best) {
    return <Chip tone="muted">{item.blocked ? 'Sem dados suficientes' : 'Sem entrada'}</Chip>;
  }
  return (
    <>
      <div className="tiny muted">{GROUP_LABEL[best.group] ?? best.group}</div>
      <div className="small" style={{ fontWeight: 700, marginTop: 2 }}>
        {best.label}
      </div>
      <div className="wrap" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <ConfidenceChip value={best.confidence} />
        <Chip tone="blue">{fmt.pct(best.probability, 0)}</Chip>
      </div>
      <div style={{ marginTop: 6 }}>
        <ProbBar probability={best.probability} />
      </div>
    </>
  );
}

function FixtureLine({ item, navigate }) {
  const { fixture, best, blocked, quality, lambdas, recommendedCount } = item;
  const isLive = fixture.status === 'LIVE' || fixture.status === 'HT';
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
          </div>
          {isLive ? <LiveStats fixture={fixture} /> : <Projection lambdas={lambdas} />}
          {quality?.sample ? (
            <div className="tiny muted" style={{ marginTop: 4 }}>
              Base: {quality.sample} jogo(s) de cada equipe
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: 'right', flex: '0 1 200px' }}>
          <BetSummary item={item} />
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn sm" onClick={() => navigate(`/jogo/${fixture.id}`)}>
              Ver análise
            </button>
          </div>
        </div>
      </div>
      {!blocked && recommendedCount > 1 ? (
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {recommendedCount} apostas recomendadas nesta partida.
        </div>
      ) : null}
    </Panel>
  );
}

function groupByLeague(items) {
  const groups = new Map();
  for (const item of items) {
    const name = item.fixture.competition?.name ?? 'Outras ligas';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  return [...groups.entries()]
    .map(([name, groupItems]) => ({ name, items: groupItems }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Lista completa de jogos: todos aparecem, agrupados por liga. Listas grandes
 * começam resumidas e o usuário expande — nenhum jogo é descartado.
 */
function FixtureList({ items, navigate }) {
  const [showAll, setShowAll] = useState(false);
  const previewLimit = 20;
  const visible = showAll ? items : items.slice(0, previewLimit);
  const groups = groupByLeague(visible);
  const leagueCount = groupByLeague(items).length;

  return (
    <div className="stack">
      {items.length > previewLimit ? (
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="tiny muted">
            {items.length} jogos · {leagueCount} ligas
          </span>
          <button type="button" className="btn sm" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Mostrar menos' : `Ver todos os ${items.length} jogos`}
          </button>
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.name} className="stack">
          <div className="between" style={{ marginTop: 4 }}>
            <span className="small" style={{ fontWeight: 700 }}>
              {group.name}
            </span>
            <span className="tiny muted">{group.items.length} jogo(s)</span>
          </div>
          {group.items.map((item) => (
            <FixtureLine key={item.fixture.id} item={item} navigate={navigate} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Home({ navigate }) {
  // limit=all: todos os jogos coletados, de todas as ligas — nada é cortado.
  const live = useApi('/fixtures?status=LIVE&limit=all', { refreshMs: 45_000 });
  const upcoming = useApi('/fixtures?status=SCHEDULED&limit=all', { refreshMs: 120_000 });
  const opportunities = useApi('/opportunities?limit=12', { refreshMs: 45_000 });
  const history = useApi('/history?limit=1', { refreshMs: 120_000 });

  const lastUpdate = live.data?.generatedAt;
  const opportunitiesList = opportunities.data?.opportunities ?? [];
  const liveItems = live.data?.items ?? [];
  const upcomingItems = upcoming.data?.items ?? [];
  const totals = history.data?.totals ?? {};
  const highConfidence = opportunitiesList.filter((item) => item.market?.confidence === 'ALTA');
  const readyToBet = opportunitiesList.length;

  return (
    <>
      <Panel className="hero">
        <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="eyebrow">Análise estatística de futebol</div>
            <h1 style={{ marginTop: 8 }}>
              Os jogos de hoje e <span style={{ color: 'var(--green)' }}>o que apostar</span>
            </h1>
            <p className="muted small" style={{ marginTop: 8, maxWidth: 620 }}>
              Cada jogo é analisado com o histórico real das duas equipes: gols, escanteios, finalizações, posse, casa e fora
              e confrontos diretos. Quando os dados não bastam, o app mostra <b>SEM ENTRADA RECOMENDADA</b> em vez de
              inventar palpite.
            </p>
          </div>
          <div className="stack" style={{ minWidth: 180 }}>
            <div className="tiny muted">
              Última atualização: {lastUpdate ? fmt.relative(lastUpdate) : '—'}
            </div>
          </div>
        </div>
      </Panel>

      <section className="section">
        <div className="grid kpi">
          <Kpi
            label="Ao vivo agora"
            value={liveItems.length}
            hint={liveItems.length ? 'atualizando a cada minuto' : 'nenhum jogo em andamento'}
          />
          <Kpi label="Jogos para analisar" value={upcomingItems.length} hint="agenda completa, todas as ligas" />
          <Kpi label="Apostas recomendadas" value={readyToBet} hint={`${highConfidence.length} de alta confiança`} />
          <Kpi
            label="Taxa de acerto"
            value={fmt.pct(totals.hitRate)}
            hint={`${totals.count ?? 0} análises já liquidadas`}
            tone={Number.isFinite(totals.hitRate) ? (totals.hitRate >= 0.5 ? 'var(--green)' : 'var(--red)') : undefined}
          />
        </div>
      </section>

      <section className="section">
        <SectionHead
          eyebrow="Ao vivo"
          title="Jogos em andamento"
          subtitle="Minuto, placar, escanteios, finalizações e posse recalculados durante a partida."
          action={
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                live.reload();
                opportunities.reload();
              }}
            >
              Atualizar
            </button>
          }
        />
        {live.loading && !live.data ? (
          <Loading rows={3} />
        ) : liveItems.length ? (
          <FixtureList items={liveItems} navigate={navigate} />
        ) : (
          <EmptyState title="Nenhum jogo ao vivo agora">
            A lista se preenche sozinha quando as partidas começarem.
          </EmptyState>
        )}
      </section>

      <section className="section">
        <SectionHead
          eyebrow="O que apostar"
          title="Melhores entradas do momento"
          subtitle="Probabilidade calculada e nível de confiança · sem dados completos, nenhuma entrada é sugerida"
        />
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
                    </div>
                    <div className="small" style={{ fontWeight: 700, marginTop: 6 }}>
                      {item.fixture.home.name} x {item.fixture.away.name}
                    </div>
                    <div className="tiny muted">{item.market.label}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="wrap" style={{ justifyContent: 'flex-end' }}>
                      <ConfidenceChip value={item.market.confidence} />
                      <Chip tone="green">{fmt.pct(item.market.probability, 0)}</Chip>
                    </div>
                    <div style={{ marginTop: 6, width: 120, marginLeft: 'auto' }}>
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
            Nenhum jogo reúne estatística suficiente para uma aposta com vantagem agora. Assim que as equipes tiverem
            histórico coletado, as entradas aparecem aqui automaticamente.
          </EmptyState>
        )}
      </section>

      <section className="section">
        <SectionHead
          eyebrow="Agenda"
          title="Próximos jogos"
          subtitle="Toque em qualquer partida para ver as estatísticas e a recomendação completa."
        />
        {upcoming.loading && !upcoming.data ? (
          <Loading rows={2} />
        ) : upcomingItems.length ? (
          <FixtureList items={upcomingItems} navigate={navigate} />
        ) : (
          <EmptyState title="Sem jogos agendados">A agenda é atualizada automaticamente.</EmptyState>
        )}
      </section>

      <section className="section">
        <SectionHead eyebrow="Como analisamos" title="O que entra na conta" />
        <Panel>
          <div className="list">
            <div className="list-item">
              <span className="bullet">1</span>
              <span className="small">
                Últimos 5 e 10 jogos de cada equipe, com peso maior para os mais recentes, separando desempenho em casa e
                fora.
              </span>
            </div>
            <div className="list-item">
              <span className="bullet">2</span>
              <span className="small">
                Gols marcados e sofridos, escanteios, finalizações e posse de bola, ajustados pela média da liga.
              </span>
            </div>
            <div className="list-item">
              <span className="bullet">3</span>
              <span className="small">
                Distribuição de Poisson para gols e modelo probabilístico para escanteios, com ajuste de primeiro e segundo
                tempo e de confrontos diretos.
              </span>
            </div>
            <div className="list-item">
              <span className="bullet">4</span>
              <span className="small">
                Ao vivo, entram minuto, placar, escanteios, finalizações e ritmo da partida. Dados velhos ou incompletos
                bloqueiam a recomendação.
              </span>
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}
