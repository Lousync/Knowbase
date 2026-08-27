# 转义字符语法

要显示原本用于格式化 Markdown 文档的字符，请在字符前面添加**反斜杠**（`\`）。

## 基本用法

```markdown
\* Without the backslash, this would be a bullet in an unordered list.
```

渲染效果：

\* Without the backslash, this would be a bullet in an unordered list.

## 可做转义的字符

| 字符 | 名称 |
| --- | --- |
| `\\` | backslash 反斜杠 |
| `` \` `` | backtick 反引号 |
| `\*` | asterisk 星号 |
| `\_` | underscore 下划线 |
| `\{ \}` | curly braces 花括号 |
| `\[ \]` | brackets 方括号 |
| `\( \)` | parentheses 圆括号 |
| `\#` | pound sign 井号 |
| `\+` | plus sign 加号 |
| `\-` | minus sign（hyphen）连字符 |
| `\.` | dot 句点 |
| `\!` | exclamation mark 感叹号 |
| `\|` | pipe 竖线（表格中转义也常用） |

## 使用场景

- 想显示字面 `#`、`*`、`_` 等 Markdown 标记字符时
- 表格单元格中需要显示 `|` 时
- 代码反引号在行内代码中的转义（配合双反引号包裹）