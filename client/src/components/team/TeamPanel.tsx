"use client";
import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ChevronRight, PanelRightClose, PanelRightOpen, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sidebar, SidebarContent } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BotAvatar } from '@/components/hotbot/BotAvatar';
import { TokenAvatar } from '@/components/token/TokenAvatar';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/utils/formatterUtils';
import { change, type Bag, type HomeData, type StrategyRow } from './data';
import { ago, appHref, pct, signedSol, sol, tone } from './format';
import { DecisionDialog, NeedsYou, useNow } from './Parts';
import { SignedPercentText } from './SignedPercentText';
import { Paged, useDecisions } from './Stream';
import { teamCollapsedAtom, useCommand } from './state';
import { newFills } from './TradeToast';
import { isCatchUp } from './useHome';
import { usePriceDisplay } from '@/hooks/usePriceDisplay';
import s from './team.module.css';
import { Link } from '@/lib/appNavigation';

export type Role = 'research' | 'sniper' | 'trader';
export const BOTS: Record<Role, { name: string; job: string }> = {
  research: { name: 'ResearchBot', job: 'Finds coins and checks them against your rules' },
  sniper: { name: 'SniperBot', job: 'Sizes the buy and picks the entry' },
  trader: { name: 'TraderBot', job: 'Holds, reviews every minute, decides the exit' },
};

/** What each bot is doing right now, from real state: across the whole team, or for the one strategy on screen. */
function lanes(data: HomeData, strategyId?: string) {
  const mine = <T extends { strategyId: string }>(rows: T[]) => strategyId ? rows.filter(row => row.strategyId === strategyId) : rows;
  const strategies = strategyId ? data.strategies.filter(row => row.id === strategyId) : data.strategies;
  const running = strategies.some(row => row.status === 'running') && !data.workspace.halted && data.worker.online;
  const total = (key: 'found' | 'passed' | 'bought') => strategies.reduce((sum, row) => sum + row.funnel[key], 0);
  // The team's open profit counts coins archived strategies still sell; one strategy's is its own.
  const openPnl = strategyId ? strategies.reduce((sum, row) => sum + row.openPnlSol, 0) : data.money.openPnl;
  return { running, researching: mine(data.researching), needs: mine(data.needs), watching: mine(data.watching), bags: mine(data.bags),
    // The best coins of the strategies' live rankings, best first: what SniperBot takes when a place opens.
    next: strategies.flatMap(row => row.pulse?.next ?? []).sort((a, b) => b.score - a.score), openPnl, found: total('found'), passed: total('passed'), bought: total('bought'),
    // The bad coins kept out over the last day are counted for the whole team, each coin once, so one strategy's roster leaves them out.
    kept: strategyId ? null : data.team.keptOut };
}

/** Show the held coin's review reason only when a sell or status is recorded. */
const heldLine = (bag: Bag) => bag.lastReview && (bag.lastReview.sell || bag.lastReview.status) ? bag.lastReview.reason.split(/[:;]/)[0] : '';

export function botRows(data: HomeData, now: number, strategyId?: string) {
  const lane = lanes(data, strategyId), openPnl = lane.openPnl;
  // When each bot last acted is kept for the whole team, so one strategy's roster neither glows nor dates for another strategy's work.
  const acted = (role: Role) => strategyId ? null : data.team.acted[role];
  const recent = (role: Role) => { const at = acted(role); return at != null && now > 0 && now - at < 90_000; };
  const more = (n: number) => n > 1 ? <span className={s.muted}> +{n - 1}</span> : null;
  const when = (role: Role) => { const at = acted(role); return at != null && now > 0 ? <time> · {ago(at, now)}</time> : null; };
  // A bot with nothing in hand sleeps, even right after it acted (its hop shows the act); ResearchBot and SniperBot stay awake while a strategy
  // runs, because a pick and its entry come at any moment. `badge` is the count beside a face in the rail: the buys waiting on you, or the
  // coins held. ResearchBot's total is the team's coins checked over the last day (`day`), every coin its screens judged; one strategy's is the
  // coins its screen sent to research since its start.
  const checked = lane.kept?.checked;
  const rows: { role: Role; state: string; asleep: boolean; text: ReactNode; badge: number; total: number; unit: string; day?: boolean }[] = [
    { role: 'research', total: checked ?? lane.found, unit: checked != null ? 'checked' : 'researched', day: checked != null, asleep: !lane.researching.length && !lane.running, state: recent('research') ? 'acted' : lane.researching.length || lane.running ? 'busy' : 'idle',
      text: lane.researching[0] ? <>Checking <b>{lane.researching[0].token.symbol}</b>{more(lane.researching.length)}</> : lane.running ? <>Scanning for new coins{when('research')}</> : data.worker.online ? 'Paused' : 'Reconnecting', badge: 0 },
    { role: 'sniper', total: lane.passed, unit: 'picked', asleep: !lane.needs.length && !lane.watching.length && !lane.next.length && !lane.running, state: lane.needs.length ? 'needs' : recent('sniper') ? 'acted' : lane.watching.length || lane.next.length || lane.running ? 'busy' : 'idle',
      text: lane.needs[0] ? <span className={s.warnText}>Wants your OK on <b>{lane.needs[0].token.symbol}</b></span> : lane.watching[0] ? <>Waiting to buy <b>{lane.watching[0].token.symbol}</b>{more(lane.watching.length)}</> : lane.next[0] ? <>Next up <b>{lane.next[0].token.symbol}</b></>
        : lane.running ? <>Waiting for a pick{when('sniper')}</> : data.worker.online ? 'Paused' : 'Reconnecting', badge: lane.needs.length },
    { role: 'trader', total: lane.bought, unit: 'bought', asleep: !lane.bags.length, state: recent('trader') ? 'acted' : lane.bags.length ? 'busy' : 'idle',
      text: lane.bags.length ? <>Holding {lane.bags.length} {lane.bags.length === 1 ? 'coin' : 'coins'} <span className={s[tone(openPnl) ?? 'muted']}>{signedSol(openPnl)}</span></> : 'Nothing held yet', badge: lane.bags.length },
  ];
  return rows;
}

type Chip = { key: string; tokens: { address: string; symbol: string }[]; label: ReactNode; warn?: boolean };
/** The coins each bot is on, as onboarding's Stage shows them: ResearchBot's checks, SniperBot's ask, waits and Next up (one chip for it),
 *  and TraderBot's two biggest movers, each coin once though two strategies hold it (the holdings themselves live on Home and the strategy pages). */
function laneChips(data: HomeData, strategyId?: string): Record<Role, Chip[]> {
  const lane = lanes(data, strategyId);
  const next = lane.next.length ? [{ key: 'next', tokens: lane.next.slice(0, 3).map(coin => coin.token), label: 'Next up' }] : [];
  const movers = lane.bags.filter(bag => bag.stage === 'held').sort((a, b) => Math.abs(change(b) ?? 0) - Math.abs(change(a) ?? 0))
    .filter((bag, n, held) => held.findIndex(row => row.token.address === bag.token.address) === n).slice(0, 2);
  return {
    research: lane.researching.slice(0, 2).map(item => ({ key: item.id, tokens: [item.token], label: 'Checking' })),
    sniper: [...lane.needs.slice(0, 1).map(item => ({ key: item.id, tokens: [item.token], label: 'Wants your OK', warn: true })), ...lane.watching.slice(0, 1).map(item => ({ key: item.id, tokens: [item.token], label: 'Buying' })), ...next],
    trader: movers.map(bag => ({ key: bag.id, tokens: [bag.token], label: <span className={s[tone(change(bag)) ?? 'muted']}>{pct(change(bag))}</span> })),
  };
}

/** A float over a face: SniperBot's entry (the coin), or TraderBot's buy (the SOL it spent) or sale (its profit), as the fill's event recorded it. */
type Float = { id: string; n: number; token: { address?: string; symbol: string } } & ({ role: 'sniper' } | { role: 'trader'; buy: boolean; sol: number | null });
/** `seen`: the coins already in SniperBot's watch or TraderBot's hands while the panel watched, kept while they are on the board. */
type Motion = { data: HomeData; laps: Record<Role, number>; big: boolean; floats: Float[]; seen: ReadonlySet<string> };

/** Each bot's one-shot hop when it acts (a lap count of the team's acts; on a strategy's page only for that strategy's entry or fill, since
 *  the act times can't tell whose they were), SniperBot's floating entries and TraderBot's floating buys and sales, derived while rendering
 *  from the board before. A float leaves when its animation ends. */
function useMotion(data: HomeData, strategyId?: string) {
  const [motion, setMotion] = useState<Motion>(() => ({ data, laps: { research: 0, sniper: 0, trader: 0 }, big: false, floats: [], seen: new Set([...data.watching, ...data.bags].map(row => row.id)) }));
  if (motion.data !== data) {
    const prev = motion.data, at = data.team.acted, held = [...data.watching, ...data.bags], onBoard = new Set<string>([...held, ...data.needs].map(row => row.id));
    // An entry is a coin's first time in SniperBot's watch or, bought at market in one update, in TraderBot's hands; a pick that waited in an ask
    // or the queue enters when it leaves it. So each coin floats once.
    const seen = new Set([...motion.seen, ...held.map(row => row.id)].filter(id => onBoard.has(id)));
    // A catch-up board holds what changed while the page was not listening, so nothing in it floats or hops.
    if (isCatchUp(data)) setMotion({ ...motion, data, seen });
    else {
      // The newest three of each bot, so no float waits long for its turn (`--n` delays each by 0.9 s).
      const entered = held.filter(row => !motion.seen.has(row.id) && (!strategyId || row.strategyId === strategyId)).slice(-3);
      const fills = newFills(prev, data).filter(fill => !strategyId || fill.strategyId === strategyId).slice(-3);
      const fresh: Float[] = [...entered.map((item, n) => ({ id: item.id + ':entry', n, role: 'sniper' as const, token: item.token })),
        ...fills.map((fill, n) => ({ id: fill.id, n, role: 'trader' as const, buy: fill.kind === 'bought', sol: fill.kind === 'bought' ? fill.amountSol : fill.pnlSol, token: { address: fill.address ?? undefined, symbol: fill.symbol } }))];
      const acted = (role: Role) => prev.workspace.mode === data.workspace.mode && at[role] != null && at[role] !== prev.team.acted[role] && (!strategyId || (role === 'sniper' ? entered.length > 0 : role === 'trader' && fills.length > 0));
      const lap = (role: Role) => motion.laps[role] + (acted(role) ? 1 : 0);
      setMotion({ data, seen, laps: { research: lap('research'), sniper: lap('sniper'), trader: lap('trader') }, big: acted('trader') ? fills.length > 0 : motion.big,
        floats: (['sniper', 'trader'] as const).flatMap(role => [...motion.floats, ...fresh].filter(float => float.role === role).slice(-3)) });
    }
  }
  return { ...motion, done: (id: string) => setMotion(current => ({ ...current, floats: current.floats.filter(float => float.id !== id) })) };
}

type Bot = ReturnType<typeof botRows>[number];

/** A bot's face: it sleeps with nothing to do, ResearchBot's eyes scan while it looks, it hops when it acts, SniperBot's entries float up over
 *  it, and TraderBot jiggles as each buy or sale floats its SOL up. */
function BotFace({ row, motion, size }: { row: Bot; motion: ReturnType<typeof useMotion>; size: number }) {
  return <span className={s.agentFace} data-state={row.state}>
    <span className={s.agentBot} data-lap={motion.laps[row.role] ? motion.laps[row.role] % 2 ? 'a' : 'b' : undefined} data-big={(row.role === 'trader' && motion.big) || undefined}>
      <BotAvatar role={row.role} size={size} mood={row.asleep ? 'asleep' : row.role === 'research' ? 'scan' : undefined}/>
    </span>
    {motion.floats.filter(float => float.role === row.role).map(float => <span key={float.id} className={`${s.botFloat} ${float.role === 'trader' && !float.buy ? s[tone(float.sol, 3) ?? 'muted'] : ''}`}
      data-buy={(float.role === 'trader' && float.buy) || undefined} data-entry={float.role === 'sniper' || undefined}
      style={{ '--n': float.n } as CSSProperties} onAnimationEnd={event => { if (event.target === event.currentTarget) motion.done(float.id); }}>
      <TokenAvatar className="size-[1.05rem] rounded-full" address={float.token.address} symbol={float.token.symbol}/>
      {float.role === 'sniper' ? <>Entry · <span>{float.token.symbol}</span></> : float.buy ? sol(float.sol) : signedSol(float.sol)}
    </span>)}
  </span>;
}

/** A bot's coins as chips: logo, symbol and what the bot is doing with it. */
function LaneChips({ chips }: { chips: Chip[] }) {
  return <span className={s.laneChips}>{chips.map(chip => <span key={chip.key} className={s.laneChip} data-warn={chip.warn || undefined}>
    <span className={s.pillLogos}>{chip.tokens.map(token => <TokenAvatar key={token.address} className="size-[1.15rem] rounded-[28%]" address={token.address} symbol={token.symbol}/>)}</span>
    {chip.tokens.length === 1 && <b>{chip.tokens[0].symbol}</b>}<small>{chip.label}</small>
  </span>)}</span>;
}

type Kept = NonNullable<HomeData['team']['keptOut']>;
const count = (value: number) => formatNumber(value, { compact: value >= 10_000, precision: 1 });
const botHref = (role: Role, strategyId?: string) => strategyId ? `${appHref('bots', role)}?strategy=${encodeURIComponent(strategyId)}` : appHref('bots', role);

/** The column: the three bots as tabs with their totals and the rugs kept out over the last day; the picked bot shows its numbers by strategy
 *  and the coins it is on now. The buys that need you sit between the two. */
function Column({ data, strategyId, kept, needs, readOnly }: { data: HomeData; strategyId?: string; kept: Kept | null; needs: ReactNode; readOnly?: boolean }) {
  const [role, setRole] = useState<Role>('trader'), now = useNow(), rows = botRows(data, now, strategyId), motion = useMotion(data, strategyId), picked = rows.find(row => row.role === role)!;
  const chips = laneChips(data, strategyId)[role];
  return <>
    <div className={s.botTabs} role="tablist" aria-label="Team">{rows.map(row => <Tooltip key={row.role}><TooltipTrigger asChild><button type="button" role="tab" aria-selected={row.role === role} aria-label={BOTS[row.role].name} className={s.botTab} onClick={() => setRole(row.role)}>
      <BotFace row={row} motion={motion} size={40}/><b>{count(row.total)}</b>
    </button></TooltipTrigger><TooltipContent side="bottom">{BOTS[row.role].name} · {row.total.toLocaleString('en-US')} {row.unit}{row.day && ' in 24h'}</TooltipContent></Tooltip>)}</div>
    {kept?.count ? <div className={s.keptLine}><ShieldCheck size={15}/><b>{count(kept.count)}</b>rugs blocked<small>24h</small></div> : null}
    {needs}
    <div className={s.botFocus} role="tabpanel">
      <Link href={botHref(role, strategyId)} aria-disabled={readOnly || undefined} onClick={event => { if (readOnly) event.preventDefault(); }} className={s.botFocusHead}><span className={s.grow}><b>{BOTS[role].name}</b><small>{picked.text}</small></span><ChevronRight size={16}/></Link>
      <StrategyBars role={role} strategies={strategyId ? data.strategies.filter(row => row.id === strategyId) : data.strategies}/>
      {chips.length > 0 && <LaneChips chips={chips}/>}
    </div>
  </>;
}

/** The picked bot's work by strategy, largest first: ResearchBot's coins researched with the part it picked, SniperBot's picks with the part it
 *  bought, TraderBot's profit (realized and open) in green or red. */
function StrategyBars({ role, strategies }: { role: Role; strategies: StrategyRow[] }) {
  const [total, part] = role === 'research' ? ['researched', 'picked'] : ['picked', 'bought'];
  const bars = strategies.map(row => role === 'trader' ? { id: row.id, name: row.name, value: row.realizedPnlSol + row.openPnlSol, part: 0 }
    : { id: row.id, name: row.name, value: role === 'research' ? row.funnel.found : row.funnel.passed, part: role === 'research' ? row.funnel.passed : row.funnel.bought })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 6);
  const top = Math.max(0, ...bars.map(bar => Math.abs(bar.value)));
  if (!bars.length) return null;
  const width = (value: number) => `${top ? Math.abs(value) / top * 100 : 0}%`;
  return <div className={s.barList}>
    {role !== 'trader' && <span className={s.barLegend}><span><i/>{total}</span><span><i data-part/>{part}</span></span>}
    {bars.map(bar => <Tooltip key={bar.id}><TooltipTrigger asChild><div className={s.barRow} tabIndex={0}>
      <span className={s.barName}>{bar.name}</span>
      <span className={s.barTrack}>{role === 'trader' ? <i data-tone={tone(bar.value, 2)} style={{ width: width(bar.value) }}/> : <><i style={{ width: width(bar.value) }}/><i data-part style={{ width: width(bar.part) }}/></>}</span>
      <b className={s[role === 'trader' ? tone(bar.value, 2) ?? 'muted' : 'num']}>{role === 'trader' ? signedSol(bar.value, 2).replace(' SOL', '') : count(bar.value)}</b>
    </div></TooltipTrigger><TooltipContent side="left">{bar.name} · {role === 'trader' ? signedSol(bar.value) : <>{count(bar.value)} {total} · {count(bar.part)} {part}{bar.value ? ` (${Math.round(bar.part / bar.value * 100)}%)` : ''}</>}</TooltipContent></Tooltip>)}
  </div>;
}

/** The team as faces in a narrow rail: a face's tooltip says what the bot is doing, its badge counts the buys waiting on you or the coins held,
 *  and the shield counts the rugs kept out. `onExpand` brings back the column the person collapsed. */
function Rail({ data, strategyId, kept, status, live, onOpen, onExpand }: { data: HomeData; strategyId?: string; kept: Kept | null; status: ReactNode; live: boolean; onOpen: (role: Role) => void; onExpand?: () => void }) {
  const now = useNow(), rows = botRows(data, now, strategyId), motion = useMotion(data, strategyId);
  return <>
    {onExpand && <Button size="icon-sm" variant="ghost" className={s.railToggle} aria-label="Expand the team" title="Expand" onClick={onExpand}><PanelRightOpen/></Button>}
    <Tooltip><TooltipTrigger asChild><span className={s.railStatus} role="status" tabIndex={0}><span className={s.dot} data-live={live || undefined} data-off={!live || undefined}/></span></TooltipTrigger>
      <TooltipContent side="left">{status}</TooltipContent></Tooltip>
    {rows.map(row => <Tooltip key={row.role}><TooltipTrigger asChild><button type="button" className={s.railBot} aria-label={BOTS[row.role].name} onClick={() => onOpen(row.role)}>
      <BotFace row={row} motion={motion} size={34}/>
      {row.badge > 0 && <span className={s.railBadge} data-warn={row.role === 'sniper' || undefined}>{row.badge}</span>}
    </button></TooltipTrigger><TooltipContent side="left"><b>{BOTS[row.role].name}</b> · {row.text}</TooltipContent></Tooltip>)}
    {kept?.count ? <Tooltip><TooltipTrigger asChild><button type="button" className={s.railShield} aria-label="Rugs blocked" onClick={() => onOpen('research')}>
      <ShieldCheck size={16}/><b>{formatNumber(kept.count, { compact: kept.count >= 1_000, precision: 1 })}</b>
    </button></TooltipTrigger><TooltipContent side="left">{count(kept.count)} rugs blocked · 24h</TooltipContent></Tooltip> : null}
  </>;
}

const WIDE = '(min-width: 80rem)';
const onWideChange = (callback: () => void) => { const list = matchMedia(WIDE); list.addEventListener('change', callback); return () => list.removeEventListener('change', callback); };
const useWide = () => useSyncExternalStore(onWideChange, () => matchMedia(WIDE).matches, () => true);

export type TeamLayout = 'column' | 'rail';
/** The layout the team takes in this window: the column, or the rail when the window is too narrow for the column beside the page or the
 *  person collapsed it. */
export function useTeamLayout(): TeamLayout {
  const collapsed = useAtomValue(teamCollapsedAtom), wide = useWide();
  return wide && !collapsed ? 'column' : 'rail';
}

/** One bot's overview, for the team or one strategy: what it has done in numbers, what it holds or watches now, and its recent decisions. */
export function BotDialog({ role, data, strategyId, onClose }: { role: Role; data: HomeData; strategyId?: string; onClose: () => void }) {
  const { describe: price } = usePriceDisplay();
  const [coin, setCoin] = useState<string | null>(null), lane = lanes(data, strategyId), bot = BOTS[role], now = useNow();
  const { results: history, status, loadMore } = useDecisions(role, data, strategyId ?? null, 20);
  type Row = { id: string; token: Bag['token']; line: string; end?: ReactNode; warn?: boolean };
  const rows: Row[] = role === 'research' ? lane.researching.map(item => ({ id: item.id, token: item.token, line: 'Checking now' }))
    : role === 'sniper' ? [...lane.needs.map(item => ({ id: item.id, token: item.token, line: `Wants your OK · ${sol(item.amountSol)}${item.markPriceUsd ? ' at ' + price(item.markPriceUsd, item.supply) : ''}`, warn: true })), ...lane.watching.map(item => ({ id: item.id, token: item.token, line: item.targetPriceUsd ? `Buys under ${price(item.targetPriceUsd, item.supply)}` : 'Buying at market', end: item.expiresAt ? <small className={s.muted}>{Math.max(1, Math.round((item.expiresAt - now) / 60000))}m left</small> : undefined }))]
    : lane.bags.map(bag => ({ id: bag.id, token: bag.token, line: bag.stage === 'held' ? heldLine(bag) : bag.stage === 'buying' ? 'Buying…' : 'Selling…', end: <span className={s.end}><b>{sol(bag.valueSol)}</b><small className={s[tone(change(bag)) ?? 'muted']}>{pct(change(bag))}</small></span> }));
  const openPnl = lane.openPnl;
  const sold = history.slice(0, 12).filter(event => event.kind === 'sold'), soldPnl = sold.reduce((sum, event) => sum + (event.pnlSol ?? 0), 0);
  const stats: [string, ReactNode][] = role === 'research' ? lane.kept?.checked != null ? [['checked · 24h', lane.kept.checked], ['kept out · 24h', lane.kept.count], ['researched', lane.found], ['picked', lane.passed]]
      : [['researched', lane.found], ['picked', lane.passed], ['pass rate', lane.found ? Math.round(lane.passed / lane.found * 100) + '%' : '—'], ...(lane.kept ? [['kept out · 24h', lane.kept.count] as [string, ReactNode]] : [])]
    : role === 'sniper' ? [['waiting', lane.watching.length + lane.needs.length], ['entered', lane.bought], ['need you', lane.needs.length]]
    : [['holding', lane.bags.length], ['open', <span className={s[tone(openPnl) ?? 'muted']}>{signedSol(openPnl)}</span>], ['last sales', <span className={s[tone(soldPnl) ?? 'muted']}>{signedSol(soldPnl)}</span>]];
  const line = (event: (typeof history)[number]) => event.kind === 'passed' ? `Picked${event.count ? ' · score ' + event.count : ''}` : event.kind === 'rejected' ? 'Turned down' : event.kind === 'armed' ? (event.priceUsd ? `Waited for ${price(event.priceUsd, event.supply)}` : 'Entered at market') : event.kind === 'approval' ? 'Asked you' : event.kind === 'queued' ? 'Queued for room' : event.kind === 'expired' ? 'Let it go' : event.kind === 'bought' ? `Bought ${sol(event.amountSol)}` : event.kind === 'sold' ? 'Sold' : event.kind === 'blocked' ? 'Held back' : 'Couldn’t finish';
  const idle = role === 'research' ? (lane.running ? 'Nothing in the queue right now' : 'Paused') : role === 'sniper' ? 'No picks waiting' : 'Nothing held';
  if (coin) return <DecisionDialog id={coin} onClose={onClose}/>;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[min(44rem,calc(var(--view-h)-2rem))] overflow-y-auto sm:max-w-[32rem]">
      <DialogTitle className="sr-only">{bot.name}</DialogTitle>
      <div className={s.decision}>
        <div className={s.decisionHead}><BotAvatar role={role} size={44}/><span className={s.grow}><b>{bot.name}</b><small>{bot.job}</small></span></div>
        <Link href={botHref(role, strategyId)} className={s.botOpen} onClick={onClose}>Open {bot.name} page <ChevronRight size={16}/></Link>
        <div className={s.stats}>{stats.map(([label, value]) => <div key={label} className={s.stat}><b>{value}</b><small>{label}</small></div>)}</div>
        {role === 'research' && lane.kept?.count ? <div className={s.laneChips}>{lane.kept.checks.map(check => <span key={check.label} className={s.laneChip}><span className={s.pillLogos}><ShieldCheck size={13}/></span><b>{check.count}</b><small>{check.label}</small></span>)}</div> : null}
        <div>
          <p className={s.label}>Now</p>
          {rows.length ? <div className={s.panelList}>{rows.map(row => <button type="button" key={row.id} className={s.panelRow} onClick={() => setCoin(row.id)}>
            <TokenAvatar className="size-8 rounded-full" address={row.token.address} symbol={row.token.symbol}/>
            <span className={s.grow}><b>{row.token.symbol}</b><small className={row.warn ? s.warnText : undefined}><SignedPercentText>{row.line}</SignedPercentText></small></span>
            {row.end}<ChevronRight size={16}/>
          </button>)}</div> : <p className={s.empty}>{idle}</p>}
        </div>
        {(history.length > 0 || status === 'CanLoadMore' || status === 'LoadingMore') && <div>
          <p className={s.label}>Recent decisions</p>
          <div className={`${s.scrollPane} ${s.panelScroll}`}><Paged className={s.panelList} status={status} onMore={() => loadMore(20)}>{history.map(event => <button type="button" key={event.id} className={s.panelRow} onClick={() => setCoin(event.itemId!)}>
            <TokenAvatar className="size-7 rounded-full" address={event.address ?? undefined} symbol={event.symbol ?? '?'}/>
            <span className={s.grow}><b>{event.symbol}</b><small>{line(event)}</small></span>
            {event.kind === 'sold' && <span className={`${s.num} ${s[tone(event.pnlSol) ?? 'muted']}`}>{signedSol(event.pnlSol)}</span>}
            <time className={s.when}>{ago(event.at, now || undefined)}</time>
          </button>)}</Paged></div>
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}

/** The team beside every page, for the whole team or, on a strategy's page, that strategy's team: the column (the bots as tabs over what the
 *  picked one is on, and every buy that needs you), or the rail of faces. The rail's faces open a bot's dialog. The holdings live on Home and the strategy pages. */
type TeamPanelProps = { data: HomeData; strategyId?: string; layout: TeamLayout; readOnly?: boolean };
export function TeamPanel(props: TeamPanelProps) {
  return props.readOnly ? <TeamPanelView {...props}/> : <LiveTeamPanel {...props}/>;
}
function LiveTeamPanel(props: TeamPanelProps) {
  const command = useCommand();
  return <TeamPanelView {...props} onResume={() => { void command({ type: 'resumeAll' }); }}/>;
}
function TeamPanelView({ data, strategyId, layout, readOnly, onResume }: TeamPanelProps & { onResume?: () => void }) {
  const [bot, setBot] = useState<Role | null>(null), setCollapsed = useSetAtom(teamCollapsedAtom), wide = useWide();
  // A strategy that left the list (archived, deleted) shows the whole team.
  const scope = strategyId ? data.strategies.find(row => row.id === strategyId) : undefined;
  const running = (scope ? [scope] : data.strategies).filter(row => row.status === 'running').length, live = data.worker.online && data.worker.liveView && !data.workspace.halted && running > 0;
  const status = data.workspace.halted ? 'Team stopped' : !data.worker.online ? 'Reconnecting to your team' : !data.worker.liveView ? 'Live view down'
    : scope ? <>{scope.name}<span className={s.muted}> · {scope.status === 'running' ? 'running' : scope.status === 'archiving' ? 'selling out' : 'paused'}</span></>
    : running ? `${running} ${running === 1 ? 'strategy' : 'strategies'} running` : 'All strategies paused';
  // The rugs kept out are counted for the whole team, so a strategy's page leaves them out.
  const kept = scope ? null : data.team.keptOut;
  // Buys waiting on you stay team-wide: one never hides because another strategy's page is open.
  const needs = data.needs.length > 0 && <div className={s.panelNeeds}>{readOnly ? <p className={s.empty}>{data.needs.length} {data.needs.length === 1 ? 'buy awaits' : 'buys await'} your review in HOTBOT.</p> : <NeedsYou items={data.needs} strategies={data.strategies}/>}</div>;
  return <Sidebar side="right" variant="floating" collapsible="offcanvas" className={s.teamSidebar} data-layout={layout}>
    {layout === 'rail' ? <SidebarContent className={`${s.panel} ${s.rail}`}>
      <Rail data={data} strategyId={scope?.id} kept={kept} status={status} live={live} onOpen={role => { if (!readOnly) setBot(role); }} onExpand={wide ? () => setCollapsed(false) : undefined}/>
    </SidebarContent> : <SidebarContent className={s.panel}>
      {/* The team's stop with its Resume. */}
      <div className={s.panelHead} role="status"><span className={s.dot} data-live={live || undefined} data-off={!live || undefined}/><b>{status}</b>
        {data.workspace.halted && <Button size="xs" disabled={readOnly} onClick={onResume}>Resume</Button>}
        <Button size="icon-sm" variant="ghost" className={s.railToggle} aria-label="Collapse the team" title="Collapse" onClick={() => setCollapsed(true)}><PanelRightClose/></Button></div>
      <Column data={data} strategyId={scope?.id} kept={kept} needs={needs} readOnly={readOnly}/>
    </SidebarContent>}
    {!readOnly && bot && <BotDialog role={bot} data={data} strategyId={scope?.id} onClose={() => setBot(null)}/>}
  </Sidebar>;
}
