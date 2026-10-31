// quiet-log.mjs — 控制台日志过滤，零侵入（不修改任何上游文件）。
// 用法：通过 NODE_OPTIONS 预加载本文件，替换 console.log。
//   set "NODE_OPTIONS=--import ./quiet-log.mjs"   （Windows cmd，在项目根目录）
//   $env:NODE_OPTIONS = '--import ./quiet-log.mjs' （PowerShell）
// 等价于 `node --import ./quiet-log.mjs server/index.js`；launch.mjs 启动的子进程
// （setup.mjs / server/index.js）会继承 NODE_OPTIONS，一条设置覆盖整条启动链路。
// 关闭过滤：SP_QUIET=0（start-windows-quiet.bat / fetch-assets-quiet.bat 会检查）。
//
// 过滤内容（只影响 console.log；console.error / console.warn 原样输出）：
//   * `[DIAG:` 开头的诊断行（server 里 39 处裸 console.log，没有 env 开关）
//   * `[mod:` 开头的 mod 输出（mod 自己的 console.log；modManager 的 [modManager] 行保留）
//   * `download errors (...)` 汇总行（上游本就缺失的资源，重跑不会变）
//   * `[assets] N leaves dropped: ...` 汇总行（同一批缺失资源的另一条说法）
//   * `[cache] downloading ...` 与 `[network] ...` 行（官方表按需下载的每次重试都打一行，纯噪音）
//   * `[official tables] Downloading as needed / Unavailable ...` 汇总行（同上；表已预取时不会再出现）
//   * 下载进度行保留，但摘掉 `err=N` 字段（那个计数会一路刷屏）
import { format } from 'node:util';

const original = console.log;

const HIDE = [
  (s) => s.startsWith('[DIAG:'),
  (s) => s.startsWith('[mod:'),
  (s) => s.startsWith('download errors ('),
  (s) => /^\[assets\] \d+ (leaf|leaves) dropped:/.test(s),
  (s) => s.startsWith('[cache] downloading'),
  (s) => s.startsWith('[network]'),
  (s) => /^\[official tables\] (Downloading as needed|Unavailable)/.test(s),
];

const PROGRESS = /^(\[[^\]]*\] \d+\/\d+) (ok=\d+ skip=\d+ miss=\d+) err=\d+(\s.*)?$/;

const asText = (args) => (args.length === 1 && typeof args[0] === 'string' ? args[0] : format(...args));

console.log = function (...args) {
  let line;
  try { line = asText(args); } catch { return original.apply(console, args); }
  if (typeof line === 'string') {
    for (const hide of HIDE) if (hide(line)) return;
    const m = PROGRESS.exec(line);
    if (m) return original.call(console, `${m[1]} ${m[2]}${m[3] ?? ''}`);
  }
  return original.apply(console, args);
};