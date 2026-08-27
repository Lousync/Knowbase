# 引用块语法

要创建块引用，请在段落前添加一个 `>` 符号。

## 基本用法

```markdown
> Dorothy followed her through many of the beautiful rooms in her castle.
```

## 多个段落的块引用

为段落之间的空白行也添加 `>` 符号：

```markdown
> Dorothy followed her through many of the beautiful rooms in her castle.
>
> The Witch bade her clean the pots and kettles.
```

## 嵌套块引用

在要嵌套的段落前添加 `>>`：

```markdown
> Dorothy followed her through many of the beautiful rooms in her castle.
>
>> The Witch bade her clean the pots and kettles.
```

## 带有其它元素的块引用

块引用可以包含其他 Markdown 元素（并非所有元素都有效，需自行实验）：

```markdown
> #### The quarterly results look great!
>
> - Revenue was off the chart.
> - Profits were higher than ever.
>
> *Everything* is going according to **plan**.
```