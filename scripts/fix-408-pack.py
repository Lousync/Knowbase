#!/usr/bin/env python3
"""
408 知识包源文件修复工具 —— 修复 pages/exams/*.md 的大题解析排版并重新打包。

用法：
  python scripts/fix-408-pack.py --src <插件目录> --out <输出目录>
  # 输出目录内生成: 修复后的插件树 + knowbase.kb-408-pack-<version>.zip
  # 默认: --src 本机 dev 库 408 插件目录, --out C:/Users/<user>/.workbuddy/tmp/kb408-out
"""

from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import zipfile

# -------- 排版修复逻辑（与 fix-quiz-answer-layout.py 保持一致） --------

QUESTION_HEAD = re.compile(r'^###\s+第\s*(\d+)\s*题(?:\s*[（(]\s*(\d+)\s*分\s*[）)])?', re.M)
SPOILER_RE = re.compile(r'```spoiler-answer\s*\n([\s\S]*?)\n```(?![A-Za-z0-9_-])')
SUBQ_IN_STEM = re.compile(r'(?<![0-9])[（(](\d{1,2})[）)]\s*([^\n]+?)(?=[（(]?\d{1,2}[）)、.．]|\n|$)')
LINE_HEAD_SUBQ = re.compile(r'^\s*[（(]?\d{1,2}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z（(]')
SUBQ_INLINE = re.compile(r'[。：；！？;，](?=\s*[（(]?\d{1,2}[）)、.．]\s*[\u4e00-\u9fa5A-Za-z])')
OPTION_LINE = re.compile(r'-\s*\*\*[A-H]\.?\*\*')


def fix_block(block: str) -> str:
    """修复单道大题块（选择题/非解析跳过）。"""
    if OPTION_LINE.search(block):
        return block
    sp = SPOILER_RE.search(block)
    if not sp:
        return block
    head = block[:sp.start()]
    body = sp.group(1)
    if '**解析**' not in body and '解析：' not in body:
        return block
    if re.match(r'^\s*\*\*答案[：:]', body):
        return block

    # 题干 (1)(2)(3) 描述
    titles = [m.group(2).strip() for m in SUBQ_IN_STEM.finditer(head)]

    # 切分小问（含代码块归属）
    sub_qs: list[dict] = []
    cur = {'body': '', 'code': []}
    in_fence = False
    cur_block = None
    found_first = False

    def finish():
        nonlocal cur
        if cur['body'].strip() or cur['code']:
            sub_qs.append(cur)

    for line in body.split('\n'):
        stripped = line.strip()
        if stripped.startswith('```'):
            if in_fence:
                if cur_block is not None:
                    cur['code'].append('\n'.join(cur_block))
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

    if not sub_qs:
        return block

    # 重组
    out = ['**解析**：', '']
    for i, sq in enumerate(sub_qs):
        title = titles[i] if i < len(titles) else f'第 {i + 1} 小问'
        out.append(f'**({i + 1}) {title}**')
        out.append('')
        if sq['body']:
            out.append(sq['body'].strip())
            out.append('')
        for blk in sq['code']:
            out.append(blk.strip())
            out.append('')
    while out and out[-1] == '':
        out.pop()
    new_body = '\n'.join(out)

    return head + '```spoiler-answer\n' + new_body + '\n```' + block[sp.end():]


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
    """把修复后的目录打包为 <id>-<version>.zip（保持目录结构，zip 根为文件直接放）"""
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
    ap.add_argument('--out', default=r'C:/Users/徐志岩/.workbuddy/tmp/kb408-v1.2.0')
    ap.add_argument('--version', default='1.2.0')
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        print(f'[ERR] 源目录不存在: {args.src}')
        return

    # 复制工作副本
    work = os.path.join(args.out, 'pack')
    if os.path.exists(work):
        shutil.rmtree(work)
    shutil.copytree(args.src, work)

    # 修复 exams/*.md
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

    # 升版本 + 描述
    mf_path = os.path.join(work, 'plugin.json')
    with open(mf_path, 'r', encoding='utf-8') as f:
        mf = json.load(f)
    mf['version'] = args.version
    if '描述' not in mf.get('description', '') and '大题解析排版' not in mf.get('description', ''):
        mf['description'] = mf.get('description', '') + '（v1.2 修复：大题解析排版结构化，每小问加粗标题独立成段）'
    with open(mf_path, 'w', encoding='utf-8') as f:
        json.dump(mf, f, ensure_ascii=False, indent=2)

    # 打包
    zip_path = repack(work, args.out, args.version)
    print(f'打包完成: {zip_path} ({os.path.getsize(zip_path) / 1024 / 1024:.1f} MB)')


if __name__ == '__main__':
    main()
