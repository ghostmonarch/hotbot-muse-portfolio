"use client";

import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import type { HomeData } from './data';
import type { Card } from './Portfolios';

export const isMcpPreviewPath = (pathname: string) => pathname === '/muse-preview' || pathname === '/muse-preview/';

export type McpPreviewPortfolio = Pick<Card, 'id' | 'name' | 'summary' | 'status' | 'startSol' | 'valueSol' | 'asks'> & { coins: { address: string; symbol: string; exitedAt?: number }[] };
type PreviewData = { team: HomeData | null; portfolios: McpPreviewPortfolio[]; readAt: string | null };
export type McpPreviewContextValue = PreviewData & {
  loading: boolean;
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const Context = createContext<McpPreviewContextValue | null>(null);
export const useMcpPreview = () => useContext(Context);

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
/** MCP marks display strings as untrusted. Unwrap their location, never interpret them as markup or instructions. */
function displayData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(displayData);
  if (!object(value)) return value;
  const entries = Object.entries(value).filter(([key]) => !['untrusted', '__proto__', 'constructor', 'prototype'].includes(key));
  if (object(value.untrusted)) for (const [key, item] of Object.entries(value.untrusted)) if (!Object.hasOwn(value, key) && !['__proto__', 'constructor', 'prototype'].includes(key)) entries.push([key, item]);
  return Object.fromEntries(entries.map(([key, item]) => [key, displayData(item)]));
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function portfolioOf(value: unknown): McpPreviewPortfolio {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.summary !== 'string' || typeof value.status !== 'string' || !['running', 'paused', 'stopped', 'picking', 'archived'].includes(value.status) || !finite(value.startSol) || !finite(value.worthSol) || !finite(value.openAsks) || !Array.isArray(value.coins)) throw new Error('HOTBOT supplied an incomplete portfolio list.');
  const coins = value.coins.map(coin => {
    if (!object(coin) || typeof coin.address !== 'string' || typeof coin.symbol !== 'string') throw new Error('HOTBOT supplied an incomplete portfolio coin.');
    return { address: coin.address, symbol: coin.symbol };
  });
  return { id: value.id as Card['id'], name: value.name, summary: value.summary, status: value.status as Card['status'], startSol: value.startSol, valueSol: value.worthSol, asks: value.openAsks, coins };
}

/** A local read transport for the existing UI. It supplies no Convex identity or write capability. */
export function McpPreviewProvider({ children }: PropsWithChildren) {
  const [data, setData] = useState<PreviewData>({ team: null, portfolios: [], readAt: null });
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/muse/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cache: 'no-store' });
      const value = displayData(await response.json());
      if (!object(value)) throw new Error('The HOTBOT context was incomplete.');
      if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'The HOTBOT context could not be read.');
      if (!object(value.team) || !value.team.workspace || !Array.isArray(value.team.strategies) || !Array.isArray(value.team.bags) || !Array.isArray(value.team.needs) || !Array.isArray(value.team.watching) || !Array.isArray(value.team.researching) || !Array.isArray(value.portfolios) || typeof value.readAt !== 'string') throw new Error('The HOTBOT context was incomplete.');
      // get_team retains HomeData's display fields but replaces editable rules with settings.
      // The preview never opens those editors or invokes their actions.
      setData({ team: value.team as HomeData, portfolios: value.portfolios.map(portfolioOf), readAt: value.readAt });
    } catch (cause) {
      setData({ team: null, portfolios: [], readAt: null });
      setError(cause instanceof Error ? cause.message : 'The HOTBOT context could not be read.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Context.Provider value={{ ...data, loading, error, ready: Boolean(data.team && !error), refresh }}>{children}</Context.Provider>;
}
