const IP_PATTERN = /^(?:https?:\/\/)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
let allDeviceTabs = [];

function extractIP(url) {
  const m = url.match(IP_PATTERN);
  return m ? m[1] : null;
}

function isDeviceTab(tab) {
  if (!tab.url) return false;
  return IP_PATTERN.test(tab.url);
}

async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  allDeviceTabs = tabs.filter(isDeviceTab);

  // Group by IP
  const groups = {};
  for (const tab of allDeviceTabs) {
    const ip = extractIP(tab.url);
    if (!groups[ip]) groups[ip] = [];
    groups[ip].push(tab);
  }

  document.getElementById('deviceCount').textContent = allDeviceTabs.length;
  document.getElementById('ipCount').textContent = Object.keys(groups).length;
  document.getElementById('totalCount').textContent = tabs.length;

  renderGroups(groups);
}

function renderGroups(groups, filter = '') {
  const container = document.getElementById('deviceList');
  container.innerHTML = '';

  const sortedIPs = Object.keys(groups).sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
  });

  let hasVisible = false;

  for (const ip of sortedIPs) {
    const tabs = groups[ip];
    const filtered = filter
      ? tabs.filter(t => t.url.includes(filter) || (t.title || '').toLowerCase().includes(filter.toLowerCase()))
      : tabs;

    if (filtered.length === 0) continue;
    hasVisible = true;

    const group = document.createElement('div');
    group.className = 'device-group';

    const header = document.createElement('div');
    header.className = 'device-header';
    header.innerHTML = `
      <input type="checkbox" class="checkbox device-cb" data-ip="${ip}" checked>
      <span class="device-ip">${ip}</span>
      <span class="device-count">${filtered.length} 个标签</span>
    `;

    const tabList = document.createElement('div');
    tabList.className = 'device-tabs';

    for (const tab of filtered) {
      const item = document.createElement('div');
      item.className = 'tab-item';
      item.innerHTML = `
        <input type="checkbox" class="checkbox tab-cb" data-tab-id="${tab.id}" checked>
        <span class="title" title="${tab.url}">${tab.title || tab.url}</span>
        <span class="close-tab" data-tab-id="${tab.id}" title="关闭此标签">×</span>
      `;
      tabList.appendChild(item);
    }

    header.addEventListener('click', (e) => {
      if (e.target.classList.contains('checkbox')) return;
      tabList.classList.toggle('show');
    });

    group.appendChild(header);
    group.appendChild(tabList);
    container.appendChild(group);
  }

  if (!hasVisible) {
    container.innerHTML = '<div class="empty">没有找到匹配的设备标签</div>';
  }
}

function getSelectedTabIds() {
  const checkboxes = document.querySelectorAll('.tab-cb:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.dataset.tabId));
}

// Close all selected device tabs
document.getElementById('closeAll').addEventListener('click', async () => {
  const tabIds = getSelectedTabIds();
  if (tabIds.length === 0) return;

  if (!confirm(`确认关闭 ${tabIds.length} 个设备标签？`)) return;

  await chrome.tabs.remove(tabIds);
  loadTabs();
});

// Group all device tabs using Chrome Tab Groups
document.getElementById('groupAll').addEventListener('click', async () => {
  const tabIds = getSelectedTabIds();
  if (tabIds.length === 0) return;

  try {
    // Group all into one group
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: '内网设备', color: 'red' });
  } catch (e) {
    // Fallback: SLBrowser may not support tabGroups
    alert('此浏览器不支持标签分组功能');
  }
});

// Refresh
document.getElementById('refresh').addEventListener('click', loadTabs);

// Filter
document.getElementById('filterInput').addEventListener('input', async (e) => {
  const filter = e.target.value.trim();
  const tabs = await chrome.tabs.query({});
  const deviceTabs = tabs.filter(isDeviceTab);

  const groups = {};
  for (const tab of deviceTabs) {
    const ip = extractIP(tab.url);
    if (!groups[ip]) groups[ip] = [];
    groups[ip].push(tab);
  }
  renderGroups(groups, filter);
});

// Individual tab close (event delegation)
document.getElementById('deviceList').addEventListener('click', async (e) => {
  if (e.target.classList.contains('close-tab')) {
    const tabId = parseInt(e.target.dataset.tabId);
    await chrome.tabs.remove(tabId);
    loadTabs();
  }
});

// Select/deselect all tabs in a device group
document.getElementById('deviceList').addEventListener('change', (e) => {
  if (e.target.classList.contains('device-cb')) {
    const ip = e.target.dataset.ip;
    const checked = e.target.checked;
    const group = e.target.closest('.device-group');
    group.querySelectorAll('.tab-cb').forEach(cb => cb.checked = checked);
  }
});

loadTabs();
