# 干员时装

Plugin: plugin-skins (cosmetic; scope room, personal). 插件在房间「插件」面板由房主为全房间开启，或玩家在 设置 → 外观插件 为自己开启；它只改变显示，不影响战斗。

这个包收录**四个官方赛季版本（一期上半 / 一期下半 / 二期上半 / 二期下半）可出现干员的并集**，因此房间内切换版本时无需换包。剩下的官方时装在配套的个人插件 `plugin-skins-extra` 里（见下）。

## 内容（实测）

| 项 | 数量 |
|---|---|
| 干员 | 193 |
| 时装 | 299 |
| Spine 模型 | 394（front 200 / back 194） |
| 只有正面模型的时装 | 6 |
| 体积 | 192.8 MB，1481 个文件 |

每套时装的字段是 `name`、`group`、`avatar`、`portrait`、`spine.front`，有背面模型的再加 `spine.back`。`avatar` 与 `portrait` 都指向同一张 180×180 裁剪图。只有正面模型的时装不写 `spine.back`，游戏里会回落到正面模型，不报错。

`name` 与 `group` 取自官方 `skin_table.json` 的 `displaySkin.skinName` / `displaySkin.skinGroupName`，没有手写。

## 素材来源与落盘规则

素材由本机官方客户端（`Arknights_Data/StreamingAssets/AB/Windows`）的 `skinpack`、`chararts`、`ui_char_avatar` 资源包提取：

- `.skel` 与 `.atlas` 按字节原样写出，`<skinId>` 为正面、`<skinId>b` 为背面；
- 页面 PNG 按 `SkeletonDataAsset → AtlasAsset → Material._MainTex/_AlphaTex` 精确配对，不按文件名猜；
- `_UseAlphaTex=1` 的页面把独立 `[alpha]` 纹理的 L 通道合成进 A 通道，输出直连 RGBA，并移除 atlas 的 `pma:` 字段，避免 pixi-spine 重复预乘；
- 头像取自 `ui_char_avatar_*.ab` 的 180×180 Sprite。

全量官方时装现在统一落在归档目录 `d:\yjw\outfits-src`（含 `manifest.json`），两个插件包都是它的一份视图，素材只有一份。本包的干员集合是四赛季并集，由 `d:\yjw\_apply_skins.py` 按 `_gap.json` 的缺口清单从客户端补齐；`plugin-skins-extra` 由 `d:\yjw\_build_extra_plugin.py` 从归档目录生成。

## 版本适配

时装的可见性由现成机制决定，都按 `charId` 而非按包：

1. 时装选择器逐干员渲染，名单来自当前版本的棋池与自选编队，不在该版本的干员不会出现；
2. `server/lobby.js` 的 `skins()` 用 `operatorCharIds(当前版本数据)` 剪裁玩家提交的皮肤表，集合含棋池全部记录、补位替身、`diy.ownedPool` 与 `diy.operators`，自选编队的 6★ 时装因此天然被允许；
3. 房间切版本时 `applyVersion` 重新解析插件集合并让成员页面重新加载，新版本没有的干员自动不显示。

所以同一个包在四个赛季之间切换时只显示当前版本该有的时装，后续新增赛季也无需改这个插件。

## 与 plugin-skins-extra 的分工

单插件上限 200 MB、房间视觉集合计上限 300 MB（`shared/plugins/manifest.js` 的 `PLUGIN_LIMITS`、`shared/plugins/visual.js` 的 `VISUAL_LIMITS`）。本包 192.8 MB 已接近单包上限，再塞入剩余 147 MB 会同时触顶，因此：

- 本包（`room` + `personal`）：四赛季并集，房主开启后全房间可见，切版本自动适配；
- `plugin-skins-extra`（`personal`）：其余干员的官方时装，玩家在 设置 → 外观插件 自己开启。

两者写的是同一套 `charId` 下的不同皮肤键，同时开启不会冲突；同一个干员的时装若已在主包，扩展包不会重复收录。

## 更新流程

```
python d:\yjw\_extract_outfits.py                 # dry-run，只解析不落盘
python d:\yjw\_extract_outfits.py --apply         # 写入 d:\yjw\outfits-src 与 manifest.json
python d:\yjw\_apply_skins.py --apply              # 按缺口清单补齐本包缺失的时装
python d:\yjw\_build_extra_plugin.py               # 生成 plugin-skins-extra（已收录的时装自动跳过）
node tools/plugin.mjs pack plugin-skins           # 重建 plugin.lock.json
node tools/plugin.mjs check plugin-skins --strict
```

`plugin.lock.json` 由 `pack` 生成（文件哈希、每个模型的动画/事件/命中时间/骨骼边界），不要手写或手改。脚本是幂等的：重复运行只覆盖同名素材。

## 已知缺口

`nlc#1` 三套（`char_1033_swire2`、`char_1040_blaze2`、`char_2025_shu`）尚未收录：官方 `skin_table.json` 里这三套的上线时间是 2026-10-16，本机客户端 2026-10-10 的 `skinpack` 包还没有下发对应资源。`char_101_sora@summer#1` 在本机资源包里只有基建模型，没有战斗骨架，同样跳过。等客户端更新后重跑上面的流程即可。

## 自检

schema → `node tools/plugin.mjs check plugin-skins --strict` → `node tools/plugin.mjs pack plugin-skins --zip`。本插件没有 `test/` 目录，`node tools/plugin.mjs test` 不适用（它只跑插件自带的作者测试）。

规则见 [docs/PLUGINS.md](../../docs/PLUGINS.md) 与 [docs/PLUGIN-GUIDE.md](../../docs/PLUGIN-GUIDE.md)。