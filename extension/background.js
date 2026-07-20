const WS_URL = 'ws://localhost:9710';
const RECONNECT_DELAY = 3000;

let ws = null;
let connected = false;

// --- Keep-alive to prevent service worker from sleeping ---
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Just accessing chrome.alarms keeps the worker alive
    if (!connected) connect();
  }
});

// --- WebSocket Connection ---
function connect() {
  if (ws && ws.readyState <= 1) return; // already connecting or open

  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    updateBadge(true);
    console.log('[TabBridge] Connected to', WS_URL);
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const result = await handleCommand(msg);
    ws.send(JSON.stringify({ id: msg.id, ...result }));
  };

  ws.onclose = () => {
    connected = false;
    updateBadge(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    connected = false;
    updateBadge(false);
  };
}

function scheduleReconnect() {
  setTimeout(connect, RECONNECT_DELAY);
}

function updateBadge(isConnected) {
  chrome.action.setBadgeText({ text: isConnected ? '✓' : '' });
  chrome.action.setBadgeBackgroundColor({ color: isConnected ? '#4caf50' : '#999' });
}

// --- Command Handlers ---
async function handleCommand(msg) {
  const { action, params = {} } = msg;
  try {
    switch (action) {
      case 'query': return { ok: true, data: await cmdQuery(params) };
      case 'close': return { ok: true, data: await cmdClose(params) };
      case 'open':  return { ok: true, data: await cmdOpen(params) };
      case 'group': return { ok: true, data: await cmdGroup(params) };
      case 'ping':  return { ok: true, data: 'pong' };
      default:      return { ok: false, error: `Unknown action: ${action}` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function cmdQuery({ urlPattern, titlePattern } = {}) {
  const tabs = await chrome.tabs.query({});
  let result = tabs.map(t => ({
    id: t.id,
    windowId: t.windowId,
    url: t.url || '',
    title: t.title || '',
    active: t.active,
  }));

  if (urlPattern) {
    const re = new RegExp(urlPattern.replace(/\*/g, '.*'));
    result = result.filter(t => re.test(t.url));
  }
  if (titlePattern) {
    const re = new RegExp(titlePattern, 'i');
    result = result.filter(t => re.test(t.title));
  }
  return result;
}

async function cmdClose({ tabIds, urlPattern } = {}) {
  let ids = tabIds || [];

  if (urlPattern && !ids.length) {
    const tabs = await cmdQuery({ urlPattern });
    ids = tabs.map(t => t.id);
  }

  if (!ids.length) return { closed: 0 };
  await chrome.tabs.remove(ids);
  return { closed: ids.length, tabIds: ids };
}

async function cmdOpen({ urls, windowId } = {}) {
  if (!urls || !urls.length) throw new Error('urls required');
  const created = [];
  for (const url of urls) {
    const tab = await chrome.tabs.create({ url, windowId, active: false });
    created.push({ id: tab.id, url });
  }
  return { opened: created.length, tabs: created };
}

async function cmdGroup({ tabIds, urlPattern, title } = {}) {
  let ids = tabIds || [];

  if (urlPattern && !ids.length) {
    const tabs = await cmdQuery({ urlPattern });
    ids = tabs.map(t => t.id);
  }

  if (!ids.length) return { grouped: 0 };

  try {
    const groupId = await chrome.tabs.group({ tabIds: ids });
    if (title) {
      await chrome.tabGroups.update(groupId, { title, color: 'blue' });
    }
    return { grouped: ids.length, groupId };
  } catch {
    return { grouped: 0, error: 'tabGroups not supported' };
  }
}

// --- Init ---
connect();
