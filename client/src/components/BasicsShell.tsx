"use client";

import { useEffect, useState, type ComponentType, type PropsWithChildren } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isBarePath, isJoinPath } from '@/lib/landing';
import { AppearancePicker } from '@/components/AppearancePicker';
import { Button } from '@/components/ui/button';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import type { AccountRuntimeProps } from '@/components/account/AccountRuntime';
import { ConvexProvider } from 'convex/react';
import { convex, ConvexQueryCacheProvider } from '@/lib/convex';
import { isMcpPreviewPath, McpPreviewProvider } from '@/components/team/McpPreviewProvider';

// The sidebar, team panel and composer, with every page they open: the launch page and /join never load them.
const ConditionalNavigation = dynamic(() => import('@/components/ConditionalNavigation').then(module => module.ConditionalNavigation));

// Start downloading account services (Convex Auth) as soon as this module runs, not after the first render; the bare pages never use them.
let runtimeRequest: Promise<typeof import('@/components/account/AccountRuntime')> | null = typeof window === 'undefined' || isBarePath(window.location.pathname) || isMcpPreviewPath(window.location.pathname) ? null : import('@/components/account/AccountRuntime');
const loadRuntime = () => (runtimeRequest ??= import('@/components/account/AccountRuntime'));

function WorkspaceShell({ children }: PropsWithChildren) {
  const [Runtime, setRuntime] = useState<ComponentType<AccountRuntimeProps> | null>(null);
  const [accountTarget, setAccountTarget] = useState<HTMLDivElement | null>(null);
  const [contentTarget, setContentTarget] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  // Account SDKs load after the public workspace has mounted. Their portals keep
  // the dashboard, editors and navigation mounted throughout account startup.
  useEffect(() => {
    let active = true;
    setError(null);
    void loadRuntime().then(module => {
      if (active) setRuntime(() => module.AccountRuntime);
    }).catch(() => {
      runtimeRequest = null;
      if (active) setError('Account controls could not load.');
    });
    return () => { active = false; };
  }, [retry]);

  return <>
    <ConditionalNavigation accountControls={<div ref={setAccountTarget} className="flex w-full flex-col items-stretch gap-3">
      {!Runtime && <div className="flex flex-col gap-3 group-data-[collapsible=icon]:items-center"><div role={error ? 'alert' : 'status'} className="text-xs text-muted-foreground">{!error&&<LoaderCircle aria-hidden className="hidden size-[1.25em] group-data-[collapsible=icon]:block motion-safe:animate-spin"/>}<span className="group-data-[collapsible=icon]:sr-only">{error ?? ''}</span></div>{error && <Button size="icon" variant="outline" aria-label="Retry account connection" title="Retry account connection" onClick={() => setRetry(value => value + 1)}><RotateCcw/></Button>}<div className="hotbot-account-icons"><AppearancePicker iconOnly/></div></div>}
    </div>} account={Runtime && <Runtime accountTarget={accountTarget} contentTarget={contentTarget} />}>
      {children}
      <div ref={setContentTarget} className="contents" />
    </ConditionalNavigation>
  </>;
}

/** /join for a visitor with a saved session: the account runtime (Convex Auth) signs the page in with nowhere to show its controls, so a person
 *  HOTBOT let in pays the pass there. A visitor who never signed in loads none of it. */
function SignedInJoin({ children }: PropsWithChildren) {
  const [Runtime, setRuntime] = useState<ComponentType<AccountRuntimeProps> | null>(null), [target, setTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!Object.keys(localStorage).some(key => key.startsWith('__convexAuthJWT'))) return;
    let active = true;
    void loadRuntime().then(module => { if (active) setRuntime(() => module.AccountRuntime); }, () => { runtimeRequest = null; });
    return () => { active = false; };
  }, []);
  return <>{children}<div ref={setTarget} hidden/>{Runtime && <Runtime accountTarget={null} contentTarget={target}/>}</>;
}

export function BasicsShell({ children }: PropsWithChildren) {
  const pathname=usePathname();
  if (isMcpPreviewPath(pathname)) return <McpPreviewProvider><ConditionalNavigation accountControls={<div className="flex flex-col gap-2 px-2 text-xs text-muted-foreground"><span>Local MCP preview · read only</span><AppearancePicker iconOnly/></div>}>{children}</ConditionalNavigation></McpPreviewProvider>;
  // The launch page and the application have their own header and document scroll, without workspace services.
  const shell = isJoinPath(pathname) ? <SignedInJoin>{children}</SignedInJoin> : isBarePath(pathname) ? <>{children}</> : <WorkspaceShell>{children}</WorkspaceShell>;
  // One query cache for the whole app, shared by every screen's cached `useQuery`.
  return convex ? <ConvexProvider client={convex}><ConvexQueryCacheProvider>{shell}</ConvexQueryCacheProvider></ConvexProvider> : shell;
}
