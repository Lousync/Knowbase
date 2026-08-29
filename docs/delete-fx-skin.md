# 删除动画皮肤（deleteFx）插件开发规范

知识库删除条目的吞噬特效**外观可被插件替换**（内置默认：纯红色进度条，无装饰）。

## 插件声明（contributes.deleteFx）

纯数据贡献（S 级内容），**不执行任何代码**：

```json
{
  "id": "com.example.dragon-skin",
  "name": "像素小龙",
  "version": "1.0.0",
  "type": "declarative",
  "category": "外观",
  "contributes": {
    "deleteFx": {
      "id": "pixel-dragon",
      "name": "像素小龙",
      "dragonSvg": "<svg viewBox=\"0 0 96 64\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"8\" y=\"8\" width=\"12\" height=\"12\" fill=\"#c52828\"/></svg>",
      "particleColors": ["#ffb74d", "#ff5252", "#ff7043"],
      "wipeColor": "#e81123",
      "durationMs": 560
    }
  }
}
```

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 皮肤 id（默认取插件 id） |
| `name` | string | 否 | 皮肤名（默认取插件名），显示在 设置 → 外观 → 删除动画皮肤 |
| `dragonSvg` | string | 否 | **可选装饰**（龙头等完整 `<svg>` 标签，含 viewBox）。注入时原样渲染；**禁 `<script>`、`on*` 事件、`javascript:`**（校验拒绝）；≤16KB。内置默认无装饰（纯红进度条），插件可按需提供 |
| `particleColors` | string[] | 否 | 粒子颜色（#RGB/#RRGGBB 等），1-12 个，循环应用到 6 颗火星 |
| `wipeColor` | string | 否 | 吞噬遮罩颜色（默认 `--danger` 主题变量） |
| `durationMs` | number | 否 | 删除中"红色吞噬推进到 55% 的时长"（300-2000ms，默认 1100）。动画总时长=删除实际耗时：删除完成前红色停在 55% 龙头循环咀嚼；删除完成瞬间收尾（吞完剩余 + 淡出） |

**安全校验**（pluginRegistry）：`dragonSvg` 含 `<script`/`on*=`/`javascript:` 直接拒收；全部为 S 级内容贡献，无代码执行面。

## 用户侧

- 设置 → 外观 → **删除动画皮肤**：选择 内置红色进度条 / 各插件皮肤
- 皮肤由 `settings.deleteFxSkin` 持久化；插件卸载/停用后自动回退内置

## 机制落点

| 位置 | 内容 |
|---|---|
| `electron/lib/pluginRegistry.ts` | `deleteFx` 贡献校验 + `plugin:listDeleteFxSkins` IPC（聚合已启用插件的皮肤） |
| `src/lib/deleteFx.ts` | 皮肤加载（模块级缓存）+ 内置皮肤 id |
| `src/components/shared/DeleteWipe.tsx` | 特效渲染：插件 dragonSvg 注入 / 内置像素龙；颜色/时长走 CSS 变量（--kb-wipe / --kb-dur / 粒子 --p） |
| `src/modules/settings/views/AppearanceView.tsx` | 皮肤选择 UI |

## 注意

- `dragonSvg` 给完整 `<svg>`，自己带 `viewBox` 和内部像素/矢量内容（可选装饰，不给就纯进度条）
- 装饰渲染位置：条目行右缘（`right:-12px; top:-26px`），删除中随吞噬推进到半程（translateX -60%）后循环张嘴动画，完成时掠过整行——设计时主体面朝左
- 颜色建议同时兼顾深浅主题（粒子/吞噬色是固定色，不随主题变量）
