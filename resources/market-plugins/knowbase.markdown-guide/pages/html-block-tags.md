# 区块标签

**区块元素**（block elements）——比如 `<div>`、`<table>`、`<pre>`、`<p>` 等——有严格的使用约束。

## 三条硬性规则

1. **前后必须加空行**：与其它内容用空行分隔，便于区分
2. **不能缩进**：开始与结束标签不可以用 tab 或空格缩进
3. **区块内 Markdown 不解析**：HTML 区块标签内部的 Markdown 语法（如 `*强调*`）不会被处理

## 正确示例

```markdown
This is a regular paragraph.

<table>
    <tr>
        <td>Foo</td>
    </tr>
</table>

This is another regular paragraph.
```

- 表格前后各有一个空行，与段落隔开
- Markdown 会自动识别区块元素，避免在区块标签前后加上多余的 `<p>` 标签

## 反例（常见错误）

```markdown
This is a regular paragraph.
<table>
    <tr><td>Foo</td></tr>
</table>
This is another regular paragraph.
```

> ❌ 表格前后没有空行，会导致格式异常。

## 区块内不能使用 Markdown

```markdown
<p>italic and **bold**</p>
```

`**bold**` 不会被解析为加粗——在 HTML 区块内必须用 HTML 本身的 `<strong>`。

## 易混点对比

| 标签类型 | 是否需要空行 | 是否可缩进 | 内部 Markdown 是否解析 |
| --- | --- | --- | --- |
| 行级内联（`<span>` 等） | 不需要 | 随意 | ✅ 可以 |
| 区块（`<div>` 等） | 必须 | 不可以 | ❌ 不行 |