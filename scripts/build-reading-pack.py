#!/usr/bin/env python3
"""
生成英语阅读内置插件包 resources/builtin-plugins/knowbase.english-reading-pack。

数据源（默认从 %TEMP%/reading 读取，可用参数覆盖）：
  1. 考研英语一真题+解析 (TsekaLuk/Kaoyan-English1-Papers 的 solutions md，2017-2023)
  2. 四六级真题 md (wamich/english-exem-md，2023 两场 × 四级/六级 × 3 套)
  3. VOA Learning English 公版语料 (bltlab/mot release，美国政府作品 public domain)

页面结构：
  空间「英语阅读」
  ├─ 笔记本 考研英语一精读（按年章，每篇 Text 一页：原文+题目+答案解析）
  ├─ 笔记本 四六级真题阅读（按 场次×级别 章，每套卷一页：Part III 阅读理解）
  └─ 笔记本 VOA 慢速英语（按主题章，每篇一页，public domain）

注意：四六级/考研真题版权归考试委员会，包内内容仅供本地个人学习。
"""

import glob
import json
import os
import re
import sys
import uuid

TEMP = os.environ.get("TEMP", "/tmp")
SRC = os.path.join(TEMP, "reading")
OUT = os.path.join(os.path.dirname(__file__), "..", "resources", "builtin-plugins", "knowbase.english-reading-pack")
VOA_TARGET = 24

SECTIONS = [
    ("科技前沿", ["technolog", "science"]),
    ("健康生活", ["health", "medic"]),
    ("教育文化", ["education", "culture"]),
    ("经济商业", ["econom", "business", "money", "agriculture"]),
    ("美国故事", ["american stories", "american history"]),
    ("社会万象", []),
]


def clean_pdfish(text: str) -> str:
    """去掉解析文本里的多余空行/空格"""
    lines = [l.rstrip() for l in text.splitlines()]
    out = []
    for l in lines:
        if not l.strip() and out and not out[-1].strip():
            continue
        out.append(l)
    return "\n".join(out).strip()


# 阅读理解 Part A 参考答案速查（来源：2017 eol.cn/t20161224_1478855；2018 people.com.cn/c1053-29725588；
# 2019 eol.cn/t20181224_1638421；2023 koolearn.com/20221224/1578642。2021/2022 用文件内解析）
READING_KEYS = {
    2017: "CCADB BABCD DBCAC CCABD",
    2018: "DCADB DABCA BCDBB BAACD",
    2019: "ADBCB DAACB CDBAC CDBCD",
    2023: "CBACD ADBCD ACAAD BCABD",
}


def key_letter(year: int, qnum: int) -> str:
    key = READING_KEYS.get(year)
    if not key or not (21 <= qnum <= 40):
        return ""
    return key.replace(" ", "")[qnum - 21]


def parse_questions(body: str):
    """从 Text 块解析题目 → [(no, stem, {A-D: text} | None, 原始区域文本)]"""
    lines = body.split("\n")
    qstarts = []
    for i, line in enumerate(lines):
        m = re.match(r"^#?\s*(\d{2})\s*[.．、]\s*(.*)", line)
        if m and 21 <= int(m.group(1)) <= 40:
            qstarts.append((i, int(m.group(1)), m.group(2)))
    questions = []
    for k, (i, no, first) in enumerate(qstarts):
        end = qstarts[k + 1][0] if k + 1 < len(qstarts) else len(lines)
        region_lines = [first] + lines[i + 1:end]
        region = "\n".join(region_lines).strip()
        options = split_options(region)
        questions.append((no, region, options))
    return questions


def split_options(region: str):
    """把题目区域切成 (题干, {A-D: 文本})；四种选项齐备才返回，否则 None。
    兼容排版（可混合）：'[A] xxx' / 'A) xxx' / 'A. xxx' / 行首粘连 'Aforecast xxx'。"""
    explicit = {L: [m for m in re.finditer(r"(?:^|[\s(（>])(" + L + r")\s*[.．)）、]\s*", region, re.M)]
                + [m for m in re.finditer(r"\[\s*(" + L + r")\s*\]\s*", region)]
                for L in "ABCD"}
    glued = {L: [] for L in "ABCD"}
    for L in "ABCD":
        for m in re.finditer(r"(?:^|\n)\s*(" + L + r")(?:\s*[.．)）、]\s*|\s*(?=[A-Za-z]))", region):
            # 选项行都很短：过滤题干行首恰好以 A-D 开头(如 "According...")的误匹配
            nl0 = region.rfind("\n", 0, m.start()) + 1
            nl1 = region.find("\n", m.start())
            line_len = len(region[nl0:nl1 if nl1 > 0 else len(region)])
            if line_len <= 80:
                glued[L].append(m)
    return _greedy_split(region, explicit) or _greedy_split(region, {L: sorted(explicit[L] + glued[L], key=lambda m: m.start()) for L in "ABCD"})


def _greedy_split(region: str, marks):
    """从各字母候选中自左向右贪心取严格递增的 A<B<C<D；粘连命中时去掉行首字母"""
    out = {}
    pos = 0
    for L in "ABCD":
        cands = [m for m in marks[L] if m.start() >= pos]
        if not cands:
            return None
        out[L] = cands[0]
        pos = cands[0].end()
    order = "ABCD"
    glued = any(out[L].group(0).strip() in list(order) for L in order)
    options = {}
    for i, L in enumerate(order):
        s = out[L].end()
        e = out[order[i + 1]].start() if i + 1 < 4 else len(region)
        text = region[s:e].strip()
        if glued:
            text = re.sub(r"^" + L + r"\s*[.．)）、]?", "", text)
        options[L] = text.strip(" \t\n,-；;。")
    if any(not options[L] for L in "ABCD"):
        return None
    stem = re.sub(r"^#?\s*\d{2}\s*[.．、]\s*", "", region[:min(out[L].start() for L in "ABCD")].strip()).strip()
    if len(stem) < 8:
        return None
    return stem, options


def _pick_sequence(marks, region, glued=False):
    """从各字母候选位置中选出严格递增的 A<B<C<D 组合"""
    import itertools
    for combo in itertools.product(marks["A"], marks["B"], marks["C"], marks["D"]):
        ends = [c.end() for c in combo]
        if all(ends[i] <= combo[i + 1].start() for i in range(3)):
            return {L: c for L, c in zip("ABCD", combo)}
    return None


def _next_mark(seq, L, region):
    order = "ABCD"
    i = order.index(L)
    return seq[order[i + 1]] if i + 1 < 4 else None


def glued_overlap(seq, L):
    return re.match(r"^[\s(（]*[A-D]$", seq[L].group(0).strip() or " ") is None and seq[L].group(0).strip() in list("ABCD")


def build_quiz_block(no: int, stem: str, options, answer: str, explanation: str) -> str:
    opts = "\n".join(f"- **{L}.** {options[L]}" for L in "ABCD")
    expl = explanation.strip() or "暂无文字解析，可用 AI 助手讲解本题。"
    return (f"### 第 {no} 题\n\n{stem}\n\n{opts}\n\n"
            f"```spoiler-answer\n**答案：{answer}**\n\n**解析**：\n\n{expl}\n```\n")


def build_kaoyan_page(year: int, name: str, body: str, answers: dict) -> str:
    """考研 Text 页：原文 + 408 同款交互选择题"""
    questions = parse_questions(body)
    if not questions:
        # 纯解析文件（如 2022）：无独立题干与选项，整块静态呈现
        return f"# {year} 考研英语一 {name}\n\n{body}\n\n*（本篇源文件未含独立题干与选项，故无可交互题目。）*\n"
    passage = body[: body.find(questions[0][1])].strip()
    static_parts = []
    quiz_blocks = []
    for no, region, parsed in questions:
        options = None
        stem = ""
        if parsed:
            stem, options = parsed
        # 答案字母：优先文件内解析（含【答案】[X]），否则速查键
        expl = ""
        ans = ""
        seg = answers.get(str(no))
        if seg:
            m = re.search(r"【答案】\s*\[?([A-D])", seg)
            if m:
                ans = m.group(1)
            em = re.search(r"【解析】\s*([\s\S]*)", seg)
            expl = em.group(1).strip() if em else ""
        if not ans:
            ans = key_letter(year, no)
        if not options or not ans:
            # 判题条件不足（选项解析失败或无答案）→ 静态展示
            static_parts.append(region)
            continue
        quiz_blocks.append(build_quiz_block(no, stem, options, ans, expl))

    md = f"# {year} 考研英语一 {name}\n\n{passage}\n"
    if static_parts:
        md += "\n## 其他题目\n\n" + "\n\n".join(static_parts) + "\n"
    if quiz_blocks:
        md += "\n## 题目（点击作答）\n\n" + "\n".join(quiz_blocks)
    else:
        md += "\n\n*本篇暂无可交互题目，可用 AI 助手辅助核对答案。*\n"
    return md


def parse_solutions_md(path: str):
    """解析考研 solutions md → { 'Text 1': {'body': 原文+题目, 'answers': {题号: 解析文本}} }"""
    raw = open(path, encoding="utf-8").read()
    parts = re.split(r"^#\s+", raw, flags=re.M)
    text_blocks = {}
    answers = {}

    # 1) 题号→【答案】+【解析】:题号不一定紧邻标记(2021 格式为题干在前)，
    #    统一向前回溯最近出现的题号
    ans_iter = list(re.finditer(r"【答案】", raw))
    for i, m in enumerate(ans_iter):
        end = ans_iter[i + 1].start() if i + 1 < len(ans_iter) else len(raw)
        seg = raw[m.start():min(end, m.start() + 1500)]
        # 截到下一个一级标题（如 "# Text 2"、"# Part B"），防止串段
        h = re.search(r"^#\s+(?!\d)", seg[1:], re.M)
        if h:
            seg = seg[:h.end() + 1]
        # 解析区若含下一题题干（"22. xxx" 行），截掉，防止解析块吞题干
        em = re.search(r"【解析】", seg)
        if em:
            m2 = re.search(r"\n\s*\d{2}[.．]\s", seg[em.end():])
            if m2:
                seg = seg[:em.end() + m2.start()]
        back = raw[max(0, m.start() - 400):m.start()]
        nums = re.findall(r"\b(\d{2})\s*\.", back)
        if nums:
            answers.setdefault(nums[-1], clean_pdfish(seg)[:1200])

    # 2) Text N 块（原文+题目）。同一 Text 若出现两次（试题区 + 解析区），保留先出现的
    #    试题区块（含原文与题干），忽略解析区同名块
    cur, buf = None, []
    for seg in parts:
        head = seg.split("\n", 1)[0].strip()
        m = re.fullmatch(r"Text\s*([1-4])", head)
        body = seg.split("\n", 1)[1] if "\n" in seg else ""
        if m:
            key = f"Text {m.group(1)}"
            if cur:
                text_blocks.setdefault(cur, "\n".join(buf).strip())
                cur, buf = None, []
            if key not in text_blocks:
                cur, buf = key, [body]
            # 已存在 → 忽略该解析区块
        elif cur:
            # 解析区或下一个大节开始 → 结束当前 Text 块
            if re.match(r"Section\s+III|Part\s+B|Part\s+C|Translation|Writing|答案与解析|一、试题解析", head):
                text_blocks.setdefault(cur, "\n".join(buf).strip())
                cur, buf = None, []
            else:
                buf.append(f"# {seg}")
    if cur:
        text_blocks.setdefault(cur, "\n".join(buf).strip())

    # 3) 每个 Text 块附带其题号的解析（块内未内含时）
    result = {}
    for name, body in text_blocks.items():
        if len(body) < 300:  # 太短说明不是完整块（无原文）
            continue
        qnums = re.findall(r"^(?:# )?\s*(\d{2})\. ", body, re.M)
        # body 已内含答案解析（如 2022 逐题内联格式）则不再追加；每篇 Text 固定 5 题，
        # 超出说明题号匹配串了段，只取前 5 个
        attached = []
        answers_by_q = {}
        if body.count("【答案】") < 5:
            for q in list(dict.fromkeys(qnums))[:5]:
                if q in answers:
                    attached.append(answers[q])
                    answers_by_q[q] = answers[q]
        result[name] = {"body": body, "answers": attached, "answers_by_q": answers_by_q}
    return result


def parse_cet_reading(path: str, title: str) -> str:
    """从四六级真题 md 抽出 Part III 阅读理解整节"""
    raw = open(path, encoding="utf-8").read()
    m = re.search(r"^## Part III.*$", raw, re.M)
    n = re.search(r"^## Part IV.*$", raw, re.M)
    if not m:
        return ""
    body = raw[m.start():n.start() if n else len(raw)]
    return f"# {title}\n\n> 本页为该套卷阅读理解部分（选词填空 / 段落匹配 / 仔细阅读）。查生词：划词后点「翻译」即可收录进生词本。\n\n{body.strip()}\n"


def load_voa_articles(src_dir=None):
    """按主题抽样 VOA Learning English 文章"""
    d = os.path.join(src_dir or SRC, "eng_learningenglish_voanews", "article")
    buckets = {name: [] for name, _ in SECTIONS}
    for f in glob.glob(os.path.join(d, "*.json")):
        try:
            a = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if a.get("content_type") != "article" or a.get("site_language") != "eng":
            continue
        n = int(a.get("n_tokens") or 0)
        if not (350 <= n <= 700):
            continue
        year = str(a.get("time_published", ""))[:4]
        if year < "2015":
            continue
        sec = (a.get("section") or "").lower()
        for name, keys in SECTIONS:
            if any(k in sec for k in keys):
                buckets[name].append(a)
                break
        else:
            if not keys and len(buckets["社会万象"]) < 40:
                buckets["社会万象"].append(a)
    picked = {}
    for name, _ in SECTIONS:
        arr = sorted(buckets[name], key=lambda a: a.get("n_tokens") or 0)
        picked[name] = arr[:4]
    return picked


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC

    pages = {}          # file -> md content
    notebooks = []      # plugin.json notebooks

    # ===== 1) 考研英语一精读 =====
    # 注意：ky1-2024.md 实际内容为 2022 年试题+答案解析（源仓库标注错位），映射到 2022
    ky_year_files = {2017: "ky1-2017.md", 2018: "ky1-2018.md", 2019: "ky1-2019.md",
                     2021: "ky1-2021.md", 2022: "ky1-2024.md", 2023: "ky1-2023.md"}
    ky_chapters = []
    for year, fname in ky_year_files.items():
        p = os.path.join(src, fname)
        if not os.path.isfile(p):
            continue
        blocks = parse_solutions_md(p)
        if not blocks:
            print(f"[pack] 考研 {year}: 未解析出 Text 块，跳过")
            continue
        pg = []
        for i in range(1, 5):
            name = f"Text {i}"
            if name not in blocks:
                continue
            b = blocks[name]
            md = build_kaoyan_page(year, name, b["body"], b["answers_by_q"])
            fname = f"pages/kaoyan/{year}-text-{i}.md"
            pages[fname] = md
            pg.append({"file": fname, "title": f"{year} {name}", "externalId": f"eng-ky1-{year}-t{i}",
                       "tags": ["考研英语", str(year), "阅读精读"]})
        if pg:
            ky_chapters.append({"name": f"{year} 真题", "pages": pg})
    if ky_chapters:
        notebooks.append({"name": "考研英语一精读", "coverColor": "#2c3e70", "chapters": ky_chapters})

    # ===== 2) 四六级真题阅读 =====
    cet_chapters = {"四级": [], "六级": []}
    for level, cn in [("CET4", "四级"), ("CET6", "六级")]:
        for session, label in [("2023.06", "2023年6月"), ("2023.12", "2023年12月")]:
            pg = []
            for i in range(1, 4):
                p = os.path.join(src, "cet", f"{level}-{session}-{i}.md")
                if not os.path.isfile(p):
                    continue
                title = f"{label} 大学英语{cn} 阅读理解（第 {i} 套）"
                md = parse_cet_reading(p, title)
                if not md:
                    continue
                fname = f"pages/cet/{level}-{session}-{i}.md"
                pages[fname] = md
                pg.append({"file": fname, "title": title[:100], "externalId": f"eng-cet-{level}-{session}-{i}",
                           "tags": [cn, f"{label}", "阅读理解"]})
            if pg:
                cet_chapters[cn].append({"name": f"{cn} {label}", "pages": pg})
    cet_nb_chapters = cet_chapters["四级"] + cet_chapters["六级"]
    if cet_nb_chapters:
        notebooks.append({"name": "四六级真题阅读", "coverColor": "#1a7a4c", "chapters": cet_nb_chapters})

    # ===== 3) VOA 慢速英语（public domain） =====
    voa = load_voa_articles(src)
    voa_chapters = []
    for name, _ in SECTIONS:
        pg = []
        for a in voa.get(name, []):
            year = str(a.get("time_published", ""))[:4]
            title = re.sub(r"\s+", " ", a.get("title", "")).strip()[:100]
            body = "\n\n".join(a.get("paragraphs", []))
            md = (f"# {title}\n\n> VOA Learning English · {name} · {year} · 约 {a.get('n_tokens')} 词 · 公有领域\n\n"
                  f"{body}\n\n---\n\n*阅读建议：先通读，划词查生词并收藏；再盲读一遍检验理解。*\n")
            ext = re.sub(r"[^A-Za-z0-9._-]", "", a.get("filename", ""))[-40:] or uuid.uuid4().hex[:8]
            fname = f"pages/voa/{ext}.md"
            pages[fname] = md
            pg.append({"file": fname, "title": title, "externalId": f"eng-voa-{ext}", "tags": ["VOA慢速", name]})
        if pg:
            voa_chapters.append({"name": name, "pages": pg})
    if voa_chapters:
        notebooks.append({"name": "VOA 慢速英语", "coverColor": "#8e5a1a", "chapters": voa_chapters})

    # ===== 写盘 =====
    for fname, content in pages.items():
        fp = os.path.join(OUT, fname.replace("/", os.sep))
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        open(fp, "w", encoding="utf-8", newline="\n").write(content)

    manifest = {
        "id": "knowbase.english-reading-pack",
        "name": "英语阅读材料包",
        "version": "1.0.0",
        "author": "Knowbase",
        "description": "英语阅读材料：考研英语一历年真题精读（原文+题目+答案解析）、四六级真题阅读理解、VOA 慢速英语分级短文（公有领域）。配合划词翻译与生词本使用，仅供个人学习交流。",
        "type": "declarative",
        "icon": "icon.svg",
        "category": "知识包",
        "riskLevel": "A",
        "contributes": {
            "knowledgePages": {
                "space": "英语阅读",
                "notebooks": notebooks,
            }
        },
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "plugin.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    n_pages = sum(len(c["pages"]) for nb in notebooks for c in nb["chapters"])
    print(f"[pack] 完成: {len(notebooks)} 个笔记本, {n_pages} 页 → {OUT}")
    for nb in notebooks:
        print(f"  - {nb['name']}: {sum(len(c['pages']) for c in nb['chapters'])} 页, {len(nb['chapters'])} 章")


if __name__ == "__main__":
    main()
