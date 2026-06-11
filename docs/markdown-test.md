# 一级标题 H1
## 二级标题 H2
### 三级标题 H3
#### 四级标题 H4
##### 五级标题 H5
###### 六级标题 H6

---

## 文本样式

这是普通段落文字，包含**粗体**、*斜体*、***粗斜体***、~~删除线~~、`行内代码`。

## 列表

### 无序列表
- 项目一
- 项目二
  - 嵌套项目 2.1
  - 嵌套项目 2.2
- 项目三

### 有序列表
1. 第一步
2. 第二步
   1. 子步骤 2.1
   2. 子步骤 2.2
3. 第三步

### 任务列表
- [x] 已完成任务
- [ ] 待完成任务
- [ ] 另一个待办

## 引用

> 这是一段引用文字，可以包含**其他格式**。
> 
> 引用可以有多段。
>
> > 嵌套引用也是支持的。

## 链接与图片

[百度链接](https://www.baidu.com)

![示例图片](https://placehold.co/600x200/007acc/white?text=Hello+Markdown)

## 代码

行内代码：`const hello = "world"`

### 代码块（JavaScript）
```js
function greet(name) {
  console.log(`Hello, ${name}!`)
}

// 斐波那契数列
const fib = (n) => n <= 1 ? n : fib(n - 1) + fib(n - 2)
console.log(fib(10)) // 55
```

### 代码块（TypeScript）
```ts
interface User {
  id: string
  name: string
  email: string
}

async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`)
  return res.json()
}
```

### 代码块（Python）
```python
def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

print(quick_sort([3, 6, 8, 10, 1, 2, 1]))
```

### 代码块（CSS）
```css
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
```

## 表格

| 姓名 | 年龄 | 城市 | 职业 |
|------|------|------|------|
| 张三 | 28 | 北京 | 工程师 |
| 李四 | 32 | 上海 | 设计师 |
| 王五 | 25 | 深圳 | 产品经理 |

## 分隔线

上面一段文字。

---

下面一段文字。

***

另一种分隔线。

___

## HTML 标签

<details>
<summary>点击展开详情</summary>

这是折叠的内容，可以在 Markdown 中嵌入 HTML。

- 支持列表
- 支持**格式**

</details>

<kbd>Ctrl</kbd> + <kbd>S</kbd> 保存

## 数学公式（LaTeX）

行内公式：$E = mc^2$

块级公式：

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

## 脚注

这是一个带脚注的句子[^1]。

[^1]: 这是脚注的内容。

## 表情符号

:smile: :rocket: :books: :memo: :bulb: :warning: :white_check_mark: :x:

## 水平定义列表

术语 1
: 这是术语 1 的定义说明

术语 2
: 这是术语 2 的定义说明

---

> **测试完成！** 以上涵盖了 Markdown 常用语法。
