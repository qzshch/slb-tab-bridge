const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { randomUUID } = require('crypto');

const PORT = 9710;
const TIMEOUT_MS = 5000;

// --- State ---
let extClient = null; // WebSocket connection from extension
const pending = new Map(); // id → { resolve, reject, timer }

// ============================================================
// WebSocket Server (extension connects here)
// ============================================================
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('[bridge] Extension connected');
  extClient = ws;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const p = pending.get(msg.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve(msg);
    }
  });

  ws.on('close', () => {
    console.log('[bridge] Extension disconnected');
    extClient = null;
    // Reject all pending
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    pending.clear();
  });
});

// ============================================================
// HTTP Server (CLI sends commands here)
// ============================================================
const httpServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', async () => {
    res.setHeader('Content-Type', 'application/json');

    // Health check
    if (req.method === 'GET' && req.url === '/status') {
      return res.end(JSON.stringify({
        ok: true,
        extensionConnected: !!extClient,
        pendingRequests: pending.size,
      }));
    }

    // Command
    if (req.method === 'POST' && req.url === '/command') {
      if (!extClient || extClient.readyState !== WebSocket.OPEN) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ ok: false, error: 'Extension not connected' }));
      }

      let cmd;
      try { cmd = JSON.parse(body); } catch {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }

      try {
        const result = await sendToExtension(cmd);
        return res.end(JSON.stringify(result));
      } catch (e) {
        res.statusCode = 504;
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });
});

// Upgrade HTTP to WebSocket for /ws path
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

function sendToExtension(cmd) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Timeout'));
    }, TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    extClient.send(JSON.stringify({ id, ...cmd }));
  });
}

// ============================================================
// CLI Client
// ============================================================
async function cliRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });

    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error('Bridge server not running. Start with: node bridge.js serve'));
      } else {
        reject(e);
      }
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================
// Main
// ============================================================
const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'serve':
      httpServer.listen(PORT, () => {
        console.log(`[bridge] Server listening on http://localhost:${PORT}`);
        console.log(`[bridge] WebSocket at ws://localhost:${PORT}/ws`);
      });
      break;

    case 'status': {
      const r = await cliRequest('GET', '/status');
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case 'query': {
      const params = {};
      const ipIdx = args.indexOf('--ip');
      if (ipIdx !== -1 && args[ipIdx + 1]) {
        params.urlPattern = args[ipIdx + 1];
      }
      const titleIdx = args.indexOf('--title');
      if (titleIdx !== -1 && args[titleIdx + 1]) {
        params.titlePattern = args[titleIdx + 1];
      }
      const r = await cliRequest('POST', '/command', { action: 'query', params });
      if (r.ok && r.data) {
        // Pretty print
        const byIP = {};
        for (const t of r.data) {
          const m = t.url.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
          const ip = m ? m[1] : 'other';
          if (!byIP[ip]) byIP[ip] = [];
          byIP[ip].push(t);
        }
        const ips = Object.keys(byIP).sort();
        for (const ip of ips) {
          console.log(`\n📡 ${ip} (${byIP[ip].length} tabs)`);
          for (const t of byIP[ip]) {
            console.log(`   [${t.id}] ${t.title || t.url}`);
          }
        }
        console.log(`\nTotal: ${r.data.length} tabs`);
      } else {
        console.log(JSON.stringify(r, null, 2));
      }
      break;
    }

    case 'close': {
      const params = {};
      const idsIdx = args.indexOf('--ids');
      if (idsIdx !== -1 && args[idsIdx + 1]) {
        params.tabIds = args[idsIdx + 1].split(',').map(Number);
      }
      const ipIdx = args.indexOf('--ip');
      if (ipIdx !== -1 && args[ipIdx + 1]) {
        params.urlPattern = args[ipIdx + 1];
      }
      const r = await cliRequest('POST', '/command', { action: 'close', params });
      console.log(r.ok ? `Closed ${r.data.closed} tabs` : `Error: ${r.error}`);
      break;
    }

    case 'open': {
      const urls = args.filter(a => !a.startsWith('-'));
      if (!urls.length) { console.error('Usage: bridge.js open <url> [url...]'); process.exit(1); }
      const r = await cliRequest('POST', '/command', { action: 'open', params: { urls } });
      console.log(r.ok ? `Opened ${r.data.opened} tabs` : `Error: ${r.error}`);
      break;
    }

    case 'group': {
      const params = {};
      const ipIdx = args.indexOf('--ip');
      if (ipIdx !== -1 && args[ipIdx + 1]) {
        params.urlPattern = args[ipIdx + 1];
      }
      const titleIdx = args.indexOf('--title');
      if (titleIdx !== -1 && args[titleIdx + 1]) {
        params.title = args[titleIdx + 1];
      }
      const r = await cliRequest('POST', '/command', { action: 'group', params });
      console.log(r.ok ? `Grouped ${r.data.grouped} tabs` : `Error: ${r.error}`);
      break;
    }

    case 'collect': {
      const params = {};
      const ipIdx = args.indexOf('--ip');
      if (ipIdx !== -1 && args[ipIdx + 1]) {
        params.urlPattern = args[ipIdx + 1];
      }
      const titleIdx = args.indexOf('--title');
      if (titleIdx !== -1 && args[titleIdx + 1]) {
        params.titlePattern = args[titleIdx + 1];
      }
      const exIdx = args.indexOf('--exclude');
      if (exIdx !== -1 && args[exIdx + 1]) {
        params.excludePatterns = args[exIdx + 1].split(',');
      }
      const r = await cliRequest('POST', '/command', { action: 'collect', params });
      if (r.ok) {
        console.log(`Collected ${r.data.collected} tabs into window ${r.data.newWindowId} (closed ${r.data.closedOriginal} originals)`);
      } else {
        console.log(`Error: ${r.error}`);
      }
      break;
    }

    default:
      console.log(`SLBrowser Tab Bridge

Usage:
  node bridge.js serve              Start bridge server
  node bridge.js status             Check connection status
  node bridge.js query [--ip PAT]   List tabs (optional IP filter)
  node bridge.js close --ids 1,2    Close tabs by ID
  node bridge.js close --ip 192.*   Close tabs by IP pattern
  node bridge.js open <url> [...]   Open new tabs
  node bridge.js group --ip PAT     Group matching tabs`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
