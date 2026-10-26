// mod-framework/modServer.js — Generic mod-aware server entry point.
// Architecture: loads all enabled mods, imports upstream startServer(),
// wraps HTTP handler to serve mod client files, and starts.
// Lives in mod-framework/ to be independent of any specific mod.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { openBrowser } from '../Stronghold-Protocol/scripts/open-browser.mjs';
import { classifyAddresses, hostUrl, KIND_LABEL } from '../Stronghold-Protocol/tools/doctor.mjs';
import { c, mark } from '../Stronghold-Protocol/tools/setup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load mod system (this calls install() on every enabled mod)
await import('./modManager.js');

// Import upstream server
import { startServer as upstreamStartServer } from '../Stronghold-Protocol/server/index.js';
import { makeLogger } from '../Stronghold-Protocol/server/http/config.js';
import { isProcessEntry, printBanner } from '../Stronghold-Protocol/server/http/boot.js';

// Collect all enabled mods' client file directories
import { getLoadedMods, getModRegistry } from './modManager.js';

// Build roots. Priority order (first match wins):

async function serveModRegistry(req, res) {
  if (req.url !== '/api/mods/registry' && req.url !== '/api/mods/registry/') return false;
  const reg = getModRegistry();
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(reg));
  return true;
}

// Build roots. Priority order (first match wins):
// 1. mod-framework itself (unified room.js, room.css) — HIGHEST priority
// 2. Mod-specific files (later mods > earlier mods) in reverse load order
function buildModFileRoots() {
  const roots = [];

  // mod-framework unified files — highest priority so the unified room.js/CSS
  // take precedence over individual mod copies
  const fwDir = __dirname;
  roots.push(
    { dir: path.join(fwDir, 'public'), prefix: '/',        modId: 'mod-framework' },
    { dir: path.join(fwDir, 'shared'), prefix: '/shared/', modId: 'mod-framework' },
  );

  // Mod-specific overrides — 20p (last-loaded) checked before clone (first-loaded)
  for (const mod of getLoadedMods().reverse()) {
    const dir = mod.dir;
    roots.push(
      { dir: path.join(dir, 'public'),    prefix: '/',        modId: mod.id },
      { dir: path.join(dir, 'shared'),    prefix: '/shared/', modId: mod.id },
      { dir: path.join(dir, 'overrides'), prefix: '/',        modId: mod.id },
    );
  }
  return roots;
}

const MOD_FILE_ROOTS = buildModFileRoots();

async function tryServeModFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  for (const root of MOD_FILE_ROOTS) {
    if (!url.pathname.startsWith(root.prefix)) continue;
    const relPath = path.normalize(url.pathname.slice(root.prefix.length)).replace(/\\/g, '/');
    let filePath = path.join(root.dir, relPath);
    filePath = path.resolve(filePath);
    if (!filePath.startsWith(path.resolve(root.dir))) continue;

    try {
      const stat = await fsp.stat(filePath);
      if (stat.isFile()) {
        const { MIME } = await import('../Stronghold-Protocol/server/http/files.js');
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';
        const data = await fsp.readFile(filePath);
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        res.end(data);
        return true;
      }
    } catch { /* not found in this root, try next */ }
  }
  return false;
}

async function main() {
  const opts = {};
  const log = makeLogger(!!opts.quiet);

  let srv;
  try {
    srv = await upstreamStartServer({ ...opts });
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`Port in use: ${process.env.PORT || 3000}. Try PORT=3001 npm start`);
    } else {
      console.error('[boot] failed to start', e);
    }
    process.exit(1);
  }

  const upstreamHandler = srv.server.listeners('request')[0];
  if (upstreamHandler) {
    srv.server.removeAllListeners('request');
    srv.server.on('request', async (req, res) => {
      if (await serveModRegistry(req, res)) return;
      if (await tryServeModFile(req, res)) return;
      upstreamHandler.call(srv.server, req, res);
    });
  }

  const port = srv.port || Number(process.env.PORT) || 3000;
  const localUrl = `http://localhost:${port}`;

  const addrs = classifyAddresses().filter((a) => a.kind === 'lan' || a.kind === 'vpn' || a.kind === 'public');
  const line = c.dim('─'.repeat(56));
  console.log(`\n${line}`);
  console.log(`${mark.ok} ${c.bold('服务器已启动')}   本机打开：${c.cyan(localUrl)}`);
  if (addrs.length) {
    console.log('  发给朋友（需要能访问这台电脑的网络）：');
    for (const a of addrs.slice(0, 4)) console.log(`    ${c.cyan(hostUrl(a.address, port))}  ${c.dim(KIND_LABEL[a.kind])}`);
  } else {
    console.log(c.warn('  没有检测到可以分享的地址：朋友暂时无法连接（检查网线/Wi-Fi）。'));
  }
  console.log(c.dim('  建房后把 4 位「同盟密钥」或「复制链接」（…/?room=密钥）发给朋友。'));
  console.log(c.dim('  朋友打不开？运行 node tools/doctor.mjs 检查防火墙。按 Ctrl+C 停止服务器。'));
  console.log(`${line}\n`);

  if (!/^(1|true|yes)$/i.test(process.env.SP_NO_BROWSER || '')) {
    openBrowser(localUrl);
  }

  let stopping = false;
  const stop = (signal) => {
    if (stopping) { console.log('forced exit'); process.exit(1); }
    stopping = true;
    console.log(`\n[${signal}] shutting down...`);
    setTimeout(() => process.exit(0), 5000).unref();
    srv.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  return srv;
}

// Entry point
if (isProcessEntry(import.meta.url)) {
  process.on('unhandledRejection', (e) => console.error('[process] unhandled rejection', e));
  process.on('uncaughtException', (e) => console.error('[process] uncaught exception', e));
  main();
}

export { main as startServer };