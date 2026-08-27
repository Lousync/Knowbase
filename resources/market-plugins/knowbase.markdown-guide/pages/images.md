# 图片语法

要添加图片，请使用感叹号（`!`），方括号内写替代文本，圆括号内放图片链接，链接后可以附加可选的图片 title。

## 基本用法

```markdown
![这是图片](/assets/img/philly-magic-garden.jpg "Magic Gardens")
```

语法结构：`![图片alt](图片链接 "图片title")`

## 链接图片

给图片增加链接：将图片的 Markdown 括在**方括号**中，然后将链接放在**圆括号**中：

```markdown
[![沙漠中的岩石图片](/assets/img/shiprock.jpg "Shiprock")](https://markdown.com.cn)
```

点击图片即跳转到链接地址。

## 要点速记

- `!` + `[alt]` + `(src "title")`
- alt 文本在图片无法加载时显示，也是无障碍阅读的基础
- 链接图片 = 图片语法整体再包一层 `[]()`