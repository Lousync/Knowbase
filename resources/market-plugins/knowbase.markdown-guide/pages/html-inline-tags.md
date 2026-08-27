# 行级内联标签

HTML 的**行级内联标签**（inline tags）如 `<span>`、`<cite>`、`<del>` 不受限制，可以在 Markdown 的段落、列表或标题里任意使用。

## 关键特性

1. **任意位置可用**：段落、列表、标题内部均可直接混用
2. **可以替代 Markdown**：依照个人习惯，甚至可以直接用 `<a>` / `<img>` 而不用 Markdown 的链接/图片语法
3. **内联标签内 Markdown 仍可解析**：这是与区块标签最大的区别

## 语法示例

```markdown
This **word** is bold. This <em>word</em> is italic.
```

渲染效果：

This **word** is bold. This *word* is italic.

## 常用内联标签速查

| 标签 | 作用 | 等价 Markdown |
| --- | --- | --- |
| `<em>` | 斜体 | `*斜体*` |
| `<strong>` | 加粗 | `**加粗**` |
| `<del>` | 删除线 | `~~删除线~~` |
| `<a href="...">` | 链接 | `[文字](链接)` |
| `<img src="...">` | 图片 | `![alt](src)` |
| `<span>` | 行内样式容器 | 无 |

## 注意

- 内联标签范围内 **Markdown 语法是可以解析的**（与区块标签相反）
- 更偏好哪种写法取决于个人习惯与需求（如需要改颜色/宽度时用 HTML 更方便）