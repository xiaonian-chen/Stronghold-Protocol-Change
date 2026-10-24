// mod-framework/config-ui.js — Mod configuration web UI.
// Starts a temporary HTTP server, opens a browser page where the user can
// enable/disable mods, then saves mod-framework/config.json and exits.
// Called by 启动服务器（信任插件）.bat BEFORE the main server starts.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dir = path.dirname(__filename);
const ROOT = path.resolve(__dir, '..');

function scanMods() {
  const modsDir = path.join(ROOT, 'mods');
  const mods = [];
  if (!fs.existsSync(modsDir)) return mods;
  const entries = fs.readdirSync(modsDir, { withFileTypes: true });
  const candidateDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(modsDir, entry.name);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) {
      candidateDirs.push(dir);
    } else {
      const subs = fs.readdirSync(dir, { withFileTypes: true });
      for (const sub of subs) {
        if (!sub.isDirectory()) continue;
        const subDir = path.join(dir, sub.name);
        if (fs.existsSync(path.join(subDir, 'manifest.json'))) candidateDirs.push(subDir);
      }
    }
  }

  for (const dir of candidateDirs) {
    const manifestPath = path.join(dir, 'manifest.json');
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      mods.push({
        id: m.id || path.basename(dir),
        name: m.name || path.basename(dir),
        version: m.version || '0.0.0',
        description: m.description || '',
        author: m.author || '',
        enabled: m.enabled !== false,
      });
    } catch { /* skip broken manifests */ }
  }
  return mods;
}

function loadConfig() {
  const configPath = path.join(__dir, 'config.json');
  if (!fs.existsSync(configPath)) return {};
  try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { return {}; }
}

function saveConfig(cfg) {
  const configPath = path.join(__dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

function buildPage(mods, config) {
  const modCards = mods.map((m) => {
    const checked = config[m.id] !== false ? 'checked' : '';
    return `<label class="mod-card">
  <input type="checkbox" name="${m.id}" ${checked}>
  <div class="mod-info">
    <span class="mod-name">${escapeHtml(m.name)}</span>
    <span class="mod-version">v${escapeHtml(m.version)}</span>
    ${m.author ? `<span class="mod-author">by ${escapeHtml(m.author)}</span>` : ''}
    ${m.description ? `<span class="mod-desc">${escapeHtml(m.description)}</span>` : ''}
  </div>
</label>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mod 管理器 — 卫戍协议：盟约</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    background: #1a1a2e; color: #e0e0e0;
    min-height: 100vh; display: flex; justify-content: center; align-items: flex-start;
    padding: 40px 16px;
  }
  .container { max-width: 540px; width: 100%; }
  h1 { font-size: 22px; margin-bottom: 4px; color: #f0f0f0; }
  .subtitle { font-size: 13px; color: #888; margin-bottom: 24px; }
  .mod-list { display: flex; flex-direction: column; gap: 10px; }
  .mod-card {
    display: flex; align-items: flex-start; gap: 12px;
    background: #16213e; border: 1px solid #0f3460; border-radius: 10px;
    padding: 14px 16px; cursor: pointer; transition: border-color 0.2s;
  }
  .mod-card:hover { border-color: #e94560; }
  .mod-card input[type="checkbox"] {
    margin-top: 3px; width: 18px; height: 18px; accent-color: #e94560; flex-shrink: 0;
  }
  .mod-info { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .mod-name { font-size: 15px; font-weight: 600; color: #f0f0f0; }
  .mod-version { font-size: 11px; color: #e94560; background: rgba(233,69,96,0.12); padding: 1px 6px; border-radius: 4px; }
  .mod-author { font-size: 11px; color: #7b8ab8; }
  .mod-desc { font-size: 12px; color: #888; width: 100%; margin-top: 2px; }
  .empty { text-align: center; color: #666; padding: 40px 0; font-size: 14px; }
  .actions { margin-top: 24px; display: flex; gap: 10px; }
  button {
    flex: 1; padding: 12px 0; border-radius: 8px; border: none;
    font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;
  }
  button:hover { opacity: 0.85; }
  .btn-start { background: #e94560; color: #fff; }
  .btn-cancel { background: #333; color: #ccc; }
  .status { margin-top: 12px; font-size: 13px; text-align: center; min-height: 20px; }
  .status.ok { color: #4ecca3; }
  .status.err { color: #e94560; }
</style>
</head>
<body>
<div class="container">
  <h1>Mod 管理器</h1>
  <p class="subtitle">勾选要启用的 Mod，点击「启动服务器」生效</p>
  <form id="form" class="mod-list">
    ${modCards || '<div class="empty">mods/ 目录下没有找到 Mod<br>将 Mod 文件夹放入 mods/ 即可在此管理</div>'}
  </form>
  <div class="actions">
    <button type="button" class="btn-cancel" id="btnCancel">取消</button>
    <button type="submit" form="form" class="btn-start">启动服务器</button>
  </div>
  <div id="status" class="status"></div>
</div>
<script>
  const form = document.getElementById('form');
  const status = document.getElementById('status');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const config = {};
    for (const [key, value] of data.entries()) config[key] = value === 'on';
    const boxes = form.querySelectorAll('input[type="checkbox"]');
    for (const cb of boxes) {
      if (!data.has(cb.name)) config[cb.name] = false;
    }
    status.textContent = '保存中...';
    status.className = 'status';
    try {
      const resp = await fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (resp.ok) {
        status.textContent = '配置已保存！服务器启动中，本页面即将关闭...';
        status.className = 'status ok';
        setTimeout(() => { window.close(); }, 800);
      } else {
        status.textContent = '保存失败，请重试';
        status.className = 'status err';
      }
    } catch (err) {
      status.textContent = '连接失败：' + err.message;
      status.className = 'status err';
    }
  });
  document.getElementById('btnCancel').addEventListener('click', async () => {
    try {
      await fetch('/cancel', { method: 'POST' });
    } catch {}
    window.close();
  });
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openBrowser(url) {
  const plat = process.platform;
  const cmd =
    plat === 'win32' ? `start "" "${url}"` :
    plat === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' }).unref();
}

function findFreePort(start = 19527) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', () => {
      if (start < 19537) resolve(findFreePort(start + 1));
      else reject(new Error('no free port'));
    });
  });
}

async function main() {
  const mods = scanMods();

  if (mods.length === 0) {
    console.log('[config-ui] No mods found — skipping mod selection, launching directly.');
    process.exit(0);
  }

  const config = loadConfig();
  const port = await findFreePort();
  const html = buildPage(mods, config);

  const server = http.createServer((req, res) => {
    console.log('[config-ui] Request:', req.method, req.url);
    res.setHeader('Connection', 'close');
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (req.method === 'POST' && req.url === '/save') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const newConfig = { ...config, ...JSON.parse(body) };
          saveConfig(newConfig);
          console.log('[config-ui] Config saved:', JSON.stringify(newConfig));
          res.writeHead(200);
          res.end('ok');
          setTimeout(() => {
            if (server.listening) {
              server.closeAllConnections();
              server.close(() => console.log('[config-ui] Launching server.'));
            }
            process.exit(0);
          }, 200);
        } catch (e) {
          console.error('[config-ui] Save error:', e.message);
          res.writeHead(400);
          res.end('bad request');
        }
      });
    } else if (req.method === 'POST' && req.url === '/cancel') {
      console.log('[config-ui] User cancelled.');
      res.writeHead(200);
      res.end('cancelled');
      setTimeout(() => {
        if (server.listening) {
          server.closeAllConnections();
          server.close(() => {});
        }
        process.exit(1);
      }, 200);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`[config-ui] Opening mod selector: ${url}`);
    openBrowser(url);
  });

  // Safety timeout: if user never clicks anything, exit after 120s so .bat isn't stuck
  setTimeout(() => {
    console.log('[config-ui] Timed out waiting for user input, launching server with current config.');
    server.closeAllConnections();
    server.close(() => process.exit(0));
  }, 120_000);
}

main().catch((e) => {
  console.error('[config-ui] Error:', e.message);
  process.exit(1);
});