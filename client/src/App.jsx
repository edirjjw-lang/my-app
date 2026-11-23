import { useEffect, useState } from 'react';
import Home from './pages/Home.jsx';
import Match from './pages/Match.jsx';
import History from './pages/History.jsx';
import Backtest from './pages/Backtest.jsx';
import System from './pages/System.jsx';

const NAV = [
  { path: '/', label: 'Início', icon: 'home' },
  { path: '/historico', label: 'Histórico', icon: 'history' },
  { path: '/backtest', label: 'Backtest', icon: 'flask' },
  { path: '/sistema', label: 'Sistema', icon: 'shield' },
];

function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (to) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return [path, navigate];
}

const ICONS = {
  home: (
    <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  flask: <path d="M9 3h6M10 3v6L5 19a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-10V3M7.5 14h9" />,
  shield: <path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z" />,
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Link({ to, children, className = '', onNavigate, ...rest }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate?.(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export default function App() {
  const [path, navigate] = useRoute();

  let page = <Home navigate={navigate} />;
  const matchRoute = path.match(/^\/jogo\/(\d+)\/?$/);
  if (matchRoute) page = <Match id={matchRoute[1]} navigate={navigate} />;
  else if (path.startsWith('/historico')) page = <History navigate={navigate} />;
  else if (path.startsWith('/backtest')) page = <Backtest />;
  else if (path.startsWith('/sistema')) page = <System />;

  const isActive = (item) =>
    item.path === '/' ? path === '/' || path.startsWith('/jogo/') : path.startsWith(item.path);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" onNavigate={navigate} className="brand" aria-label="FUTEBOL PRO — início">
            <span className="brand-mark">FP</span>
            <span>
              FUTEBOL <em>PRO</em>
            </span>
          </Link>
          <nav className="nav-desktop" aria-label="Navegação principal">
            {NAV.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onNavigate={navigate}
                className={`nav-link ${isActive(item) ? 'active' : ''}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <Link to="/sistema" onNavigate={navigate} className="btn sm ghost">
              Status
            </Link>
          </div>
        </div>
      </header>

      <main className="container" style={{ flex: 1 }}>
        {page}
        <p className="footer-note">
          Probabilidades calculadas por modelos estatísticos (Poisson e binomial negativa) sobre dados reais do provedor.
          <br />
          Não há garantia de lucro ou de acerto. Análise estatística não elimina o risco. Aposte com responsabilidade (+18).
        </p>
      </main>

      <nav className="bottom-nav" aria-label="Navegação">
        {NAV.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onNavigate={navigate}
            className={`bottom-link ${isActive(item) ? 'active' : ''}`}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
