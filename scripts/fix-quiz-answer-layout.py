#!/usr/bin/env python3
"""
修复 408（及未来）知识包大题解析排版 —— 让每个小问独立成段、加粗小标题。

问题：源 markdown 里大题解析常把多个小问挤在一起（如 "…并深度加 1。2、结点数据类型定义："），
  小问没有标题层级，代码块归属不明，编号风格（1、vs (1)）与题干不统一。

修复策略（针对每道大题）：
  1. 从题干提取每个小问的描述 (1)xxx (2)yyy (3)zzz
  2. 将 spoiler-answer 解析按"句末标点 + 小问编号"切分为若干片段
  3. 将代码块归属到紧随其前的小问
  4. 重组为：
       **解析**：

       **(1) 题干描述**

       内容...
       ```c
       代码
       ```

       **(2) 题干描述**

       内容...

注意：
  - 渲染层 normalizeAnswerLayout 仍保留作为兜底（防重导入/未来插件回归）
  - 本脚本直接更新 knowledge_pages.content_md，插件更新时默认跳过本地修改（保护修复）
  - 实际重写前请用 --dry-run 预览；确认无误后加 --write 实写

用法：
  python scripts/fix-quiz-answer-layout.py             # dry-run：打印每页改动摘要
  python scripts/fix-quiz-answer-layout.py --write     # 实写到 knowledge.db
  python scripts/fix-quiz-answer-layout.py --db PATH   # 指定数据库路径
"""

from __future__ import annotations
import argparse
import os
import re
import sqlite3
import sys
from dataclasses import dataclass, field

# -------- 配置 --------

DEFAULT_DEV_DB = r'C:/Users/徐志岩/AppData/Roaming/knowbase (dev KnowledgeRecorder)/data/knowledge.db'
PROD_DB = r'C:/Users/徐志岩/AppData/Roaming/knowbase/data/knowledge.db'

SENT_END = r'[。：；！？;，]'  # 句末标点
NUM_AFTER = r'[（(]?\d{1,2}[）)、.．]'  # 编号形式
QUESTION_HEAD = re.compile(r'^###\s+第\s*(\d+)\s*题(?:\s*[（(]\s*(\d+)\s*分\s*[）)])?', re.M)
SPOILER_RE = re.compile(r'```spoiler-answer\s*\n([\s\S]*?)\n```(?![A-Za-z0-9_-])')
SUBQ_IN_STEM = re.compile(r'(?<![0-9])[（(](\d{1,2})[）)]\s*([^\n]+?)(?=[（(]?\d{1,2}[）)、.．]|\n|$)')
# 行首小问编号：^数字顿号/括号 + 中文（如 "1、基本设计思想" / "(1) xxx"）
LINE_HEAD_SUBQ = re.compile(r'^\s*[（(]?\d{1,2}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z（(]')
# 行内句末+编号切分（标点后紧跟小问编号）
SUBQ_INLINE = re.compile(rf'[{SENT_END[1:-1]}](?=\s*[（(]?\d{{1,2}}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z])')
OPTION_LINE = re.compile(r'-\s*\*\*[A-H]\.?\*\*')  # 任意选项行（选择题特征）


# -------- 数据结构 --------

@dataclass
class SubQuestion:
    no: int                  # 题号（1-based，匹配题干小问顺序）
    body: str = ''           # 小问正文（不含代码块）
    code_blocks: list[str] = field(default_factory=list)  # 归属该小问的围栏代码


@dataclass
class BigQuestion:
    no: int                  # 大题号（41/42/...）
    points: str              # 分值
    stem: str                # 题干（spoiler 之前）
    sub_titles: list[str]    # 提取的 (1) (2) (3) 描述
    sub_questions: list[SubQuestion] = field(default_factory=list)  # 重组后的小问（带代码块）


# -------- 解析 --------

def split_into_big_questions(md: str) -> list[BigQuestion]:
    """按 ### 第 N 题 切分为大题列表（最后到文件尾或下一题）"""
    heads = list(QUESTION_HEAD.finditer(md))
    if not heads:
        return []
    result = []
    for i, h in enumerate(heads):
        no = int(h.group(1))
        points = h.group(2) or ''
        start = h.start()
        end = heads[i + 1].start() if i + 1 < len(heads) else len(md)
        block = md[start:end]
        # 题干 = 第一个 spoiler 之前
        sp = SPOILER_RE.search(block)
        stem = block[len(h.group(0)):sp.start()].strip() if sp else block[len(h.group(0)):].strip()
        result.append(BigQuestion(no=no, points=points, stem=stem, sub_titles=[]))
    return result


def extract_sub_titles(stem: str) -> list[str]:
    """从题干提取 (1)xxx (2)yyy (3)zzz 描述（按出现顺序）"""
    titles = []
    for m in SUBQ_IN_STEM.finditer(stem):
        titles.append(m.group(2).strip())
    return titles


def parse_spoiler_to_subq(body: str, expect_n: int) -> list[SubQuestion]:
    """
    把 spoiler 正文切分为小问片段 + 归属代码块。

    策略：
      - 行首小问编号（^N、 / ^(N)）→ 新小问开始（最可靠的边界）
      - 行内"句末标点 + 编号 + 中文"→ 切分当前小问（处理首行"答案：1、..."挤一起）
      - 围栏（```c 等）整块归到当时小问
      - 第一个被识别的小问之前的 preamble（如 "**解析**：答案："）丢弃
    """
    lines = body.split('\n')
    sub_questions: list[SubQuestion] = []
    cur = SubQuestion(no=1)
    in_fence = False
    cur_block: list[str] | None = None
    found_first = False  # 是否已识别第 1 个小问

    def finish_cur():
        nonlocal cur
        if cur.body.strip() or cur.code_blocks:
            sub_questions.append(cur)

    for line in lines:
        stripped = line.strip()

        # 围栏切换
        if stripped.startswith('```'):
            if in_fence:
                if cur_block is not None:
                    cur.code_blocks.append('\n'.join(cur_block))
                    cur_block = None
                in_fence = False
            else:
                rest = stripped[3:].strip()
                if rest:
                    in_fence = True
                    cur_block = [line]
            continue

        if in_fence:
            if cur_block is not None:
                cur_block.append(line)
            continue

        # 非围栏：检测行首小问编号
        if LINE_HEAD_SUBQ.match(line):
            if not found_first:
                # 第 1 个小问：丢弃之前累积的 preamble
                cur.body = stripped
                found_first = True
            else:
                # 正常新小问
                finish_cur()
                cur = SubQuestion(no=cur.no + 1, body=stripped)
            continue

        # 续行：累加到 cur.body
        if not cur.body and not stripped and not found_first:
            # preamble 空行：丢弃
            continue
        cur.body = (cur.body + '\n' + line).strip() if cur.body else line.strip()
        m = SUBQ_INLINE.search(cur.body)
        if m and m.end() < len(cur.body):
            if not found_first:
                # 第 1 个小问：丢弃标点前的 preamble，标点 + 后续作为第 1 小问 body
                cur.body = cur.body[m.end():].lstrip()
                found_first = True
            else:
                head = cur.body[:m.end()]
                tail = cur.body[m.end():].lstrip()
                cur.body = head.strip()
                finish_cur()
                cur = SubQuestion(no=cur.no + 1, body=tail)

    # 收尾
    finish_cur()

    # 过滤空小问 + 重编号
    sub_questions = [s for s in sub_questions if s.body.strip() or s.code_blocks]
    for idx, s in enumerate(sub_questions, 1):
        s.no = idx
    return sub_questions


def rebuild_spoiler(bq: BigQuestion) -> str:
    """重组 spoiler-answer 块为加粗小标题格式"""
    out = ['**解析**：', '']
    titles = bq.sub_titles
    for i, sq in enumerate(bq.sub_questions):
        title = titles[i] if i < len(titles) else f'第 {sq.no} 小问'
        out.append(f'**({sq.no}) {title}**')
        out.append('')
        if sq.body:
            out.append(sq.body.strip())
            out.append('')
        for blk in sq.code_blocks:
            out.append(blk.strip())
            out.append('')
    # 去末尾多余空行
    while out and out[-1] == '':
        out.pop()
    return '\n'.join(out)


def fix_block(block: str) -> tuple[str, bool]:
    """
    修复单道大题 block（从 ### 第 N 题 到下一题前）。
    返回 (新 block, 是否修改)。

    跳过条件：选择题（块内含 `- **A.**` 选项行）
    """
    # 跳过选择题
    if OPTION_LINE.search(block):
        return block, False

    sp = SPOILER_RE.search(block)
    if not sp:
        return block, False
    head = block[:sp.start()]
    body = sp.group(1)

    # 仅处理大题（解析开头有 "解析" 标记且不以"**答案："开头——大题无答案字母）
    if '**解析**' not in body and '解析：' not in body:
        return block, False
    if re.match(r'^\s*\*\*答案[：:]', body):
        return block, False  # 选择题

    titles = extract_sub_titles(head)
    sub_questions = parse_spoiler_to_subq(body, expect_n=len(titles) or 1)
    if not sub_questions:
        return block, False

    bq = BigQuestion(no=0, points='', stem=head, sub_titles=titles, sub_questions=sub_questions)
    new_body = rebuild_spoiler(bq)
    new_block = head + '```spoiler-answer\n' + new_body + '\n```' + block[sp.end():]
    return new_block, new_block != block


# -------- 数据库 --------

def get_pages_with_bigq(con: sqlite3.Connection) -> list[tuple[str, str]]:
    cur = con.cursor()
    cur.execute("SELECT id, title, content_md FROM knowledge_pages WHERE content_md LIKE '%第 4%题%' AND content_md LIKE '%spoiler-answer%' AND content_md LIKE '%解析%'")
    return cur.fetchall()


def fix_page(content: str) -> tuple[str, list[int], list[int]]:
    """
    修复一整页 markdown。返回 (新 content, 改动大题号列表, 跳过大题号列表)。
    """
    heads = list(QUESTION_HEAD.finditer(content))
    if not heads:
        return content, [], []
    new_parts = []
    last = 0
    fixed, skipped = [], []
    for i, h in enumerate(heads):
        new_parts.append(content[last:h.start()])
        start = h.start()
        end = heads[i + 1].start() if i + 1 < len(heads) else len(content)
        block = content[start:end]
        new_block, changed = fix_block(block)
        new_parts.append(new_block)
        if changed:
            fixed.append(int(h.group(1)))
        else:
            skipped.append(int(h.group(1)))
        last = end
    new_parts.append(content[last:])
    return ''.join(new_parts), fixed, skipped


def main():
    ap = argparse.ArgumentParser(description='修复大题解析排版')
    ap.add_argument('--db', default=DEFAULT_DEV_DB, help=f'数据库路径（默认 dev 库：{DEFAULT_DEV_DB}）')
    ap.add_argument('--write', action='store_true', help='实写数据库（默认仅 dry-run）')
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f'[ERR] 数据库不存在: {args.db}')
        sys.exit(1)

    con = sqlite3.connect(args.db)
    pages = get_pages_with_bigq(con)
    print(f'[{ "WRITE" if args.write else "DRY-RUN" }] 数据库: {args.db}')
    print(f'含大题页面: {len(pages)}')
    cur = con.cursor()
    total_fixed_pages = 0
    for pid, title, content in pages:
        new_content, fixed, skipped = fix_page(content)
        if not fixed:
            continue
        total_fixed_pages += 1
        print(f'\n  [{title}] 修复大题: 第 {fixed} 题 | 跳过: {skipped or "无"}')
        if not args.write:
            # 预览第一个被修复的大题的新 spoiler
            import re as _re
            m = _re.search(rf'### 第\s*{fixed[0]}\s*题[\s\S]*?```spoiler-answer\s*\n([\s\S]*?)\n```', new_content)
            if m:
                print(f'    预览 (第 {fixed[0]} 题 spoiler):')
                for line in m.group(1).split('\n')[:14]:
                    print(f'      {line}')
                if len(m.group(1).split('\n')) > 14:
                    print(f'      ... (省略)')
        if args.write:
            cur.execute('UPDATE knowledge_pages SET content_md = ?, updated_at = ? WHERE id = ?', (new_content, '2026-08-29T16:00:00Z', pid))
            print(f'    → 已写入')
    if args.write:
        con.commit()
    con.close()
    print(f'\n总计: {total_fixed_pages} 页有改动（{ "已写入" if args.write else "DRY-RUN 未写入" }）')


if __name__ == '__main__':
    main()
