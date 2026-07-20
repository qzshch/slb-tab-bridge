const IP_RE = /^(?:https?:\/\/)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

function extractIP(url) {
  const m = (url || '').match(IP_RE);
  return m ? m[1] : null;
}

async function load() {
  // Connection status
  const sw = chrome.runtime.getBackgroundPage ? null : await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  // Fallback: check badge text
  const badge = await chrome.action.getBadgeText({});
  const isOn = badge === '✓';
  document.getElementById('statusDot').className = 'dot ' + (isOn ? 'on' : 'off');
  document.getElementById('statusText').textContent = isOn ? 'Bridge 已连接' : 'Bridge 未连接';

  // Load tabs
  const tabs = await chrome.tabs.query({});
  const deviceTabs = tabs.filter(t => IP_RE.test(t.url || ''));

  const groups = {};
  for (const t of deviceTabs) {
    const ip = extractIP(t.url);
    if (!groups[ip]) groups[ip] = [];
    groups[ip].push(t);
  }

  document.getElementById('devN').textContent = deviceTabs.length;
  document.getElementById('ipN').textContent = Object.keys(groups).length;
  document.getElementById('allN').textContent = tabs.length;

  render(groups);
}

function render(groups, filter = '') {
  const el = document.getElementById('list');
  el.innerHTML = '';

  const ips = Object.keys(groups).sort((a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });

  let any = false;
  for (const ip of ips) {
    const tabs = filter
      ? groups[ip].filter(t => t.url.includes(filter) || (t.title || '').toLowerCase().includes(filter.toLowerCase()))
      : groups[ip];
    if (!tabs.length) continue;
    any = true;

    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<div class="gh"><input type="checkbox" class="cb dcb" data-ip="${ip}" checked><span class="ip">${ip}</span><span class="cnt">${tabs.length}</span></div><div class="tl"></div>`;

    const tl = g.querySelector('.tl');
    for (const t of tabs) {
      const d = document.createElement('div');
      d.className = 'ti';
      d.innerHTML = `<input type="checkbox" class="cb tcb" data-id="${t.id}" checked><span class="t" title="${t.url}">${t.title || t.url}</span><span class="x" data-id="${t.id}">×</span>`;
      tl.appendChild(d);
    }

    g.querySelector('.gh').addEventListener('click', e => {
      if (e.target.classList.contains('cb')) return;
      tl.classList.toggle('show');
    });
    el.appendChild(g);
  }

  if (!any) el.innerHTML = '<div class="empty">没有设备标签</div>';
}

function getSelectedIds() {
  return [...document.querySelectorAll('.tcb:checked')].map(c => parseInt(c.dataset.id));
}

document.getElementById('closeAll').onclick = async () => {
  const ids = getSelectedIds();
  if (!ids.length || !confirm(`关闭 ${ids.length} 个设备标签？`)) return;
  await chrome.tabs.remove(ids);
  load();
};

document.getElementById('groupAll').onclick = async () => {
  const ids = getSelectedIds();
  if (!ids.length) return;
  try {
    const gid = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(gid, { title: '内网设备', color: 'red' });
  } catch { alert('此浏览器不支持标签分组'); }
};

document.getElementById('refresh').onclick = load;

document.getElementById('fi').oninput = async (e) => {
  const tabs = await chrome.tabs.query({});
  const deviceTabs = tabs.filter(t => IP_RE.test(t.url || ''));
  const groups = {};
  for (const t of deviceTabs) {
    const ip = extractIP(t.url);
    if (!groups[ip]) groups[ip] = [];
    groups[ip].push(t);
  }
  render(groups, e.target.value.trim());
};

document.getElementById('list').addEventListener('click', async e => {
  if (e.target.classList.contains('x')) {
    await chrome.tabs.remove(parseInt(e.target.dataset.id));
    load();
  }
});

document.getElementById('list').addEventListener('change', e => {
  if (e.target.classList.contains('dcb')) {
    const g = e.target.closest('.group');
    g.querySelectorAll('.tcb').forEach(c => c.checked = e.target.checked);
  }
});

load();
