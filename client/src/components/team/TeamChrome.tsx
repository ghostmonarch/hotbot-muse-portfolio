"use client";
import { useHome } from './useHome';
import { type CSSProperties, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { ConvexProvider } from 'convex/react';
import { useAtomValue } from 'jotai';
import { convex } from '@/lib/convex';
import { isLandingPath } from '@/lib/landing';
import { currentUserIdAtom } from '@/store/user/atoms';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { AlertToast } from './AlertToast';
import { AccessGate } from './AccessGate';
import { TradeToast } from './TradeToast';
import { CheckCoin } from './CheckCoin';
import { Dock, type Focus } from './CommandPanel';
import type { HomeData } from './data';
import { Reporter } from './Report';
import { TeamPanel, useTeamLayout } from './TeamPanel';
import { coinLookAtom, launchingAtom, pendingPlanAtom, viewedAtom } from './state';
import s from './team.module.css';
import { useShellPathname } from '@/lib/appNavigation';
import { useMcpPreview } from './McpPreviewProvider';

/** The coin dialog loads once a coin is open, not with every page. */
const CoinLook = dynamic(() => import('./CoinLook').then(module => module.CoinLook), { ssr: false });

/** Where the person is, from the URL, so the composer knows which strategy or coin is on screen. */
export function focusFor(pathname: string): Focus | null {
  if (pathname === '/app/new' || isLandingPath(pathname)) return null;
  const strategy = pathname.match(/^\/app\/strategies\/([^/]+)$/), lab = pathname.match(/^\/app\/lab\/([^/]+)$/), token = pathname.match(/^\/app\/tokens\/([^/]+)$/);
  if (strategy) return { page: 'strategy', strategyId: decodeURIComponent(strategy[1]) };
  // The Lab plans its draft with HOTBOT: a saved strategy's, or one not made yet (/app/lab/new).
  if (lab) return lab[1] === 'new' ? { page: 'lab' } : { page: 'lab', strategyId: decodeURIComponent(lab[1]) };
  if (token) return { page: 'token', itemId: decodeURIComponent(token[1]) };
  if (pathname === '/app/strategies' || pathname === '/app/lab') return { page: 'strategies' };
  if (pathname === '/app/account') return { page: 'account' };
  return { page: 'home' };
}

/** The team panel on the right and HOTBOT's composer in the corner, rendered once around every page 
 *  Phones have no panel (MobileNav's header line shows what the team is doing) and open the composer from the bottom bar's Ask button. */
/** `full`: the page takes the whole window (the Lab), so the team panel steps aside; the composer stays. */
export function TeamChromeView({ data, focus, full, children, readOnly }: { data: HomeData | null; focus: Focus | null; full?: boolean; children: ReactNode; readOnly?: boolean }) {
  const mobile = useIsMobile(), viewing = Boolean(useAtomValue(viewedAtom)), looking = Boolean(useAtomValue(coinLookAtom)), layout = useTeamLayout();
  return <SidebarProvider className="h-full min-h-0 flex-1 overflow-hidden" style={{ '--sidebar-width': layout === 'rail' ? '4.75rem' : 'clamp(18rem, 20vw, 19.5rem)', minHeight: 0 } as CSSProperties}>
    {/* An admin viewing someone's team gets the viewing bar above every page; the frame is layout-neutral otherwise, so pages never remount. */}
    <div className={s.viewingFrame} data-viewing={viewing || undefined}>{children}</div>
    {data && focus && <>
      {!mobile && !full && <TeamPanel data={data} strategyId={focus.page === 'strategy' ? focus.strategyId : undefined} layout={layout} readOnly={readOnly}/>}
      {/* HOTBOT works for the admin's own team, so its composer steps aside while viewing someone else's. */}
      {!readOnly && <>
        {!viewing && <Dock data={data} focus={focus}/>}
        <CheckCoin data={data}/>
        {looking && <CoinLook/>}
        <Reporter data={data} focus={focus}/>
        <AlertToast data={data}/>
        <AccessGate data={data}/>
        <TradeToast data={data}/>
      </>}
    </>}
  </SidebarProvider>;
}

export function TeamChrome({ children }: { children: ReactNode }) {
  const preview = useMcpPreview();
  if (preview) return <TeamChromeView data={preview.team} focus={{ page: 'home' }} readOnly>{children}</TeamChromeView>;
  if (!convex) return <>{children}</>;
  return <ConvexProvider client={convex}><Live>{children}</Live></ConvexProvider>;
}

function Live({ children }: { children: ReactNode }) {
  const pathname = useShellPathname(), userId = useAtomValue(currentUserIdAtom), launching = useAtomValue(launchingAtom), pending = useAtomValue(pendingPlanAtom);
  // Onboarding (a plan starting, or its launch step) has no panel or composer around it.
  const focus = launching || pending ? null : focusFor(pathname);
  // Nothing until the person has a team; the same authenticated client the pages use.
  const data = useHome(Boolean(userId && focus));
  return <TeamChromeView data={data ?? null} focus={focus} full={pathname.startsWith('/app/lab') || pathname === '/dev/pipeline' || pathname === '/dev/indexer' || pathname === '/dev/architecture'}>{children}</TeamChromeView>;
}
