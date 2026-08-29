#!/usr/bin/env python3
"""
408 知识包源文件修复工具 —— 修复 pages/exams/*.md 的大题解析排版并重新打包。

修复内容：
1. spoiler-answer 内嵌套的围栏代码块（```c ... ```）是 markdown 非法嵌套（spoiler 会被提前截断）
   → 转换为"缩进代码块"（行首 4 空格），保证 spoiler 围栏完整、代码内容保留
2. 大题解析重排：小问加粗标题（复用题干 (1)(2)(3) 描述）+ 独立成段 + 代码块归属正确
3. 升版本 + 重新打包 zip

用法：
  python scripts/fix-408-pack.py --src <插件目录> --out <输出目录> --version X.Y.Z
  # 默认 src = 本机 dev 库 408 插件目录；输入应为"原始 1.1.0 未修复"的插件源
"""

from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import zipfile

# -------- 排版修复逻辑 --------

QUESTION_HEAD = re.compile(r'^###\s+第\s*(\d+)\s*题(?:\s*[（(]\s*(\d+)\s*分\s*[）)])?', re.M)
SUBQ_IN_STEM = re.compile(r'(?<![0-9])[（(](\d{1,2})[）)]\s*([^\n]+?)(?=[（(]?\d{1,2}[）)、.．]|\n|$)')
LINE_HEAD_SUBQ = re.compile(r'^\s*[（(]?\d{1,2}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z（(]')
SUBQ_INLINE = re.compile(r'[。：；！？;，](?=\s*[（(]?\d{1,2}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z])')
OPTION_LINE = re.compile(r'-\s*\*\*[A-H]\.?\*\*')
PLACEHOLDER_RE = re.compile(r'\[\[KBCODE-(\d+)\]\]')


def extract_spoiler(block: str) -> tuple[str, str] | None:
    """
    状态机提取 spoiler-answer 完整内容（支持内部嵌套 ```c 等围栏）。
    返回 (body, 结束 ``` 之后的尾部) 或 None（无 spoiler）。
    """
    lines = block.split('\n')
    body_lines = []
    in_spoiler = False
    in_fence = False
    end_idx = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not in_spoiler:
            if stripped.startswith('```spoiler-answer'):
                in_spoiler = True
            continue
        if stripped.startswith('```'):
            rest = stripped[3:].strip()
            if in_fence:
                in_fence = False
                body_lines.append(line)
                continue
            if rest and not rest.startswith('spoiler'):
                in_fence = True
            else:
                # spoiler 结束（空 ``` 或 ```spoiler 变体）
                end_idx = i
                break
        body_lines.append(line)
    if not in_spoiler or end_idx < 0:
        return None
    # 尾部 = 结束 ``` 行之后的所有行
    tail = '\n'.join(lines[end_idx + 1:])
    return '\n'.join(body_lines), tail


def preprocess_code_blocks(body: str) -> tuple[str, dict[str, str]]:
    """
    把 body 内嵌套的围栏代码块（```c ... ```）替换为占位符 [[KBCODE-n]]，
    返回 (新 body, 占位符→代码内容映射)。代码内容存原始行（不缩进），
    占位符在 rebuild 时替换为缩进代码块（围栏内安全写法）。
    """
    lines = body.split('\n')
    out: list[str] = []
    code_map: dict[str, str] = {}
    in_fence = False
    cur_code: list[str] = []
    idx = 0
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('```'):
            rest = stripped[3:].strip()
            if in_fence:
                in_fence = False
                code_map[f'[[KBCODE-{idx}]]'] = '\n'.join(cur_code)
                idx += 1
                cur_code = []
                out.append(f'[[KBCODE-{idx - 1}]]')
                continue
            if rest and not rest.startswith('spoiler'):
                in_fence = True
                cur_code = []
                continue
        if in_fence:
            cur_code.append(line)
        else:
            out.append(line)
    if cur_code:
        code_map[f'[[KBCODE-{idx}]]'] = '\n'.join(cur_code)
        out.append(f'[[KBCODE-{idx}]]')
    return '\n'.join(out), code_map


def indent_code(code: str) -> str:
    """代码内容 → 缩进代码块文本（每行行首 4 空格，空行保持空行）"""
    lines = []
    for l in code.split('\n'):
        lines.append('    ' + l if l.strip() else l)
    return '\n'.join(lines)


def replace_placeholders(text: str, code_map: dict[str, str]) -> str:
    """把文本中的占位符替换为缩进代码块（独立段落）"""
    out = text
    for ph, code in code_map.items():
        if ph in out:
            out = out.replace(ph, '\n\n' + indent_code(code) + '\n\n')
    return out


def parse_spoiler_to_subq(body: str) -> list[dict]:
    """
    把 spoiler 正文（已做围栏→占位符预处理）切分为小问片段。
    行首小问编号（^N、/^(N)）开新小问；行内"句末标点+编号"切分当前小问；
    第一个小问前的 preamble（"**解析**：答案："）丢弃。
    """
    lines = body.split('\n')
    sub_qs: list[dict] = []
    cur: dict = {'body': '', 'code': []}
    found_first = False

    def finish():
        nonlocal cur
        if cur['body'].strip() or cur['code']:
            sub_qs.append(cur)

    for line in lines:
        stripped = line.strip()
        if stripped.startswith('```'):
            # 占位符方案下不应出现围栏行；防御性跳过
            continue
        if LINE_HEAD_SUBQ.match(line):
            if not found_first:
                cur = {'body': stripped, 'code': []}
                found_first = True
            else:
                finish()
                cur = {'body': stripped, 'code': []}
            continue
        if not cur['body'] and not stripped and not found_first:
            continue
        cur['body'] = (cur['body'] + '\n' + line).strip() if cur['body'] else line.strip()
        m = SUBQ_INLINE.search(cur['body'])
        if m and m.end() < len(cur['body']):
            if not found_first:
                cur['body'] = cur['body'][m.end():].lstrip()
                found_first = True
            else:
                tail = cur['body'][m.end():].lstrip()
                cur['body'] = cur['body'][:m.end()].strip()
                finish()
                cur = {'body': tail, 'code': []}
    finish()
    sub_qs = [s for s in sub_qs if s['body'].strip() or s['code']]
    return sub_qs


def fix_block(block: str) -> str:
    """修复单道大题块（选择题/非解析跳过）。"""
    if OPTION_LINE.search(block):
        return block
    sp = extract_spoiler(block)
    if not sp:
        return block
    body, tail = sp
    if '**解析**' not in body and '解析：' not in body:
        return block
    if re.match(r'^\s*\*\*答案[：:]', body):
        return block

    # 题干 (1)(2)(3) 描述
    head = block[:block.find('```spoiler-answer')]
    titles = [m.group(2).strip() for m in SUBQ_IN_STEM.finditer(head)]

    # 嵌套围栏 → 占位符，再切分小问
    body, code_map = preprocess_code_blocks(body)
    sub_qs = parse_spoiler_to_subq(body)
    if not sub_qs:
        return block

    # 重组
    out = ['**解析**：', '']
    for i, sq in enumerate(sub_qs):
        title = titles[i] if i < len(titles) else f'第 {i + 1} 小问'
        out.append(f'**({i + 1}) {title}**')
        out.append('')
        sq_body = replace_placeholders(sq['body'].strip(), code_map) if sq['body'].strip() else ''
        if sq_body:
            out.append(sq_body)
            out.append('')
        for blk in sq['code']:
            out.append(indent_code(blk))
            out.append('')
    while out and out[-1] == '':
        out.pop()
    new_body = '\n'.join(out)

    return head + '```spoiler-answer\n' + new_body + '\n```' + tail


def fix_content(content: str) -> tuple[str, list[int]]:
    heads = list(QUESTION_HEAD.finditer(content))
    if not heads:
        return content, []
    parts, last, fixed = [], 0, []
    for i, h in enumerate(heads):
        parts.append(content[last:h.start()])
        start, end = h.start(), heads[i + 1].start() if i + 1 < len(heads) else len(content)
        new_block = fix_block(content[start:end])
        if new_block != content[start:end]:
            fixed.append(int(h.group(1)))
        parts.append(new_block)
        last = end
    parts.append(content[last:])
    return ''.join(parts), fixed


# -------- 打包 --------

def repack(src: str, out_dir: str, version: str) -> str:
    plugin_id = 'knowbase.kb-408-pack'
    zip_path = os.path.join(out_dir, f'{plugin_id}-{version}.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(src):
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, src).replace('\\', '/')
                zf.write(full, rel)
    return zip_path


def main():
    ap = argparse.ArgumentParser(description='修复 408 插件源并打包')
    ap.add_argument('--src', default=r'C:/Users/徐志岩/AppData/Roaming/knowbase (dev KnowledgeRecorder)/plugins/knowbase.kb-408-pack')
    ap.add_argument('--out', default=r'C:/Users/徐志岩/.workbuddy/tmp/kb408-v1.2.1')
    ap.add_argument('--version', default='1.2.1')
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        print(f'[ERR] 源目录不存在: {args.src}')
        return

    work = os.path.join(args.out, 'pack')
    if os.path.exists(work):
        shutil.rmtree(work)
    shutil.copytree(args.src, work)

    exam_dir = os.path.join(work, 'pages', 'exams')
    total_fixed = 0
    if os.path.isdir(exam_dir):
        for name in sorted(os.listdir(exam_dir)):
            if not name.endswith('.md'):
                continue
            path = os.path.join(exam_dir, name)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            new_content, fixed = fix_content(content)
            if fixed:
                with open(path, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(new_content)
                print(f'  [{name}] 修复大题: 第 {fixed} 题')
                total_fixed += len(fixed)
    print(f'共修复 {total_fixed} 道大题解析')

    mf_path = os.path.join(work, 'plugin.json')
    with open(mf_path, 'r', encoding='utf-8') as f:
        mf = json.load(f)
    mf['version'] = args.version
    mf['description'] = mf.get('description', '') + '（v1.2.1 修复：解析内代码块由围栏改为缩进写法，spolier 折叠不再被截断）'
    with open(mf_path, 'w', encoding='utf-8') as f:
        json.dump(mf, f, ensure_ascii=False, indent=2)

    zip_path = repack(work, args.out, args.version)
    print(f'打包完成: {zip_path} ({os.path.getsize(zip_path) / 1024 / 1024:.1f} MB)')


if __name__ == '__main__':
    main()
