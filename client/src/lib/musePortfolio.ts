import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../convex/api';
import type { Id } from '../../convex/dataModel';

type PageData = NonNullable<FunctionReturnType<typeof api.portfolios.page>>;
type PageCoin = PageData['coins'][number];
type Position = PageCoin['position'];
type MissingPositionFields = 'holdQty' | 'holdSol' | 'entryLiquidityUsd';

/** MCP exposes a lossy read model. Missing values stay missing; the preview must hide dependent UI. */
export type MusePortfolioCoin = Omit<PageCoin, 'position'> & {
  position: Omit<Position, MissingPositionFields> & Partial<Pick<Position, MissingPositionFields>>;
  planSummary?: string[];
};
export type MusePortfolioData = Omit<PageData, 'book' | 'points' | 'coins'> & {
  book: { value: number; hold?: undefined };
  points: { at: number; value: number; hold?: undefined }[];
  coins: MusePortfolioCoin[];
};
export type MusePortfolioSnapshot = { data: MusePortfolioData; readAt: string; warnings: string[] };
type Row = Record<string, unknown>;

const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
function row(value: unknown, path: string): Row {
  if (!record(value)) throw new Error(`HOTBOT did not supply ${path} as an object.`);
  return value;
}
function field(value: Row, key: string): unknown {
  if (value[key] !== undefined) return value[key];
  return record(value.untrusted) ? value.untrusted[key] : undefined;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`HOTBOT did not supply ${path} as text.`);
  return value;
}
function maybeText(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`HOTBOT did not supply ${path} as a finite number.`);
  return value;
}
function maybeNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`HOTBOT did not supply ${path} as a list.`);
  return value;
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function date(value: unknown, path: string): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`HOTBOT did not supply a valid ${path} timestamp.`);
  return parsed;
}
function maybeDate(value: unknown, path: string): number | undefined { return value == null ? undefined : date(value, path); }
function id<Table extends string>(value: unknown, path: string): Id<Table> {
  const checked = text(value, path);
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(checked)) throw new Error(`HOTBOT did not supply a valid ${path}.`);
  return checked as Id<Table>;
}
function choice<const Choices extends readonly string[]>(value: unknown, choices: Choices, path: string): Choices[number] {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`HOTBOT supplied an unsupported ${path}.`);
  return value;
}

function mandateOf(raw: unknown): PageData['mandate'] {
  const source = row(raw, 'mandate');
  return {
    autonomy: choice(source.autonomy, ['ask', 'limits', 'full'], 'mandate.autonomy'),
    age: choice(source.age, ['any', 'established', 'new'], 'mandate.age'),
    words: text(source.words, 'mandate.words'), summary: text(source.summary, 'mandate.summary'),
    terms: strings(source.terms), budgetSol: number(source.budgetSol, 'mandate.budgetSol'),
    coins: number(source.coins, 'mandate.coins'), perCoinSol: number(source.perCoinSol, 'mandate.perCoinSol'),
    tradesPerDay: number(source.tradesPerDay, 'mandate.tradesPerDay'), stopAllSol: number(source.stopAllSol, 'mandate.stopAllSol'),
  };
}

function markOf(raw: unknown, path: string): PageCoin['mark'] {
  const source = row(raw, path);
  return {
    at: date(source.at, `${path}.at`), priceUsd: number(source.priceUsd, `${path}.priceUsd`),
    liquidityUsd: number(source.liquidityUsd, `${path}.liquidityUsd`), volume24hUsd: number(source.volume24hUsd, `${path}.volume24hUsd`),
    capUsd: number(source.capUsd, `${path}.capUsd`), change24hPct: number(source.change24hPct, `${path}.change24hPct`),
    volume1hUsd: maybeNumber(source.volume1hUsd), buys1h: maybeNumber(source.buys1h), sells1h: maybeNumber(source.sells1h),
  };
}

function coinOf(raw: unknown, index: number): MusePortfolioCoin {
  const path = `coins[${index}]`, source = row(raw, path), position = row(source.position, `${path}.position`);
  const thesisRaw = field(source, 'thesis'), thesis = record(thesisRaw) ? thesisRaw : {};
  const plan = record(source.plan) ? source.plan : null;
  return {
    id: id<'portfolioCoins'>(source.id, `${path}.id`), address: text(source.address, `${path}.address`),
    symbol: text(field(source, 'symbol'), `${path}.symbol`), name: text(field(source, 'name'), `${path}.name`),
    status: choice(source.status, ['held', 'exited'], `${path}.status`),
    header: undefined, intel: undefined,
    thesis: { why: maybeText(field(thesis, 'why')) ?? '', wrong: maybeText(field(thesis, 'wrong')) ?? '', add: maybeText(field(thesis, 'add')) ?? '' },
    // MCP supplies plan text/progress, not the original numeric plan. Do not reverse-engineer prices from rounded prose.
    plan: null, ...(plan ? { planSummary: strings(plan.steps) } : {}),
    position: {
      qty: number(position.tokens, `${path}.position.tokens`), costSol: number(position.costSol, `${path}.position.costSol`),
      paidSol: number(position.paidSol, `${path}.position.paidSol`), realizedSol: number(position.realizedSol, `${path}.position.realizedSol`),
      entryPriceUsd: number(position.entryPriceUsd, `${path}.position.entryPriceUsd`), peakPriceUsd: number(position.peakPriceUsd, `${path}.position.peakPriceUsd`),
      boughtAt: date(position.boughtAt, `${path}.position.boughtAt`),
      entryLiquidityUsd: maybeNumber(position.entryLiquidityUsd), holdQty: undefined, holdSol: undefined,
    },
    mark: markOf(source.mark, `${path}.mark`), pickedAt: date(source.pickedAt, `${path}.pickedAt`), exitedAt: maybeDate(source.exitedAt, `${path}.exitedAt`),
  };
}

function journalOf(raw: unknown, index: number): PageData['journal'][number] {
  const path = `journal[${index}]`, source = row(raw, path), ask = record(source.ask) ? source.ask : null;
  const step = record(source.planStep) ? source.planStep : null;
  const read = record(source.read) ? source.read : null;
  const status = ask?.status ?? source.status;
  const action = source.action == null ? undefined : choice(source.action, ['trim', 'exit', 'hold', 'add'], `${path}.action`);
  return {
    id: id<'portfolioJournal'>(source.id, `${path}.id`), at: date(source.at, `${path}.at`),
    kind: choice(source.kind, ['start', 'pick', 'plan', 'stop', 'note', 'pass', 'wake', 'floor'], `${path}.kind`),
    line: text(field(source, 'line'), `${path}.line`), symbol: maybeText(field(source, 'symbol')),
    why: maybeText(field(source, 'why')), coinId: source.coinId == null ? undefined : id<'portfolioCoins'>(source.coinId, `${path}.coinId`),
    action, sol: maybeNumber(source.sol), pnlSol: maybeNumber(source.pnlSol), priceUsd: maybeNumber(source.priceUsd),
    status: status === 'approved' || status === 'skipped' || status === 'pending' ? status : undefined,
    expiresAt: maybeDate(ask?.expiresAt ?? source.expiresAt, `${path}.expiresAt`),
    fired: source.fired == null ? undefined : strings(source.fired),
    step: step ? { kind: choice(step.kind, ['trail', 'risk', 'dip', 'take'], `${path}.planStep.kind`), index: maybeNumber(step.index), of: maybeNumber(step.of) } : undefined,
    read: read ? { mark: markOf(read, `${path}.read`), pumpUsers: maybeNumber(read.pumpHolders), callouts: maybeNumber(read.pumpCallouts) } : undefined,
  };
}

/** Adapt only values actually returned by get_portfolio; unsupported information remains unavailable. */
export function adaptMusePortfolio(raw: unknown): MusePortfolioData {
  const source = row(raw, 'portfolio'), book = row(source.book, 'book');
  const points = book.valueLine == null ? [] : list(book.valueLine, 'book.valueLine');
  const solUsd = number(book.solUsd, 'book.solUsd');
  if (solUsd <= 0) throw new Error('HOTBOT has no usable SOL/USD conversion for this snapshot.');
  return {
    id: id<'portfolios'>(source.id, 'portfolio.id'), name: text(source.name, 'portfolio.name'), mandate: mandateOf(source.mandate),
    status: choice(source.status, ['running', 'paused', 'picking', 'stopped'], 'portfolio.status'),
    startSol: number(book.startSol, 'book.startSol'), cashSol: number(book.cashSol, 'book.cashSol'),
    book: { value: number(book.worthSol, 'book.worthSol'), hold: undefined },
    points: points.map((point, index) => { const value = row(point, `book.valueLine[${index}]`); return { at: date(value.at, `book.valueLine[${index}].at`), value: number(value.worthSol, `book.valueLine[${index}].worthSol`), hold: undefined }; }),
    createdAt: date(source.createdAt, 'portfolio.createdAt'), nextReviewAt: maybeDate(source.nextReviewAt, 'portfolio.nextReviewAt') ?? null,
    nextPickAt: null, tradesToday: number(book.tradesToday, 'book.tradesToday'), solUsd,
    coins: list(source.coins, 'coins').map(coinOf), journal: list(source.journal, 'journal').map(journalOf),
  };
}

export function adaptMusePortfolioSnapshot(raw: unknown): MusePortfolioSnapshot {
  const source = row(raw, 'snapshot');
  const readAt = text(source.readAt, 'snapshot.readAt');
  date(readAt, 'snapshot.readAt');
  const data = adaptMusePortfolio(source.portfolio);
  return { data, readAt, warnings: [
    'This read-only view uses the real get_portfolio snapshot. No portfolio settings are changed here.',
    'The unvalidated holding comparison is unavailable and must not be displayed.',
    'MCP supplies sampled value points and a page of journal history; this is not a complete tick or trade archive.',
    'Entry liquidity, original holding-baseline quantities, internal numeric plans, coin art/intelligence, and next-pick time are not supplied by this MCP read. They are not reconstructed.',
  ] };
}
