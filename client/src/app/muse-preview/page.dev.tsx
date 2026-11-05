"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMcpPreview } from '@/components/team/McpPreviewProvider';
import { PortfolioView } from '@/components/team/Portfolios';
import { MusePortfolioChat } from '@/components/team/MusePortfolioChat';
import { Loading } from '@/components/team/Parts';
import { Button } from '@/components/ui/button';
import { adaptMusePortfolioSnapshot, type MusePortfolioSnapshot } from '@/lib/musePortfolio';
import { usePlace } from '@/lib/appNavigation';
import s from '@/components/team/team.module.css';

/** The shipped portfolio UI, reading the same paper portfolio through HOTBOT MCP. */
export default function MusePreviewPage() {
  return <Suspense fallback={<div className={s.page}><Loading variant="page"/></div>}><MusePreviewContent/></Suspense>;
}
function MusePreviewContent() {
  const preview = useMcpPreview();
  const requested = useSearchParams().get('portfolioId');
  const [snapshot, setSnapshot] = useState<MusePortfolioSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const openSettings = useRef<(() => void) | null>(null);
  const rememberSettings = useCallback((open: () => void) => { openSettings.current = open; }, []);
  const portfolioId = requested ? preview?.portfolios.find(row => row.id === requested)?.id : preview?.portfolios[0]?.id;
  usePlace(snapshot?.data.name);
  useEffect(() => {
    if (!portfolioId) return;
    const controller = new AbortController();
    setSnapshot(null); setError(null);
    void fetch('/api/muse/portfolio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portfolioId }), signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Could not read this portfolio.'); return adaptMusePortfolioSnapshot(body); })
      .then(value => { if (!controller.signal.aborted) setSnapshot(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read this portfolio.'); });
    return () => controller.abort();
  }, [portfolioId, retry]);
  const problem = error ?? preview?.error;
  if (problem) return <div className={s.page}><p role="alert">{problem}</p><Button onClick={() => { setRetry(value => value + 1); void preview?.refresh(); }}>Retry connection</Button></div>;
  if (preview && !preview.loading && !portfolioId) return <div className={s.page}><p className={s.empty}>{requested ? 'This portfolio is not in the connected account.' : 'There are no paper portfolios to review in this account.'}</p></div>;
  if (!snapshot) return <div className={s.page}><Loading variant="page" label="Reading the paper portfolio through HOTBOT MCP"/></div>;
  return <>
    <div className="px-5 pt-3 text-xs text-muted-foreground" data-muse-build>Local build · real paper portfolio · Muse Spark 1.3</div>
    <PortfolioView key={snapshot.data.id} data={snapshot.data} readOnlyPreview onReviewSettingsReady={rememberSettings}
      chatContent={<MusePortfolioChat portfolioId={snapshot.data.id} name={snapshot.data.name} onReviewSettings={() => openSettings.current?.()}/>}/>
  </>;
}
