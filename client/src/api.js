import { useCallback, useEffect, useRef, useState } from 'react';

const ADMIN_STORAGE = 'futebolpro.adminToken';

export function getAdminToken() {
  try {
    return localStorage.getItem(ADMIN_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(value) {
  try {
    if (value) localStorage.setItem(ADMIN_STORAGE, value);
    else localStorage.removeItem(ADMIN_STORAGE);
  } catch {
    /* storage may be unavailable in private mode */
  }
}

export async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (admin) {
    const token = getAdminToken();
    if (token) headers['x-admin-token'] = token;
  }
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `Falha na requisição (${response.status})`);
    error.status = response.status;
    error.code = data?.error;
    error.data = data;
    throw error;
  }
  return data;
}

export function useApi(path, { refreshMs = 0, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const mounted = useRef(true);

  const load = useCallback(
    async (silent = false) => {
      if (!enabled) return;
      if (!silent) setState((prev) => ({ ...prev, loading: true }));
      try {
        const data = await api(path);
        if (mounted.current) setState({ data, error: null, loading: false });
      } catch (error) {
        if (mounted.current) setState((prev) => ({ data: prev.data, error, loading: false }));
      }
    },
    [path, enabled],
  );

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !enabled) return undefined;
    const timer = setInterval(() => load(true), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, enabled, load]);

  return { ...state, reload: load };
}

export const fmt = {
  pct(value, digits = 1) {
    if (!Number.isFinite(value)) return '—';
    return `${(value * 100).toFixed(digits)}%`;
  },
  odds(value) {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(2);
  },
  num(value, digits = 2) {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(digits);
  },
  signed(value, digits = 2) {
    if (!Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
  },
  money(value) {
    if (!Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}R$ ${Math.abs(value).toFixed(2)}`;
  },
  dateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  time(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },
  relative(iso) {
    if (!iso) return 'nunca';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'nunca';
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return 'agora';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min atrás`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h atrás`;
    return `${Math.floor(diff / 86_400_000)} d atrás`;
  },
};

export const STATUS_LABEL = {
  LIVE: 'AO VIVO',
  HT: 'INTERVALO',
  SCHEDULED: 'AGENDADO',
  FINISHED: 'ENCERRADO',
  POSTPONED: 'ADIADO',
  CANCELLED: 'CANCELADO',
};

export const GROUP_LABEL = {
  GOLS: 'Gols',
  ESCANTEIO: 'Escanteios',
  RESULTADO: 'Resultados',
};

export const QUALITY_LABEL = {
  OK: 'Dados completos',
  LIMITADA: 'Dados limitados',
  INSUFICIENTE: 'Dados insuficientes',
};
