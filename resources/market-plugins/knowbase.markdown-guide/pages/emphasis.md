# 强调语法(粗体与斜体)

通过将文本设置为**粗体**或**斜体**来强调其重要性。

## 粗体（Bold）

在单词或短语前后各添加**两个星号**或**两个下划线**：

```markdown
I just love **bold text**.
I just love __bold text__.
Love**is**bold
```

## 斜体（Italic）

在单词或短语前后各添加**一个星号**或**一个下划线**：

```markdown
Italicized text is the *cat's meow*.
Italicized text is the _cat's meow_.
A*cat*meow
```

## 粗体 + 斜体

在单词或短语前后各添加**三个星号或下划线**（也可混合 `__*` / `**_`）：

```markdown
This text is ***really important***.
This text is ___really important___.
This text is __*really important*__.
This is really***very***important text.
```

## 最佳实践

| 场景 | ✅ 推荐 | ❌ 避免 |
| --- | --- | --- |
| 单词中间加粗 | `Love**is**bold` | `Love__is__bold`（下划线在词中兼容性差） |
| 单词中间斜体 | `A*cat*meow` | `A_cat_meow` |
| 单词中间粗斜体 | `This is really***very***important` | `This is really___very___important` |

> 核心原则：**单词或短语中间部分的强调一律使用星号（asterisks），以保证跨应用兼容。**