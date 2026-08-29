#!/usr/bin/env python3
"""
从 ECDICT 全量词库构建考纲精简词典 resources/dict/ecdict-exam.json。

筛选规则：tag 含 cet4 / cet6 / ky（考研）的词条，并辅以高频词兜底
（BNC 词频或当代语料库词频前 20000），保证选读文章里的常见词都能命中；
考纲标签单独保留在词条 tag 字段里供 UI 做徽章。数据源（按顺序尝试）：
本地缓存 %TEMP%/ecdict/ → gh-proxy 镜像 → GitHub raw。

用法：
    python scripts/build-exam-dict.py
可选参数：
    --csv    全量 ecdict.csv 路径（默认用缓存/下载）
    --lemma  lemma.en.txt 路径
    --out    输出路径（默认 resources/dict/ecdict-exam.json）
"""

import argparse
import csv
import json
import os
import sys
import tempfile
import urllib.request

CSV_URLS = [
    "https://gh-proxy.com/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
    "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
]
LEMMA_URLS = [
    "https://gh-proxy.com/https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt",
    "https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt",
]
EXAM_TAGS = {"cet4", "cet6", "ky"}
FREQ_LIMIT = 20000  # 高频词兜底阈值（BNC / 当代语料库词频排名）


def download(urls, dest):
    for url in urls:
        try:
            print(f"[dict] 下载 {url}")
            urllib.request.urlretrieve(url, dest)
            if os.path.getsize(dest) > 0:
                return True
        except Exception as e:
            print(f"[dict]   失败: {e}")
    return False


def fetch(name, urls, explicit):
    if explicit:
        return explicit
    cache = os.path.join(tempfile.gettempdir(), "ecdict", name)
    if os.path.isfile(cache) and os.path.getsize(cache) > 1024:
        return cache
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    if not download(urls, cache):
        sys.exit(f"[dict] 无法获取 {name}，请用 --{name.split('.')[0]} 指定本地文件")
    return cache


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--lemma")
    ap.add_argument("--out", default=os.path.join("resources", "dict", "ecdict-exam.json"))
    args = ap.parse_args()

    csv_path = fetch("ecdict.csv", CSV_URLS, args.csv)
    lemma_path = fetch("lemma.en.txt", LEMMA_URLS, args.lemma)
    print(f"[dict] 词库: {csv_path}\n[dict] 词形表: {lemma_path}")

    words = {}
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        idx = {k: i for i, k in enumerate(header)}
        for row in reader:
            if len(row) < 12:
                continue
            def _i(key, default=0):
                v = row[idx[key]].strip()
                try:
                    return int(v)
                except ValueError:
                    return default
            tags = set(row[idx["tag"]].split())
            is_exam = bool(tags & EXAM_TAGS)
            is_freq = (0 < _i("frq") <= FREQ_LIMIT) or (0 < _i("bnc") <= FREQ_LIMIT)
            if not (is_exam or is_freq):
                continue
            word = row[idx["word"]].strip().lower()
            if not word:
                continue
            words[word] = [
                row[idx["phonetic"]].strip(),
                # ECDICT 的 CSV 把换行存成字面量 "\n"（反斜杠+n），还原成真实换行
                row[idx["translation"]].strip().replace("\\n", "\n"),
                row[idx["definition"]].strip().replace("\\n", "\n"),
                row[idx["tag"]].strip(),
                _i("collins"), _i("oxford"), _i("bnc"), _i("frq"),
                row[idx["exchange"]].strip(),
            ]

    # 词形还原反查表：inflected → base（仅保留 base 已入选的映射）
    lemma = {}
    with open(lemma_path, encoding="utf-8") as f:
        for line in f:
            if line.startswith(";") or "->" not in line:
                continue
            base_part, forms_part = line.split("->", 1)
            base = base_part.split("/")[0].strip().lower()
            if base not in words:
                continue
            for form in forms_part.split(","):
                form = form.strip().lower()
                if form and form.isalpha() and form != base and form not in words:
                    lemma[form] = base

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "count": len(words), "words": words, "lemma": lemma},
                  f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(args.out) / 1024 / 1024
    print(f"[dict] 完成: {len(words)} 词, {len(lemma)} 条词形映射, {size_mb:.1f} MB → {args.out}")


if __name__ == "__main__":
    main()
