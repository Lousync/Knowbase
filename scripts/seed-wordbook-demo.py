#!/usr/bin/env python3
"""
向开发版数据库注入单词本示例数据（体验词根/近义聚类与话题分组用）。

写入内容：
  - 词根 port(携带)族:  import / export / portable / deport / porter
  - 词根 vers(转)族:    adverse / avert / controversy / anniversary
  - 近义 abandon 族:    abandon / desert / forsake
  - 近义 increase 族:   increase / growth / increment / development
  - 话题分组「示例 · 经济类」: economy / inflation / tariff / subsidy

用法：
    python scripts/seed-wordbook-demo.py [数据库路径]
默认数据库：%APPDATA%/knowbase (dev KnowledgeRecorder)/knowledge.db
注意：必须在应用关闭后运行（应用运行中为内存库，落盘会覆盖本脚本的修改）。
"""

import json
import os
import sqlite3
import sys
import uuid

DICT_JSON = os.path.join(os.path.dirname(__file__), "..", "resources", "dict", "ecdict-exam.json")

SEED_WORDS = [
    # 词根 port（carry，携带）
    "import", "export", "portable", "deport", "porter",
    # 词根 vers/vert（turn，转）
    "adverse", "avert", "controversy", "anniversary",
    # 近义：放弃族
    "abandon", "desert", "forsake",
    # 近义：增长族
    "increase", "growth", "increment", "development",
]

SEED_GROUP = ("示例 · 经济类", ["economy", "inflation", "tariff", "subsidy"])


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.environ.get("APPDATA", ""), "knowbase (dev KnowledgeRecorder)", "data", "knowledge.db")
    if not os.path.isfile(db_path):
        sys.exit(f"[seed] 数据库不存在: {db_path}")

    with open(DICT_JSON, encoding="utf-8") as f:
        dict_words = json.load(f)["words"]
    missing = [w for w in SEED_WORDS + SEED_GROUP[1] if w not in dict_words]
    if missing:
        sys.exit(f"[seed] 以下词不在离线词典中，请检查: {missing}")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "wordbook_entries" not in tables:
        sys.exit("[seed] wordbook_entries 表不存在——请先启动一次应用让迁移 051/052/054 执行")

    added, skipped = [], []
    for w in SEED_WORDS:
        cur.execute("SELECT 1 FROM wordbook_entries WHERE word = ?", [w])
        if cur.fetchone():
            skipped.append(w)
            continue
        cur.execute(
            """INSERT INTO wordbook_entries
               (word, status, source, due_at, interval_days, ease, streak)
               VALUES (?, 'learning', 'manual', datetime('now', 'localtime'), 0, 2.5, 0)""",
            [w])
        added.append(w)

    gid = str(uuid.uuid4())
    cur.execute("INSERT INTO wordbook_groups (id, name) VALUES (?, ?)", [gid, SEED_GROUP[0]])
    for w in SEED_GROUP[1]:
        cur.execute("INSERT OR IGNORE INTO wordbook_group_words (group_id, word) VALUES (?, ?)", [gid, w])

    conn.commit()
    conn.close()
    print(f"[seed] 完成: 新增 {len(added)} 词 {added}")
    if skipped:
        print(f"[seed] 跳过(已存在): {skipped}")
    print(f"[seed] 分组「{SEED_GROUP[0]}」已建，含 {len(SEED_GROUP[1])} 词")
    print("[seed] 重新打开应用后，到 单词本 → 生词本/体系 查看效果")


if __name__ == "__main__":
    main()
