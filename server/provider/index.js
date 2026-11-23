import { config } from '../config.js';
import { apiFootballProvider } from './apiFootball.js';
import { footballDataProvider } from './footballDataOrg.js';

const REGISTRY = {
  'api-football': apiFootballProvider,
  apifootball: apiFootballProvider,
  'football-data': footballDataProvider,
  'football-data.org': footballDataProvider,
  footballdata: footballDataProvider,
};

export function getProvider() {
  return REGISTRY[config.provider] || apiFootballProvider;
}

export function providerCapabilities() {
  return getProvider().capabilities;
}

export function providerRegistry() {
  return Object.values(REGISTRY).map((provider) => ({
    id: provider.id,
    label: provider.label,
    capabilities: provider.capabilities,
  }));
}
