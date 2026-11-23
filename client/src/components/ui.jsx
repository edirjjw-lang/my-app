import { fmt, GROUP_LABEL, QUALITY_LABEL, STATUS_LABEL } from '../api.js';

export function Chip({ tone = '', children, dot = false }) {
  return (
    <span className={`chip ${tone}`}>
      {dot ? <i className="dot" /> : null}
      {children}
    </span>
  );
}

const BADGE_PALETTES = [
  ['#00e58a', '#046b43'],
  ['#4aa8ff', '#1a4b96'],
  ['#ffb648', '#a25f04'],
  ['#ff5d73', '#8a1730'],
  ['#a78bfa', '#4b2a94'],
  ['#2dd4bf', '#0b6b60'],
  ['#f472b6', '#8c1a5c'],
  ['#8fd3ff', '#215f96'],
];

const NAME_SKIP = new Set(['de', 'da', 'do', 'dos', 'das', 'del', 'la', 'el', 'y', 'e', 'of', 'the']);

/** Iniciais do time para o escudo (ex.: "América de Cali" → AC). */
export function teamInitials(name) {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !NAME_SKIP.has(word.toLowerCase()));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function paletteFor(name) {
  const text = String(name ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 100000;
  return BADGE_PALETTES[hash % BADGE_PALETTES.length];
}

/** Escudo do time: usa o logo real quando a fonte fornece, senão as iniciais. */
export function TeamBadge({ name, logo, size = 'md' }) {
  const [from, to] = paletteFor(name);
  const style = { '--badge-from': from, '--badge-to': to };
  if (logo) {
    return (
      <span className={`team-badge ${size}`} style={style}>
        <img src={logo} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`team-badge ${size}`} style={style} aria-hidden="true">
      {teamInitials(name)}
    </span>
  );
}

const LIVE_STATUSES = new Set(['LIVE', 'HT']);

export function StatusChip({ status, minute }) {
  const tone = LIVE_STATUSES.has(status) ? 'live' : status === 'FINISHED' ? 'muted' : 'blue';
  const label = STATUS_LABEL[status] ?? status;
  return (
    <Chip tone={tone} dot={LIVE_STATUSES.has(status)}>
      {LIVE_STATUSES.has(status) && minute ? `${label} ${minute}'` : label}
    </Chip>
  );
}

export function ConfidenceChip({ value }) {
  const tone = value === 'ALTA' ? 'green' : value === 'MODERADA' ? 'amber' : value === 'BAIXA' ? 'red' : 'muted';
  return <Chip tone={tone}>{value === 'ALTA' ? 'Confiança alta' : value === 'MODERADA' ? 'Confiança moderada' : value === 'BAIXA' ? 'Confiança baixa' : 'Sem confiança'}</Chip>;
}

export function QualityChip({ quality }) {
  const level = quality?.level ?? 'INSUFICIENTE';
  const tone = level === 'ALTA' ? 'green' : level === 'MEDIA' ? 'amber' : level === 'BAIXA' ? 'red' : 'muted';
  return (
    <Chip tone={tone}>
      {QUALITY_LABEL[level] ?? level}
      {quality?.sample ? ` · ${quality.sample} jogo(s)` : ''}
    </Chip>
  );
}

export function GroupChip({ group }) {
  return <Chip tone="muted">{GROUP_LABEL[group] ?? group}</Chip>;
}

export function Panel({ children, className = '', ...rest }) {
  return (
    <div className={`panel ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionHead({ eyebrow, title, subtitle, action }) {
  return (
    <div className="between" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2 style={{ marginTop: 4 }}>{title}</h2>
        {subtitle ? <p className="small muted" style={{ marginTop: 6 }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }) {
  return (
    <Panel className="tight">
      <div className="tiny muted">{label}</div>
      <div className="kpi-value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {hint ? <div className="tiny muted">{hint}</div> : null}
    </Panel>
  );
}

export function ProbBar({ probability }) {
  const pct = Math.max(0, Math.min(1, Number(probability) || 0)) * 100;
  return (
    <div className="prob-bar" role="img" aria-label={`Probabilidade ${pct.toFixed(0)}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Metric({ label, value, tone }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b style={tone ? { color: tone } : undefined}>{value}</b>
    </div>
  );
}

export function StatCompare({ label, home, away, suffix = '' }) {
  const hasHome = Number.isFinite(home);
  const hasAway = Number.isFinite(away);
  const total = (hasHome ? home : 0) + (hasAway ? away : 0);
  const homeShare = total > 0 ? (home / total) * 100 : 50;
  return (
    <div className="stat-compare">
      <div className="between tiny">
        <b>{hasHome ? `${home}${suffix}` : '—'}</b>
        <span className="muted">{label}</span>
        <b>{hasAway ? `${away}${suffix}` : '—'}</b>
      </div>
      <div className="duo-bar">
        <span className="home" style={{ width: `${homeShare}%` }} />
        <span className="away" style={{ width: `${100 - homeShare}%` }} />
      </div>
    </div>
  );
}

export function Alert({ tone = '', title, children }) {
  return (
    <div className={`alert ${tone}`}>
      {title ? <b>{title}</b> : null}
      {children ? <div className="small">{children}</div> : null}
    </div>
  );
}

export function Loading({ rows = 3 }) {
  return (
    <div className="stack">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton" key={index} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <Panel className="empty">
      <div style={{ fontWeight: 700 }}>{title}</div>
      {children ? <p className="small muted" style={{ marginTop: 6 }}>{children}</p> : null}
    </Panel>
  );
}

export function EdgeText({ edge }) {
  if (!Number.isFinite(edge)) return null;
  const pct = edge * 100;
  const tone = pct > 0 ? 'var(--green)' : 'var(--red)';
  return (
    <span className="tiny" style={{ color: tone }}>
      {pct > 0 ? '+' : ''}
      {pct.toFixed(1)}% de vantagem
    </span>
  );
}

/**
 * Um mercado analisado: probabilidade calculada, confiança, fatores
 * favoráveis e riscos. Sem preço de mercado — apenas a leitura estatística.
 */
export function MarketRow({ market, showDetails = true }) {
  const suggested = market.entry && !String(market.entry).toUpperCase().includes('SEM');
  const factors = Array.isArray(market.factors) ? market.factors : [];
  const risks = Array.isArray(market.risks) ? market.risks : [];
  return (
    <Panel className={`tight market-row ${suggested ? 'recommended' : ''}`}>
      <div className="between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="wrap" style={{ gap: 6 }}>
            <GroupChip group={market.group} />
            {suggested ? <Chip tone="green">Aposta sugerida</Chip> : null}
          </div>
          <div className="small" style={{ fontWeight: 700, marginTop: 6 }}>
            {market.label}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 130 }}>
          <div className="wrap" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <ConfidenceChip value={market.confidence} />
            <b>{fmt.pct(market.probability, 0)}</b>
          </div>
          <div style={{ marginTop: 6 }}>
            <ProbBar probability={market.probability} />
          </div>
        </div>
      </div>

      {showDetails && (factors.length || risks.length || market.rationale) ? (
        <div style={{ marginTop: 10 }}>
          {factors.length ? (
            <ul className="factor-list">
              {factors.map((factor) => (
                <li key={factor} className="small">
                  <span style={{ color: 'var(--green)' }}>+</span> {factor}
                </li>
              ))}
            </ul>
          ) : null}
          {risks.length ? (
            <ul className="factor-list">
              {risks.map((risk) => (
                <li key={risk} className="small">
                  <span style={{ color: 'var(--red)' }}>−</span> {risk}
                </li>
              ))}
            </ul>
          ) : null}
          {market.rationale ? (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {market.rationale}
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
