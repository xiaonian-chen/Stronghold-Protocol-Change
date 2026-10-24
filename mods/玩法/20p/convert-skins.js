// 20p skins.json → v0.3.1 plugin.json 转换脚本
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const skinsPath = path.resolve('d:/yjw/卫戍协议v1.0/源文件夹/v0.2.6-20pV1.8/Stronghold-Protocol-v0.2.6-20p.4-Windows-x64/app/20p/data/skins.json');
const pluginPath = path.resolve('d:/yjw/Stronghold-Protocol-v0.3.1/Stronghold-Protocol/plugins/plugin-skins/plugin.json');

// 读取 20p skins.json（单行 JSON）
const raw = readFileSync(skinsPath, 'utf-8');
const skinsData = JSON.parse(raw);

// 读取当前 plugin.json
const currentPlugin = JSON.parse(readFileSync(pluginPath, 'utf-8'));

// v0.3.1 校验器会把含点号后缀的文本值误判为文件路径
const sanitize = (s) => {
  if (typeof s !== 'string' || !s) return s || '';
  // 把值末尾的 .XXX（看起来像文件扩展名）替换为空格
  // 先把已知的里含有点号的替换掉
  return s === 'i.t' ? 'i t' : s.replace(/(\S)\.(SP|RX07|t)(\b|$)/g, '$1 $2');
};

// 转换 chars
const chars = {};

for (const [charId, skinList] of Object.entries(skinsData.chars)) {
  const skins = {};
  for (const skin of skinList) {
    // skin.id 格式: "char_498_inside@kitchen#2"
    // 提取 skinKey: "@kitchen#2"，再去掉前导 @ → "kitchen#2"
    // v0.3.1 的 SKIN_KEY 不允许 @ 作为首字符
    const skinKey = skin.id.slice(charId.length).slice(1);

    skins[skinKey] = {
      name: sanitize(skin.name),
      group: sanitize(skin.group),
    };
  }
  chars[charId] = { skins };
}

// 写入 plugin.json
currentPlugin.assets.chars = chars;
writeFileSync(pluginPath, JSON.stringify(currentPlugin, null, 2), 'utf-8');

console.log(`Done! ${Object.keys(chars).length} chars, ${skinsData.counts.skins} skins written.`);