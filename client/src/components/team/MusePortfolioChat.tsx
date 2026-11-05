"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, FileText, LoaderCircle, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { BotAvatar } from '@/components/hotbot/BotAvatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AUTONOMY_TEXT, LIMIT_TEXT, SettingName } from './Portfolios';
import { sol } from './format';
import s from './team.module.css';
import m from './MusePortfolioChat.module.css';

type Receipt = { toolCallId: string; tool: string; path: string; value: unknown; readAt: string; claim?: string };
type Setting = 'autonomy' | 'perCoinSol' | 'tradesPerDay';
type Proposal = { title: string; field: Setting; current: number | string; proposed: number | string; reason: string; tradeoff: string; effects?: string; definitionUrl?: string; sourceRefs: Receipt[]; portfolioId: string };
type Read = { id: string; tool: string; args?: unknown; result?: unknown; readAt?: string; error?: string; pending: boolean };
type Turn = { id: string; question: string; answer?: string; sources: Receipt[]; reads: Read[]; proposal?: Proposal; notices: string[]; error?: string; complete?: boolean };
type Message = { role: 'user' | 'assistant'; content: string };
type Props = { portfolioId: string; name: string; onReviewSettings?: () => void };
type Event = { type: string; id?: string; tool?: string; args?: unknown; result?: unknown; readAt?: string; text?: string; message?: string; error?: string | { message?: string }; sources?: Receipt[]; sourceWarning?: string; proposal?: Proposal };

const INITIAL = 'Review this portfolio’s instructions and recent activity. Check whether its activity matches the original plan, with evidence. Do not assume there is a mismatch.';
const FOLLOW_UP = 'I want to check in less often. Draft one small change to the current settings, explain the tradeoff, and show the source for the current value. Propose nothing if the record does not support a change.';
const pretty = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'Not provided';
const readName = (tool: string) => tool === 'get_portfolio' ? 'Portfolio & journal' : tool === 'get_reference' ? 'Setting definitions' : tool.replaceAll('_', ' ');
const time = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not provided';
const isReceipt = (value: Receipt) => value && typeof value.toolCallId === 'string' && typeof value.path === 'string';

function Sources({ records }: { records: Receipt[] }) {
  if (!records.length) return null;
  return <div className={m.sources} aria-label="Source records">{records.filter(isReceipt).map((record, index) => <details className={`${m.receipt} receipt`} key={`${record.toolCallId}:${record.path}:${index}`} data-muse-receipt>
    <summary><FileText aria-hidden/>Source record {index + 1}</summary>
    <dl>
      {record.claim && <><dt>Claim</dt><dd>{record.claim}</dd></>}
      <dt>Tool</dt><dd><code>{record.tool}</code></dd>
      <dt>Exact field</dt><dd><code>{record.path}</code></dd>
      <dt>Value</dt><dd><pre>{pretty(record.value)}</pre></dd>
      <dt>Read at</dt><dd><time dateTime={record.readAt}>{time(record.readAt)}</time></dd>
      <dt>Call ID</dt><dd><code>{record.toolCallId}</code></dd>
    </dl>
  </details>)}</div>;
}

function ReadRecord({ read }: { read: Read }) {
  const [open, setOpen] = useState(false);
  return <details className={`${m.read} tool-call`} onToggle={event => setOpen(event.currentTarget.open)} data-muse-tool={read.tool}>
    <summary>{read.pending ? <LoaderCircle className="animate-spin" aria-hidden/> : read.error ? <X aria-hidden/> : <Check aria-hidden/>}<span>{readName(read.tool)}</span><small>{read.pending ? 'Reading…' : read.error ? 'Read failed' : 'Read complete'}</small></summary>
    {open && <div className={m.readBody}>
      <small>{time(read.readAt)} · <code>{read.id}</code></small>
      <b>Request</b><pre>{pretty(read.args ?? {})}</pre>
      {read.error ? <p role="alert">{read.error}</p> : <><b>Result</b><pre>{pretty(read.result)}</pre></>}
    </div>}
  </details>;
}

function Activity({ reads }: { reads: Read[] }) {
  if (!reads.length) return null;
  return <details className={m.activity} data-muse-activity>
    <summary><FileText aria-hidden/>Muse read {reads.some(read => read.tool === 'get_reference') ? 'the portfolio & settings' : 'the portfolio & journal'}<small>{reads.length} {reads.length === 1 ? 'read' : 'reads'}</small></summary>
    <div className={m.reads}>{reads.map(read => <ReadRecord key={read.id} read={read}/>)}</div>
  </details>;
}

function settingValue(field: Setting, value: number | string) {
  if (field === 'autonomy' && typeof value === 'string' && Object.hasOwn(AUTONOMY_TEXT, value)) return AUTONOMY_TEXT[value as keyof typeof AUTONOMY_TEXT].label;
  return field === 'perCoinSol' && typeof value === 'number' ? sol(value, 2) : String(value);
}
function definitionLink(value?: string) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/0xwhoismax/hotbot/blob/') ? url.href : null; } catch { return null; }
}

function ProposalCard({ proposal, onReviewSettings }: { proposal: Proposal; onReviewSettings?: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const definition = definitionLink(proposal.definitionUrl), setting = LIMIT_TEXT[proposal.field];
  if (!setting) return null;
  return <ul className={s.folioOffers} aria-label="Muse proposal"><li className={`${s.folioOffer} proposal`} data-state={dismissed ? 'dismissed' : 'open'} data-muse-proposal>
    <span className={s.folioOfferIcon} aria-hidden><SlidersHorizontal/></span>
    <div className={s.folioOfferBody}>
      <b>{proposal.title}</b>
      <span className={m.proposalStatus}>{dismissed ? 'Dismissed in this chat' : 'Proposed · awaiting your review'}</span>
      <span className={m.settingName}><SettingName name={setting.label} note={setting.note}/></span>
      <span className={s.folioOfferValues}><span><small>Current</small><b>{settingValue(proposal.field, proposal.current)}</b></span><span><small>Proposed</small><b>{settingValue(proposal.field, proposal.proposed)}</b></span></span>
      <p className={m.proposalText}><b>Why:</b> {proposal.reason}</p>
      <p className={m.proposalText}><b>Tradeoff:</b> {proposal.tradeoff}</p>
      {proposal.effects && <p className={m.proposalText}><b>What this affects:</b> {proposal.effects}</p>}
      {definition && <a className={m.definition} href={definition} target="_blank" rel="noopener noreferrer">View setting definition</a>}
      <Sources records={proposal.sourceRefs ?? []}/>
    </div>
    <span className={s.folioOfferFoot}>{!dismissed && <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setDismissed(true)}><X/>Dismiss</Button>
      {onReviewSettings && <Button type="button" size="sm" variant="secondary" onClick={onReviewSettings}><SlidersHorizontal/>Review settings</Button>}
    </>}</span>
  </li></ul>;
}

function historyOf(turns: Turn[], question: string): Message[] {
  const history: Message[] = turns.filter(turn => turn.answer && !turn.error).slice(-5).flatMap(turn => [{ role: 'user' as const, content: turn.question }, { role: 'assistant' as const, content: turn.answer! }]);
  history.push({ role: 'user', content: question });
  while (history.length > 1 && history.reduce((total, message) => total + message.content.length, 0) > 30_000) history.splice(0, 2);
  return history;
}

export function MusePortfolioChat({ portfolioId, name, onReviewSettings }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]), [text, setText] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const thread = useRef<HTMLDivElement>(null), request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setTurns([]); setText(''); setBusy(false); setProgress('');
    return () => { request.current?.abort(); request.current = null; };
  }, [portfolioId]);
  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'auto' });
  }, [turns, busy]);

  const submit = async (value: string) => {
    const question = value.trim();
    if (!question || question.length > 8_000 || request.current) return;
    const controller = new AbortController(), id = crypto.randomUUID(); request.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 180_000);
    const active = () => request.current === controller;
    const update = (change: (turn: Turn) => Turn) => { if (active()) setTurns(previous => previous.map(turn => turn.id === id ? change(turn) : turn)); };
    setText(''); setBusy(true); setProgress('Muse is reading the portfolio…');
    setTurns(previous => [...previous.slice(-11), { id, question, sources: [], reads: [], notices: [] }]);
    let completed = false;
    const accept = (event: Event) => {
      if (!active()) return;
      if (event.type === 'tool_start') {
        setProgress(`Muse is reading ${readName(event.tool ?? 'portfolio').toLowerCase()}…`);
        update(turn => ({ ...turn, reads: [...turn.reads, { id: event.id ?? crypto.randomUUID(), tool: event.tool ?? 'get_portfolio', args: event.args, pending: true }] }));
      } else if (event.type === 'tool_end' || event.type === 'tool_error') {
        update(turn => ({ ...turn, reads: turn.reads.map(read => read.id === event.id ? { ...read, pending: false, result: event.result, readAt: event.readAt, error: event.type === 'tool_error' ? event.message ?? 'The read did not complete.' : undefined } : read) }));
        setProgress('Muse is reviewing the source records…');
      } else if (event.type === 'answer') {
        update(turn => ({ ...turn, answer: event.text ?? '', sources: Array.isArray(event.sources) ? event.sources : [], notices: event.sourceWarning ? [...turn.notices, event.sourceWarning] : turn.notices }));
      } else if (event.type === 'proposal' && event.proposal?.portfolioId === portfolioId) update(turn => ({ ...turn, proposal: event.proposal }));
      else if (event.type === 'notice') update(turn => ({ ...turn, notices: [...turn.notices, event.text ?? event.message ?? 'Some source records could not be matched.'] }));
      else if (event.type === 'error') throw new Error(event.message ?? (typeof event.error === 'string' ? event.error : event.error?.message) ?? 'Muse could not finish the review.');
      else if (event.type === 'done') { completed = true; update(turn => ({ ...turn, complete: true })); }
    };
    try {
      const response = await fetch('/api/muse/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolioId, messages: historyOf(turns, question) }), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(typeof failure.error === 'string' ? failure.error : failure.error?.message ?? failure.message ?? `Muse could not complete the request (${response.status}).`);
      }
      if (!response.body) throw new Error('Muse returned no response stream.');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', bytes = 0;
      try {
        while (true) {
          const { value: chunk, done } = await reader.read();
          bytes += chunk?.byteLength ?? 0;
          if (bytes > 4_000_000) throw new Error('The review returned too much data. Ask a narrower question.');
          buffer += decoder.decode(chunk, { stream: !done });
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) accept(JSON.parse(line) as Event);
          if (done) break;
        }
        if (buffer.trim()) accept(JSON.parse(buffer) as Event);
        if (!completed) throw new Error('The response ended before Muse finished. Try again.');
      } finally { await reader.cancel().catch(() => {}); }
    } catch (cause) {
      if (active()) {
        const error = controller.signal.aborted ? 'The review timed out. No settings were changed.' : cause instanceof Error ? cause.message : 'Muse could not finish this review.';
        update(turn => ({ ...turn, error, reads: turn.reads.map(read => read.pending ? { ...read, pending: false, error: 'Read interrupted' } : read) }));
      }
    } finally {
      clearTimeout(timeout);
      if (active()) { request.current = null; setBusy(false); setProgress(''); }
    }
  };

  return <section className={`${s.surface} ${s.folioChat}`} aria-label={`Muse chat about ${name}`} data-muse-chat>
    <div className={m.header}><span>Muse Spark 1.3</span><small title="The selected portfolio records and this conversation are sent to Meta Model API. This chat cannot change settings or trade.">Paper · reads only</small></div>
    <div id="messages" ref={thread} className={s.folioChatThread} role="log" aria-live="polite" aria-busy={busy}>
      {turns.length === 0 ? <div className={s.folioChatEmpty}>
        <BotAvatar role="coordinator" size={56}/><b>Ask Muse about {name}</b>
        <span className={s.folioChatAsks}><Button type="button" size="sm" variant="secondary" className="rounded-full" onClick={() => void submit(INITIAL)}>Does the activity match my plan?</Button></span>
      </div> : turns.map(turn => <div className={s.folioChatPages} key={turn.id} data-muse-turn>
        <p className={`${s.folioChatMine} message user`}>{turn.question}</p>
        {turn.answer && <div className={`${s.folioChatAgent} message assistant`}>
          <BotAvatar role="coordinator" size={28}/><div>
            <span className={m.agentName}>Muse Spark 1.3</span><p>{turn.answer}</p>
            <Sources records={turn.sources}/><Activity reads={turn.reads}/>
            {turn.proposal && <ProposalCard proposal={turn.proposal} onReviewSettings={onReviewSettings}/>}
            {turn.notices.map((notice, index) => <p className={m.notice} key={index}>{notice}</p>)}
            {turn.complete && !turn.proposal && <Button type="button" size="sm" variant="ghost" className={m.followup} disabled={busy} onClick={() => void submit(FOLLOW_UP)}>What could I change to check in less often?</Button>}
          </div>
        </div>}
        {turn.error && <div className={`${s.folioChatError} message error`} role="alert"><span>{turn.error}</span><Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void submit(turn.question)}><RotateCcw/>Try again</Button></div>}
      </div>)}
      {busy && <div className={`${s.folioChatAgent} message assistant pending`} role="status"><BotAvatar role="coordinator" size={28} mood="scan"/><div><span className={m.progress}>{progress}</span><span className={s.folioChatTyping} aria-hidden><i/><i/><i/></span></div></div>}
    </div>
    <form className={s.chatComposer} onSubmit={event => { event.preventDefault(); void submit(text); }}>
      <Textarea id="message-input" variant="composer" value={text} maxLength={8_000} placeholder={`Ask Muse about ${name}…`} aria-label="Message Muse"
        onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(text); } }}/>
      <div className={s.composerTools}><span className={m.composerNote}>Proposals stay unapplied</span><Button type="submit" size="icon" className="rounded-full" aria-label="Send to Muse" title="Send to Muse" disabled={!text.trim() || busy}>{busy ? <LoaderCircle className="animate-spin"/> : <ArrowUp/>}</Button></div>
    </form>
  </section>;
}
