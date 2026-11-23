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
  TeamBadge,
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
  const { best, blocked } = item;
  if (!best) {
    return (
      <div className="bet-empty">
        <Chip tone="muted">{blocked ? 'Sem dados suficientes' : 'Sem entrada'}</Chip>
      </div>
    );
  }
  return (
    <div className="bet-strip">
      <div className="bet-strip-main">
        <span className="bet-eyebrow">{GROUP_LABEL[best.group] ?? best.group}</span>
        <strong className="bet-label">{best.label}</strong>
        <ProbBar probability={best.probability} />
      </div>
      <div className="bet-strip-side">
        <span className="bet-prob">{fmt.pct(best.probability, 0)}</span>
        <ConfidenceChip value={best.confidence} />
      </div>
    </div>
  );
}

function FixtureLine({ item, navigate }) {
  const { fixture, quality, lambdas, recommendedCount, blocked } = item;
  const isLive = fixture.status === 'LIVE' || fixture.status === 'HT';
  const scheduled = fixture.status === 'SCHEDULED';
  return (
    <article className={`match-card ${isLive ? 'is-live' : ''}`}>
      <div className="match-top">
        <div className="match-top-left">
          <StatusChip status={fixture.status} minute={fixture.minute} />
          {fixture.competition?.name ? <span className="match-comp">{fixture.competition.name}</span> : null}
        </div>
        <span className="match-time">
          {scheduled
            ? fmt.dateTime(fixture.kickoffUtc)
            : isLive && fixture.minute
              ? `${fixture.minute}'`
              : 'encerrado'}
        </span>
      </div>

      <div className="teams">
        <div className="team-row">
          <TeamBadge name={fixture.home.name} logo={fixture.home.logo} />
          <span className="team-name">{fixture.home.name}</span>
          {scheduled ? <span className="team-tag">Casa</span> : <span className="team-score">{fixture.score.home ?? 0}</span>}
        </div>
        <div className="team-row">
          <TeamBadge name={fixture.away.name} logo={fixture.away.logo} />
          <span className="team-name">{fixture.away.name}</span>
          {scheduled ? <span className="team-tag">Fora</span> : <span className="team-score">{fixture.score.away ?? 0}</span>}
        </div>
      </div>

      <div className="match-meta">
        {isLive ? <LiveStats fixture={fixture} /> : <Projection lambdas={lambdas} />}
        {quality?.sample ? <span className="tiny muted">Base: {quality.sample} jogo(s) de cada equipe</span> : null}
      </div>

      <BetSummary item={item} />

      <div className="match-actions">
        <button type="button" className="btn sm" onClick={() => navigate(`/jogo/${fixture.id}`)}>
          Ver análise
        </button>
        {!blocked && recommendedCount > 1 ? (
          <span className="tiny muted">{recommendedCount} apostas recomendadas nesta partida.</span>
        ) : null}
      </div>
    </article>
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
            {opportunitiesList.map((item, index) => (
              <article className="pick-card" key={`${item.fixture.id}-${item.market.marketKey}`}>
                <div className="pick-head">
                  <span className="pick-rank">{String(index + 1).padStart(2, '0')}</span>
                  <StatusChip status={item.fixture.status} minute={item.fixture.minute} />
                  <Chip tone="muted">{GROUP_LABEL[item.market.group] ?? item.market.group}</Chip>
                </div>
                <div className="pick-match">
                  <div className="pick-team">
                    <TeamBadge name={item.fixture.home.name} logo={item.fixture.home.logo} size="sm" />
                    <span className="pick-name">{item.fixture.home.name}</span>
                  </div>
                  <span className="pick-x">x</span>
                  <div className="pick-team right">
                    <span className="pick-name">{item.fixture.away.name}</span>
                    <TeamBadge name={item.fixture.away.name} logo={item.fixture.away.logo} size="sm" />
                  </div>
                </div>
                <div className="pick-market">{item.market.label}</div>
                <div className="pick-foot">
                  <div className="pick-prob-block">
                    <span className="pick-prob">{fmt.pct(item.market.probability, 0)}</span>
                    <span className="pick-prob-label">probabilidade</span>
                  </div>
                  <div className="pick-side">
                    <ConfidenceChip value={item.market.confidence} />
                    <button type="button" className="btn sm" onClick={() => navigate(`/jogo/${item.fixture.id}`)}>
                      Ver análise
                    </button>
                  </div>
                </div>
                <ProbBar probability={item.market.probability} />
              </article>
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
