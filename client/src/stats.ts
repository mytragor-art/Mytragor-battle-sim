import { resolveServerEndpoint, resolveHttpBase } from './config/runtime';

type Counter = { name: string; decks: number; copies: number; plays: number };
type Mode = 'all' | 'pvp' | 'solo' | 'ai';
type Stats = {
  updatedAt: string;
  days: number;
  mode: Mode;
  decks: number;
  storage: { persistentConfigured: boolean; healthy: boolean };
  leaders: Counter[];
  cards: Counter[];
};

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento ausente: ${id}`);
  return node as T;
}

const mode = element<HTMLSelectElement>('mode');
const days = element<HTMLSelectElement>('days');
const sort = element<HTMLSelectElement>('sort');
const status = element('status');
const error = element('error');
const results = element('results');
const snapshot = element('snapshot');
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
let current: Stats | null = null;
let active: AbortController | null = null;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCounter(value: unknown): value is Counter {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string' && isCount(row.decks) && isCount(row.copies) && isCount(row.plays);
}

function isStats(value: unknown): value is Stats {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const storage = data.storage as Record<string, unknown> | undefined;
  return typeof data.updatedAt === 'string' && Number.isFinite(Date.parse(data.updatedAt))
    && [7, 30, 90].includes(data.days as number)
    && ['all', 'pvp', 'solo', 'ai'].includes(data.mode as string)
    && isCount(data.decks) && !!storage && typeof storage.persistentConfigured === 'boolean'
    && typeof storage.healthy === 'boolean'
    && Array.isArray(data.leaders) && data.leaders.every(isCounter)
    && Array.isArray(data.cards) && data.cards.every(isCounter);
}

function renderRows(id: string, rows: Counter[]) {
  const fragment = document.createDocumentFragment();
  for (const [index, row] of rows.slice(0, 10).entries()) {
    const tr = document.createElement('tr');
    const position = document.createElement('td');
    position.textContent = `${index + 1}º`;
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = row.name;
    tr.append(position, name);
    fragment.append(tr);
  }
  element(id).replaceChildren(fragment);
}

function renderCards() {
  if (!current) return;
  const key = sort.value === 'plays' ? 'plays' : 'decks';
  const rows = [...current.cards].sort((a, b) => b[key] - a[key]
    || b.decks - a.decks || b.plays - a.plays || a.name.localeCompare(b.name, 'pt-BR'));
  renderRows('cards', rows);
  element('cards-caption').textContent = key === 'plays'
    ? 'Top 10 por jogadas resolvidas, sem exibir quantidades.' : 'Top 10 por presença nos baralhos, sem exibir quantidades.';
}

function render(data: Stats) {
  current = data;
  const modeLabel = mode.selectedOptions[0].textContent || '';
  element('updated').textContent = `${modeLabel} · ${data.days} dias · Atualizado em ${dateTime.format(new Date(data.updatedAt))}`;
  element('durability-warning').hidden = data.storage.persistentConfigured;
  element('health-warning').hidden = data.storage.healthy;
  element('empty').hidden = data.decks !== 0 || data.leaders.length !== 0 || data.cards.length !== 0;
  element('leaders-empty').hidden = data.leaders.length !== 0;
  element('cards-empty').hidden = data.cards.length !== 0;
  const leaders = [...data.leaders].sort((a, b) => b.decks - a.decks || a.name.localeCompare(b.name, 'pt-BR'));
  renderRows('leaders', leaders);
  renderCards();
  snapshot.hidden = false;
}

async function loadStats() {
  active?.abort();
  const controller = new AbortController();
  active = controller;
  const requestedMode = mode.value;
  const requestedDays = days.value;
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);
  current = null;
  snapshot.hidden = true;
  error.hidden = true;
  results.setAttribute('aria-busy', 'true');
  status.textContent = 'Carregando estatísticas…';
  try {
    const query = new URLSearchParams({ mode: requestedMode, days: requestedDays });
    const response = await fetch(`${resolveHttpBase(resolveServerEndpoint())}/usage-stats?${query}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('HTTP');
    const data: unknown = await response.json();
    if (active !== controller) return;
    if (controller.signal.aborted) throw new Error('ABORTED');
    if (!isStats(data) || data.mode !== requestedMode || String(data.days) !== requestedDays) {
      throw new Error('FORMAT');
    }
    render(data);
    status.textContent = 'Estatísticas carregadas. Não há atualização automática.';
  } catch (cause: unknown) {
    if (active !== controller) return;
    status.textContent = '';
    error.textContent = timedOut
      ? 'O servidor não respondeu em 15 segundos. Use “Atualizar dados” para tentar novamente.'
      : cause instanceof Error && cause.message === 'FORMAT'
        ? 'O servidor retornou estatísticas em formato inesperado. Tente atualizar novamente.'
        : 'Não foi possível carregar as estatísticas. Verifique sua conexão e use “Atualizar dados” para tentar novamente.';
    error.hidden = false;
  } finally {
    window.clearTimeout(timeout);
    if (active === controller) {
      active = null;
      results.setAttribute('aria-busy', 'false');
    }
  }
}

mode.addEventListener('change', () => void loadStats());
days.addEventListener('change', () => void loadStats());
element('refresh').addEventListener('click', () => void loadStats());
sort.addEventListener('change', renderCards);
window.addEventListener('pagehide', () => {
  active?.abort();
  active = null;
});
void loadStats();