import { fmt, GROUP_LABEL, QUALITY_LABEL, STATUS_LABEL } from '../api.js';

export function Chip({ tone = '', children, dot = false }) {
  return (
    <span className={`chip ${tone}`}>
      {dot ? <span className={`dot ${tone === 'live' ? 'pulse' : ''}`} /> : null}
      {children}
    </span>
  );
}

export function StatusChip({ status, minute }) {
  if (status === 'LIVE' || status === 'HT') {
    return (
      <Chip tone="live" dot>
        {status === 'HT' ? 'INTERVALO' : `${minute ? `${minute}'` : 'AO VIVO'}`}
      </Chip>
    );
  }
  return <Chip tone={status === 'FINISHED' ? 'muted' : 'blue'}>{STATUS_LABEL[status] ?? status}</Chip>;
}

export function ConfidenceChip({ value }) {
  const tone = value === 'ALTA' ? 'green' : value === 'MODERADA' ? 'amber' : 'red';
  return <Chip tone={tone}>{value ?? '—'}</Chip>;
}

export function QualityChip({ quality }) {
  if (!quality) return null;
  const tone = quality.level === 'OK' ? 'green' : quality.level === 'LIMITADA' ? 'amber' : 'red';
  return (
    <Chip tone={tone} dot>
      {QUALITY_LABEL[quality.level] ?? quality.level}
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
    <div className="section-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }) {
  return (
    <div className="kpi-card">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function ProbBar({ probability }) {
  const width = Math.max(0, Math.min(100, (probability ?? 0) * 100));
  return (
    <div className="prob-bar" aria-hidden="true">
      <i style={{ width: `${width}%` }} />
    </div>
  );
}

export function Metric({ label, value, tone }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b className={tone ?? ''}>{value}</b>
    </div>
  );
}

export function StatCompare({ label, home, away, suffix = '' }) {
  const total = (Number(home) || 0) + (Number(away) || 0);
  const homePct = total > 0 ? (Number(home) / total) * 100 : 50;
  return (
    <div className="stat-line">
      <div className="labels">
        <span>
          {Number.isFinite(home) ? `${home}${suffix}` : '—'}
        </span>
        <span className="muted tiny">{label}</span>
        <span>
          {Number.isFinite(away) ? `${away}${suffix}` : '—'}
        </span>
      </div>
      <div className="track">
        <i className="home" style={{ width: `${homePct}%` }} />
        <i className="away" style={{ width: `${100 - homePct}%` }} />
      </div>
    </div>
  );
}

export function Alert({ tone = '', title, children }) {
  return (
    <div className={`alert ${tone}`}>
      {title ? <h3>{title}</h3> : null}
      <div className="small">{children}</div>
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
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

export function EdgeText({ edge }) {
  if (!Number.isFinite(edge)) return <span className="muted">—</span>;
  return <span style={{ color: edge > 0 ? 'var(--green)' : 'var(--red)' }}>{fmt.pct(edge, 1)}</span>;
}

export function MarketRow({ market, showDetails = true }) {
  const recommended = market.entry === 'RECOMENDADA';
  const hasOdd = Number.isFinite(market.bookmakerOdds);
  return (
    <div className={`market-row ${recommended ? 'recommended' : ''} ${recommended ? '' : 'blocked'}`}>
      <div style={{ minWidth: 0 }}>
        <div className="market-label">
          <span>{market.label}</span>
          {recommended ? <Chip tone="green">RECOMENDADA</Chip> : <Chip tone="muted">SEM ENTRADA</Chip>}
          {market.preferred ? <Chip tone="blue">FAIXA 1.50–1.80</Chip> : null}
        </div>
        <div className="market-numbers">
          <Metric label="Probabilidade" value={fmt.pct(market.probability)} />
          <Metric label="Odd justa" value={fmt.odds(market.fairOdds)} />
          <Metric
            label="Odd mercado"
            value={hasOdd ? fmt.odds(market.bookmakerOdds) : 'sem odd'}
            tone={hasOdd ? 'pos' : ''}
          />
          <Metric label="Vantagem" value={<EdgeText edge={market.edge} />} />
          <Metric label="Confiança" value={market.confidence ?? '—'} />
        </div>
        <ProbBar probability={market.probability} />
        {showDetails && recommended && market.rationale ? (
          <details style={{ marginTop: 8 }}>
            <summary className="small" style={{ cursor: 'pointer', color: 'var(--green)' }}>
              Justificativa, fatores e riscos
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <p className="small muted">{market.rationale}</p>
              {market.factors?.length ? (
                <div className="list">
                  {market.factors.map((factor, index) => (
                    <div className="list-item" key={`f-${index}`}>
                      <span className="bullet">+</span>
                      <span className="small">{factor}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {market.risks?.length ? (
                <div className="list">
                  {market.risks.map((risk, index) => (
                    <div className="list-item risk" key={`r-${index}`}>
                      <span className="bullet">!</span>
                      <span className="small">{risk}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
        {showDetails && !recommended && market.reason ? (
          <div className="tiny muted" style={{ marginTop: 6 }}>
            {market.reason}
          </div>
        ) : null}
      </div>
      <div className="right">
        {hasOdd ? (
          <div style={{ fontSize: '1.2rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {fmt.odds(market.bookmakerOdds)}
          </div>
        ) : (
          <div className="tiny muted">sem odd</div>
        )}
        <div className="tiny muted">{market.group === 'ESCANTEIO' ? 'escanteios' : market.group === 'GOLS' ? 'gols' : 'resultado'}</div>
      </div>
    </div>
  );
}
