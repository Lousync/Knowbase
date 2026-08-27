# 何时在 Markdown 中使用 HTML

对于 Markdown 涵盖范围之外的标签，可以直接在文件里使用 HTML 本身。

## 核心原则

- 无需额外标注「这是 HTML 还是 Markdown」——把 HTML 标签直接添加到 Markdown 文本中即可
- 当需要**更改元素属性**时（如指定文本颜色、更改图片宽度），HTML 标签比 Markdown 语法更方便
- 例如：可以用 HTML 的 `<a>` / `<img>` 直接替代 Markdown 的链接与图片语法

## 一句话总结

> **Markdown 写不了的，就交给 HTML；两者可以直接混排。**

## 示例

```markdown
这是一个 <span style="color:red">红色文字</span> 的例子。
```

渲染效果：

这是一个 <span style="color:red">红色文字</span> 的例子。

## 适用范围

| 场景 | 推荐方式 |
| --- | --- |
| 段落、强调、列表、链接等基础排版 | Markdown 语法 |
| 需要精细控制属性（颜色/宽度/对齐） | 内联 HTML 标签 |
| 表格、复杂布局等 Markdown 不擅长之处 | HTML 区块标签 |