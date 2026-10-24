// 20p/server.js — 20p 自定义服务入口 (multi-mod aware)
// 架构：导入上游 startServer()，在其基础上挂载所有 mod 模块
// 上游 Stronghold-Protocol/ 目录零修改，升级时整包替换即可

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== 0. 加载 Mod 系统 =====
await import('../../mod-framework/modManager.js');

// ===== 1. 从上游导入核心模块 =====
import { startServer as upstreamStartServer } from '../../Stronghold-Protocol/server/index.js';
import { makeLogger } from '../../Stronghold-Protocol/server/http/config.js';
import { isProcessEntry, printBanner } from '../../Stronghold-Protocol/server/http/boot.js';

// ===== 2. 多 Mod 客户端文件覆盖服务 =====
// 收集所有已启用 mod 的客户端文件目录，按优先级依次尝试匹配。
// 每个 mod 可选提供三个目录：
//   public/   → URL /         （客户端专用覆盖：lobby.js, room.js 等）
//   shared/   → URL /shared/  （A 类共用代码）
//   overrides/ → URL /         （B 类上游副本 client/src 覆盖）
//
// 查找顺序：后加载的 mod 优先级更高；每个 mod 内部先查 public/ → shared/ → overrides/。

import { getLoadedMods } from '../../mod-framework/modManager.js';

function buildModFileRoots() {
  const roots = [];
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
    if (!filePath.startsWith(root.dir)) continue;

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
    } catch { /* 本根目录下无此文件，继续检查下一个 */ }
  }
  return false;
}

// ===== 4. 启动服务器 =====
async function main() {
  const opts = {};

  const srv = await upstreamStartServer({ ...opts });

  const upstreamHandler = srv.server.listeners('request')[0];
  if (upstreamHandler) {
    srv.server.removeAllListeners('request');
    srv.server.on('request', async (req, res) => {
      if (await tryServeModFile(req, res)) return;
      upstreamHandler.call(srv.server, req, res);
    });
  }

  printBanner(srv);
  return srv;
}

// 入口
if (isProcessEntry(import.meta.url)) {
  process.on('unhandledRejection', (e) => console.error('[process] unhandled rejection', e));
  process.on('uncaughtException', (e) => console.error('[process] uncaught exception', e));

  const opts = {};
  const log = makeLogger(!!opts.quiet);

  let srv;
  try {
    srv = await upstreamStartServer({ ...opts });
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`端口已被占用 / port in use: ${process.env.PORT || 3000}. Try PORT=3001 npm start`);
    } else {
      console.error('[boot] failed to start', e);
    }
    process.exit(1);
  }

  const upstreamHandler = srv.server.listeners('request')[0];
  if (upstreamHandler) {
    srv.server.removeAllListeners('request');
    srv.server.on('request', async (req, res) => {
      if (await tryServeModFile(req, res)) return;
      upstreamHandler.call(srv.server, req, res);
    });
  }

  printBanner(srv);

  let stopping = false;
  const stop = (signal) => {
    if (stopping) { console.log('forced exit'); process.exit(1); }
    stopping = true;
    console.log(`\n[${signal}] shutting down…`);
    setTimeout(() => process.exit(0), 5000).unref();
    srv.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

export { main as startServer };