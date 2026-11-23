import { useState } from 'react';
import { api, fmt, getAdminToken, setAdminToken, useApi } from '../api.js';
import { Alert, Chip, Loading, Panel, SectionHead } from '../components/ui.jsx';

const SCOPE_LABEL = {
  live: 'Sincronizar jogos ao vivo',
  scheduled: 'Sincronizar jogos agendados',
  history: 'Aquecer histórico das equipes',
};

export default function System() {
  const { data, error, loading, reload } = useApi('/status', { refreshMs: 30_000 });
  const [token, setToken] = useState(getAdminToken());
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);

  async function runSync(scope) {
    setBusy(scope);
    setActionError(null);
    setMessage(null);
    setAdminToken(token.trim());
    try {
      const result = await api('/sync', { method: 'POST', body: { scope } });
      setMessage(`Sincronização "${SCOPE_LABEL[scope] ?? scope}" concluída.`);
      await reload(true);
      return result;
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy(null);
    }
  }

  async function settle() {
    setBusy('settle');
    setActionError(null);
    setMessage(null);
    setAdminToken(token.trim());
    try {
      const result = await api('/settle', { method: 'POST', body: {} });
      setMessage(`Liquidação concluída: ${result.settled ?? 0} recomendação(ões) atualizada(s).`);
      await reload(true);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <div style={{ marginTop: 18 }}><Loading rows={4} /></div>;
  if (error && !data) return <div className="section"><Alert tone="error" title="Status indisponível">{error.message}</Alert></div>;

  const provider = data?.provider ?? {};
  const health = provider.health ?? {};
  const state = data?.sync?.state ?? {};
  const limitations = data?.limitations ?? [];

  return (
    <>
      <div className="section">
        <SectionHead eyebrow="Módulo 3" title="Sistema, segurança e monitoramento" subtitle="Estado real do provedor, banco de dados, sincronização e eventos." />
        {!provider.configured ? (
          <Alert tone="warn" title="API de futebol não configurada">
            Adicione a variável de ambiente <b>FOOTBALL_API_KEY</b> (Settings → Environment variables) com a chave da sua API.
            Enquanto isso, o app não busca jogos e bloqueia recomendações — nada é simulado.
          </Alert>
        ) : null}
      </div>

      <section className="section">
        <SectionHead eyebrow="Provedor" title="Integração de dados" />
        <Panel>
          <div className="grid two">
            <div>
              <div className="eyebrow">Provedor</div>
              <div style={{ marginTop: 6, fontWeight: 700 }}>{provider.label ?? '—'}</div>
              <div className="wrap" style={{ marginTop: 8 }}>
                <Chip tone={provider.configured ? 'green' : 'amber'}>{provider.configured ? 'Configurado' : 'Sem chave'}</Chip>
                <Chip tone={health.status === 'ok' ? 'green' : health.status === 'degraded' ? 'amber' : 'muted'}>
                  Saúde: {health.status ?? 'sem chamadas'}
                </Chip>
                <Chip tone="muted">Cota: {health.rateLimitRemaining ?? '—'} restantes</Chip>
              </div>
              <div className="tiny muted" style={{ marginTop: 8 }}>
                Último sucesso: {health.lastSuccessAt ? fmt.dateTime(health.lastSuccessAt) : '—'}
                {health.lastError ? ` · Último erro: ${health.lastError}` : ''}
              </div>
            </div>
            <div>
              <div className="eyebrow">Capacidades do provedor</div>
              <div className="wrap" style={{ marginTop: 8 }}>
                {Object.entries(provider.capabilities ?? {}).map(([key, value]) => (
                  <Chip key={key} tone={value ? 'green' : 'muted'}>
                    {key}: {value ? 'sim' : 'não'}
                  </Chip>
                ))}
              </div>
              <div className="tiny muted" style={{ marginTop: 10 }}>
                Limite de idade de dados considerado atual: {Math.round((provider.staleAfterMs ?? 0) / 60000)} min.
              </div>
            </div>
          </div>
        </Panel>
      </section>

      <section className="section">
        <SectionHead eyebrow="Dados" title="Banco de dados" />
        <Panel className="tight">
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><td>Partidas</td><td className="mono">{data?.data?.fixtures ?? 0}</td></tr>
                <tr><td>Competições</td><td className="mono">{data?.data?.competitions ?? 0}</td></tr>
                <tr><td>Equipes</td><td className="mono">{data?.data?.teams ?? 0}</td></tr>
                <tr><td>Registros de estatística por equipe/partida</td><td className="mono">{data?.data?.teamMatchStats ?? 0}</td></tr>
                <tr><td>Recomendações registradas</td><td className="mono">{data?.data?.recommendations ?? 0}</td></tr>
                <tr><td>Entradas em cache</td><td className="mono">{data?.data?.cache?.entries ?? 0}</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="section">
        <SectionHead eyebrow="Automação" title="Sincronização" subtitle={`Ao vivo a cada ${Math.round((data?.sync?.intervalsMs?.live ?? 0) / 1000)}s · agenda a cada ${Math.round((data?.sync?.intervalsMs?.scheduled ?? 0) / 60000)} min`} />
        <Panel>
          <div className="wrap">
            <Chip tone={state.enabled ? 'green' : 'muted'}>{state.enabled ? 'Agendador ativo' : 'Agendador desativado'}</Chip>
            <Chip tone="muted">Ciclos: {state.cycles ?? 0}</Chip>
            <Chip tone="muted">Último ao vivo: {state.lastLiveAt ? fmt.relative(state.lastLiveAt) : '—'}</Chip>
            <Chip tone="muted">Última liquidação: {state.lastSettlementAt ? fmt.relative(state.lastSettlementAt) : '—'}</Chip>
          </div>
          {state.lastError ? (
            <div className="tiny" style={{ marginTop: 10, color: 'var(--amber)' }}>
              Último erro do agendador ({state.lastError.scope}): {state.lastError.message}
            </div>
          ) : null}
          <div className="grid form-grid" style={{ marginTop: 14 }}>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>Token administrativo (ADMIN_TOKEN)</span>
              <input
                type="password"
                value={token}
                placeholder="Defina ADMIN_TOKEN nas variáveis de ambiente"
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="wrap" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => runSync('live')} disabled={Boolean(busy)}>
              {busy === 'live' ? 'Sincronizando…' : 'Sincronizar ao vivo'}
            </button>
            <button type="button" className="btn" onClick={() => runSync('scheduled')} disabled={Boolean(busy)}>
              {busy === 'scheduled' ? 'Sincronizando…' : 'Sincronizar agendados'}
            </button>
            <button type="button" className="btn" onClick={() => runSync('history')} disabled={Boolean(busy)}>
              {busy === 'history' ? 'Aquecendo…' : 'Aquecer histórico'}
            </button>
            <button type="button" className="btn" onClick={settle} disabled={Boolean(busy)}>
              {busy === 'settle' ? 'Liquidando…' : 'Liquidar resultados'}
            </button>
          </div>
          {message ? <div className="tiny" style={{ marginTop: 10, color: 'var(--green)' }}>{message}</div> : null}
          {actionError ? <div className="tiny" style={{ marginTop: 10, color: 'var(--red)' }}>{actionError}</div> : null}
        </Panel>
      </section>

      <section className="section">
        <SectionHead eyebrow="Log" title="Execuções recentes" />
        <Panel className="tight">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Escopo</th>
                  <th>Status</th>
                  <th>Itens</th>
                  <th>Mensagem</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {(data?.sync?.recentRuns ?? []).length ? (
                  data.sync.recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="mono tiny">{run.scope}</td>
                      <td>
                        <Chip tone={run.status === 'ok' ? 'green' : run.status === 'error' ? 'red' : 'muted'}>{run.status}</Chip>
                      </td>
                      <td className="mono">{run.items ?? 0}</td>
                      <td className="tiny muted">{run.message ?? '—'}</td>
                      <td className="tiny muted">{fmt.relative(run.finished_at ?? run.started_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} className="muted small">Nenhuma sincronização executada ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {limitations.length ? (
        <section className="section">
          <SectionHead eyebrow="Limitações" title="Pendências declaradas" />
          <Panel>
            <div className="list">
              {limitations.map((item, index) => (
                <div className="list-item risk" key={index}>
                  <span className="bullet">!</span>
                  <span className="small">{item}</span>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      ) : null}

      <section className="section">
        <SectionHead eyebrow="Segurança" title="Proteção e privacidade" />
        <Panel>
          <div className="list">
            <div className="list-item"><span className="bullet">+</span><span className="small">Chave da API usada somente no backend; nunca é enviada ao navegador.</span></div>
            <div className="list-item"><span className="bullet">+</span><span className="small">Rotas administrativas exigem token; requisições são limitadas por IP.</span></div>
            <div className="list-item"><span className="bullet">+</span><span className="small">Headers de segurança, CORS restrito e validação de entrada.</span></div>
            <div className="list-item"><span className="bullet">+</span><span className="small">Cache com TTL e marcação de dados desatualizados: recomendações são bloqueadas quando os dados não são atuais.</span></div>
            <div className="list-item"><span className="bullet">+</span><span className="small">Nenhum dado pessoal é coletado; o banco guarda apenas partidas, estatísticas e recomendações.</span></div>
          </div>
        </Panel>
      </section>
    </>
  );
}
