// Organize Feishu tabs: dedup → group by topic → collect each into new window
const http = require('http');

const PORT = 9710;

function request(action, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, params });
    const req = http.request({ hostname: 'localhost', port: PORT, path: '/command', method: 'POST',
      headers: { 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Topic definitions - each has a name and matching function
const TOPICS = [
  {
    name: 'EG71 迭代',
    match: t => /EG71|71\.0\.0|Niagara Driver|6X.?71蜂窝|FT101/.test(t.title),
  },
  {
    name: 'SG50/UG63V2 迭代',
    match: t => /SG50|UG63[Vv]2/.test(t.title),
  },
  {
    name: 'UG6X/UG56 迭代',
    match: t => /UG56|UG6[Xx]|UGXX|60\.0\.0|56\.0\.0|PSTI/.test(t.title),
  },
  {
    name: '网关通用',
    match: t => /网关(?!竞品安全|重要客户)|ToolBox|toolbox|设备数采|设备Profile|导入导出|入网体验|入网配置|LoRaWAN.*设备添加|MQTT.*TLS|云平台.*Profile|新增默认.*Profile|ODM.*按需|Dashboard.*优化/.test(t.title),
  },
  {
    name: 'BTL/安全/合规',
    match: t => /BTL|BACnet|PICS|EU Data Act|安全态势|安全漏洞|网络安全需求|内核升级.*安全|root.*密码|root.*默认密码|admin权限/.test(t.title),
  },
  {
    name: '规划/资源',
    match: t => /2026.*规划|2027.*规划|资源规划|路演|客户调研|ACS客户/.test(t.title),
  },
  {
    name: '人事/管理',
    match: t => /试用期任务表|产品团队任务表|Token账号/.test(t.title),
  },
];

async function main() {
  // Step 0: Query all Feishu tabs
  const result = await request('query', { titlePattern: '飞书' });
  if (!result.ok) { console.error('Query failed:', result.error); return; }
  let tabs = result.data;
  console.log(`📋 Total Feishu tabs: ${tabs.length}`);

  // Step 1: Dedup - group by doc URL, keep first, close rest
  const byDoc = {};
  for (const t of tabs) {
    const m = t.url.match(/\/(wiki|base|docx|sheets|bitable)\/([A-Za-z0-9]+)/);
    const key = m ? `${m[1]}/${m[2]}` : t.url.split('?')[0];
    if (!byDoc[key]) byDoc[key] = [];
    byDoc[key].push(t);
  }

  const dupIds = [];
  for (const [doc, group] of Object.entries(byDoc)) {
    if (group.length > 1) {
      // Keep the first one, close the rest
      for (let i = 1; i < group.length; i++) {
        dupIds.push(group[i].id);
      }
    }
  }

  if (dupIds.length) {
    console.log(`\n🗑️  Step 1: Closing ${dupIds.length} duplicate tabs...`);
    await request('close', { tabIds: dupIds });
    // Refresh tab list
    await sleep(500);
    const r2 = await request('query', { titlePattern: '飞书' });
    tabs = r2.data;
    console.log(`   Remaining: ${tabs.length} tabs`);
  }

  // Step 2: Group by topic and collect each into a new window
  for (const topic of TOPICS) {
    const matching = tabs.filter(t => topic.match(t));
    if (!matching.length) {
      console.log(`\n⏭️  ${topic.name}: no matching tabs`);
      continue;
    }

    // Dedup URLs within topic
    const seen = new Set();
    const unique = matching.filter(t => {
      const key = t.url.split('?')[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`\n📦 ${topic.name}: ${matching.length} tabs → ${unique.length} unique`);

    // Close originals FIRST to free resources
    const tabIds = matching.map(t => t.id);
    await request('close', { tabIds });
    await sleep(800);

    // Then open in new window
    const urls = unique.map(t => t.url);
    const openResult = await request('open', { urls });
    if (openResult.ok) {
      console.log(`   ✅ Closed ${tabIds.length}, opened ${urls.length} in new window`);
    } else {
      console.log(`   ⚠️ Closed ${tabIds.length}, but open failed: ${openResult.error}`);
    }

    // Remove matched tabs from list
    const matchSet = new Set(matching.map(t => t.id));
    tabs = tabs.filter(t => !matchSet.has(t.id));

    await sleep(300); // Brief pause between operations
  }

  // Step 3: Remaining tabs → one window
  if (tabs.length) {
    const seen = new Set();
    const unique = tabs.filter(t => {
      const key = t.url.split('?')[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const urls = unique.map(t => t.url);
    const allIds = tabs.map(t => t.id);

    console.log(`\n📦 其他/独立: ${tabs.length} tabs → ${unique.length} unique`);
    // Close first, then open
    await request('close', { tabIds: allIds });
    await sleep(800);
    const openResult = await request('open', { urls });
    if (openResult.ok) {
      console.log(`   ✅ Closed ${allIds.length}, opened ${urls.length} in new window`);
    }
  }

  console.log('\n🎉 Done!');
}

main().catch(e => console.error('Error:', e.message));
