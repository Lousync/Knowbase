# 标题语法

要创建标题，请在单词或短语前面添加井号（`#`）。`#` 的数量代表标题的级别（1-6 级）。

## 基本用法

```markdown
# Heading level 1
## Heading level 2
### Heading level 3
#### Heading level 4
##### Heading level 5
###### Heading level 6
```

## 可选语法

在文本下方添加任意数量的 `==`（一级标题）或 `--`（二级标题）：

```markdown
Heading level 1
===============

Heading level 2
---------------
```

## 最佳实践

不同的 Markdown 应用处理 `#` 与标题之间空格的方式不一致。为了兼容，请在 `#` 和标题之间使用**一个空格**分隔：

| ✅ 正确 | ❌ 错误 |
| --- | --- |
| `# Here's a Heading` | `#Here's a Heading` |