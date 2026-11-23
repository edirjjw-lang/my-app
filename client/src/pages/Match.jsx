import { useState } from 'react';
import { fmt, GROUP_LABEL, useApi } from '../api.js';
import {
  Alert,
  Chip,
  ConfidenceChip,
  EmptyState,
  Loading,
  MarketRow,
  Metric,
  Panel,
  ProbBar,
  QualityChip,
  SectionHead,
  StatCompare,
  StatusChip,
  TeamBadge,
} from '../components/ui.jsx';

const TABS = ['TODOS', 'GOLS', 'ESCANTEIO', 'RESULTADO'];

function matchesTab(group, tab) {
  if (tab === 'TODOS') return true;
  const normalized = String(group ?? '').toUpperCase();
  if (tab === 'ESCANTEIO') return normalized.startsWith('ESCANTEIO');
  return normalized.startsWith(tab);
}

function BetCard({ market, index }) {
  const factors = Array.isArray(market.factors) ? market.factors : [];
  const risks = Array.isArray(market.risks) ? market.risks : [];
  return (
    <Panel className="bet-card">
      <div className="between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="wrap" style={{ gap: 6 }}>
            <Chip tone="green">#{index + 1} aposta</Chip>
            <Chip tone="muted">{GROUP_LABEL[market.group] ?? market.group}</Chip>
          </div>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', marginTop: 8 }}>{market.label}</div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 140 }}>
          <div className="tiny muted">Probabilidade estimada</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--green)', lineHeight: 1.1 }} className="bet-big-prob">
            {fmt.pct(market.probability, 0)}
          </div>
          <div style={{ marginTop: 6 }}>
            <ConfidenceChip value={market.confidence} />
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <ProbBar probability={market.probability} />
      </div>
      {factors.length ? (
        <div style={{ marginTop: 12 }}>
          <div className="tiny" style={{ color: 'var(--green)', fontWeight: 700 }}>
            A favor
          </div>
          <ul className="factor-list">
            {factors.map((factor) => (
              <li key={factor} className="small">
                {factor}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {risks.length ? (
        <div style={{ marginTop: 10 }}>
          <div className="tiny" style={{ color: 'var(--red)', fontWeight: 700 }}>
            Riscos
          </div>
          <ul className="factor-list">
            {risks.map((risk) => (
              <li key={risk} className="small">
                {risk}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {market.rationale ? (
        <p className="small muted" style={{ marginTop: 10 }}>
          <b style={{ color: 'var(--text)' }}>Por que: </b>
          {market.rationale}
        </p>
      ) : null}
    </Panel>
  );
}

export default function Match({ id, navigate }) {
  const { data, error, loading, reload } = useApi(`/fixtures/${id}`, { refreshMs: 30_000 });
  const [tab, setTab] = useState('TODOS');

  const fixture = data?.fixture;
  const analysis = data?.analysis;
  const markets = analysis?.markets ?? [];
  const recommended = analysis?.recommended ?? [];
  const isLive = fixture && (fixture.status === 'LIVE' || fixture.status === 'HT');
  const filtered = markets.filter((market) => matchesTab(market.group, tab));

  if (loading && !data) {
    return (
      <div className="section">
        <Loading rows={3} />
      </div>
    );
  }

  if (error || !fixture) {
    return (
      <div className="section stack">
        <Alert tone="red" title="Não foi possível carregar este jogo">
          {error ?? 'Jogo não encontrado.'}
        </Alert>
        <div>
          <button type="button" className="btn" onClick={() => navigate('/')}>
            Voltar aos jogos
          </button>
        </div>
      </div>
    );
  }

  const stats = fixture.stats ?? {};

  return (
    <>
      <div className="section">
        <button type="button" className="btn ghost sm" onClick={() => navigate('/')}>
          ← Todos os jogos
        </button>
      </div>

      <Panel className="hero">
        <div className="wrap" style={{ gap: 8 }}>
          <StatusChip status={fixture.status} minute={fixture.minute} />
          {fixture.competition?.name ? <span className="tiny muted">{fixture.competition.name}</span> : null}
          <QualityChip quality={analysis?.quality} />
        </div>
        <div className="scoreboard">
          <div className="sb-team">
            <TeamBadge name={fixture.home.name} logo={fixture.home.logo} size="lg" />
            <span className="sb-name">{fixture.home.name}</span>
            <span className="sb-role">{isLive ? 'Mandante · ao vivo' : 'Mandante'}</span>
          </div>
          <div className="sb-center">
            <div className="sb-score">
              {fixture.score.home ?? 0} <span>–</span> {fixture.score.away ?? 0}
            </div>
            <div className="sb-time">
              {fixture.status === 'SCHEDULED'
                ? fmt.dateTime(fixture.kickoffUtc)
                : fixture.minute
                  ? `${fixture.minute}'`
                  : 'encerrado'}
            </div>
          </div>
          <div className="sb-team right">
            <TeamBadge name={fixture.away.name} logo={fixture.away.logo} size="lg" />
            <span className="sb-name">{fixture.away.name}</span>
            <span className="sb-role">Visitante</span>
          </div>
        </div>
        <div className="tiny muted" style={{ marginTop: 12 }}>
          Atualizado {fixture.updatedAt ? fmt.relative(fixture.updatedAt) : '—'}
          <button type="button" className="btn ghost sm" style={{ marginLeft: 8 }} onClick={reload}>
            Atualizar
          </button>
        </div>
      </Panel>

      <section className="section">
        <SectionHead
          eyebrow="O que apostar"
          title="Recomendação desta partida"
          subtitle="Probabilidade calculada pelo modelo, com fatores favoráveis e riscos reais do jogo."
        />
        {recommended.length ? (
          <div className="stack">
            {recommended.map((market, index) => (
              <BetCard key={`${market.marketKey}-${market.selection}-${market.line}`} market={market} index={index} />
            ))}
          </div>
        ) : (
          <Alert tone="amber" title="SEM ENTRADA RECOMENDADA">
            {analysis?.noEntryReasons?.length
              ? analysis.noEntryReasons.join(' · ')
              : 'Os dados deste jogo não sustentam uma aposta com vantagem estatística. Não vale arriscar aqui.'}
          </Alert>
        )}
      </section>

      {isLive ? (
        <section className="section">
          <SectionHead eyebrow="Ao vivo" title="Números da partida" subtitle="Atualizados durante o jogo." />
          <Panel>
            <div className="stack">
              <StatCompare label="Escanteios" home={stats.corners?.home} away={stats.corners?.away} />
              <StatCompare label="Finalizações" home={stats.shots?.home} away={stats.shots?.away} />
              <StatCompare label="No gol" home={stats.shotsOn?.home} away={stats.shotsOn?.away} />
              <StatCompare label="Posse de bola" home={stats.possession?.home} away={stats.possession?.away} suffix="%" />
              <StatCompare label="Cartões" home={stats.cards?.home} away={stats.cards?.away} />
              {Number.isFinite(stats.dangerousAttacks?.home) ? (
                <StatCompare
                  label="Ataques perigosos"
                  home={stats.dangerousAttacks?.home}
                  away={stats.dangerousAttacks?.away}
                />
              ) : null}
            </div>
            {!fixture.hasStats ? (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                A transmissão dos números desta partida ainda não chegou. A recomendação fica bloqueada até os dados
                atualizarem.
              </p>
            ) : null}
          </Panel>
        </section>
      ) : null}

      <section className="section">
        <SectionHead eyebrow="Projeção" title="O que a estatística espera" subtitle="Calculado sobre o histórico real das equipes." />
        <Panel>
          <div className="grid kpi">
            <Metric label="Gols esperados (casa)" value={fmt.num(analysis?.lambdas?.home)} />
            <Metric label="Gols esperados (fora)" value={fmt.num(analysis?.lambdas?.away)} />
            <Metric label="Escanteios esperados" value={fmt.num(analysis?.lambdas?.cornersTotal, 1)} />
            <Metric label="Base de dados" value={analysis?.quality?.sample ? `${analysis.quality.sample} jogo(s)` : '—'} />
          </div>
          {analysis?.quality?.missing?.length ? (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Falta para a análise ficar completa: {analysis.quality.missing.join(' · ')}.
            </p>
          ) : null}
        </Panel>
      </section>

      <section className="section">
        <SectionHead eyebrow="Mercados" title="Todos os mercados analisados" subtitle="Probabilidade e confiança de cada leitura." />
        <div className="tabs">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              className={`tab ${tab === item ? 'active' : ''}`}
              onClick={() => setTab(item)}
            >
              {item === 'TODOS' ? 'Todos' : item === 'ESCANTEIO' ? 'Escanteios' : item === 'RESULTADO' ? 'Resultado' : 'Gols'}
            </button>
          ))}
        </div>
        {filtered.length ? (
          <div className="stack">
            {filtered.map((market) => (
              <MarketRow key={`${market.marketKey}-${market.selection}-${market.line}`} market={market} />
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhum mercado nesta categoria">
            Os mercados aparecem quando a partida tem dados suficientes para o cálculo.
          </EmptyState>
        )}
      </section>
    </>
  );
}
