// Operates only the local review page; the running server owns all provider credentials.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const output = process.argv[2] && resolve(process.argv[2]);
if (!output || process.argv.length < 3 || process.argv.length > 4 || !output.endsWith('.mp4')) throw new Error('Usage: node record.mjs /absolute/path/demo.mp4 [http://localhost:3000/muse-preview]');
const preview = join(dirname(output), `${basename(output, '.mp4')}-final.png`);
const timingFile = join(dirname(output), `${basename(output, '.mp4')}-timing.txt`);
if ([output, preview, timingFile].some(existsSync)) throw new Error('An output already exists. Choose a new recording filename.');
const page = new URL(process.argv[3] || 'http://localhost:3000/muse-preview');
if (page.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(page.hostname) || page.pathname !== '/muse-preview' || page.search || page.hash || page.username || page.password) throw new Error('Recording is limited to the local /muse-preview page.');
const pageUrl = page.href;
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(dirname(output), { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'hotbot-muse-record-'));
const profile = join(scratch, 'profile');
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
let launchError, ws, recording = false, sequence = 0;
chrome.once('error', error => { launchError = error; });
const sleep = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const now = () => Date.now() / 1000;
const pending = new Map(), shots = [], waits = [];
async function waitFor(check, label, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (launchError) throw new Error(`Chrome could not start: ${launchError.message}`);
    if (chrome.exitCode !== null) throw new Error('Chrome stopped before the recording finished.');
    const result = await check();
    if (result) return result;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}. No successful demo was produced.`);
}
function send(method, params = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); rejectCommand(new Error(`Chrome command timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error('The local review page could not complete a recording interaction.');
  return result.result?.value;
}
function cutSeconds(from, to) {
  let duration = Math.max(0, to - from);
  for (const wait of waits) {
    const overlap = Math.max(0, Math.min(to, wait.to) - Math.max(from, wait.from));
    duration -= overlap * (1 - 1 / Math.max(1, (wait.to - wait.from) / 4));
  }
  return duration;
}
async function ask(question) {
  const before = await evaluate(`document.querySelectorAll('#messages .message.assistant:not(.pending):not(.error)').length`);
  await evaluate(`document.querySelector('#message-input').focus()`);
  for (const character of question) { await send('Input.insertText', { text: character }); await sleep(26); }
  await sleep(500);
  const from = now();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(async () => {
    const error = await evaluate(`document.querySelector('#messages .message.error')?.textContent || ''`);
    if (error) throw new Error(`The real conversation failed: ${error}`);
    return evaluate(`document.querySelectorAll('#messages .message.assistant:not(.pending):not(.error)').length > ${before} && !document.querySelector('#message-input').disabled && !document.querySelector('#messages .message.pending')`);
  }, 'Muse’s real answer');
  const to = now();
  waits.push({ from, to, question });
}
async function openReceipt(scope) {
  const opened = await evaluate(`(() => { const receipt = document.querySelector(${JSON.stringify(scope)}); if (!receipt) return false; receipt.open = true; receipt.scrollIntoView({block:'center'}); return true; })()`);
  if (!opened) throw new Error('The real answer did not expose an expandable source record.');
}
try {
  const portFile = join(profile, 'DevToolsActivePort');
  const port = await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').split('\n')[0], 'Chrome startup', 15_000);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).then(response => response.json());
  const target = targets.find(item => item.type === 'page');
  if (!target) throw new Error('Chrome did not create a recording tab.');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error('Chrome connection timed out.')), 10_000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); rejectOpen(new Error('Chrome connection failed.')); }, { once: true });
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const command = pending.get(message.id); pending.delete(message.id); clearTimeout(command.timer);
      message.error ? command.reject(new Error(message.error.message)) : command.resolve(message.result);
    }
    if (message.method === 'Page.screencastFrame') {
      const file = join(scratch, `frame-${String(shots.length).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(message.params.data, 'base64')); shots.push({ file, at: now() });
      ws.send(JSON.stringify({ id: ++sequence, method: 'Page.screencastFrameAck', params: { sessionId: message.params.sessionId } }));
    }
  });
  ws.addEventListener('close', () => {
    for (const command of pending.values()) { clearTimeout(command.timer); command.reject(new Error('Chrome disconnected.')); }
    pending.clear();
  });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 4 / 3, mobile: false });
  await send('Page.enable'); await send('Page.navigate', { url: pageUrl });
  await waitFor(async () => {
    const error = await evaluate(`document.querySelector('[role="alert"]')?.textContent || ''`);
    if (/rejected|failed|unreadable|could not|unavailable/i.test(error)) throw new Error(error);
    return evaluate(`!!document.body?.textContent?.includes('Fresh Picks') && !!Array.from(document.querySelectorAll('[role="tab"]')).find(tab => tab.textContent.trim() === 'Chat')`);
  }, 'the real Fresh Picks portfolio');
  await send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 }); recording = true;
  await waitFor(() => shots.length, 'the first video frame', 10_000);
  await sleep(4000);
  const chatTab = await evaluate(`(() => { const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(tab => tab.textContent.trim() === 'Chat'); tab.scrollIntoView({block:'center'}); const rect = tab.getBoundingClientRect(); return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: chatTab.x, y: chatTab.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: chatTab.x, y: chatTab.y, button: 'left', clickCount: 1 });
  await waitFor(() => evaluate(`!!document.querySelector('[data-muse-chat] #message-input')`), 'the native Muse chat');
  await evaluate(`document.querySelector('[data-muse-chat]').scrollIntoView({block:'start'})`);
  await sleep(2000);
  await ask('The journal passed on ELEVEN, then bought it about five minutes later. Compare both records: what evidence differs, and can those records explain the reversal? Cite the full records.');
  await sleep(12_000);
  await evaluate(`(() => { const activity = document.querySelector('#messages [data-muse-turn]:last-child [data-muse-activity]'); if (!activity) throw new Error('No real tool activity'); activity.open = true; const read = activity.querySelector('[data-muse-tool]'); if (read) read.open = true; activity.scrollIntoView({block:'center'}); })()`);
  await sleep(8000);
  await evaluate(`document.querySelector('#messages [data-muse-turn]:last-child [data-muse-activity]').open = false`);
  await openReceipt('#messages .message.assistant:last-child .receipt');
  await sleep(14_000);
  await ask('Can I require my approval before the next buy? Draft the closest supported setting change, show its current value and source, and explain what else it affects.');
  const proposal = await evaluate(`!!document.querySelector('#messages .message.assistant:last-child .proposal')`);
  if (!proposal) throw new Error('Muse did not support a concrete proposal. Review the real result; do not substitute a staged proposal.');
  await evaluate(`document.querySelector('#messages .message.assistant:last-child .proposal').scrollIntoView({block:'center'})`);
  await sleep(17_000);
  await openReceipt('#messages .message.assistant:last-child .proposal .receipt');
  await sleep(14_000);
  await evaluate(`(() => { const proposal = document.querySelector('#messages .message.assistant:last-child .proposal'); proposal.querySelectorAll('.receipt').forEach(receipt => { receipt.open = false; }); proposal.scrollIntoView({block:'center'}); })()`);
  const elapsed = cutSeconds(shots[0].at, now());
  await sleep(Math.max(12_000, (93 - elapsed) * 1000));
  const final = await send('Page.captureScreenshot', { format: 'png' });
  const finalFrame = join(scratch, 'final.png'); writeFileSync(finalFrame, Buffer.from(final.data, 'base64'));
  shots.push({ file: finalFrame, at: now() });
  await send('Page.stopScreencast'); recording = false;
  const origin = shots[0].at;
  const quote = path => path.replaceAll("'", "'\\''");
  const concat = shots.map((shot, index) => `file '${quote(shot.file)}'\nduration ${Math.max(.001, cutSeconds(shot.at, shots[index + 1]?.at ?? shot.at + 1)).toFixed(6)}`).join('\n') + `\nfile '${quote(finalFrame)}'\n`;
  const listFile = join(scratch, 'frames.txt'); writeFileSync(listFile, concat);
  const duration = Math.min(170, cutSeconds(origin, shots.at(-1).at) + 1).toFixed(3);
  const encoded = spawnSync('ffmpeg', ['-n', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-t', duration, '-movflags', '+faststart', output], { timeout: 180_000 });
  if (encoded.error || encoded.status !== 0) throw new Error(`Video encoding failed: ${encoded.error?.message ?? String(encoded.stderr)}`);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output], { timeout: 10_000 });
  const seconds = Number(String(probe.stdout));
  if (probe.status !== 0 || !Number.isFinite(seconds) || seconds < 90 || seconds > 170.1) throw new Error('The rendered video did not pass the 90–170 second duration check.');
  writeFileSync(preview, Buffer.from(final.data, 'base64'), { flag: 'wx' });
  const timing = ['Actual native HOTBOT portfolio UI with Muse conversation.', `Local page: ${pageUrl}`, 'Silent recording. No overlays, promo cards, injected UI, or staged answers.', 'Only model waiting intervals are shortened to at most four seconds each. All other actions retain their recorded timing.', '', ...waits.flatMap((wait, index) => [`Question ${index + 1}: ${wait.question}`, `Actual model wait: ${(wait.to - wait.from).toFixed(2)} seconds. Video wait: ${cutSeconds(wait.from, wait.to).toFixed(2)} seconds.`, `Video interval: ${cutSeconds(origin, wait.from).toFixed(2)}–${cutSeconds(origin, wait.to).toFixed(2)} seconds.`, '']), `Final duration: ${seconds.toFixed(2)} seconds. Paper activity; the proposal remains unapplied.`].join('\n');
  writeFileSync(timingFile, timing, { flag: 'wx' });
  process.stdout.write(`Recorded ${output}\nFinal screenshot ${preview}\nTiming disclosure ${timingFile}\n${seconds.toFixed(1)} seconds · 1920×1080 · silent · no overlays\n`);
} finally {
  if (recording && ws?.readyState === WebSocket.OPEN) await send('Page.stopScreencast').catch(() => {});
  ws?.close(); chrome.kill(); await sleep(250); if (chrome.exitCode === null) chrome.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
}
