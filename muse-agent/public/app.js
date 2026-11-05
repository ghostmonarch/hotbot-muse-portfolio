'use strict';

const $ = (selector) => document.querySelector(selector);
const elements = {
  connectionButton: $('#connection-button'), connectionDot: $('#connection-dot'), connectionLabel: $('#connection-label'),
  modelName: $('#model-name'), select: $('#portfolio-select'), summary: $('#portfolio-summary'), context: $('#portfolio-context'),
  welcome: $('#welcome'), messages: $('#messages'), scroll: $('#conversation-scroll'), form: $('#chat-form'), input: $('#message-input'),
  send: $('#send-button'), progress: $('#progress-line'), progressLabel: $('#progress-label'), sources: $('#tool-list'),
  sourceCount: $('#source-count'), evidenceEmpty: $('#evidence-empty'), dialog: $('#setup-dialog'), configForm: $('#config-form'),
  metaKey: $('#meta-api-key'), hotbotToken: $('#hotbot-token'), configError: $('#config-error'), connectSubmit: $('#connect-submit'),
};
const state = { status: {}, portfolios: [], portfolioId: '', messages: [], tools: new Map(), busy: false, pending: null, hotbotReady: false };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}
function pretty(value) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
function errorText(error) { return error instanceof Error ? error.message : String(error); }
function portfolioId(portfolio) { return String(portfolio.id ?? portfolio._id ?? portfolio.portfolioId ?? ''); }
function selectedPortfolio() { return state.portfolios.find((portfolio) => portfolioId(portfolio) === state.portfolioId); }
function clockTime(value) {
  const date = new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function timestamp(value) {
  const date = new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toISOString();
}
function progress(text, busy = false) {
  elements.progressLabel.textContent = text;
  elements.progress.classList.toggle('busy', busy);
  elements.progress.classList.toggle('ready', !busy && Boolean(state.portfolioId));
}
async function request(path, body) {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error(`The server returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(result.error?.message ?? result.error ?? result.message ?? `Request failed (${response.status}).`);
  return result;
}
function setBusy(busy) {
  state.busy = busy;
  const canChat = Boolean(state.status.configured && state.portfolioId);
  elements.input.disabled = busy || !canChat;
  elements.send.disabled = busy || !canChat || !elements.input.value.trim();
  elements.select.disabled = busy || !state.portfolios.length;
  for (const button of document.querySelectorAll('.starter, .followup-button')) button.disabled = busy;
}
function scrollConversation() { elements.scroll.scrollTop = elements.scroll.scrollHeight; }
function addMessage(role, text, extraClass = '') {
  elements.welcome.hidden = true;
  const article = node('article', `message ${role} ${extraClass}`.trim());
  const header = node('div', 'message-header');
  header.append(node('span', 'message-avatar', role === 'user' ? 'You' : 'M'));
  header.append(node('span', '', role === 'user' ? 'You' : 'Muse'));
  const time = node('time', '', clockTime());
  time.dateTime = timestamp();
  header.append(time);
  const content = node('div', 'message-content', text);
  article.append(header, content);
  elements.messages.append(article);
  scrollConversation();
  return { article, content };
}
function pendingMessage(text) {
  if (!state.pending) state.pending = addMessage('assistant', text, 'pending');
  else state.pending.content.textContent = text;
}
function clearPending() {
  if (state.pending) state.pending.article.remove();
  state.pending = null;
}
function unwrapToolResult(result) {
  let value = result;
  if (value?.content && Array.isArray(value.content)) {
    const text = value.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    try { value = JSON.parse(text); } catch { return value; }
  }
  return value;
}
function contextBlock(title) {
  const block = node('section', 'context-block');
  block.append(node('h3', '', title));
  return block;
}
function contextRow(label, value) {
  const row = node('div', 'context-row');
  row.append(node('span', '', label), node('span', '', value));
  return row;
}
function formatted(value, unit = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}` : value;
}
function renderContext(data = selectedPortfolio()) {
  if (!data) return;
  const portfolio = data.portfolio ?? data;
  const mandate = portfolio.mandate ?? {};
  elements.summary.textContent = portfolio.summary ?? mandate.summary ?? mandate.words ?? 'Ask Muse to read this portfolio’s full context.';
  elements.context.replaceChildren();
  const instructions = mandate.words ?? portfolio.words;
  if (instructions) {
    const block = contextBlock('Your instructions');
    block.append(node('p', '', instructions));
    elements.context.append(block);
  }
  const details = contextBlock('Portfolio');
  const pairs = [
    ['Status', portfolio.status], ['Starting paper budget', formatted(portfolio.startSol ?? mandate.budgetSol, ' SOL')],
    ['Approval mode', ({ ask: 'Ask me first', limits: 'Within limits', full: 'Full autonomy' })[mandate.autonomy ?? portfolio.autonomy]],
    ['Coins', mandate.coins],
  ];
  for (const [label, value] of pairs) if (value !== undefined && value !== null) details.append(contextRow(label, value));
  if (details.children.length > 1) elements.context.append(details);
  const limits = contextBlock('Current limits');
  for (const [label, value] of [
    ['Per coin', formatted(mandate.perCoinSol, ' SOL')], ['Trades per day', mandate.tradesPerDay], ['Stop floor', formatted(mandate.stopAllSol, ' SOL')],
  ]) if (value !== undefined && value !== null) limits.append(contextRow(label, value));
  if (limits.children.length > 1) elements.context.append(limits);
  if (!elements.context.children.length) {
    const block = contextBlock('Ready to review');
    block.append(node('p', '', 'Muse will read the instructions, holdings and journal through Hotbot’s MCP.'));
    elements.context.append(block);
  }
}
function friendlyTool(tool) {
  const names = { list_portfolios: 'Read your portfolios', get_portfolio: 'Read portfolio & journal', get_activity: 'Read recent activity', get_coin: 'Read coin evidence', get_team: 'Read your team', get_stats: 'Read strategy results', get_decisions: 'Read agent decisions', get_reference: 'Read available settings', get_trades: 'Read trade history', get_funnel: 'Read research checks', search_coins: 'Search coin records' };
  return names[tool] ?? String(tool ?? 'MCP read').replaceAll('_', ' ');
}
function addTool(event) {
  const id = String(event.id ?? event.toolCallId ?? `read-${state.tools.size + 1}`);
  if (state.tools.has(id)) return state.tools.get(id);
  elements.evidenceEmpty.hidden = true;
  const item = node('li', 'tool-call pending');
  item.id = `tool-${state.tools.size + 1}`;
  const name = node('div', 'tool-name', friendlyTool(event.tool));
  const meta = node('span', 'tool-meta', 'Reading…');
  const callId = node('span', 'tool-meta tool-id', id);
  const details = node('details');
  details.append(node('summary', '', 'Inspect request & result'));
  const raw = node('pre', '', pretty({ tool: event.tool, arguments: event.args ?? {} }));
  details.append(raw);
  item.append(name, meta, callId, details);
  elements.sources.append(item);
  const record = { item, name, meta, raw, details, tool: event.tool, args: event.args ?? {} };
  state.tools.set(id, record);
  elements.sourceCount.textContent = String(state.tools.size);
  return record;
}
function finishTool(event) {
  const record = state.tools.get(String(event.id ?? event.toolCallId)) ?? addTool(event);
  record.item.classList.remove('pending');
  const failed = Boolean(event.error || event.result?.isError);
  record.item.classList.toggle('failed', failed);
  record.meta.textContent = `${failed ? 'Read failed' : 'Read complete'} · ${clockTime(event.readAt)}`;
  record.raw.textContent = pretty({ tool: event.tool ?? record.tool, arguments: record.args, readAt: event.readAt, result: event.result, ...(event.error ? { error: event.error } : {}) });
  const result = unwrapToolResult(event.result);
  if ((event.tool ?? record.tool) === 'get_portfolio' && result && typeof result === 'object' && !failed) renderContext(result);
}
function focusSource(reference) {
  const id = typeof reference === 'string' ? reference : reference.toolCallId ?? reference.id;
  const record = state.tools.get(String(id));
  if (!record) return;
  record.details.open = true;
  record.item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  record.details.querySelector('summary').focus({ preventScroll: true });
  record.item.classList.add('highlight');
  setTimeout(() => record.item.classList.remove('highlight'), 1800);
}
function appendReceipts(container, receipts) {
  if (!Array.isArray(receipts) || !receipts.length) return;
  const list = node('div', 'receipt-list');
  receipts.forEach((receipt, index) => {
    const detail = node('details', 'receipt');
    detail.append(node('summary', 'receipt-link', `Source record ${index + 1}`));
    const fields = node('dl', 'receipt-fields');
    const data = typeof receipt === 'string' ? { toolCallId: receipt } : receipt;
    for (const [label, value] of [
      ['Claim', data.claim], ['Tool', data.tool], ['Exact field', data.path],
      ['Value', data.value], ['Read at', data.readAt], ['Call ID', data.toolCallId],
    ]) {
      if (label === 'Claim' && !value) continue;
      fields.append(node('dt', '', label));
      const description = node('dd');
      const content = value === undefined ? 'Not provided' : pretty(value);
      if (label === 'Value') description.append(node('pre', 'receipt-value', content));
      else description.append(node('span', ['Tool', 'Exact field', 'Call ID'].includes(label) ? 'receipt-code' : '', content));
      fields.append(description);
    }
    const inspect = node('button', 'receipt-inspect', 'Inspect full tool result');
    inspect.type = 'button'; inspect.addEventListener('click', () => focusSource(receipt));
    detail.append(fields, inspect); list.append(detail);
  });
  container.append(list);
}
function settingLabel(field) {
  return ({ autonomy: 'Approval mode', perCoinSol: 'Per coin limit', tradesPerDay: 'Daily trade limit' })[field] ?? 'Portfolio setting';
}
function settingValue(field, value) {
  if (value === undefined) return 'Not provided';
  if (field === 'autonomy') return ({ ask: 'Ask me first', limits: 'Within limits', full: 'Full autonomy' })[value] ?? pretty(value);
  if (field === 'perCoinSol') return formatted(value, ' SOL');
  if (field === 'tradesPerDay') return formatted(value, ' trades / day');
  return pretty(value);
}
function showAnswer(event) {
  clearPending();
  const text = String(event.text ?? event.answer ?? '');
  if (!text) return;
  const message = addMessage('assistant', text);
  appendReceipts(message.article, event.sources);
  if (event.sourceWarning) message.article.append(node('p', 'source-notice', event.sourceWarning));
  state.messages.push({ role: 'assistant', content: text });
  const followup = node('button', 'followup-button', 'Show the current setting, proposed setting and uncertainty');
  followup.type = 'button';
  followup.addEventListener('click', () => sendMessage('Show the current setting, your proposed setting, and what remains uncertain.'));
  message.article.append(followup);
  scrollConversation();
}
function showProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') return;
  const last = elements.messages.querySelector('.message.assistant:last-child') ?? addMessage('assistant', 'A proposed next step for your review.').article;
  const card = node('section', 'proposal');
  const status = node('span', 'proposal-status', 'Proposed · awaiting your review');
  card.append(status, node('h3', '', proposal.title ?? 'A change worth reviewing'));
  card.append(node('p', 'proposal-field', settingLabel(proposal.field)));
  const comparison = node('div', 'proposal-comparison');
  for (const [label, value] of [['Current', proposal.current], ['Proposed', proposal.proposed]]) {
    const cell = node('div');
    cell.append(node('small', '', label), node('strong', '', settingValue(proposal.field, value)));
    comparison.append(cell);
  }
  card.append(comparison);
  for (const [label, value] of [['Why', proposal.reason], ['Tradeoff', proposal.tradeoff]]) {
    if (!value) continue;
    const detail = node('p', 'proposal-detail');
    detail.append(node('b', '', `${label}: `), document.createTextNode(String(value)));
    card.append(detail);
  }
  if (proposal.effects) {
    const scope = node('p', 'proposal-detail');
    scope.append(node('b', '', 'What else changes: '), document.createTextNode(String(proposal.effects)));
    card.append(scope);
  }
  if (typeof proposal.definitionUrl === 'string' && proposal.definitionUrl.startsWith('https://github.com/0xwhoismax/hotbot/blob/')) {
    const definition = node('a', 'receipt-inspect', 'Read the setting definition');
    definition.href = proposal.definitionUrl;
    definition.target = '_blank'; definition.rel = 'noopener noreferrer';
    card.append(definition);
  }
  appendReceipts(card, proposal.sourceRefs);
  const actions = node('div', 'proposal-actions');
  const id = String(proposal.portfolioId ?? state.portfolioId);
  if (id) {
    const link = node('a', 'settings-link', 'Review in Hotbot');
    link.href = `https://usehotbot.com/app/portfolios/${encodeURIComponent(id)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  const dismiss = node('button', 'dismiss-button', 'Dismiss');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => {
    card.classList.add('dismissed'); status.textContent = 'Dismissed in this chat'; actions.remove();
  });
  actions.append(dismiss); card.append(actions); last.append(card);
  scrollConversation();
}
function handleEvent(event) {
  const type = event.type ?? event.event;
  if (type === 'tool_start') {
    addTool(event); progress(friendlyTool(event.tool), true); pendingMessage(`${friendlyTool(event.tool)}…`);
  } else if (type === 'tool_end') {
    finishTool(event); progress('Reading the evidence…', true); pendingMessage('Reviewing the evidence and checking the answer…');
  } else if (type === 'tool_error') {
    const record = state.tools.get(String(event.id ?? event.toolCallId)) ?? addTool(event);
    record.item.classList.remove('pending'); record.item.classList.add('failed');
    record.meta.textContent = 'Read failed';
    record.raw.textContent = pretty({ tool: event.tool ?? record.tool, arguments: record.args, error: event.message ?? 'The read did not complete.' });
  } else if (type === 'answer') showAnswer(event);
  else if (type === 'proposal') showProposal(event.proposal ?? event);
  else if (type === 'notice') {
    const last = elements.messages.querySelector('.message.assistant:last-child') ?? addMessage('assistant', '').article;
    last.append(node('p', 'source-notice', event.text ?? event.message ?? 'Some evidence could not be matched.'));
  }
  else if (type === 'error') throw new Error(event.message ?? event.error?.message ?? event.error ?? 'Muse could not finish this review.');
  else if (type === 'done') { clearPending(); progress('Review complete · sources available'); }
}
async function sendMessage(text) {
  if (state.busy) return;
  if (!state.status.configured) { elements.dialog.showModal(); return; }
  if (!state.portfolioId) { progress('Choose a portfolio first'); elements.select.focus(); return; }
  const content = String(text ?? '').trim();
  if (!content) return;
  elements.input.value = ''; elements.input.style.height = '';
  state.messages.push({ role: 'user', content });
  addMessage('user', content); setBusy(true); progress('Asking Muse…', true); pendingMessage('Reading your portfolio through Hotbot’s MCP…');
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolioId: state.portfolioId, messages: state.messages }) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.message ?? body.error ?? body.message ?? `Muse request failed (${response.status}).`);
    }
    if (!response.body) throw new Error('The server did not return a response stream.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', completed = false;
    const readEvent = (line) => {
      const event = JSON.parse(line);
      if ((event.type ?? event.event) === 'done') completed = true;
      handleEvent(event);
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) readEvent(line);
      if (done) break;
    }
    if (buffer.trim()) readEvent(buffer);
    if (!completed) throw new Error('The response ended before the review finished. Try again.');
    clearPending(); progress('Review complete · sources available');
  } catch (error) {
    clearPending(); addMessage('assistant', errorText(error), 'error'); progress('Review interrupted · try again');
    for (const record of state.tools.values()) if (record.item.classList.contains('pending')) {
      record.item.classList.remove('pending'); record.item.classList.add('failed'); record.meta.textContent = 'Read interrupted';
    }
  } finally { setBusy(false); elements.input.focus(); }
}
async function loadPortfolios() {
  progress('Reading your portfolios…', true);
  const result = await request('/api/portfolios', {});
  const portfolios = Array.isArray(result) ? result : result.portfolios;
  if (!Array.isArray(portfolios)) throw new Error('Hotbot did not return a portfolio list.');
  state.portfolios = portfolios.filter((portfolio) => portfolio && portfolioId(portfolio));
  state.hotbotReady = true;
  elements.connectionLabel.textContent = 'Hotbot connected';
  elements.connectionDot.classList.add('connected');
  elements.select.replaceChildren(node('option', '', state.portfolios.length ? 'Choose a portfolio' : 'No portfolios found'));
  elements.select.options[0].value = '';
  for (const portfolio of state.portfolios) {
    const option = node('option', '', portfolio.name ?? portfolio.summary ?? portfolioId(portfolio));
    option.value = portfolioId(portfolio); elements.select.append(option);
  }
  if (state.portfolios.length === 1) {
    elements.select.value = portfolioId(state.portfolios[0]); selectPortfolio();
  } else {
    elements.summary.textContent = state.portfolios.length ? 'Choose a paper portfolio for Muse to review.' : 'No themed portfolios were returned by this connection.';
    progress(state.portfolios.length ? 'Choose a portfolio to begin' : 'Create a paper portfolio in Hotbot to begin');
  }
  setBusy(false);
}
function selectPortfolio() {
  state.portfolioId = elements.select.value;
  state.messages = []; state.tools.clear(); elements.messages.replaceChildren(); elements.sources.replaceChildren();
  elements.sourceCount.textContent = '0'; elements.evidenceEmpty.hidden = false; elements.welcome.hidden = false;
  state.pending = null;
  if (state.portfolioId) { renderContext(); progress('Ready · ask Muse about this portfolio'); }
  else { elements.context.replaceChildren(); progress('Choose a portfolio to begin'); }
  setBusy(false);
}
async function loadStatus() {
  state.status = await request('/api/status');
  elements.connectionDot.classList.toggle('connected', state.hotbotReady);
  elements.connectionLabel.textContent = state.hotbotReady ? 'Hotbot connected' : state.status.configured ? 'Configured' : 'Connect';
  if (state.status.model) elements.modelName.textContent = /muse.*spark.*1[._-]?3/i.test(state.status.model) ? 'Muse Spark 1.3' : state.status.model;
  $('#meta-key-status').textContent = state.status.metaConfigured ? 'Configured' : '';
  $('#hotbot-token-status').textContent = state.status.hotbotConfigured ? 'Configured' : '';
  elements.metaKey.placeholder = state.status.metaConfigured ? 'Leave blank to keep existing key' : 'Enter your Meta API key';
  elements.hotbotToken.placeholder = state.status.hotbotConfigured ? 'Leave blank to keep existing token' : 'Enter your Hotbot token';
  return state.status;
}
elements.connectionButton.addEventListener('click', () => { elements.configError.textContent = ''; elements.dialog.showModal(); });
$('#close-setup').addEventListener('click', () => elements.dialog.close());
elements.configForm.addEventListener('submit', async (event) => {
  event.preventDefault(); elements.configError.textContent = ''; elements.connectSubmit.disabled = true; elements.connectSubmit.textContent = 'Connecting…';
  const config = {};
  if (elements.metaKey.value.trim()) config.metaApiKey = elements.metaKey.value.trim();
  if (elements.hotbotToken.value.trim()) config.hotbotToken = elements.hotbotToken.value.trim();
  try {
    await request('/api/config', config);
    state.hotbotReady = false;
    elements.metaKey.value = ''; elements.hotbotToken.value = '';
    await loadStatus();
    if (!state.status.configured) throw new Error('Add both a Meta API key and a Hotbot read-only token.');
    await loadPortfolios(); elements.dialog.close();
  } catch (error) { elements.configError.textContent = errorText(error); }
  finally { elements.connectSubmit.disabled = false; elements.connectSubmit.textContent = 'Connect'; }
});
elements.select.addEventListener('change', selectPortfolio);
elements.form.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(elements.input.value); });
elements.input.addEventListener('input', () => {
  elements.input.style.height = 'auto'; elements.input.style.height = `${Math.min(160, elements.input.scrollHeight)}px`;
  elements.send.disabled = state.busy || !elements.input.value.trim();
});
elements.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(elements.input.value); }
});
for (const starter of document.querySelectorAll('[data-prompt]')) starter.addEventListener('click', () => sendMessage(starter.dataset.prompt));
(async () => {
  try { await loadStatus(); if (state.status.configured) await loadPortfolios(); else progress('Connect Meta and Hotbot to begin'); }
  catch (error) { progress(errorText(error)); }
  setBusy(false);
})();
