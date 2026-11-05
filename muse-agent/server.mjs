import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { McpClient, MODEL, UserError, object, runConversation, stripBaselines, validateChatInput } from './agent.mjs';

const PUBLIC = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const MAX_BODY = 64_000;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
export function createApp({ metaApiKey = process.env.MODEL_API_KEY || '', hotbotToken = process.env.HOTBOT_MCP_TOKEN || process.env.HOTBOT_KEY || '', fetchImpl = fetch } = {}) {
  const config = { metaApiKey, hotbotToken };
  let busy = false;
  const status = () => ({ configured: Boolean(config.metaApiKey && config.hotbotToken), metaConfigured: Boolean(config.metaApiKey), hotbotConfigured: Boolean(config.hotbotToken), model: MODEL });
  return http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403).end(); return; }
    const origin = `http://${host}`;
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    const json = (code, body) => { res.writeHead(code, { ...headers, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url || '/', origin);
      if (req.method === 'GET' && url.pathname === '/api/status') return json(200, status());
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return json(403, { error: 'Open this page directly on localhost to continue.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Send JSON.' });
        let bytes = 0, bodyText = '';
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_BODY) return json(413, { error: 'This request was too large.' });
          bodyText += chunk.toString();
        }
        let body;
        try { body = JSON.parse(bodyText); } catch { return json(400, { error: 'The request was not valid JSON.' }); }
        if (!object(body)) return json(400, { error: 'Send a JSON object.' });
        if (url.pathname === '/api/config') {
          if (busy) return json(409, { error: 'Wait for the current conversation to finish.' });
          for (const name of ['metaApiKey', 'hotbotToken']) {
            if (body[name] !== undefined) {
              if (typeof body[name] !== 'string' || body[name].length > 8_000 || /[\r\n]/.test(body[name])) return json(400, { error: 'The connection value was not valid.' });
            }
          }
          for (const name of ['metaApiKey', 'hotbotToken']) if (body[name] !== undefined) config[name] = body[name].trim();
          return json(200, status());
        }
        if (url.pathname === '/api/portfolios') {
          if (!config.hotbotToken) return json(409, { error: 'Connect HOTBOT first.' });
          const client = await new McpClient(config.hotbotToken, fetchImpl).initialize();
          const result = await client.call('list_portfolios', {});
          return json(200, { portfolios: Array.isArray(result.portfolios) ? result.portfolios : [], readAt: new Date().toISOString() });
        }
        if (url.pathname === '/api/portfolio') {
          if (typeof body.portfolioId !== 'string' || !/^[A-Za-z0-9_-]{3,120}$/.test(body.portfolioId)) return json(400, { error: 'Select one valid portfolio.' });
          if (!config.hotbotToken) return json(409, { error: 'Connect HOTBOT first.' });
          const client = await new McpClient(config.hotbotToken, fetchImpl).initialize();
          const portfolio = await client.call('get_portfolio', { portfolioId: body.portfolioId, limit: 50 }, body.portfolioId);
          return json(200, { portfolio, readAt: new Date().toISOString() });
        }
        if (url.pathname === '/api/context') {
          if (!config.hotbotToken) return json(409, { error: 'Connect HOTBOT first.' });
          const client = await new McpClient(config.hotbotToken, fetchImpl).initialize();
          // This fixed UI read is not exposed to Muse and does not expand the conversation allowlist.
          const [teamRead, portfolioRead] = await Promise.all([
            client.rpc('tools/call', { name: 'get_team', arguments: {} }),
            client.call('list_portfolios', {}),
          ]);
          if (teamRead?.isError) throw new UserError('HOTBOT could not supply the team context.');
          let team;
          if (teamRead?.structuredContent !== undefined) team = stripBaselines(teamRead.structuredContent);
          else {
            const contents = (teamRead?.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
            try { team = stripBaselines(JSON.parse(contents)); }
            catch { throw new UserError('HOTBOT returned team context that could not be inspected as structured data.'); }
          }
          return json(200, { team, portfolios: Array.isArray(portfolioRead.portfolios) ? portfolioRead.portfolios : [], readAt: new Date().toISOString() });
        }
        if (url.pathname === '/api/chat') {
          validateChatInput(body);
          if (!status().configured) return json(409, { error: 'Connect Meta and HOTBOT first.' });
          if (busy) return json(409, { error: 'A conversation is already running.' });
          busy = true;
          const controller = new AbortController();
          const disconnected = () => { if (!res.writableEnded) controller.abort(); };
          res.once('close', disconnected);
          res.writeHead(200, { ...headers, 'content-type': 'application/x-ndjson; charset=utf-8', 'x-accel-buffering': 'no' });
          const emit = event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
          try {
            await runConversation({ ...config, portfolioId: body.portfolioId, messages: body.messages, emit, fetchImpl, signal: controller.signal });
          } catch (error) { emit({ type: 'error', message: error instanceof UserError ? error.message : 'The conversation stopped. No settings were changed.' }); }
          finally { busy = false; res.removeListener('close', disconnected); res.end(); }
          return;
        }
        return json(404, { error: 'This endpoint is unavailable.' });
      }
      if (req.method !== 'GET') return json(405, { error: 'This method is unavailable.' });
      const pathname = decodeURIComponent(url.pathname);
      const file = resolve(PUBLIC, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!file.startsWith(PUBLIC + sep) && file !== resolve(PUBLIC, 'index.html')) return json(404, { error: 'Not found.' });
      const extension = file.slice(file.lastIndexOf('.'));
      if (!Object.hasOwn(MIME, extension)) return json(404, { error: 'Not found.' });
      try {
        const data = await readFile(file);
        res.writeHead(200, { ...headers, 'content-type': MIME[extension] });
        res.end(data);
      } catch { return json(404, { error: 'Not found.' }); }
    } catch (error) {
      if (!res.headersSent) json(error instanceof UserError ? 400 : 500, { error: error instanceof UserError ? error.message : 'The request could not be completed.' });
      else res.end();
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = createApp();
  server.listen(3817, '127.0.0.1', () => process.stdout.write('Muse portfolio is ready at http://127.0.0.1:3817\n'));
}
