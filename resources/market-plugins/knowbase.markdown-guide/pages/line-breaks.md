# 换行语法

在一行的末尾添加**两个或多个空格**，然后按回车，即可创建一个换行（`<br>`）。

## 基本用法

```markdown
This is the first line.  
And this is the second line.
```

渲染效果：

This is the first line.  
And this is the second line.

## 最佳实践

- 几乎所有 Markdown 应用都支持「行尾两个空格」换行（称结尾空格 trailing whitespace），但在编辑器中不易看见，很多人会无意添加
- 更稳妥的替代：使用 HTML 的 `<br>` 标签换行
- **不推荐**：行尾反斜杠 `\` 换行（CommonMark 支持，但并非所有应用都支持）；直接回车换行（仅少数轻量级语言支持）

| ✅ 推荐 | ❌ 不推荐 |
| --- | --- |
| 行尾两个空格 或 `<br>` 标签 | 行尾反斜杠；直接回车 |

> 结论：**为了兼容性，请在行尾使用「结尾空格」或 `<br>` 标签实现换行。**