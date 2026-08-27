# 链接语法

链接文本放在**中括号**内，链接地址放在后面的**圆括号**中，链接 title 可选。

## 基本用法

```markdown
这是一个链接 [Markdown语法](https://markdown.com.cn)。
```

## 给链接增加 Title

title 是鼠标悬停在链接上时出现的文字，放在圆括号内地址之后、以空格分隔：

```markdown
这是一个链接 [Markdown语法](https://markdown.com.cn "最好的markdown教程")。
```

## 网址和 Email 地址

使用尖括号可以把 URL 或 email 地址变成可点击链接：

```markdown
<https://markdown.com.cn>
<fake@example.com>
```

## 带格式化的链接

在链接语法前后加星号即可给链接加粗/斜体；把链接显示为代码则在方括号中添加反引号：

```markdown
I love supporting the **[EFF](https://eff.org)**.
This is the *[Markdown Guide](https://www.markdownguide.org)*.
See the section on [`code`](#code).
```

## 引用类型链接（Reference-style）

引用样式链接把 URL 从正文中移出，使文本更易阅读，分两部分：

**第一部分**（正文内）：两组方括号，第一组为显示文本，第二组为标签：

```markdown
[hobbit-hole][1]
```

**第二部分**（文档任意位置）：标签 + 冒号 + 空格 + URL（+ 可选 title）：

```markdown
[1]: https://en.wikipedia.org/wiki/Hobbit#Lifestyle
[1]: https://en.wikipedia.org/wiki/Hobbit#Lifestyle "Hobbit lifestyles"
```

## 最佳实践

不同的 Markdown 应用处理 URL 中空格的方式不一样。**为了兼容性，请使用 `%20` 代替空格**：

| ✅ 正确 | ❌ 错误 |
| --- | --- |
| `[link](https://www.example.com/my%20great%20page)` | `[link](https://www.example.com/my great page)` |