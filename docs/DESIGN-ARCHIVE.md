# 设计文档归档约定（DESIGN-ARCHIVE）

> 本目录（`docs/`）存放**活跃**的设计文档、总纲与过程记录。**已实现（已落码并验证）的设计方案**不在此长期留存，统一归档至独立的过程记录仓库。

## 归档仓库

**DesignProcess** — https://github.com/Lousync/DesignProcess （PRIVATE）
本地路径：`E:\Projects\DesignProcess\`

- `Knowbase-已实现设计文档/` — 从本目录归档过来的已实现设计文档
- `Knowbase-图标重设计/` — 图标项目全过程（决策记录 + 终稿 + 过程稿）
- 该仓库由定时任务自动提交推送：有未提交变更时每日自动 commit + push

## 归档规则

1. **判定标准**：设计方案的核心功能已落码、验证通过（文档头部状态标注"已实现/已落地/Q0 已实现"等，或经实际验证确认），即视为已实现。
2. **归档动作**：实现验证通过后，将设计文档从 `docs/` 移动到 DesignProcess 仓库的 `Knowbase-已实现设计文档/`，随该仓库自动提交推送；同时在本文档的归档清单中登记。
3. **保留在主仓库的**：总纲（rework-master-plan）、仍在演进的设计（待拍板/待排期/分阶段实施中）、调研与评估、验证问题记录、活跃更新记录（ui-updates）。
4. **例外**：暂缓项目（如 voice-input-design）虽不实现，但作为论证留存，保留在主仓库。

## 归档清单

| 日期 | 文档 | 实现证据 |
|---|---|---|
| 2026-09-11 | conflict-resolution-design.md | v1（保存时 mtime 校验）已落地 |
| 2026-09-11 | icon-redesign-record.md | 无影版图标接入 build/，构建验证通过 |
| 2026-09-11 | ignore-filter-design.md | `.ignore` 过滤插 scanMarkdownFiles 全链路生效（2026-09-07 定稿后落码） |
| 2026-09-11 | plugin-web-clipper-design.md | Q0 已实现（2026-09，ebf46e2/e12d27d/583c8ca + 浏览器扩展） |
