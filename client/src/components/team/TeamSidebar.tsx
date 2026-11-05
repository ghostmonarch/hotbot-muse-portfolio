"use client";
import { useHome } from './useHome';
import { useRef, type ReactNode } from 'react';
import { ConvexProvider } from 'convex/react';
import { useAtomValue } from 'jotai';
import { Ellipsis, Flag, House, Plus, Route, FlaskConical, Wallet, Wrench, PieChart } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { AppFlame } from '@/components/hotbot/AppFlame';
import { api, convex, useQuery } from '@/lib/convex';
import { currentUserIdAtom, labAtom, useSignedOut } from '@/store/user/atoms';
import { signedSol, tone, usd } from './format';
import type { HomeData, StrategyRow } from './data';
import { TokenAvatar } from '@/components/token/TokenAvatar';
import { SOL_MINT } from '@/lib/solana';
import { TeamWalletDialog } from './TeamWallet';
import { useReport } from './Report';
import { FirstTip, PORTFOLIO_STATUS, strategyLine } from './Parts';
import { StrategyMenu } from './StrategyMenu';
import { AtLimit, usePortfolioCount, usePortfolioLimit, useStrategyCount, useStrategyLimit, type Count } from './Limits';
import { viewAsAtom } from './state';
import s from './team.module.css';
import { Link, useCurrentPlace, useShellPathname } from '@/lib/appNavigation';
import { useMcpPreview } from './McpPreviewProvider';

const pages = [['/app', 'Home', House], ['/app/portfolios', 'Portfolios', PieChart], ['/app/strategies', 'Strategies', Route]] as const;
/** The Lab, for admins and the people an admin gave it. */
const labLink = [['/app/lab', 'Lab', FlaskConical]] as const;
/** Local builds only: one link to /dev, whose cards open the development pages (each is notFound in production, and this list is empty there). */
export const dev = process.env.NODE_ENV === 'development' ? [['/dev', 'Dev', Wrench]] as const : [];

/** Navigation, then your portfolios and strategies like a chat list, then the team wallet and one account row pinned under them. */
export function TeamSidebar({ accountControls }: { accountControls?: ReactNode }) {
  const pathname = useShellPathname(), { setOpenMobile } = useSidebar(), sessionSignedOut = useSignedOut(), preview = useMcpPreview(), signedOut = !preview && sessionSignedOut, hasLab = useAtomValue(labAtom), report = useReport();
  const lab = useRef<HTMLAnchorElement>(null);
  const active = (href: string) => href === '/app' ? pathname === '/app' : href === '/app/strategies' ? pathname === '/app/strategies' || pathname === '/app/new' : href === '/app/portfolios' ? pathname === '/app/portfolios' || pathname === '/app/portfolios/new' : pathname.startsWith(href);
  return <Sidebar collapsible="icon" variant="floating">
    <SidebarHeader className="px-4 pt-4 pb-3 group-data-[collapsible=icon]:px-2"><div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col"><Link href={preview ? '/muse-preview' : '/app'} aria-label="HOTBOT home" className="flex items-center gap-2.5" onClick={() => setOpenMobile(false)}><AppFlame size={30}/><span className="text-[0.875rem] font-semibold tracking-[0.14em] group-data-[collapsible=icon]:hidden">HOTBOT</span></Link>{!signedOut && <SidebarTrigger aria-label="Minimize or expand navigation"/>}</div></SidebarHeader>
    <SidebarContent className="gap-6">
      {!signedOut && <SidebarGroup className="py-0"><SidebarGroupContent><SidebarMenu className="gap-1">
        {[...pages, ...(hasLab ? labLink : []), ...dev].map(([href, label, Icon]) => <SidebarMenuItem key={href}><SidebarMenuButton asChild tooltip={label} isActive={preview ? href === '/app/portfolios' : active(href)} className={s.navBtn}><Link ref={href === '/app/lab' ? lab : undefined} href={href} aria-disabled={Boolean(preview)} onClick={event => { if (preview) event.preventDefault(); setOpenMobile(false); }}><Icon/><span>{label}</span>{href === '/app/portfolios' && <span className={`${s.navNew} group-data-[collapsible=icon]:hidden`}>New</span>}</Link></SidebarMenuButton></SidebarMenuItem>)}
        <SidebarMenuItem><SidebarMenuButton tooltip="Report a problem (F)" disabled={Boolean(preview)} className={s.navBtn} aria-keyshortcuts="F" onClick={() => { setOpenMobile(false); report.pick(); }}><Flag className={s.reportFlag}/><span>Report a problem</span></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu></SidebarGroupContent></SidebarGroup>}
      {!signedOut && <FirstTip id="lab" anchor={lab} when={hasLab && /^\/app\/strategies\/[^/]+$/.test(pathname)} side="right" title="Test changes in the Lab" text="It backtests any change to a strategy, and AI suggests improvements right on screen."/>}
      {preview ? <PreviewSidebarStrategies onNavigate={() => setOpenMobile(false)}/> : convex && <ConvexProvider client={convex}><SidebarStrategies pathname={pathname} onNavigate={() => setOpenMobile(false)}/></ConvexProvider>}
    </SidebarContent>
    <SidebarFooter className="gap-2 p-2 pb-3 group-data-[collapsible=icon]:px-2">{preview ? <PreviewSidebarBalance/> : convex && <ConvexProvider client={convex}><SidebarBalance/></ConvexProvider>}<div className="w-full">{accountControls}</div></SidebarFooter>
    {!signedOut && <SidebarRail/>}
  </Sidebar>;
}

/** One flat list, no folds: Real SOL first, then by status, so paused rows sink to the end. */
const STATUS_RANK: Record<StrategyRow['status'], number> = { running: 0, archiving: 1, paused: 2, archived: 2 };
const strategyRank = (row: StrategyRow) => (row.mode === 'live' ? 0 : 3) + STATUS_RANK[row.status];

/** A coin page and a bot page filtered to a strategy sit inside that strategy (`usePlace`), so its row lights there too. */
function SidebarStrategies({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const userId = useAtomValue(currentUserIdAtom), data = useHome(Boolean(userId)), within = useCurrentPlace()?.strategyId, limit = useStrategyLimit(), count = useStrategyCount();
  if (!data) return null;
  const rows = [...data.strategies].sort((a, b) => strategyRank(a) - strategyRank(b));
  const place = { pathname, within, onNavigate, data };
  return <><SidebarPortfolios pathname={pathname} onNavigate={onNavigate}/>
  <SidebarGroup className="py-0 group-data-[collapsible=icon]:hidden">
    <SidebarGroupLabel className={s.navLabel}>Strategies<NavCount count={count}/><AtLimit limit={limit}><Link href="/app/new" onClick={onNavigate} className={s.navAdd} aria-label="New strategy"><Plus/></Link></AtLimit></SidebarGroupLabel>
    <SidebarGroupContent><SidebarMenu className="gap-0.5">
      {rows.map(row => <StrategyLink key={row.id} row={row} {...place}/>)}
    </SidebarMenu></SidebarGroupContent>
  </SidebarGroup></>;
}

/** How many of a list's slots are in use, out of the limit; an admin has no limit, so only the count shows. */
function NavCount({ count }: { count: Count | null }) {
  if (!count) return null;
  const { kept, limit } = count;
  return <span className={s.navCount} data-full={limit !== null && kept >= limit ? '' : undefined}><span aria-hidden>{kept}{limit !== null && `/${limit}`}</span><span className="sr-only">{limit === null ? `${kept} in use` : `${kept} of ${limit} in use`}</span></span>;
}

/** The team wallet under the lists, so it stays in view however long they get: its worth and profit, and the dialog with the rest. */
function SidebarBalance() {
  const userId = useAtomValue(currentUserIdAtom), data = useHome(Boolean(userId));
  if (!data) return null;
  const total = data.money.openPnl + data.money.realizedPnlSol;
  return <TeamWalletDialog data={data}><button type="button" className={`${s.navBalance} group-data-[collapsible=icon]:!mx-auto group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!bg-transparent`} aria-label="Open wallet">
    <TokenAvatar className="size-8 rounded-full" address={SOL_MINT} symbol="SOL"/>
    <span className={`${s.navBalanceText} group-data-[collapsible=icon]:!hidden`}>
      <span><b>{data.money.equity.toFixed(2)} SOL</b><span className={`${s.stratPnl} ${s[tone(total, 2) ?? 'muted']}`}>{signedSol(total, 2).replace(' SOL', '')}</span></span>
      <small>{usd(data.money.equity * data.money.solUsd)} · {data.workspace.mode === 'paper' ? 'Paper' : 'Real SOL'}</small>
    </span>
  </button></TeamWalletDialog>;
}

const pnlColor = (pnl: number) => Math.abs(pnl) < 1e-9 ? 'var(--muted-foreground)' : pnl > 0 ? 'var(--positive)' : 'var(--destructive)';
type Place = { pathname: string; within?: string | null; onNavigate: () => void };
type StrategyPlace = Place & { data: HomeData };

/** One row of the sidebar's lists: the name on top, then its state beside its profit. `dot` colours the state's dot; `real` marks a Real SOL
 *  strategy with the ember wallet; `quiet` greys a paused one; `action` is a button that shows over the row's end while the pointer is on it. */
function SideRow({ href, active, name, line, dot, real, quiet, pnl, onNavigate, action, readOnly }: { href: string; active: boolean; name: string; line: string; dot?: 'live' | 'ember' | 'warn'; real?: boolean; quiet?: boolean; pnl: number; onNavigate: () => void; action?: ReactNode; readOnly?: boolean }) {
  return <SidebarMenuItem className={action ? s.sideItem : undefined}>
    <SidebarMenuButton asChild isActive={active} className={s.sideRow} data-quiet={quiet || undefined}><Link href={href} aria-disabled={readOnly || undefined} onClick={event => { if (readOnly) event.preventDefault(); else onNavigate(); }} title={readOnly ? `${name} · controls available in HOTBOT` : name}>
      <b>{name}</b>
      <small data-tone={dot}><span>{line}</span>{real && <Wallet className={s.sideReal} aria-label="Trades Real SOL"><title>Trades Real SOL</title></Wallet>}</small>
      <span className={s.stratPnl} style={{ color: pnlColor(pnl) }}>{signedSol(pnl).replace(' SOL', '')}</span>
    </Link></SidebarMenuButton>
    {action}
  </SidebarMenuItem>;
}

/** The same native lists, supplied by authenticated MCP reads; no Convex identity is implied. */
function PreviewSidebarStrategies({ onNavigate }: { onNavigate: () => void }) {
  const preview = useMcpPreview();
  if (!preview?.team) return <p className="px-4 text-xs text-muted-foreground" role="status">{preview?.loading ? 'Reading HOTBOT…' : preview?.error ?? 'Connect HOTBOT to read your team.'}</p>;
  const rows = [...preview.team.strategies].sort((a, b) => strategyRank(a) - strategyRank(b));
  return <>
    {preview.portfolios.length > 0 && <SidebarGroup className="py-0 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className={s.navLabel}>Portfolios<NavCount count={{ kept: preview.portfolios.length, limit: null }}/></SidebarGroupLabel>
      <SidebarGroupContent><SidebarMenu className="gap-0.5">{preview.portfolios.map(row => {
        const holding = row.coins.filter(coin => coin.exitedAt === undefined).length;
        return <SideRow key={row.id} href={`/muse-preview?portfolioId=${encodeURIComponent(row.id)}`} active={false} name={row.name} pnl={row.valueSol - row.startSol} onNavigate={onNavigate}
          line={row.asks ? 'Needs you' : row.status !== 'running' ? PORTFOLIO_STATUS[row.status] : holding ? `${holding} holding` : 'No coins'}
          dot={row.asks ? 'warn' : row.status === 'running' || row.status === 'picking' ? 'live' : undefined}/>;
      })}</SidebarMenu></SidebarGroupContent>
    </SidebarGroup>}
    <SidebarGroup className="py-0 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className={s.navLabel}>Strategies<NavCount count={{ kept: rows.length, limit: null }}/></SidebarGroupLabel>
      <SidebarGroupContent><SidebarMenu className="gap-0.5">{rows.map(row => <SideRow key={row.id} href={'/app/strategies/' + row.id} active={false} name={row.name}
        line={strategyLine(row)} dot={row.loss?.stoppedAt != null ? 'warn' : row.status === 'running' ? 'live' : row.status === 'archiving' ? 'ember' : undefined}
        real={row.mode === 'live'} quiet={row.status === 'paused'} pnl={row.realizedPnlSol + row.openPnlSol} onNavigate={onNavigate} readOnly/>)}</SidebarMenu></SidebarGroupContent>
    </SidebarGroup>
  </>;
}

function PreviewSidebarBalance() {
  const data = useMcpPreview()?.team;
  if (!data) return null;
  const total = data.money.openPnl + data.money.realizedPnlSol;
  return <button type="button" disabled className={`${s.navBalance} group-data-[collapsible=icon]:!mx-auto group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!bg-transparent`} aria-label="Team balance, read only" title="Wallet controls are available in HOTBOT">
    <TokenAvatar className="size-8 rounded-full" address={SOL_MINT} symbol="SOL"/>
    <span className={`${s.navBalanceText} group-data-[collapsible=icon]:!hidden`}><span><b>{data.money.equity.toFixed(2)} SOL</b><span className={`${s.stratPnl} ${s[tone(total, 2) ?? 'muted']}`}>{signedSol(total, 2).replace(' SOL', '')}</span></span><small>{usd(data.money.equity * data.money.solUsd)} · {data.workspace.mode === 'paper' ? 'Paper' : 'Real SOL'}</small></span>
  </button>;
}

/** One strategy's row, with its profit in the portfolio it trades in and its menu. */
function StrategyLink({ row, data, pathname, within, onNavigate }: StrategyPlace & { row: StrategyRow }) {
  const dot = row.loss?.stoppedAt != null ? 'warn' : row.status === 'running' ? 'live' : row.status === 'archiving' ? 'ember' : undefined;
  const menu = <StrategyMenu data={data} strategy={row} run archive onNavigate={onNavigate}><button type="button" className={s.sideMore} aria-label={`More for ${row.name}`}><Ellipsis/></button></StrategyMenu>;
  return <SideRow href={'/app/strategies/' + row.id} active={pathname === '/app/strategies/' + row.id || within === row.id} name={row.name} line={strategyLine(row)} dot={dot} real={row.mode === 'live'} quiet={row.status === 'paused'} pnl={row.realizedPnlSol + row.openPnlSol} onNavigate={onNavigate} action={menu}/>;
}

/** The team's portfolios like the strategies below them: worth against the start, and the warning tone while one needs the person. Hidden until there is one. */
function SidebarPortfolios({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const rows = useQuery(api.portfolios.list, { ...useAtomValue(viewAsAtom) }), limit = usePortfolioLimit(), count = usePortfolioCount();
  if (!rows?.length) return null;
  return <SidebarGroup className="py-0 group-data-[collapsible=icon]:hidden">
    <SidebarGroupLabel className={s.navLabel}>Portfolios<NavCount count={count}/><AtLimit limit={limit}><Link href="/app/portfolios/new" onClick={onNavigate} className={s.navAdd} aria-label="New portfolio"><Plus/></Link></AtLimit></SidebarGroupLabel>
    <SidebarGroupContent><SidebarMenu className="gap-0.5">
      {rows.map(row => { const holding = row.coins.filter(coin => coin.exitedAt === undefined).length;
        return <SideRow key={row.id} href={'/app/portfolios/' + row.id} active={pathname === '/app/portfolios/' + row.id} name={row.name} pnl={row.valueSol - row.startSol} onNavigate={onNavigate}
          line={row.asks ? 'Needs you' : row.status !== 'running' ? PORTFOLIO_STATUS[row.status] : holding ? `${holding} holding` : 'No coins'}
          dot={row.asks ? 'warn' : row.status === 'running' || row.status === 'picking' ? 'live' : undefined}/>; })}
    </SidebarMenu></SidebarGroupContent>
  </SidebarGroup>;
}
