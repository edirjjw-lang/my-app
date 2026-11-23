import { config } from '../config.js';
import { apiFootballProvider } from './apiFootball.js';
import { bzzoiroProvider } from './bzzoiro.js';
import { footballDataProvider } from './footballDataOrg.js';

const REGISTRY = {
  'api-football': apiFootballProvider,
  apifootball: apiFootballProvider,
  'football-data': footballDataProvider,
  'football-data.org': footballDataProvider,
  footballdata: footballDataProvider,
  bzzoiro: bzzoiroProvider,
  'bzzoiro-sports': bzzoiroProvider,
  bzzoirosports: bzzoiroProvider,
};

/**
 * Provedor efetivo: FOOTBALL_API_PROVIDER quando informado; caso contrário,
 * deduz pela URL base configurada (ex.: sports.bzzoiro.com -> bzzoiro).
 */
export function resolveProviderId() {
  if (REGISTRY[config.provider]) return config.provider;
  const base = (config.apiBaseUrl || '').toLowerCase();
  if (base.includes('bzzoiro')) return 'bzzoiro';
  if (base.includes('football-data')) return 'football-data';
  return 'api-football';
}

export function getProvider() {
  return REGISTRY[resolveProviderId()] || apiFootballProvider;
}

export function providerCapabilities() {
  return getProvider().capabilities;
}

export function providerRegistry() {
  const seen = new Set();
  const entries = [];
  for (const provider of Object.values(REGISTRY)) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    entries.push({
      id: provider.id,
      label: provider.label,
      capabilities: provider.capabilities,
    });
  }
  return entries;
}
