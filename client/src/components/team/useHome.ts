"use client";
import { atom, useAtomValue } from 'jotai';
import { replaceEqualDeep } from '@tanstack/react-query';
import type { FunctionReturnType } from 'convex/server';
import { api, convex } from '@/lib/convex';
import { lastMark, watchPrices, watchSol, watchTeam, type TeamFeed } from '@/services/market';
import { currentUserIdAtom } from '@/store/user/atoms';
import { WORKER_ONLINE_MS, composeHome, homeAddresses } from '../../../../types/home';
import type { HomeData } from './data';
import { viewAsAtom } from './state';
import { useMcpPreview } from './McpPreviewProvider';

type TeamView = FunctionReturnType<typeof api.team.gateway.view>;

type HomeResult = HomeData | null | undefined | Error;
const empty = atom<HomeResult>(undefined);
/** How long the first home waits for its coins' prices before it shows without them. */
const FIRST_PRICES_MS = 1_500;
/** Homes that hold what changed while the page was not listening: every home composed from the first new board after (re)subscribing (the
 *  tab came back, another team is viewed) or after the socket reconnected. Nothing in one is news, so the live notices announce none of it. */
const catchUps = new WeakSet<HomeData>();
export const isCatchUp = (home: HomeData) => catchUps.has(home);

/** One live home per signed-in account (or the team an admin is viewing): `team.board` (a coin changes there only when something happens to
 *  it), `team.status` (the worker's last beat and SOL) and each shown mint's live price from the market gateway, composed exactly as
 *  `team.home`. With the `topicAt` flag on, the board and the status come from the team topic on the gateway's socket while it brings
 *  them, and from Convex while it cannot. Ticks recompose on the next frame, and a mint keeps its last price while the socket
 *  reconnects (`lastMark`). The worker is online by this browser's clock, so the home turns it offline when its beats stop. Closing/covering
 *  the tab releases them all; returning keeps the last portfolio visible. Trading runs in the worker and does not depend on these UI
 *  subscriptions. */
const subscription = atom(get => {
  if (!get(currentUserIdAtom) || !convex) return empty;
  const client = convex, result = atom<HomeResult>(undefined), as = get(viewAsAtom);
  result.onMount = setResult => {
    const board = client.watchQuery(api.team.board, as), status = client.watchQuery(api.team.status, {}), flags = client.watchQuery(api.flags.current, {});
    let key: string | undefined, solUsd: number | undefined, soon: ReturnType<typeof setTimeout> | undefined, shown = false, home: HomeData | undefined;
    // `offline`: the timer that composes the home again when the last beat ages past WORKER_ONLINE_MS, at `offlineAt`.
    let offline: ReturnType<typeof setTimeout> | undefined, offlineAt = 0;
    // `late`: the next new board is a catch-up. `last`: the board last composed. `catchUp`: the catch-up board, while it is the latest.
    // `connections`: the socket's connection count at the last home.
    let late = true, last: unknown, catchUp: unknown, connections = client.connectionState().connectionCount;
    const startedAt = Date.now();
    let listening = false, topic: TeamFeed = null;
    let stopBoard: (() => void) | undefined, stopStatus: (() => void) | undefined, stopPrices: (() => void) | undefined, stopSol: (() => void) | undefined, stopFlags: (() => void) | undefined, stopTopic: (() => void) | undefined;
    // The topic's view, while it brings one, stands in for Convex's board and status, whose subscriptions rest meanwhile; a switch either
    // way makes the next board a catch-up.
    const follow = () => {
      const on = Boolean(flags.localQueryResult()?.topicAt);
      if (on && !stopTopic) stopTopic = watchTeam(() => client.action(api.team.gateway.token, as), feed => { topic = feed; follow(); update(); });
      if (!on && stopTopic) { stopTopic(); stopTopic = undefined; topic = null; }
      const fromConvex = !(topic && 'view' in topic);
      if (fromConvex && !stopBoard) { late = true; stopBoard = board.onUpdate(update); stopStatus = status.onUpdate(update); }
      if (!fromConvex && stopBoard) { late = true; stopBoard(); stopStatus?.(); stopBoard = stopStatus = undefined; }
    };
    const update = () => {
      clearTimeout(soon); soon = undefined;
      try {
        const view = topic && 'view' in topic ? topic.view as TeamView : undefined;
        const value = view ? view.board : board.localQueryResult(), live = view ? view.status : status.localQueryResult();
        if (value === undefined || live === undefined) return;
        if (value === null) { home = undefined; setResult(null); return; }
        if (live === null) return;
        // A new bag or ask changes the mints to watch; until their prices arrive the page shows the board with the prices it had.
        const addresses = homeAddresses(value), next = addresses.join(',');
        if (next !== key) { key = next; stopPrices?.(); stopPrices = watchPrices(addresses, tick); }
        const prices = Object.fromEntries(addresses.flatMap(address => { const mark = lastMark(address); return mark ? [[address, mark]] : []; }));
        // The first home waits up to FIRST_PRICES_MS for every shown coin's price, so no coin shows at its entry price while the socket opens.
        if (!shown && Object.keys(prices).length < addresses.length && Date.now() - startedAt < FIRST_PRICES_MS) { soon ??= setTimeout(update, startedAt + FIRST_PRICES_MS - Date.now()); return; }
        shown = true;
        // The new home keeps every part equal to the last one's objects, so rows whose coin did not move keep their identity and skip
        // rendering; a home equal to the last one (a SOL price push without a change, a tick of a coin not shown) renders nothing.
        const now = Date.now(), topicOn = Boolean(flags.localQueryResult()?.topicAt), count = client.connectionState().connectionCount;
        const composed = replaceEqualDeep(home, composeHome(value, { ...live, solUsd: solUsd ?? live.solUsd, prices }, now, topicOn));
        // A stopped worker sends no new status, so nothing else would compose the home when its last beat ages out.
        const until = live.worker.beatAt + WORKER_ONLINE_MS;
        if (until !== offlineAt) { clearTimeout(offline); offlineAt = until; offline = until > now ? setTimeout(() => { offlineAt = 0; update(); }, until - now) : undefined; }
        if (count !== connections) { connections = count; late = true; }
        // A new board settles whether it is a catch-up. The board and the status can land in one transition, and a price tick recomposes the
        // same board, so every home composed from a catch-up board carries the mark until the next board arrives.
        if (value !== last) { catchUp = late ? value : undefined; late = false; last = value; }
        if (value === catchUp) catchUps.add(composed);
        if (composed === home) return;
        home = composed;
        setResult(composed);
      } catch (error) { home = undefined; setResult(error instanceof Error ? error : new Error(String(error))); }
    };
    let frame: number | undefined;
    const tick = () => { frame ??= requestAnimationFrame(() => { frame = undefined; update(); }); };
    const stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(soon); clearTimeout(offline); soon = offline = frame = undefined; offlineAt = 0; listening = false; topic = null;
      stopFlags?.(); stopTopic?.(); stopBoard?.(); stopStatus?.(); stopPrices?.(); stopSol?.(); stopFlags = stopTopic = stopBoard = stopStatus = stopPrices = stopSol = key = undefined;
    };
    const visible = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (!listening) {
        listening = true; late = true;
        stopFlags = flags.onUpdate(follow); stopSol = watchSol(usd => { solUsd = usd; tick(); });
        follow();
        update();
      }
    };
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => { document.removeEventListener('visibilitychange', visible); stop(); };
  };
  return result;
});
const home = atom(get => get(get(subscription)));

export function useHome(enabled = true) {
  const preview = useMcpPreview();
  const result = useAtomValue(enabled && !preview ? home : empty);
  if (preview) return preview.loading ? undefined : preview.team;
  if (result instanceof Error) throw result;
  return result;
}
