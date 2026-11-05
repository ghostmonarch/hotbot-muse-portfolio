"use client";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';
import { useAction, useMutation, type PaginationStatus } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { toast } from 'sonner';
import { Archive, ArrowLeft, ArrowUp, BadgeCheck, Bot, Cat, Check, ChevronRight, Eye, Gem, Heart, MessageCircle, Pause, Play, Plus, Repeat2, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { api, usePaginatedQuery, useQuery } from '@/lib/convex';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TokenAvatar, useCoinLogo } from '@/components/token/TokenAvatar';
import { BotAvatar } from '@/components/hotbot/BotAvatar';
import { useDictation } from '@/hooks/useDictation';
import { useCoinBanner } from '@/services/banners';
import { CoinChart, type ChartMarker, type ChartRange } from './CoinChart';
import { CoinSheet } from './CoinLook';
import { CoinHead } from './Decision';
import { MicButton } from './MicButton';
import { useCoinLaunchedAt } from './TokenInfo';
import { PortfolioChat, type ChatMessage } from './PortfolioChat';
import { RateButton, useCoinRating } from './Rating';
import { AUTONOMY, COVER_COINS, FLOOR, JOURNAL_PAGE, MANDATE, pctFrom, signalsOf, type Autonomy, type Mandate } from '../../../../types/portfolio';
import type { MusePortfolioData, MusePortfolioCoin } from '@/lib/musePortfolio';
import type { LIMIT_KEYS } from '../../../../types/portfolioChat';
import { planMeters, planText, type PlanMeter, type RiskKind } from '../../../../types/plan';
import type { AgentRole } from '../../../../types/hotbot';
import { MARKET_PERIODS } from '../../../../types/marketFeed';
import { claimWord, type ClaimKind, type ClaimStatus } from '../../../../types/findings';
import { ago, appHref, pct, price, signedSol, sol, tone, usd } from './format';
import { Hint, Loading, Meter, Num, PORTFOLIO_STATUS, QuickPicks, RoomMeter, useNow, type Wire } from './Parts';
import { Paged } from './Stream';
import { AtLimit, usePortfolioLimit, type Limit } from './Limits';
import { failToast, readOnly, viewAsAtom, viewedAtom } from './state';
import s from './team.module.css';
import { Link, useRouter } from '@/lib/appNavigation';

export type Card = NonNullable<FunctionReturnType<typeof api.portfolios.list>>[number];
export type PageData = NonNullable<FunctionReturnType<typeof api.portfolios.page>>;
type Findings = NonNullable<FunctionReturnType<typeof api.portfolios.findings>>;
type Claim = Findings['coins'][number]['claims'][number];
type Entry = PageData['journal'][number];
type ViewData = PageData | MusePortfolioData;
type CoinRow = PageData['coins'][number] | MusePortfolioCoin;
type Draft = FunctionReturnType<typeof api.portfolios.draft>;

/** Words an idea card hands to the new-portfolio screen. */
const wordsAtom = atom('');

export const AUTONOMY_TEXT: Record<Autonomy, { label: string; note: string }> = {
  ask: { label: 'Ask me first', note: 'Every trade waits for your yes. Asks you don’t answer in 2 hours are skipped.' },
  limits: { label: 'Inside my limits', note: 'Trades inside your limits go ahead. Anything bigger asks you first.' },
  full: { label: 'Fully', note: 'Every trade goes ahead, cut down to your limits.' },
};
/** What each setting does, in one sentence for its tooltip; how much HOTBOT does alone names all three choices. */
export const LIMIT_TEXT: Record<typeof LIMIT_KEYS[number], { label: string; note: ReactNode }> = {
  autonomy: { label: 'How much HOTBOT does alone', note: <span className={s.folioHintList}>{AUTONOMY.map(choice => <span key={choice}><b>{AUTONOMY_TEXT[choice].label}</b> {AUTONOMY_TEXT[choice].note}</span>)}</span> },
  perCoinSol: { label: 'Most SOL in one coin', note: 'HOTBOT keeps what one coin cost it under this; a bigger add asks you first, or, when HOTBOT does everything alone, adds only what fits.' },
  tradesPerDay: { label: 'Trades a day', note: 'The most buys and sells HOTBOT makes in a day (UTC), take-profits and dip buys included; new picks and the safety floor never wait for it.' },
  stopAllSol: { label: 'Sell all and stop under', note: 'When the portfolio’s worth falls under this, HOTBOT sells every coin and stops it; 0 turns it off.' },
};
const STATUS_TONE: Partial<Record<Card['status'], string>> = { running: 'live', picking: 'ember', stopped: 'down' };
const IDEAS = [
  { name: 'Cat coins', Icon: Cat, words: 'Good cat coins with real communities, held for weeks. Add on dips.' },
  { name: 'AI agents', Icon: Bot, words: 'AI agent coins whose teams ship, held for months. Ask me before each buy.' },
  { name: 'Blue-chip memes', Icon: Gem, words: 'Big, older memecoins held for months, 10 SOL. Add on dips.' },
] as const;

/** Mutations that act on the person's own portfolios; a viewing admin gets the read-only note instead. */
export function useAct() {
  const viewed = useAtomValue(viewedAtom);
  return async <T,>(run: () => Promise<T>): Promise<T | undefined> => {
    if (viewed) { toast.error(readOnly(viewed)); return undefined; }
    try { return await run(); } catch (cause) { failToast(cause); return undefined; }
  };
}

type CoinFace = { address: string; symbol: string; header?: string | null };
const coinAvatar = (coin: CoinFace, className: string) =>
  <TokenAvatar className={className} address={coin.address} symbol={coin.symbol}/>;

/** A coin's art: its banner (one stored with its intel, else the one its DexScreener profile shows, read in the browser), else its logo blown
 *  up and blurred into a field of its own colours. It stays plain while the banner is asked for, so a banner never replaces the blur in sight. */
function CoinArt({ coin, className, children }: { coin: CoinFace; className?: string; children?: ReactNode }) {
  const banner = useCoinBanner(coin.header ? null : coin.address), header = coin.header ?? banner;
  const logo = useCoinLogo(header || banner === undefined ? '' : coin.address).src;
  return <span className={`${s.folioArt} ${className ?? ''}`}>
    {header ? <img src={header} alt="" loading="lazy" referrerPolicy="no-referrer"/> : banner === null && <i style={logo ? { backgroundImage: `url(${JSON.stringify(logo)})` } : undefined} aria-hidden/>}
    {children}
  </span>;
}

/** A portfolio's cover: the first of its coins' stored banners, else the first coin's art, else the theme's tint. Greyed when the coins are
 *  the ones it held last. */
function Cover({ src, coin, past, small, children }: { src?: string | null; coin?: CoinFace; past: boolean; small?: boolean; children?: ReactNode }) {
  return <span className={s.folioCover} data-small={small || undefined} data-past={past || undefined}>
    {src ? <img src={src} alt="" loading={small ? 'lazy' : 'eager'} referrerPolicy="no-referrer"/> : coin ? <CoinArt coin={{ ...coin, header: null }}/> : null}
    {children}
  </span>;
}

/** The coins as big tilted stickers, greyed when they are the ones it held last, or HOTBOT in a sticker's place before its first pick. */
function Stickers({ coins, past, scanning, small }: { coins: CoinFace[]; past: boolean; scanning?: boolean; small?: boolean }) {
  return <span className={s.folioStickers} data-small={small || undefined} data-past={past || undefined} aria-hidden>
    {coins.length ? coins.slice(0, COVER_COINS).map((coin, index) => <span key={coin.address} style={{ '--i': index } as CSSProperties}>{coinAvatar(coin, 'size-full rounded-full')}</span>)
      : <span className={s.folioMascot}><BotAvatar role="coordinator" size={small ? 44 : 72} mood={scanning ? 'scan' : undefined}/></span>}
  </span>;
}

/** A portfolio that holds no coin: all its worth is in SOL, and while it runs it looks for coins again at `nextPickAt`. */
function InSol({ nextPickAt, now }: { nextPickAt: number | null; now: number }) {
  return <span className={`${s.pill} ${s.folioInSol}`}>All in SOL{nextPickAt !== null && now > 0 && ` · looks again in ${until(nextPickAt, now)}`}</span>;
}

type LineTrade = { id: string; at: number; tone?: string; line: string; sol?: number; pnlSol?: number };
type LinePoint = { at: number; value: number; hold?: number };
/** The line at `at`, straight between the points around it, as it is drawn. */
const along = (points: readonly LinePoint[], at: number): LinePoint => {
  const after = points.findIndex(point => point.at >= at);
  if (after <= 0) return { ...points[after === 0 ? 0 : points.length - 1], at };
  const a = points[after - 1], b = points[after], share = (at - a.at) / Math.max(1, b.at - a.at);
  return { at, value: a.value + (b.value - a.value) * share, hold: a.hold !== undefined && b.hold !== undefined ? a.hold + (b.hold - a.hold) * share : undefined };
};
const TIP_TRADES = { near: 0.015, max: 3 } as const;
/** The value line and, dashed, the same picks bought once and never touched. A pointer over it reads the line where it points: the time,
 *  the worth and its change since the start, the holding line, and the trades within `TIP_TRADES.near` of the line's span from the
 *  pointer, at most `TIP_TRADES.max`. */
function ValueLine({ points, start, trades = [] }: { points: LinePoint[]; start: number; trades?: LineTrade[] }) {
  const gradient = useId().replace(/:/g, '');
  const [pointed, setPointed] = useState<number | null>(null);
  const line = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].at, span = Math.max(1, points.at(-1)!.at - first);
    const values = points.flatMap(point => point.hold === undefined ? [point.value, start] : [point.value, point.hold, start]), low = Math.min(...values), high = Math.max(...values), pad = Math.max(start * 0.01, (high - low) * 0.15);
    const y = (value: number) => 4 + (1 - (value - (low - pad)) / (high - low + 2 * pad)) * 34;
    const path = (key: 'value' | 'hold') => points.map((point, index) => `${index ? 'L' : 'M'}${((point.at - first) / span * 100).toFixed(2)} ${y(point[key] ?? point.value).toFixed(2)}`).join(' ');
    const dots = trades.filter(trade => trade.at >= first && trade.at <= first + span).map(trade => ({ ...trade, left: (trade.at - first) / span * 100, top: y(along(points, trade.at).value) / 40 * 100 }));
    return { first, span, y, value: path('value'), hold: points.every(point => point.hold !== undefined) ? path('hold') : null, base: y(start), dots };
  }, [points, start, trades]);
  const change = changeTone((points.at(-1)?.value ?? start) - start, start), shade = change === 'down' ? 'var(--destructive)' : change === 'up' ? 'var(--positive)' : 'var(--muted-foreground)';
  if (!line) return <div className={s.folioChartEmpty} role="img" aria-label="The value line starts once HOTBOT has picked and priced the coins"><BotAvatar role="coordinator" size={44} mood="scan"/></div>;
  const point = pointed === null ? null : along(points, pointed), move = point ? (point.value - start) / start * 100 : 0;
  const read = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), at = line.first + Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * line.span;
    setPointed(at);
  };
  const left = point ? (point.at - line.first) / line.span * 100 : 0;
  const here = pointed === null ? [] : trades.filter(trade => Math.abs(trade.at - pointed) <= line.span * TIP_TRADES.near).sort((a, b) => Math.abs(a.at - pointed) - Math.abs(b.at - pointed));
  return <div className={s.folioChartWrap} onPointerMove={read} onPointerDown={read} onPointerLeave={() => setPointed(null)}><svg className={s.folioChart} viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={line.hold ? "Portfolio value over time, against buy-and-hold" : "Paper portfolio value over time"}>
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={shade} stopOpacity={0.2}/><stop offset="100%" stopColor={shade} stopOpacity={0}/></linearGradient></defs>
    <path d={`M0 ${line.base.toFixed(2)} L100 ${line.base.toFixed(2)}`} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke"/>
    <path d={`${line.value} L100 40 L0 40 Z`} fill={`url(#${gradient})`}/>
    {line.hold && <path d={line.hold} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.7} strokeWidth={1.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke"/>}
    <path d={line.value} fill="none" stroke={shade} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
  </svg>{line.dots.map(dot => <i key={dot.id} className={s.folioDot} data-tone={dot.tone} style={{ left: `${dot.left}%`, top: `${dot.top}%` }} aria-hidden/>)}
    {point && <>
      <i className={s.folioCursor} style={{ left: `${left}%` }} aria-hidden/>
      <i className={s.folioCursorDot} style={{ left: `${left}%`, top: `${line.y(point.value) / 40 * 100}%` }} aria-hidden/>
      <div className={s.folioTip} style={{ left: `${Math.min(80, Math.max(20, left))}%` }} role="status">
        <small>{new Date(point.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>
        <b className={s.num}>{sol(point.value, 2)} <span className={s[tone(move, 1) ?? 'muted']}>{pct(move)}</span></b>
        {point.hold !== undefined && <small className={s.num}>Holding {sol(point.hold, 2)}</small>}
        {here.slice(0, TIP_TRADES.max).map(trade => <span key={trade.id} className={s.folioTipTrade} data-tone={trade.tone}><i aria-hidden/>{trade.line}{trade.sol != null && <b className={s.num}>{sol(trade.sol, 2)}{trade.pnlSol != null && trade.sol - trade.pnlSol > 0 && <span className={s[tone(trade.pnlSol / (trade.sol - trade.pnlSol) * 100, 1) ?? 'muted']}> {pct(trade.pnlSol / (trade.sol - trade.pnlSol) * 100)}</span>}</b>}</span>)}
        {here.length > TIP_TRADES.max && <small>+{here.length - TIP_TRADES.max} more</small>}
      </div>
    </>}
  </div>;
}

/** How long until `at`, in `ago`'s units. */
const until = (at: number, now: number) => { const left = ago(2 * now - at, now); return left === 'now' ? 'a minute' : left; };
const lead = (vsHold: number, startSol: number) => Math.min(1, Math.abs(vsHold) / Math.max(1e-9, startSol * 0.1));

/** The match every portfolio plays: its worth against the same picks bought once and never touched. The bar grows right when ahead, left when
 *  behind, coloured as the score strip shows the lead (2 decimals). */
function Tug({ vsHold, startSol }: { vsHold: number; startSol: number }) {
  return <span className={s.folioTug} data-tone={tone(vsHold, 2)} style={{ '--lead': lead(vsHold, startSol) } as CSSProperties} aria-hidden><i/></span>;
}

/** The tone of a worth's change as `Delta` shows it, in SOL and as a share of the start: coloured when either figure is not zero. */
const changeTone = (pnl: number, startSol: number) => tone(pnl, 2) ?? tone(pnl / startSol * 100, 1);
/** A worth's change since the start, in SOL and as a share of the start. */
function Delta({ pnl, startSol }: { pnl: number; startSol: number }) {
  return <span className={s.folioDelta} data-tone={changeTone(pnl, startSol)}>{signedSol(pnl, 2).replace(' SOL', '')} · {pct(pnl / startSol * 100)}</span>;
}

function StatusPill({ status, asks }: { status: Card['status']; asks?: number }) {
  return <span className={s.pill} data-tone={asks ? 'warn' : STATUS_TONE[status]}>{status === 'running' && !asks && <i className={s.dot} data-live/>}{asks ? 'Needs you' : PORTFOLIO_STATUS[status]}</span>;
}

export function PortfolioCard({ row, now }: { row: Card; now: number }) {
  const past = row.coins.some(coin => coin.exitedAt !== undefined);
  return <Link href={appHref('portfolios', row.id)} className={`${s.surface} ${s.folioCard}`}>
    <Cover src={row.cover} coin={row.coins[0]} past={past} small><StatusPill status={row.status} asks={row.asks}/></Cover>
    <span className={s.folioCardBody}>
      <Stickers coins={row.coins} past={past} scanning={row.status === 'picking'} small/>
      <b className={s.folioCardName}>{row.name}</b>
      <span className={s.folioCardWorth}><b className={s.num}>{row.valueSol.toFixed(2)}<i>SOL</i></b><Delta pnl={row.valueSol - row.startSol} startSol={row.startSol}/></span>
      {past && <InSol nextPickAt={row.nextPickAt} now={now}/>}
      {row.last && <span className={s.folioLast}><span>{row.last.line}</span><small>{ago(row.last.at, now)}</small></span>}
    </span>
  </Link>;
}

/** Ideas to start from. Each opens the new-portfolio screen with its words filled in. */
function Ideas({ onPick, limit }: { onPick: (words: string) => void; limit: Limit | null }) {
  return <div className={s.folioIdeas}>{IDEAS.map(({ name, Icon, words }) => <AtLimit key={name} limit={limit}><button type="button" className={`${s.surface} ${s.folioIdea}`} onClick={() => onPick(words)}>
    <span className={s.folioIdeaIcon}><Icon aria-hidden/></span><b>{name}</b><small>{words}</small>
  </button></AtLimit>)}</div>;
}

/** Every portfolio as a card: its coins as stickers, its worth and profit, the newest thing HOTBOT did; then ideas to start another. */
export function PortfoliosPage() {
  const rows = useQuery(api.portfolios.list, { ...useAtomValue(viewAsAtom) }), now = useNow(30_000), router = useRouter(), [, setWords] = useAtom(wordsAtom);
  const running = rows?.filter(row => row.status === 'running' || row.status === 'picking').length ?? 0, limit = usePortfolioLimit();
  const start = (words: string) => { setWords(words); router.push(appHref('portfolios', 'new')); };
  return <div className={s.page}>
    <header className={s.head}>
      <div><h1 className={s.title}>Portfolios{rows ? <span className={s.titleCount}>{running} running</span> : null}<span className={s.pill} title="Portfolios trade on paper until they beat buy-and-hold over weeks of tests. No SOL moves.">Paper</span></h1></div>
      <div className={s.headActions}><AtLimit limit={limit}><Button asChild variant="ember" size="sm"><Link href={appHref('portfolios', 'new')}><Plus/>New portfolio</Link></Button></AtLimit></div>
    </header>
    {rows === undefined ? <Loading variant="box" height="16rem"/>
      : rows === null ? <p className={s.empty}>Start your team first.</p>
      : rows.length > 0 && <div className={s.folioGrid}>{rows.map(row => <PortfolioCard key={row.id} row={row} now={now}/>)}</div>}
    <section className={s.section} aria-label="Start from an idea">
      <div className={s.sectionHead}><h2>{rows?.length ? 'Start another' : 'Start from an idea'}</h2></div>
      <Ideas onPick={start} limit={limit}/>
    </section>
  </div>;
}

const AGE_TEXT: Record<Mandate['age'], string> = { established: 'Older coins', new: 'New coins', any: 'New or old' };
/** A mandate as value tiles, each limit with its `LIMIT_TEXT` note. */
export const loadout = (mandate: Mandate): [string, string, ReactNode?][] => [
  ['Budget', sol(mandate.budgetSol, 2)], ['Coins', `${mandate.coins}`], ['Max a coin', sol(mandate.perCoinSol, 2), LIMIT_TEXT.perCoinSol.note],
  ['Coin age', AGE_TEXT[mandate.age]], ['Trades', `${mandate.tradesPerDay} a day`, LIMIT_TEXT.tradesPerDay.note], ['Stop floor', sol(mandate.stopAllSol, 2), LIMIT_TEXT.stopAllSol.note],
];
/** A setting's name, with what it does in a tooltip when there is a note. */
export const SettingName = ({ name, note }: { name: string; note?: ReactNode }) => note ? <Hint text={note}>{name}</Hint> : <>{name}</>;

/** How much HOTBOT does alone, as three choices; its tooltip says what each one does. */
function AutonomyPicks({ value, onPick }: { value: Autonomy; onPick: (value: Autonomy) => void }) {
  return <div className={s.folioLeash}><Hint text={LIMIT_TEXT.autonomy.note}><b>{LIMIT_TEXT.autonomy.label}</b></Hint><QuickPicks options={AUTONOMY.map(choice => ({ value: choice, text: AUTONOMY_TEXT[choice].label }))} value={value} onPick={onPick}/></div>;
}

/** Making a portfolio is a conversation: the person says what they want, in words or by voice, and HOTBOT answers in a sentence or two, asks
 *  at most one question when something important is unclear, and shows the portfolio as a card that every next message changes. Start is
 *  on the card from the first answer. */
type Turn = { id: number; role: 'person' | 'agent'; text: string; draft?: Draft };
const STARTERS = ['Good cat coins with real communities, held for weeks', 'Fresh promising coins for a few days, 2 SOL', 'Big older memecoins for a year, 10 SOL'] as const;

export function NewPortfolio() {
  const router = useRouter(), act = useAct(), [initial, setInitial] = useAtom(wordsAtom);
  const draftAction = useAction(api.portfolios.draft), start = useMutation(api.portfolios.start);
  const [turns, setTurns] = useState<Turn[]>([]), [text, setText] = useState(initial), [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState<'draft' | 'start' | null>(null);
  const dictation = useDictation(said => setText(previous => previous.trim() ? `${previous.trimEnd()} ${said}` : said));
  // Each new turn comes into view. HOTBOT's answer shows from its start, so its words come before its card.
  const thread = useRef<HTMLDivElement>(null), lastRole = turns.at(-1)?.role;
  // The card sits on HOTBOT's newest answer that came with a draft, and shows the draft as it is now.
  const cardAt = turns.findLast(turn => turn.draft)?.id;
  useEffect(() => {
    if (!lastRole) return;
    thread.current?.lastElementChild?.scrollIntoView({ block: lastRole === 'agent' && busy === null ? 'start' : 'end', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [turns.length, lastRole, busy]);
  const send = async (words: string) => {
    const said = words.trim();
    if (busy || said.length < (turns.length ? 1 : 3)) return;
    setTurns(rows => [...rows, { id: rows.length, role: 'person', text: said }]);
    setText(''); setBusy('draft');
    const history = turns.map(({ role, text: words }) => ({ role, text: words }));
    const next = await act(() => draftAction({ text: said, history, ...(draft ? { current: { name: draft.name, mandate: draft.mandate } } : {}) }));
    setBusy(null);
    if (!next) { setText(said); setTurns(rows => rows.slice(0, -1)); return; }
    setDraft(next); setInitial('');
    setTurns(rows => [...rows, { id: rows.length, role: 'agent', text: [next.reply, next.question].filter(Boolean).join(' ') || `${next.name} is set up.`, draft: next }]);
  };
  const begin = async () => {
    if (!draft || busy) return;
    setBusy('start');
    const id = await act(() => start({ name: draft.name, mandate: draft.mandate }));
    setBusy(null);
    if (id) router.push(appHref('portfolios', id));
  };
  return <div className={`${s.page} ${s.folioNew}`}>
    <Link href={appHref('portfolios')} className={s.back}><ArrowLeft size={14}/>Portfolios</Link>
    <section className={`${s.surface} ${s.folioChat} ${s.folioCreate}`} aria-label="New portfolio">
      <div ref={thread} className={s.folioChatThread} role="log" aria-live="polite" aria-busy={busy === 'draft'}>
        {turns.length === 0 && busy === null ? <div className={s.folioChatEmpty}>
          <BotAvatar role="coordinator" size={64}/>
          <h1 className={s.title}>What should I hold for you?</h1>
          <span className={s.folioChatAsks}>{STARTERS.map(starter => <Button key={starter} size="sm" variant="secondary" className="rounded-full" onClick={() => void send(starter)}>{starter}</Button>)}</span>
        </div> : turns.map(turn => turn.role === 'person' ? <p key={turn.id} className={s.folioChatMine}>{turn.text}</p>
          : <div key={turn.id} className={s.folioChatAgent}><BotAvatar role="coordinator" size={28}/><div>
            <p className={s.folioThesis}>{turn.text}</p>
            {turn.id === cardAt && draft && <DraftCard draft={draft} busy={busy} onAutonomy={autonomy => setDraft({ ...draft, mandate: { ...draft.mandate, autonomy } })} onStart={() => void begin()}/>}
          </div></div>)}
        {busy === 'draft' && <div className={s.folioChatAgent} role="status" aria-label="HOTBOT is setting it up"><BotAvatar role="coordinator" size={28} mood="scan"/><span className={s.folioChatTyping} aria-hidden><i/><i/><i/></span></div>}
      </div>
      <form className={s.folioChangeBox} onSubmit={event => { event.preventDefault(); void send(text); }}>
        <label htmlFor="folio-words" className="sr-only">Tell HOTBOT what to hold</label>
        <input id="folio-words" value={text} maxLength={MANDATE.words} autoFocus autoComplete="off" disabled={busy === 'start'} placeholder={draft ? 'Change anything' : 'Cat coins for a few weeks, 5 SOL'} onChange={event => setText(event.target.value)}/>
        <MicButton dictation={dictation}/>
        <Button type="submit" size="icon" variant="ember" aria-label="Send" disabled={busy !== null || text.trim().length < (turns.length ? 1 : 3)}><ArrowUp/></Button>
      </form>
    </section>
  </div>;
}

/** The portfolio as it stands in the conversation: its values, the coins that fit now, how much HOTBOT does alone, and Start. */
function DraftCard({ draft, busy, onAutonomy, onStart }: { draft: Draft; busy: 'draft' | 'start' | null; onAutonomy: (autonomy: Autonomy) => void; onStart: () => void }) {
  const mandate = draft.mandate;
  return <div className={`${s.folioDraft} ${s.folioDraftCard}`} data-busy={busy === 'draft' || undefined}>
    <span className={s.folioDraftName}><b>{draft.name}</b><span className={s.pill}>Paper</span></span>
    <div className={s.folioLoadout}>{loadout(mandate).map(([label, value, note]) => <span key={label} className={s.folioStat}><small><SettingName name={label} note={note}/></small><b className={s.num}>{value}</b></span>)}</div>
    {draft.fits.length > 0 && <div className={s.folioFits}><b>Fits now</b><span className={s.folioFitList}>{draft.fits.slice(0, 8).map(coin => <span key={coin.address} className={s.folioFit} title={`${coin.symbol} · ${usd(coin.capUsd)}`}>{coinAvatar(coin, 'size-10 rounded-full')}<small>{coin.symbol}</small></span>)}</span></div>}
    <AutonomyPicks value={mandate.autonomy} onPick={onAutonomy}/>
    <div className={s.folioDraftActions}><AtLimit limit={usePortfolioLimit()}><Button variant="ember" onClick={onStart} disabled={busy !== null}><Play/>{busy === 'start' ? 'Starting…' : 'Start portfolio'}</Button></AtLimit></div>
  </div>;
}

const worthOf = (coin: CoinRow, data: ViewData) => coin.position.qty * coin.mark.priceUsd / (data.solUsd || 1);

/** A coin's plan as meters (`planMeters`): each step with how far the coin has moved toward it from where the plan was set, and the code
 *  floor. A step's value is the price's distance from its level, or a risk's progress; a step that fired shows its state. Take profits are
 *  green, dip buys ember, exits warn and the floor is red. A risk without a fresh source has no meter. */
const RISK_LABEL: Record<RiskKind, (value: number) => string> = { liquidity: value => `Exit at liquidity −${value}%`, holders: value => `Exit at holders −${value}%`, sellers: value => `Exit at ${value}% sells`, labels: value => `Exit at ${value} bot or scam posts` };
const STATE_TEXT = { filled: 'Done', asked: 'Asked', refused: 'Skipped' } as const;
function wireOf(meter: PlanMeter, priceUsd: number): Wire {
  const away = meter.priceUsd ? pct(pctFrom(priceUsd, meter.priceUsd)) : `${Math.round(meter.fill * 100)}%`;
  const label = meter.kind === 'take' ? `Sell ${meter.part! >= 1 ? 'the rest' : `${Math.round(meter.part! * 100)}%`} · ${price(meter.priceUsd!)}` : meter.kind === 'dip' ? `Buy ${sol(meter.sol!, 2)} · ${price(meter.priceUsd!)}`
    : meter.kind === 'trail' ? (meter.armed ? `Trailing stop ${meter.value}% · ${price(meter.priceUsd!)}` : `Trail ${meter.value}% from ${price(meter.priceUsd!)}`) : RISK_LABEL[meter.risk!](meter.value!);
  return { key: meter.key, label, value: meter.state === 'open' ? away : STATE_TEXT[meter.state], fill: meter.fill, tone: meter.tone, ...(meter.state !== 'open' ? { done: true } : {}) };
}
function wires(coin: CoinRow, now = Date.now()): Wire[] {
  const plan = coin.plan ? planMeters(coin.plan, coin.mark, signalsOf(coin.intel, now)).map(meter => wireOf(meter, coin.mark.priceUsd)) : [];
  const floor = Math.max(0, Math.min(1, -pctFrom(coin.position.entryPriceUsd, coin.mark.priceUsd) / FLOOR.dropPct));
  return [...plan, { key: 'floor', label: `Floor · ${price(coin.position.entryPriceUsd * (1 - FLOOR.dropPct / 100))}`, value: pct(pctFrom(coin.mark.priceUsd, coin.position.entryPriceUsd * (1 - FLOOR.dropPct / 100))), fill: floor, tone: 'down' }];
}

/** A held coin as a card: its art, the move, its share and worth, why HOTBOT holds it, and the open plan step it is closest to. */
function CoinCard({ coin, data, onOpen }: { coin: CoinRow; data: ViewData; onOpen: () => void }) {
  const worth = worthOf(coin, data), gain = (worthOf(coin, data) + coin.position.realizedSol - coin.position.paidSol), gainPct = coin.position.paidSol > 0 ? gain / coin.position.paidSol * 100 : 0;
  const share = worth / Math.max(1e-9, data.book.value) * 100, hot = wires(coin).filter(wire => !wire.done).reduce<Wire | null>((best, wire) => !best || wire.fill > best.fill ? wire : best, null);
  // A block, not a <button>: Safari draws a button's own border and does not stretch its parts, so the card would not match the banner.
  return <li><div role="button" tabIndex={0} className={`${s.surface} ${s.folioCoin}`} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}>
    <CoinArt coin={coin} className={s.folioCoinArt}><span className={s.folioMove} data-tone={tone(gainPct, 1)}>{pct(gainPct)}</span></CoinArt>
    <span className={s.folioCoinHead}>
      <span className={s.folioCoinFace}>{coinAvatar(coin, 'size-full rounded-full')}</span>
      <span className={s.folioCoinTitle}>
        <span className={s.folioCoinName}><b>{coin.symbol}</b><span className={s.pill}>{Math.round(share)}%</span></span>
        <span className={s.folioCoinWorth}><b className={s.num}>{sol(worth, 2)}</b><small className={`${s.num} ${s[tone(gain, 2) ?? 'muted']}`}>{signedSol(gain, 2)}</small></span>
      </span>
    </span>
    <span className={s.folioCoinBody}>
      <span className={s.folioCoinWhy}>{coin.thesis.why}</span>
      {hot && <ul className={s.meters}><Meter wire={hot}/></ul>}
    </span>
  </div></li>;
}

const CLAIM_LABEL: Record<ClaimKind, string> = { why: 'Why', wrong: 'Wrong if', add: 'Add when' };
/** The briefing's field names a claim may quote, in words a person reads. */
const FIELD_WORDS: Record<string, string> = { volume24hUsd: '24h volume', volume24h: '24h volume', volume1hUsd: 'volume in the last hour', buys1h: 'buys in the last hour', sells1h: 'sells in the last hour', liquidityUsd: 'liquidity', capUsd: 'market cap', change24hPct: '24h change', priceUsd: 'price' };
const plainFields = (text: string) => text.replace(/\b(volume24hUsd|volume24h|volume1hUsd|buys1h|sells1h|liquidityUsd|capUsd|change24hPct|priceUsd)\b/g, field => FIELD_WORDS[field]);
/** A claim's status in its kind's words (`claimWord`). Green and red stay for money, so a claim warns only when it turns against the coin:
 *  a why weakening or broken, a wrong-if close or met. */
const claimWarns = (kind: string, status: ClaimStatus) => status === 'weakening' || status === 'refuted' || (kind === 'wrong' && status === 'right');
/** The coin's claims, each with its status and the newest evidence behind it. */
function Claims({ claims }: { claims: Claim[] }) {
  return <ul className={s.folioClaims}>{claims.map(claim => { const word = claimWord(claim.kind, claim.status as ClaimStatus); return <li key={claim.id}>
    <span className={s.folioClaimHead}><b>{CLAIM_LABEL[claim.kind as ClaimKind]}</b><span className={s.pill} data-tone={claimWarns(claim.kind, claim.status as ClaimStatus) ? 'warn' : undefined}>{word.charAt(0).toUpperCase() + word.slice(1)}</span></span>
    <p>{plainFields(claim.text)}</p>
    {claim.evidence.length > 0 && <span className={s.folioEvidence}>{claim.evidence.slice(0, 3).map(fact => <small key={fact.id} title={fact.text}>{fact.text.length > 60 ? fact.text.slice(0, 59) + '…' : fact.text}</small>)}</span>}
  </li>; })}</ul>;
}

/** One held coin in full, in the coin sheet every coin opens in: its head with the worth and move, its chart with the entry, the market's
 *  pulse, the thesis, its plan step by step, and Rate. */
function CoinDialog({ coin, data, claims, now, onWhy, onClose }: { coin: CoinRow; data: ViewData; claims?: Claim[]; now: number; onWhy?: () => void; onClose: () => void }) {
  const rating = useCoinRating({ mint: coin.address, symbol: coin.symbol });
  const worth = worthOf(coin, data), gain = (worthOf(coin, data) + coin.position.realizedSol - coin.position.paidSol), gainPct = coin.position.paidSol > 0 ? gain / coin.position.paidSol * 100 : 0;
  const drained = coin.position.entryLiquidityUsd === undefined ? 0 : pctFrom(coin.position.entryLiquidityUsd, coin.mark.liquidityUsd), markers = useTrailMarkers(coin.id), launchedAt = useCoinLaunchedAt(coin.address);
  return <CoinSheet title={coin.symbol} onClose={onClose} dock={<div className={s.decisionActions}>
    {onWhy && <Button size="sm" variant="secondary" onClick={onWhy}>Why it holds it<ChevronRight/></Button>}
    <RateButton rating={rating} symbol={coin.symbol} tip={false}/>
  </div>}>
    <CoinHead address={coin.address} symbol={coin.symbol} status={`held ${ago(coin.position.boughtAt, now || coin.position.boughtAt)} · ${price(coin.mark.priceUsd)}`}
      worth={{ value: sol(worth, 2), tone: gainPct, paid: coin.position.paidSol, move: gainPct }}/>
    <CoinChart address={coin.address} supply={coin.mark.priceUsd > 0 ? coin.mark.capUsd / coin.mark.priceUsd : null} entryPriceUsd={coin.position.entryPriceUsd} markPriceUsd={coin.mark.priceUsd} launchedAt={launchedAt} markers={markers ?? []} rating={rating.chart}/>
    <div className={s.folioTiles}>
      <span><small>24 h</small><b className={`${s.num} ${s[tone(coin.mark.change24hPct, 1) ?? 'muted']}`}>{pct(coin.mark.change24hPct)}</b></span>
      <span><small>Volume</small><b className={s.num}>{usd(coin.mark.volume24hUsd)}</b></span>
      <span><small>Liquidity</small><b className={`${s.num} ${Math.abs(drained) >= 5 ? s[tone(drained) ?? 'muted'] : ''}`}>{usd(coin.mark.liquidityUsd)}</b></span>
      <span><small>Market cap</small><b className={s.num}>{usd(coin.mark.capUsd)}</b></span>
    </div>
    {claims?.length ? <Claims claims={claims}/> : <><p className={s.folioThesis}>{coin.thesis.why}</p>{coin.thesis.wrong && <p className={s.folioWrong}><b>Wrong if</b>{coin.thesis.wrong}</p>}</>}
    <ul className={s.meters} aria-label="The plan">{wires(coin).map(wire => <Meter key={wire.key} wire={wire}/>)}</ul>
  </CoinSheet>;
}

type TrailRow = NonNullable<FunctionReturnType<typeof api.portfolios.coinTrail>>[number];
/** A coin's journal as pins on its chart: each buy and sale where it filled, and each look that held where it read the price. An ask
 *  nobody approved traded nothing, so it has no pin. */
function useTrailMarkers(coinId: string | undefined): ChartMarker[] | undefined {
  const rows = useQuery(api.portfolios.coinTrail, coinId ? { coinId, ...useAtomValue(viewAsAtom) } : 'skip');
  return useMemo(() => rows === undefined ? undefined : (rows ?? []).flatMap((row: TrailRow): ChartMarker[] => {
    if (row.status === 'pending' || row.status === 'skipped') return [];
    const base = { id: row.id, t: row.at, priceUsd: row.priceUsd, sub: row.line, itemId: null };
    if (row.action === 'add') return [{ ...base, kind: 'buy', role: row.kind === 'pick' ? 'research' : 'sniper', title: row.kind === 'pick' ? 'Bought' : 'Added', ...(row.sol != null ? { value: sol(row.sol, 2) } : {}) }];
    if (row.action === 'trim' || row.action === 'exit') return [{ ...base, kind: 'sell', role: 'trader', title: row.action === 'exit' ? 'Sold all' : 'Sold part', ...(row.pnlSol != null ? { value: signedSol(row.pnlSol, 2), tone: tone(row.pnlSol, 2) } : {}) }];
    return row.kind === 'wake' || row.kind === 'plan' ? [{ ...base, kind: 'pick', role: 'trader', title: 'Held' }] : [];
  }), [rows]);
}
const HOUR = 3_600_000;
/** Room on the chart before a coin's first decision and after its last; how many candles each side of the open decision it frames. */
const TRAIL_PAD = 2 * HOUR, FOCUS_CANDLES = 40;
/** A decision's chart: the coin's whole trail with room around it, up to now while it is held, in candles sized to that span, framed on
 *  the decision at `focus`. */
function trailRange(markers: ChartMarker[], focus: number, held: boolean, now: number): ChartRange {
  const times = [focus, ...markers.map(marker => marker.t)], from = Math.min(...times) - TRAIL_PAD;
  const to = held ? Math.ceil(now / MARKET_PERIODS['15m']) * MARKET_PERIODS['15m'] : Math.min(now, Math.max(...times) + TRAIL_PAD);
  const period = to - from <= 12 * HOUR ? '1m' : to - from <= 72 * HOUR ? '5m' : '15m', step = MARKET_PERIODS[period];
  return { from, to, period, view: { from: Math.max(from, focus - FOCUS_CANDLES * step), to: Math.min(to, focus + FOCUS_CANDLES * step) } };
}

/** What a journal entry is, the bot that did it, and the colour of its outcome. */
function entryTag(entry: Entry): { role: AgentRole; tone?: 'up' | 'down' | 'warn' | 'ember'; group: 'trade' | 'research' | 'check' | 'other' } {
  if (entry.status === 'pending') return { role: 'coordinator', tone: 'warn', group: 'trade' };
  switch (entry.kind) {
    case 'pick': return { role: 'research', tone: 'ember', group: 'trade' };
    case 'pass': return { role: 'research', group: 'research' };
    case 'floor': case 'stop': return { role: 'trader', tone: 'down', group: 'trade' };
    case 'wake': case 'plan': return entry.action === 'hold' || !entry.action ? { role: 'trader', group: 'check' } : { role: entry.action === 'add' ? 'sniper' : 'trader', tone: entry.action === 'add' ? 'ember' : resultTone(entry), group: 'trade' };
    default: return { role: 'coordinator', group: 'other' };
  }
}
/** The tone of a sale's result as its move row shows it: the return on the part sold when that part had a cost, else the profit in SOL. */
function resultTone(entry: Entry) {
  if (entry.pnlSol == null) return undefined;
  const cost = entry.sol != null ? entry.sol - entry.pnlSol : 0;
  return cost > 0 ? tone(entry.pnlSol / cost * 100, 1) : tone(entry.pnlSol, 2);
}
const FEED = [{ value: 'all', text: 'All' }, { value: 'trade', text: 'Trades' }, { value: 'research', text: 'Research' }, { value: 'check', text: 'Checks' }] as const;
type Feed = typeof FEED[number]['value'];

/** The sold coins a page of `portfolios.soldCoins` reads. */
const SOLD_PAGE = 20;
type SoldRow = { id: string; address: string; symbol: string; gainSol: number; exitedAt: number };
/** The coins it sold, newest first, a page at a time as the reader nears the end. A row opens the move that sold it when the page holds that
 *  move. `sample` stands in for the read on /dev/portfolio. */
type SoldProps = { data: ViewData; sample?: SoldRow[]; onOpen: (entry: Entry) => void };
function SoldCoins(props: SoldProps) {
  return props.sample ? <SoldCoinRows data={props.data} rows={props.sample} onOpen={props.onOpen} status="Exhausted"/> : <LiveSoldCoins {...props}/>;
}
function LiveSoldCoins({ data, onOpen }: SoldProps) {
  const pages = usePaginatedQuery(api.portfolios.soldCoins, { id: data.id, ...useAtomValue(viewAsAtom) }, { initialNumItems: SOLD_PAGE });
  if (pages.status === 'LoadingFirstPage') return <Loading rows={2}/>;
  return <SoldCoinRows data={data} rows={pages.results} onOpen={onOpen} status={pages.status} onMore={() => pages.loadMore(SOLD_PAGE)}/>;
}
function SoldCoinRows({ data, rows, onOpen, status, onMore = () => {} }: Omit<SoldProps, 'sample'> & { rows: SoldRow[]; status: PaginationStatus; onMore?: () => void }) {
  const now = useNow(30_000);
  if (!rows.length) return null;
  return <Paged status={status} onMore={onMore}>
    <ul className={`${s.surface} ${s.folioMoves} ${s.folioPanel}`} aria-label="Sold">{rows.map(row => { const entry = data.journal.find(item => item.coinId === row.id); return <li key={row.id}><button type="button" className={s.folioMoveRow} disabled={!entry} onClick={() => entry && onOpen(entry)}>{coinAvatar(row, 'size-9 rounded-full')}<span className={s.folioMoveText}>Sold {row.symbol}</span><span className={s.folioMoveEnd}><b className={`${s.num} ${s[tone(row.gainSol, 2) ?? 'muted']}`}>{signedSol(row.gainSol, 2)}</b><small>{ago(row.exitedAt, now)}</small></span></button></li>; })}</ul>
  </Paged>;
}

function Move({ entry, now, onOpen }: { entry: Entry; now: number; onOpen: () => void }) {
  const tag = entryTag(entry);
  // A sale shows the SOL it brought back and the gain on the part sold; a buy shows the SOL it put in.
  const cost = entry.sol != null && entry.pnlSol != null ? entry.sol - entry.pnlSol : 0;
  const money = entry.status === 'pending' ? <b className={s.warnText}>Asks you</b>
    : entry.pnlSol != null && entry.sol != null && cost > 0 ? <b className={s.num}>{sol(entry.sol, 2)} <span className={s[resultTone(entry) ?? 'muted']}>{pct(entry.pnlSol / cost * 100)}</span></b>
    : entry.pnlSol != null ? <b className={`${s.num} ${s[resultTone(entry) ?? 'muted']}`}>{signedSol(entry.pnlSol, 2)}</b>
    : entry.sol != null && (entry.action === 'add' || entry.kind === 'pick') ? <b className={s.num}>{sol(entry.sol, 2)}</b> : null;
  return <li><button type="button" className={s.folioMoveRow} data-tone={tag.tone} onClick={onOpen}>
    <span className={s.holdFace}>
      {entry.address && entry.symbol ? coinAvatar({ address: entry.address, symbol: entry.symbol }, 'size-9 rounded-full') : <BotAvatar role={tag.role} size={34}/>}
      {entry.address && entry.symbol && <span className={s.holdBot}><BotAvatar role={tag.role} size={16}/></span>}
    </span>
    <span className={s.folioMoveText}>{entry.line}</span>
    <span className={s.folioMoveEnd}>{money}<small>{ago(entry.at, now)}</small></span>
  </button></li>;
}

/** One journal entry in full: why it woke, what it read, what it decided and the plan it set, and for a coin its chart with every
 *  decision on it, this one lit. A pin opens its own entry when the page holds it. An open ask can be answered here. */
function EntryDialog({ entry, data, onOpen, onClose }: { entry: Entry; data: ViewData; onOpen: (entry: Entry) => void; onClose: () => void }) {
  const answer = useMutation(api.portfolios.answer), act = useAct(), now = useNow(30_000);
  const coin = data.coins.find(row => row.id === entry.coinId), mark = entry.read?.mark, markers = useTrailMarkers(entry.coinId), chartMark = coin?.mark ?? mark;
  // Fixed once the trail loads, so the window does not move while the dialog is open.
  const range = useMemo(() => markers && trailRange(markers, entry.at, coin?.status === 'held', Date.now()), [markers, entry.at, coin?.status]);
  // The coin as it stands now, for a coin still held: what all its buys cost, its worth and the move against that cost.
  const held = coin && coin.status === 'held' ? { paid: coin.position.paidSol, worth: worthOf(coin, data), gainPct: coin.position.paidSol > 0 ? (worthOf(coin, data) + coin.position.realizedSol - coin.position.paidSol) / coin.position.paidSol * 100 : 0 } : null;
  const reply = async (approve: boolean) => { const done = await act(() => answer({ entryId: entry.id, approve })); if (!done) return; if (done.answer === 'approved') toast.success('Approved: filled on paper'); else toast(done.why ?? 'Skipped'); onClose(); };
  const tiles: [string, ReactNode][] = mark ? [['Price', price(mark.priceUsd)], ['24 h', <span key="d" className={s[tone(mark.change24hPct, 1) ?? 'muted']}>{pct(mark.change24hPct)}</span>], ['Liquidity', usd(mark.liquidityUsd)], ['Market cap', usd(mark.capUsd)], ['Volume, 24 h', usd(mark.volume24hUsd)],
    ...(coin && entry.kind !== 'pick' ? [['From entry', <span key="e" className={s[tone(pctFrom(coin.position.entryPriceUsd, mark.priceUsd), 1) ?? 'muted']}>{pct(pctFrom(coin.position.entryPriceUsd, mark.priceUsd))}</span>] as [string, ReactNode]] : []),
    ...(entry.read?.pumpUsers != null ? [['pump.fun holders', entry.read.pumpUsers.toLocaleString('en-US')] as [string, ReactNode]] : []), ...(entry.read?.callouts != null ? [['Callouts', String(entry.read.callouts)] as [string, ReactNode]] : [])] : [];
  const steps = entry.plan ? planText(entry.plan) : [];
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={`${s.folioDialog} sm:max-w-[40rem]`}>
      <div className={s.folioDialogHead}>
        {entry.address && entry.symbol ? coinAvatar({ address: entry.address, symbol: entry.symbol }, 'size-12 rounded-full') : <BotAvatar role="coordinator" size={40}/>}
        <div className={s.folioDialogText}><DialogTitle className={s.folioDialogTitle}>{entry.line}</DialogTitle><DialogDescription>{data.name} · {new Date(entry.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · paper</DialogDescription></div>
      </div>
      {(entry.pnlSol != null || entry.sol != null) && <div className={s.folioFigures}>
        {entry.pnlSol != null && <div><small>Made</small><b className={`${s.num} ${s[tone(entry.pnlSol, 3) ?? 'muted']}`}>{signedSol(entry.pnlSol, 3)}</b></div>}
        {entry.sol != null && <div><small>{entry.action === 'add' ? 'This buy' : 'Sold for'}</small><b className={s.num}>{sol(entry.sol, 2)}</b></div>}
        {held && entry.action === 'add' && Math.abs(held.paid - (entry.sol ?? 0)) >= 0.005 && <div><small>Put in, all buys</small><b className={s.num}>{sol(held.paid, 2)}</b></div>}
        {held && <div><small>Worth now</small><b className={s.num}>{sol(held.worth, 2)} <span className={s[tone(held.gainPct, 1) ?? 'muted']}>{pct(held.gainPct)}</span></b></div>}
      </div>}
      {entry.address && (markers && range ? <CoinChart address={entry.address} supply={chartMark && chartMark.priceUsd > 0 ? chartMark.capUsd / chartMark.priceUsd : null} entryPriceUsd={coin?.position.entryPriceUsd} markPriceUsd={coin?.status === 'held' ? coin.mark.priceUsd : null} launchedAt={null}
        markers={markers} range={range} onOpenMarker={marker => { const next = data.journal.find(row => row.id === marker.id); if (next) onOpen(next); }}/> : <Loading rows={4}/>)}
      {entry.fired && entry.fired.length > 0 && <div className={s.folioStep}><BotAvatar role="coordinator" size={22}/><div><b>Why it woke</b><div className={s.folioChips}>{entry.fired.map(chip => <span key={chip} className={s.folioChip} data-fired>{chip}</span>)}</div></div></div>}
      {tiles.length > 0 && <div className={s.folioStep}><BotAvatar role="research" size={22}/><div><b>What it read</b><div className={s.folioTiles}>{tiles.map(([label, value]) => <span key={label}><small>{label}</small><b className={s.num}>{value}</b></span>)}</div></div></div>}
      {entry.why && <div className={s.folioStep}><BotAvatar role="trader" size={22}/><div><b>{entry.kind === 'pick' ? 'Why it picked it' : entry.kind === 'pass' ? 'Why it passed' : 'What it decided'}</b><p>{entry.why}</p>
        {entry.kind === 'pick' && coin?.thesis.wrong && <p className={s.folioWrong}><b>Wrong if</b> {coin.thesis.wrong}</p>}
        {entry.kind === 'pick' && coin?.thesis.add && <p className={s.folioWrong}><b>Adds when</b> {coin.thesis.add}</p>}
        {entry.planned && <p className={s.folioWrong}><b>Wants to</b> {entry.planned.action === 'add' ? `add ${sol(entry.planned.sol, 2)}` : entry.planned.action === 'exit' ? 'sell all of it' : `sell ${coin && coin.position.qty > 0 ? Math.round(entry.planned.qty / coin.position.qty * 100) : '?'}%`}{entry.planned.note ? `, ${entry.planned.note}` : ''}</p>}
        {steps.length > 0 && <div className={s.folioChips}>{steps.map(chip => <span key={chip} className={s.folioChip}>{chip}</span>)}</div>}</div></div>}
      <div className={s.folioDialogFoot}>
        <small className={s.muted}><ShieldCheck aria-hidden/>The floor stays on: sells at −{FLOOR.dropPct}% or a drained pool, and the limits bound every trade.</small>
        {entry.status === 'pending' && (entry.expiresAt ?? 0) > now ? <span className={s.headActions}><Button variant="secondary" size="sm" onClick={() => void reply(false)}><X/>Skip</Button><Button size="sm" onClick={() => void reply(true)}><Check/>Approve</Button></span> : <Button size="sm" variant="secondary" onClick={onClose}>Done</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}

const SOURCE = { x: 'X', pump: 'pump.fun' } as const;
const count = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(value);
/** What people say about the held coins, newest first: X posts and pump.fun callouts that coin intel read. Strangers' words,
 *  shown as plain text. It reads only while its tab is open. */
function Buzz({ coins, now }: { coins: CoinRow[]; now: number }) {
  const items = useQuery(api.teamIntel.chatter, { addresses: coins.map(coin => coin.address), ...useAtomValue(viewAsAtom) });
  if (items === undefined) return <Loading rows={4}/>;
  if (!items.length) return <div className={s.folioEmpty}><BotAvatar role="research" size={56}/><b>No posts yet</b></div>;
  const byAddress = new Map(coins.map(coin => [coin.address, coin]));
  return <ul className={s.folioBuzz}>{items.map(item => { const coin = byAddress.get(item.address); return <li key={`${item.source}${item.id}`} className={`${s.surface} ${s.folioPost}`}>
    <div className={s.folioPostHead}>
      {coin && coinAvatar(coin, 'size-8 rounded-full')}
      <span className={s.grow}><b>{item.author || item.handle}{item.verified && <BadgeCheck aria-label="Verified"/>}</b><small>{item.handle ? `@${item.handle} · ` : ''}{SOURCE[item.source]} · {ago(item.at, now || item.at)}</small></span>
      {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className={s.folioPostLink} aria-label="Open on X"><ChevronRight/></a>}
    </div>
    <p className={s.folioPostText}>{item.text}</p>
    <div className={s.folioPostStats}><span><Heart/>{count(item.likes)}</span><span><Repeat2/>{count(item.reposts)}</span><span><MessageCircle/>{count(item.replies)}</span>{item.views > 0 && <span><Eye/>{count(item.views)}</span>}</div>
  </li>; })}</ul>;
}

/** The limits and how much HOTBOT does alone, changed after the start and bounded again on the server; archiving sits here too. */
function SettingsDialog({ data, onClose, onArchive }: { data: PageData; onClose: () => void; onArchive: () => void }) {
  const setLimits = useMutation(api.portfolios.setLimits), act = useAct();
  const [autonomy, setAutonomy] = useState(data.mandate.autonomy), [perCoin, setPerCoin] = useState(data.mandate.perCoinSol), [trades, setTrades] = useState(data.mandate.tradesPerDay), [stop, setStop] = useState(data.mandate.stopAllSol);
  const save = async () => { if (await act(() => setLimits({ id: data.id, autonomy, perCoinSol: perCoin, tradesPerDay: trades, stopAllSol: stop })) !== undefined) { toast.success('Saved'); onClose(); } };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={`${s.folioDialog} sm:max-w-[30rem]`}>
      <DialogTitle className={s.folioDialogTitle}>Settings</DialogTitle>
      <DialogDescription className="sr-only">How much HOTBOT does alone and the limits on its trades.</DialogDescription>
      <AutonomyPicks value={autonomy} onPick={setAutonomy}/>
      <div className={s.folioLimits}>
        <label><SettingName name={LIMIT_TEXT.perCoinSol.label} note={LIMIT_TEXT.perCoinSol.note}/><Num kind="sol" label={LIMIT_TEXT.perCoinSol.label} value={perCoin} onChange={setPerCoin} min={0.05} max={data.startSol}/></label>
        <label><SettingName name={LIMIT_TEXT.tradesPerDay.label} note={LIMIT_TEXT.tradesPerDay.note}/><Num kind="count" label={LIMIT_TEXT.tradesPerDay.label} value={trades} onChange={setTrades} min={1} max={MANDATE.tradesPerDay.max} integer/></label>
        <label><SettingName name={LIMIT_TEXT.stopAllSol.label} note={LIMIT_TEXT.stopAllSol.note}/><Num kind="sol" label={LIMIT_TEXT.stopAllSol.label} value={stop} onChange={setStop} min={0} max={data.startSol * 0.95}/></label>
      </div>
      <div className={s.folioDialogFoot}><Button variant="ghost" size="sm" onClick={onArchive}><Archive/>Archive</Button><span className={s.headActions}><Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={() => void save()}>Save</Button></span></div>
    </DialogContent>
  </Dialog>;
}

/** One portfolio: a banner with its coins as stickers, the score (worth, the lead over buy-and-hold, room above the stop floor, trades left),
 *  then tabs: the run (value line with HOTBOT's trades, the split, the latest moves), the coins as cards, every move with its why, what
 *  people say, and the chat with HOTBOT. */
export function PortfolioPage({ id }: { id: string }) {
  const data = useQuery(api.portfolios.page, { id, ...useAtomValue(viewAsAtom) });
  if (data === undefined) return <div className={s.page}><Loading variant="page"/></div>;
  if (data === null) return <div className={s.page}><Link href={appHref('portfolios')} className={s.back}><ArrowLeft size={14}/>Portfolios</Link><p className={s.empty}>This portfolio isn’t there any more.</p></div>;
  return <PortfolioView data={data}/>;
}

/** `chat` stands in for the chat's thread on /dev/portfolio. */
type ViewProps = { data: ViewData; chat?: ChatMessage[]; chatContent?: ReactNode; readOnlyPreview?: boolean; initialTab?: string; onReviewSettingsReady?: (open: () => void) => void };
/** Reuse the shipped portfolio UI with explicit read-only MCP data, without starting Convex account services. */
export function PortfolioView(props: ViewProps) {
  return props.readOnlyPreview ? <PortfolioBody {...props}/> : <LivePortfolioView {...props} data={props.data as PageData}/>;
}
function LivePortfolioView(props: ViewProps & { data: PageData }) {
  const setStatus = useMutation(api.portfolios.setStatus), act = useAct();
  const findings = useQuery(api.portfolios.findings, { id: props.data.id, ...useAtomValue(viewAsAtom) });
  return <PortfolioBody {...props} findings={findings} onStatus={status => act(() => setStatus({ id: props.data.id, status }))} chatContent={props.chatContent ?? <PortfolioChat data={props.data} sample={props.chat}/>}/>;
}
function PortfolioBody({ data, chat, chatContent, readOnlyPreview = false, initialTab = 'run', onReviewSettingsReady, findings, onStatus }: ViewProps & { findings?: Findings | null; onStatus?: (status: 'paused' | 'running' | 'archived') => Promise<unknown> }) {
  const now = useNow(30_000), router = useRouter();
  const [tab, setTab] = useState(initialTab), [show, setShow] = useState<Feed>('all');
  const [open, setOpen] = useState<Entry | null>(null), [coinOpen, setCoinOpen] = useState<string | null>(null), [settings, setSettings] = useState(false), [archiving, setArchiving] = useState(false);
  // The team's claims and lessons: read only while the run tab or a coin's dialog shows them.
  useEffect(() => { onReviewSettingsReady?.(() => setSettings(true)); }, [onReviewSettingsReady]);
  const trades = useMemo(() => data.journal.filter(entry => entry.status !== 'pending' && entry.status !== 'skipped' && entryTag(entry).group === 'trade').map(entry => ({ id: entry.id, at: entry.at, tone: entryTag(entry).tone, line: entry.line, sol: entry.sol, pnlSol: entry.pnlSol })), [data.journal]);
  const held = data.coins.filter(coin => coin.status === 'held'), sold = data.coins.filter(coin => coin.status === 'exited');
  // The banner shows the coins held now, else the newest it sold, greyed.
  const faces = held.length ? held : [...sold].sort((a, b) => (b.exitedAt ?? 0) - (a.exitedAt ?? 0)).slice(0, COVER_COINS), past = !held.length && faces.length > 0;
  const { value: worth, hold } = data.book, pnl = worth - data.startSol, vsHold = hold === undefined ? 0 : worth - hold, started = held.length + sold.length > 0;
  const stop = data.mandate.stopAllSol, room = data.startSol > stop ? Math.max(0, Math.min(1, (worth - stop) / (data.startSol - stop))) : 1;
  const asks = data.journal.filter(entry => entry.status === 'pending' && (entry.expiresAt ?? 0) > now), live = data.status === 'running' || data.status === 'picking';
  const cover = faces.find(coin => coin.header)?.header, day = Math.max(1, Math.ceil(((now || data.createdAt) - data.createdAt) / 86_400_000));
  const counts = useMemo(() => {
    const by: Record<Feed, number> = { all: data.journal.length, trade: 0, research: 0, check: 0 };
    for (const entry of data.journal) { const { group } = entryTag(entry); if (group !== 'other') by[group] += 1; }
    return by;
  }, [data.journal]);
  // The page holds the newest `JOURNAL_PAGE` moves; when it is full there are likely older ones, so each count is a floor, every filter
  // stays, and a picked filter keeps its place. Otherwise a filter that lost its last move falls back to all.
  const more = data.journal.length >= JOURNAL_PAGE, feed = more || counts[show] ? show : 'all', total = more ? `${JOURNAL_PAGE}+` : String(data.journal.length);
  const moves = data.journal.filter(entry => feed === 'all' || entryTag(entry).group === feed), coin = held.find(row => row.id === coinOpen);
  const archive = async () => { if (await onStatus?.('archived') !== undefined) router.push(appHref('portfolios')); };
  return <div className={`${s.page} ${s.folioPage}`}>
    <Link href={readOnlyPreview ? "/muse-preview" : appHref('portfolios')} className={s.back}><ArrowLeft size={14}/>Portfolios</Link>
    <header className={`${s.surface} ${s.folioBanner}`}>
      <Cover src={cover} coin={faces[0]} past={past}/>
      <div className={s.folioBannerBody}>
        <Stickers coins={faces} past={past} scanning={data.status === 'picking'}/>
        <span className={s.folioKicker}><StatusPill status={data.status}/>{past && <InSol nextPickAt={data.nextPickAt} now={now}/>}<span className={s.pill}>Paper</span><span className={s.folioTeam}><BotAvatar role="coordinator" size={22}/><BotAvatar role="research" size={22}/><BotAvatar role="sniper" size={22}/><BotAvatar role="trader" size={22}/><small>Day {day}</small></span></span>
        <h1 className={s.folioBannerTitle}>{data.name}</h1>
        <p className={s.folioBannerSub}>{data.mandate.summary}</p>
      </div>
      <div className={s.folioBannerActions}>
        {live ? <button type="button" className={s.toggleButton} disabled={readOnlyPreview} title={readOnlyPreview ? 'Read-only local preview' : undefined} onClick={() => void onStatus?.('paused')}><Pause/>Pause</button>
          : data.status === 'paused' ? <button type="button" className={s.toggleButton} data-go disabled={readOnlyPreview} onClick={() => void onStatus?.('running')}><Play/>Run</button> : null}
        <button type="button" className={s.headRound} aria-label="Settings" title="Settings" onClick={() => setSettings(true)}><SlidersHorizontal/></button>
      </div>
    </header>
    {asks.length > 0 && <section className={s.folioNeeds} aria-label="Needs you">{asks.map(entry => <button key={entry.id} type="button" className={s.folioNeed} onClick={() => setOpen(entry)}>
      {entry.address && entry.symbol ? coinAvatar({ address: entry.address, symbol: entry.symbol }, 'size-9 rounded-full') : <BotAvatar role="coordinator" size={34}/>}
      <b>{entry.line}</b><small>skips in {until(entry.expiresAt ?? now, now)}</small><span>Review<ChevronRight aria-hidden/></span>
    </button>)}</section>}
    <section className={`${s.surface} ${s.folioHud}`} aria-label="Score">
      <div className={s.folioStat}><small>Worth</small><b className={s.num}>{worth.toFixed(2)}<i>SOL</i></b><Delta pnl={pnl} startSol={data.startSol}/></div>
      {hold !== undefined ? <div className={s.folioStat}><small>vs holding</small><b className={`${s.num} ${s[tone(vsHold, 2) ?? 'muted']}`}>{started ? signedSol(vsHold, 2).replace(' SOL', '') : '—'}<i>SOL</i></b><Tug vsHold={started ? vsHold : 0} startSol={data.startSol}/></div> : <div className={s.folioStat}><small>Cash</small><b className={s.num}>{data.cashSol.toFixed(2)}<i>SOL</i></b><span className={s.folioDelta}>Paper balance</span></div>}
      <div className={s.folioStat}><small>Above the floor</small><b className={s.num}>{Math.max(0, worth - stop).toFixed(2)}<i>SOL</i></b>
        <RoomMeter room={room} label={`Room above the ${sol(stop, 2)} stop floor`}/></div>
      <div className={s.folioStat}><small>Trades today</small><b className={s.num}>{data.tradesToday}<i>of {data.mandate.tradesPerDay}</i></b>
        <span className={s.folioPips} aria-hidden>{Array.from({ length: data.mandate.tradesPerDay }, (_, index) => <i key={index} data-on={index < data.tradesToday || undefined}/>)}</span></div>
    </section>
    <Tabs value={tab} onValueChange={setTab} className={s.folioTabs}>
      <TabsList variant="line" aria-label="Portfolio">
        <TabsTrigger value="run">The run</TabsTrigger>
        <TabsTrigger value="coins">Coins<TabsCount>{held.length || ''}</TabsCount></TabsTrigger>
        <TabsTrigger value="moves">Moves<TabsCount>{data.journal.length ? total : ''}</TabsCount></TabsTrigger>
        {held.length > 0 && !readOnlyPreview && <TabsTrigger value="buzz">Buzz</TabsTrigger>}
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>
      <TabsContent value="run" className={s.folioTab}>
        <section className={`${s.surface} ${s.folioPanel}`} aria-label="The run so far">
          <ValueLine points={data.points} start={data.startSol} trades={trades}/>
          <div className={s.folioLegend}><span><i data-line="value"/>This portfolio</span>{hold !== undefined && <span><i data-line="hold"/>Just holding</span>}{trades.length > 0 && <span><i data-line="dot"/>Trades</span>}</div>
          {worth > 0 && <div className={s.folioAlloc} role="group" aria-label="What it holds, by share of its worth">
            {held.map(row => { const part = worthOf(row, data) / worth * 100; return <button key={row.id} type="button" style={{ flexGrow: part }} onClick={() => setCoinOpen(row.id)} title={`${row.symbol} ${Math.round(part)}%`}><CoinArt coin={{ ...row, header: null }}/><b>{row.symbol}</b><small>{Math.round(part)}%</small></button>; })}
            <span data-free style={{ flexGrow: data.cashSol / worth * 100 }} title={sol(data.cashSol, 2)}><b>SOL</b><small>{Math.round(data.cashSol / worth * 100)}%</small></span>
          </div>}
        </section>
        {data.journal.length > 0 && <section className={`${s.surface} ${s.folioPanel}`} aria-label="Latest moves">
          <ul className={s.folioMoves}>{data.journal.slice(0, 4).map(entry => <Move key={entry.id} entry={entry} now={now} onOpen={() => setOpen(entry)}/>)}</ul>
          {data.journal.length > 4 && <Button variant="secondary" size="sm" className="self-start" onClick={() => setTab('moves')}>All moves<ChevronRight/></Button>}
        </section>}
        {findings && findings.lessons.length > 0 && <section className={`${s.surface} ${s.folioPanel}`} aria-label="What HOTBOT learned">
          <div className={s.sectionHead}><h2>Learned<small>{findings.lessons.length}</small></h2></div>
          <ul className={s.folioLessons}>{findings.lessons.map(lesson => <li key={lesson.id}>
            <BotAvatar role="coordinator" size={26}/>
            <span>{lesson.symbol && <b>{lesson.symbol}</b>}{lesson.text}</span>
            {lesson.changePct !== undefined && <span className={s.folioDelta} title="The price after the action">{pct(lesson.changePct)}</span>}
          </li>)}</ul>
        </section>}
      </TabsContent>
      <TabsContent value="coins" className={s.folioTab}>
        {held.length ? <ul className={s.folioCoins}>{held.map(row => <CoinCard key={row.id} coin={row} data={data} onOpen={() => setCoinOpen(row.id)}/>)}</ul>
          : <div className={s.folioEmpty}><BotAvatar role="research" size={56} mood={data.status === 'picking' ? 'scan' : undefined}/><b>{data.status === 'picking' ? 'Picking coins…' : data.status === 'stopped' ? 'Sold everything at the floor' : 'No coins right now'}</b></div>}
        {sold.length > 0 && <SoldCoins data={data} onOpen={setOpen} sample={(chat || readOnlyPreview) ? sold.map(row => ({ id: row.id, address: row.address, symbol: row.symbol, gainSol: row.position.realizedSol - row.position.paidSol, exitedAt: row.exitedAt ?? row.pickedAt })) : undefined}/>}
      </TabsContent>
      {held.length > 0 && <TabsContent value="buzz" className={s.folioTab}>{tab === 'buzz' && <Buzz coins={held} now={now}/>}</TabsContent>}
      <TabsContent value="chat" className={s.folioTab}>{tab === 'chat' && chatContent}</TabsContent>
      <TabsContent value="moves" className={s.folioTab}>
        <section className={`${s.surface} ${s.folioPanel}`} aria-label="Every move">
          {(more || FEED.some(option => option.value !== 'all' && counts[option.value])) && <span className={`${s.seg} ${s.folioFeed}`} role="group" aria-label="Show">
            {FEED.filter(option => more || counts[option.value]).map(option => <button type="button" key={option.value} aria-pressed={feed === option.value} onClick={() => setShow(option.value)}>{option.text} <small>{counts[option.value] ? `${counts[option.value]}${more ? '+' : ''}` : ''}</small></button>)}
          </span>}
          {moves.length ? <ul className={s.folioMoves}>{moves.map(entry => <Move key={entry.id} entry={entry} now={now} onOpen={() => setOpen(entry)}/>)}</ul> : <p className={s.empty}>{more ? `None in the latest ${JOURNAL_PAGE}.` : 'Nothing here yet.'}</p>}
        </section>
      </TabsContent>
    </Tabs>
    {coin && !readOnlyPreview && <CoinDialog coin={coin} data={data} claims={findings?.coins.find(row => row.address === coin.address)?.claims} now={now} onClose={() => setCoinOpen(null)} onWhy={(() => { const entry = data.journal.find(row => row.coinId === coin.id && row.kind === 'pick') ?? data.journal.find(row => row.coinId === coin.id); return entry ? () => { setCoinOpen(null); setOpen(entry); } : undefined; })()}/>}
    {open && !readOnlyPreview && <EntryDialog entry={data.journal.find(entry => entry.id === open.id) ?? open} data={data} onOpen={setOpen} onClose={() => setOpen(null)}/>}
    {settings && !readOnlyPreview && <SettingsDialog data={data as PageData} onClose={() => setSettings(false)} onArchive={() => { setSettings(false); setArchiving(true); }}/>}
    {readOnlyPreview && coin && <ReadOnlyCoinDialog coin={coin} data={data} onClose={() => setCoinOpen(null)}/>}
    {readOnlyPreview && open && <ReadOnlyEntryDialog entry={open} data={data} onClose={() => setOpen(null)}/>}
    {readOnlyPreview && settings && <ReadOnlySettings data={data} onClose={() => setSettings(false)}/>}
    <Dialog open={archiving} onOpenChange={setArchiving}>
      <DialogContent className="sm:max-w-[26rem]">
        <DialogTitle>Archive {data.name}?</DialogTitle>
        <DialogDescription>It stops watching its coins and leaves your list. No SOL moves.</DialogDescription>
        <div className={s.folioDialogFoot}><span/><span className={s.headActions}><Button variant="secondary" size="sm" onClick={() => setArchiving(false)}>Keep it</Button><Button size="sm" variant="destructive" onClick={() => void archive()}><Archive/>Archive</Button></span></div>
      </DialogContent>
    </Dialog>
  </div>;
}

/** The native settings layout, showing the actual snapshot without an account mutation. */
function ReadOnlySettings({ data, onClose }: { data: ViewData; onClose: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className={`${s.folioDialog} sm:max-w-[30rem]`}>
    <DialogTitle className={s.folioDialogTitle}>Settings</DialogTitle><DialogDescription>Current paper portfolio settings. Muse’s proposal has not been applied.</DialogDescription>
    <div className={s.folioLeash}><b>{LIMIT_TEXT.autonomy.label}</b><span>{AUTONOMY_TEXT[data.mandate.autonomy].label}</span></div>
    <div className={s.folioTiles}>{loadout(data.mandate).map(([label, value, note]) => <span key={label}><small><SettingName name={label} note={note}/></small><b>{value}</b></span>)}</div>
    <div className={s.folioDialogFoot}><small className={s.muted}>Read-only local build · no settings changed</small><Button size="sm" variant="secondary" onClick={onClose}>Done</Button></div>
  </DialogContent></Dialog>;
}
function ReadOnlyEntryDialog({ entry, data, onClose }: { entry: Entry; data: ViewData; onClose: () => void }) {
  const mark = entry.read?.mark;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className={`${s.folioDialog} sm:max-w-[40rem]`}>
    <div className={s.folioDialogHead}><BotAvatar role={entryTag(entry).role} size={40}/><div className={s.folioDialogText}><DialogTitle className={s.folioDialogTitle}>{entry.line}</DialogTitle><DialogDescription>{data.name} · {new Date(entry.at).toLocaleString()} · paper</DialogDescription></div></div>
    {entry.sol !== undefined && <div className={s.folioFigures}><div><small>{entry.kind === 'pick' || entry.action === 'add' ? 'This buy' : 'SOL'}</small><b className={s.num}>{sol(entry.sol, 2)}</b></div></div>}
    {mark && <div className={s.folioTiles}>{[['Price', price(mark.priceUsd)], ['24 h', pct(mark.change24hPct)], ['Liquidity', usd(mark.liquidityUsd)], ['Market cap', usd(mark.capUsd)], ['Volume, 24 h', usd(mark.volume24hUsd)]].map(([label, value]) => <span key={label}><small>{label}</small><b className={s.num}>{value}</b></span>)}</div>}
    {entry.why && <div className={s.folioStep}><BotAvatar role="research" size={22}/><div><b>{entry.kind === 'pick' ? 'Why it picked it' : entry.kind === 'pass' ? 'Why it passed' : 'What it decided'}</b><p>{entry.why}</p></div></div>}
    <div className={s.folioDialogFoot}><small className={s.muted}>Real MCP journal record · read only</small><Button size="sm" variant="secondary" onClick={onClose}>Done</Button></div>
  </DialogContent></Dialog>;
}
function ReadOnlyCoinDialog({ coin, data, onClose }: { coin: CoinRow; data: ViewData; onClose: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className={`${s.folioDialog} sm:max-w-[40rem]`}>
    <div className={s.folioDialogHead}>{coinAvatar(coin, 'size-12 rounded-full')}<div className={s.folioDialogText}><DialogTitle>{coin.symbol}</DialogTitle><DialogDescription>{coin.name} · paper holding</DialogDescription></div></div>
    <div className={s.folioTiles}>{[['Worth', sol(worthOf(coin, data), 2)], ['24 h', pct(coin.mark.change24hPct)], ['Liquidity', usd(coin.mark.liquidityUsd)], ['Market cap', usd(coin.mark.capUsd)]].map(([label,value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>
    <p className={s.folioThesis}>{coin.thesis.why}</p>{coin.thesis.wrong && <p className={s.folioWrong}><b>Wrong if</b>{coin.thesis.wrong}</p>}
    {'planSummary' in coin && coin.planSummary?.length ? <div className={s.folioChips}>{coin.planSummary.map(step => <span key={step} className={s.folioChip}>{step}</span>)}</div> : null}
    <div className={s.folioDialogFoot}><small className={s.muted}>Real MCP holding · read only</small><Button size="sm" variant="secondary" onClick={onClose}>Done</Button></div>
  </DialogContent></Dialog>;
}
