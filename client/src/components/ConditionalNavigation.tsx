"use client";
import { useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import { currentUserIdAtom, useSignedOut } from '@/store/user/atoms';
import { launchingAtom, pendingPlanAtom } from '@/components/team/state';
import { useHome } from '@/components/team/useHome';
import { MainScrollContext, ScrollTargetContext, useScrollTargetRegistry } from '@/lib/scroll-context';
import { SidebarProvider } from '@/components/ui/sidebar';
import { MobileNav } from '@/components/team/MobileNav';
import { TeamSidebar } from '@/components/team/TeamSidebar';
import { TeamChrome } from '@/components/team/TeamChrome';
import { Scrollbar } from '@/components/ui/scrollbar';
import scrollStyles from '@/components/ui/scrollbar.module.css';
import { useMcpPreview } from '@/components/team/McpPreviewProvider';
/** `account` mounts under the navigation's own sidebar provider, outside TeamChrome's nested one, so its portalled controls read the left sidebar's state. The sidebar stays a compact rail
 *  while onboarding is on screen: signed out, signed in without a team, a plan starting or the launch step.
 *  Phones get no side panels: MobileNav's header and bottom bar (whose avatar menu carries the account controls) replace the sidebar sheet. */
export function ConditionalNavigation({ accountControls, account, children }: PropsWithChildren<{ accountControls?: ReactNode; account?: ReactNode }>) {
  const main=useRef<HTMLElement>(null), registry=useScrollTargetRegistry(), sessionSignedOut=useSignedOut(), preview=useMcpPreview(), signedOut=!preview && sessionSignedOut, [open, setOpen]=useState(true);
  const userId=useAtomValue(currentUserIdAtom), data=useHome(Boolean(userId)), launching=useAtomValue(launchingAtom), pending=useAtomValue(pendingPlanAtom), rail=preview ? false : signedOut || launching || Boolean(pending) || data === null;
  // Phones never scroll the page sideways: a row wider than the screen is a layout bug, not something to pan to.
  return <MainScrollContext.Provider value={main}><ScrollTargetContext.Provider value={registry}><SidebarProvider open={open && !rail} onOpenChange={value => { if (!rail) setOpen(value); }} className="h-dvh min-h-0 overflow-hidden" style={{ height: '100dvh', minHeight: 0 }}><TeamSidebar accountControls={accountControls}/>{account}{!signedOut && <MobileNav accountControls={accountControls}/>}<div className={scrollStyles.frame}><TeamChrome><main ref={main} id="main-content" className="relative min-h-0 min-w-0 flex-1 max-md:overflow-x-hidden" style={{overflowY:registry.el?'hidden':'auto'}}><div className="w-full min-h-full">{children}</div></main></TeamChrome><Scrollbar viewport={registry.el} fallback={main}/></div></SidebarProvider></ScrollTargetContext.Provider></MainScrollContext.Provider>;
}
