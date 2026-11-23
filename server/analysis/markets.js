/**
 * Definição de mercados, confiança, justificativas e liquidação de resultados.
 * Nenhuma odd é inventada: quando não há odd real do provedor, o mercado
 * aparece como "sem odd disponível" e não gera entrada.
 */

export const GROUPS = {
  GOALS: 'GOLS',
  CORNERS: 'ESCANTEIO',
  RESULT: 'RESULTADO',
};

export const CONFIDENCE = {
  ALTA: 'ALTA',
  MODERADA: 'MODERADA',
  BAIXA: 'BAIXA',
};

export const CONFIDENCE_RANK = { BAIXA: 0, MODERADA: 1, ALTA: 2 };

export const ENTRY = {
  RECOMMENDED: 'RECOMENDADA',
  NO_ENTRY: 'SEM_ENTRADA',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function confidenceLabel(score) {
  if (score >= 0.7) return CONFIDENCE.ALTA;
  if (score >= 0.5) return CONFIDENCE.MODERADA;
  return CONFIDENCE.BAIXA;
}

export function selectionLabel(market) {
  const { marketType, line, selection, team, period } = market;
  const lineText = Number.isFinite(line) ? String(line) : '';
  const periodText = period === '1H' ? ' no 1º tempo' : period === '2H' ? ' no 2º tempo' : '';
  const teamText = team === 'home' ? 'Casa' : team === 'away' ? 'Fora' : '';

  switch (marketType) {
    case 'over':
      return team
        ? `${teamText} mais de ${lineText} escanteios${periodText}`
        : `Mais de ${lineText} ${market.group === GROUPS.GOALS ? 'gols' : 'escanteios'}${periodText}`;
    case 'under':
      return team
        ? `${teamText} menos de ${lineText} escanteios${periodText}`
        : `Menos de ${lineText} ${market.group === GROUPS.GOALS ? 'gols' : 'escanteios'}${periodText}`;
    case '1x2':
      return selection === 'home' ? 'Vitória da casa' : selection === 'draw' ? 'Empate' : 'Vitória do visitante';
    case 'dc':
      if (selection === 'home_draw') return 'Dupla chance: Casa ou Empate';
      if (selection === 'home_away') return 'Dupla chance: Casa ou Fora';
      return 'Dupla chance: Empate ou Fora';
    case 'dnb':
      return `Empate anula: ${selection === 'home' ? 'Casa' : 'Fora'}`;
    case 'btts':
      return selection === 'yes' ? 'Ambas marcam: Sim' : 'Ambas marcam: Não';
    default:
      return 'Mercado';
  }
}

/**
 * Confiança = composição de tamanho de amostra, qualidade dos dados,
 * vantagem estatística, estabilidade e confiabilidade do mercado.
 */
export function computeConfidence({
  probability,
  edge,
  sample,
  qualityScore,
  coefficientOfVariation,
  group,
  hasOdds,
  live,
}) {
  const sampleScore = clamp(sample / 10, 0, 1);
  const edgeScore = hasOdds && Number.isFinite(edge) ? clamp(edge / 0.12, 0, 1) : 0;
  const stability = Number.isFinite(coefficientOfVariation)
    ? clamp(1 - coefficientOfVariation, 0, 1)
    : 0.5;
  const marketReliability = group === GROUPS.CORNERS ? 0.72 : 1;
  const livePenalty = live ? 0.9 : 1;
  const probabilitySanity = probability >= 0.08 && probability <= 0.92 ? 1 : 0.6;

  const score =
    (0.3 * sampleScore +
      0.2 * clamp(qualityScore, 0, 1) +
      0.25 * edgeScore +
      0.15 * stability +
      0.1 * marketReliability) *
    livePenalty *
    probabilitySanity;

  return { score: clamp(score, 0, 1), label: confidenceLabel(score) };
}

function pct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function odd(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

/**
 * Justificativa numérica: cada frase é derivada dos valores reais do modelo.
 */
export function buildRationale({ market, lambdas, profiles, h2h, quality, live, odds }) {
  const parts = [];
  const { group, probability, fairOdds, bookmakerOdds, edge } = market;

  if (group === GROUPS.GOALS) {
    parts.push(
      `Modelo Poisson projeta ${lambdas.total.toFixed(2)} gols no total (casa ${lambdas.home.toFixed(2)} x fora ${lambdas.away.toFixed(2)}).`,
    );
    if (Number.isFinite(profiles.home.goalsFor) && Number.isFinite(profiles.away.goalsAgainst)) {
      parts.push(
        `Casa marca ${profiles.home.goalsFor.toFixed(2)}/jogo e visitante sofre ${profiles.away.goalsAgainst.toFixed(2)}/jogo (média ponderada de ${profiles.home.matches} e ${profiles.away.matches} jogos).`,
      );
    }
  } else if (group === GROUPS.CORNERS) {
    if (Number.isFinite(lambdas.cornersTotal)) {
      parts.push(
        `Modelo binomial negativo projeta ${lambdas.cornersTotal.toFixed(2)} escanteios (casa ${Number(lambdas.cornersHome).toFixed(2)} x fora ${Number(lambdas.cornersAway).toFixed(2)}).`,
      );
    }
    if (Number.isFinite(profiles.home.cornersFor) && Number.isFinite(profiles.away.cornersFor)) {
      parts.push(
        `Médias de escanteios: casa ${profiles.home.cornersFor.toFixed(2)} a favor e ${profiles.home.cornersAgainst.toFixed(2)} contra; visitante ${profiles.away.cornersFor.toFixed(2)} a favor e ${profiles.away.cornersAgainst.toFixed(2)} contra.`,
      );
    }
  } else {
    parts.push(
      `Placar projetado ${lambdas.home.toFixed(2)} x ${lambdas.away.toFixed(2)} gera ${pct(probability)} para este resultado.`,
    );
  }

  if (h2h?.matches >= 3) {
    parts.push(
      `Confronto direto: ${h2h.matches} jogos, média de ${h2h.goalsPerMatch.toFixed(2)} gols.`,
    );
  }
  if (live) {
    parts.push(
      `Ao vivo aos ${live.minute}': placar ${live.score}, ${live.corners} escanteios, ${live.shots} finalizações; ritmo x${live.tempoFactor.toFixed(2)}.`,
    );
  }
  parts.push(
    `Probabilidade ${pct(probability)} | odd justa ${odd(fairOdds)} | odd de mercado ${odd(bookmakerOdds)}${Number.isFinite(edge) ? ` | vantagem ${pct(edge)}` : ''}.`,
  );
  if (quality.level === 'LIMITADA') {
    parts.push(`Amostra limitada: ${quality.sample} jogos por equipe, dados parciais.`);
  }

  return parts.join(' ');
}

export function buildFactors({ market, lambdas, profiles, h2h, odds, live, injuries, lineups }) {
  const factors = [];
  const { group } = market;

  if (group === GROUPS.GOALS) {
    if (lambdas.total >= 2.7) factors.push(`Projeção de gols elevada (${lambdas.total.toFixed(2)}).`);
    if (lambdas.total <= 2.2) factors.push(`Projeção de gols baixa (${lambdas.total.toFixed(2)}).`);
    if (profiles.home.goalsFor >= 1.6) factors.push(`Casa com ataque produtivo (${profiles.home.goalsFor.toFixed(2)} gols/jogo).`);
    if (profiles.away.goalsAgainst >= 1.5) factors.push(`Defesa visitante vazada (${profiles.away.goalsAgainst.toFixed(2)} gols sofridos/jogo).`);
  }
  if (group === GROUPS.CORNERS) {
    if (Number.isFinite(lambdas.cornersTotal)) factors.push(`Total projetado de ${lambdas.cornersTotal.toFixed(2)} escanteios.`);
    if (profiles.home.cornersFor >= 5.5) factors.push(`Casa com média alta de escanteios (${profiles.home.cornersFor.toFixed(2)}).`);
    if (profiles.away.cornersAgainst >= 5.5) factors.push(`Visitante cede ${profiles.away.cornersAgainst.toFixed(2)} escanteios/jogo.`);
  }
  if (group === GROUPS.RESULT) {
    factors.push(`Força ofensiva casa x${lambdas.strength.homeAttack.toFixed(2)} / defesa visitante x${lambdas.strength.awayDefence.toFixed(2)}.`);
    factors.push(`Força ofensiva visitante x${lambdas.strength.awayAttack.toFixed(2)} / defesa casa x${lambdas.strength.homeDefence.toFixed(2)}.`);
  }
  if (h2h?.matches >= 3) factors.push(`H2H com ${h2h.matches} confrontos e ${h2h.goalsPerMatch.toFixed(2)} gols por jogo.`);
  if (live) factors.push(`Ritmo ao vivo x${live.tempoFactor.toFixed(2)} (${live.tempoSource}).`);
  if (Number.isFinite(odds)) factors.push(`Odd de mercado ${odds.toFixed(2)} contra odd justa ${market.fairOdds?.toFixed(2) ?? '—'}.`);
  if (lineups?.confirmed) factors.push('Escalações confirmadas pelo provedor.');
  if (injuries?.length) factors.push(`${injuries.length} desfalque(s) reportado(s) pelo provedor.`);

  return factors.slice(0, 6);
}

export function buildRisks({ market, quality, live, odds, profiles, injuries, lineups }) {
  const risks = [];
  if (quality.level === 'LIMITADA') risks.push(`Amostra reduzida (${quality.sample} jogos) — estimativas menos estáveis.`);
  if (!Number.isFinite(odds)) risks.push('Odd de mercado indisponível: sem referência de valor.');
  if (market.group === GROUPS.CORNERS) risks.push('Escanteios têm alta variância jogo a jogo; modelo usa binomial negativa para não subestimar a dispersão.');
  if (live) risks.push('Dados ao vivo podem sofrer atraso do provedor; a análise é recalculada a cada atualização.');
  if (Number.isFinite(profiles.home.goalsForStd) && profiles.home.goalsForStd > 1.6) {
    risks.push(`Alta dispersão de gols da casa (desvio ${profiles.home.goalsForStd.toFixed(2)}).`);
  }
  if (!lineups?.confirmed) risks.push('Escalações ainda não confirmadas pelo provedor.');
  if (!injuries?.length) risks.push('Nenhum desfalque reportado pode significar ausência de dados, não ausência de baixas.');
  risks.push('Probabilidades são estimativas estatísticas; não há garantia de resultado.');
  return risks.slice(0, 5);
}

/**
 * Liquidação de um mercado com o resultado final real da partida.
 * Retorna 'GREEN' | 'RED' | 'VOID' | null (quando ainda não é possível liquidar).
 */
export function settleMarket(recommendation, final) {
  const { group, marketType, line, period, team, selection } = recommendation;
  if (!final) return null;

  const homeGoals = final.home_goals;
  const awayGoals = final.away_goals;
  const htHome = final.ht_home_goals;
  const htAway = final.ht_away_goals;
  const homeCorners = final.home_corners;
  const awayCorners = final.away_corners;
  const htHomeCorners = final.ht_home_corners;
  const htAwayCorners = final.ht_away_corners;

  if (group === GROUPS.GOALS) {
    if (period === '1H') {
      if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
      const total = htHome + htAway;
      return marketType === 'over' ? (total > line ? 'GREEN' : 'RED') : total < line ? 'GREEN' : 'RED';
    }
    if (period === '2H') {
      if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
      const total = homeGoals + awayGoals - htHome - htAway;
      return marketType === 'over' ? (total > line ? 'GREEN' : 'RED') : total < line ? 'GREEN' : 'RED';
    }
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
    const total = homeGoals + awayGoals;
    return marketType === 'over' ? (total > line ? 'GREEN' : 'RED') : total < line ? 'GREEN' : 'RED';
  }

  if (group === GROUPS.CORNERS) {
    let observed;
    if (period === '1H') {
      if (!Number.isFinite(htHomeCorners) || !Number.isFinite(htAwayCorners)) return null;
      observed = team === 'home' ? htHomeCorners : team === 'away' ? htAwayCorners : htHomeCorners + htAwayCorners;
    } else {
      if (!Number.isFinite(homeCorners) || !Number.isFinite(awayCorners)) return null;
      observed = team === 'home' ? homeCorners : team === 'away' ? awayCorners : homeCorners + awayCorners;
    }
    return marketType === 'over' ? (observed > line ? 'GREEN' : 'RED') : observed < line ? 'GREEN' : 'RED';
  }

  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  const total = homeGoals + awayGoals;
  const homeWins = homeGoals > awayGoals;
  const draw = homeGoals === awayGoals;
  const awayWins = awayGoals > homeGoals;

  if (marketType === '1x2') {
    if (selection === 'home') return homeWins ? 'GREEN' : 'RED';
    if (selection === 'draw') return draw ? 'GREEN' : 'RED';
    return awayWins ? 'GREEN' : 'RED';
  }
  if (marketType === 'dc') {
    if (selection === 'home_draw') return homeWins || draw ? 'GREEN' : 'RED';
    if (selection === 'home_away') return !draw ? 'GREEN' : 'RED';
    return awayWins || draw ? 'GREEN' : 'RED';
  }
  if (marketType === 'dnb') {
    if (draw) return 'VOID';
    if (selection === 'home') return homeWins ? 'GREEN' : 'RED';
    return awayWins ? 'GREEN' : 'RED';
  }
  if (marketType === 'btts') {
    const both = homeGoals > 0 && awayGoals > 0;
    return selection === 'yes' ? (both ? 'GREEN' : 'RED') : both ? 'RED' : 'GREEN';
  }
  return null;
}

export function marketKeyOf({ group, marketType, period, team, selection, line }) {
  const parts = [group.toLowerCase(), marketType];
  if (period && period !== 'FT') parts.push(period.toLowerCase());
  if (team) parts.push(team);
  if (selection) parts.push(selection);
  if (Number.isFinite(line)) parts.push(String(line).replace('.', '_'));
  return parts.join('_');
}
