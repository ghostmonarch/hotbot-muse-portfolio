import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UPSTREAM = 'http://127.0.0.1:3817';
const ALLOWED = new Set(['context', 'portfolio', 'portfolios', 'chat']);

/** Development-only transport. Credentials remain in the loopback Muse process. */
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || origin !== `http://${host}` || (site && site !== 'same-origin')) {
    return Response.json({ error: 'Open this local build directly in your browser.' }, { status: 403 });
  }
  if (!ALLOWED.has(action)) return Response.json({ error: 'Unavailable endpoint.' }, { status: 404 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Send JSON.' }, { status: 415 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 64_000) { await reader.cancel(); return Response.json({ error: 'Request too large.' }, { status: 413 }); }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { body.set(chunk, at); at += chunk.byteLength; }
  try {
    const upstream = await fetch(`${UPSTREAM}/api/${action}`, {
      method: 'POST', body, cache: 'no-store',
      headers: { 'content-type': 'application/json', origin: UPSTREAM, 'sec-fetch-site': 'same-origin' },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(190_000)]),
    });
    return new Response(upstream.body, { status: upstream.status, headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no',
    } });
  } catch {
    return Response.json({ error: 'The local Muse service is unavailable. Start muse-agent/server.mjs and retry.' }, { status: 502 });
  }
}
