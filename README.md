# SLBrowser Tab Bridge

让 Claude Code 能够读取和操作联想浏览器（SLBrowser）的标签页。

## 背景

SLBrowser 是联想预装的 Chromium 浏览器，但：
- 不支持 `--remote-debugging-port`（CDP 不可用）
- Session SNSS 文件被排他锁
- UI Automation 可读取标签标题，但无法获取 URL，且逐标签切换会严重卡顿

## 架构

```
┌─────────────┐     CLI      ┌──────────────┐   WebSocket   ┌──────────────────┐   chrome.tabs   ┌────────────┐
│ Claude Code │ ──────────>  │  bridge.js   │ ────────────> │ Chrome Extension │ ──────────────> │  SLBrowser │
│             │ <──────────  │  (Node.js)   │ <──────────── │  (background.js) │ <────────────── │   标签页    │
└─────────────┘   JSON       └──────────────┘    JSON       └──────────────────┘                  └────────────┘
```

### 组件

| 组件 | 说明 |
|------|------|
| **extension/** | Chrome 扩展（Manifest V3），注入 background.js 建立 WebSocket 连接，popup 提供手动操作界面 |
| **bridge/** | Node.js WebSocket 服务端，暴露 CLI 接口供 Claude Code 调用 |
| **reference/** | 已有脚本存档（Python UI Automation 枚举、纯 popup 扩展 v1） |

### 通信协议

**WebSocket 消息格式**（JSON）：

```json
// 请求（bridge → extension）
{ "id": "uuid", "action": "query", "params": {} }
{ "id": "uuid", "action": "close", "params": { "tabIds": [1, 2, 3] } }
{ "id": "uuid", "action": "open", "params": { "urls": ["http://..."] } }
{ "id": "uuid", "action": "group", "params": { "tabIds": [1, 2], "title": "设备" } }

// 响应（extension → bridge）
{ "id": "uuid", "ok": true, "data": [...] }
{ "id": "uuid", "ok": false, "error": "message" }
```

### CLI 命令

```bash
# 查询所有标签（可选过滤）
node bridge.js query [--ip 192.168.*]

# 关闭指定标签
node bridge.js close --ids 1,2,3
node bridge.js close --ip 192.168.44.*

# 打开新标签
node bridge.js open http://192.168.44.114 http://192.168.45.67

# 将标签归组
node bridge.js group --ip 192.168.* --title "内网设备"

# 获取连接状态
node bridge.js status
```

## 开发待办

### Phase 1: 扩展端（WebSocket 客户端）
- [ ] background.js：WebSocket 连接管理（自动重连）
- [ ] 实现 action handlers：query / close / open / group
- [ ] popup.html：显示连接状态 + 手动操作（保留 v1 功能）
- [ ] manifest.json：添加 background service worker

### Phase 2: Bridge 端（Node.js WebSocket 服务端）
- [ ] WebSocket 服务端（ws 库）
- [ ] CLI 命令解析（commander 或原生 process.argv）
- [ ] 请求-响应匹配（UUID 关联）
- [ ] 超时与错误处理

### Phase 3: Claude Code 集成
- [ ] 编写 usage 文档
- [ ] 记录到 MEMORY.md 触发规则
- [ ] 测试：查询 → 关闭 → 打开完整流程

## 已有参考脚本

| 文件 | 方法 | 局限 |
|------|------|------|
| `reference/slb_all_tabs.py` | Python + PowerShell UI Automation | 只能读标题，无法获取 URL；无法操作 |
| `reference/popup.js` (v1) | chrome.tabs 纯前端 popup | 只能手动操作，无法被外部程序调用 |

## 安装

### 扩展
1. SLBrowser 地址栏 `slbrowser://extensions/`
2. 开启开发者模式
3. 加载已解压的扩展 → 选择 `extension/` 目录

### Bridge
```bash
cd bridge && npm install && node bridge.js status
```
