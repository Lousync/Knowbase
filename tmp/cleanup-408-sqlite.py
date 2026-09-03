#!/usr/bin/env python3
"""清理 dev 库 sqlite 中的「408 学习空间」测试数据（用户 2026-09-03 拍板：408 仅测试用，保持测试数据干净）。

用法（先完全退出 Knowbase dev 实例，再执行）：
  python tmp/cleanup-408-sqlite.py [db_path]

删除范围（递归）：
  - knowledge_categories：408 space + 全部子孙（notebook/folder）
  - knowledge_pages：category_id 在 408 树内的页面
  - knowledge_page_tags / knowledge_links：关联清理
  - knowledge_pack_imports：space_id 指向 408 的导入映射（防重导误判 skip）
"""
import sqlite3, sys, os

DB = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\徐志岩\AppData\Roaming\knowbase (dev KnowledgeRecorder)\data\knowledge.db"
SPACE_NAME = '408 学习空间'

def main():
    if not os.path.exists(DB):
        print(f'db 不存在: {DB}'); sys.exit(1)
    c = sqlite3.connect(DB)
    space = c.execute("SELECT id FROM knowledge_categories WHERE name=? AND category_type='space'", (SPACE_NAME,)).fetchone()
    if not space:
        print('未找到 408 学习空间 space——可能已清理'); sys.exit(0)
    root = space[0]
    ids = [root]
    stack = [root]
    while stack:
        parent = stack.pop()
        for (kid,) in c.execute("SELECT id FROM knowledge_categories WHERE parent_id=?", (parent,)).fetchall():
            if kid not in ids:
                ids.append(kid); stack.append(kid)
    ph = ','.join('?' * len(ids))
    page_ids = [r[0] for r in c.execute(f"SELECT id FROM knowledge_pages WHERE category_id IN ({ph})", ids).fetchall()]
    # 页面还可能在 descendant 之外的 category ？可能无。但保险：分类树外孤儿页不在此次范围。
    print(f'分类节点 {len(ids)} 个, 页面 {len(page_ids)} 个')
    # 关联表
    if page_ids:
        pph = ','.join('?' * len(page_ids))
        c.execute(f"DELETE FROM knowledge_page_tags WHERE page_id IN ({pph})", page_ids)
        c.execute(f"DELETE FROM knowledge_links WHERE source_page_id IN ({pph}) OR target_page_id IN ({pph})", page_ids)
    c.execute(f"DELETE FROM knowledge_pages WHERE id IN ({ph})", ids)  # 页面主删（分类树兜底）
    # 兜底：分类树 ids 里没有的页面，若其 category 被删会产生悬空——上面已按 category_id 删；此处再按 page_ids 删一次不必要
    c.execute(f"DELETE FROM knowledge_pages WHERE category_id IN ({ph})", ids)
    c.execute(f"DELETE FROM knowledge_categories WHERE id IN ({ph})", ids)
    # 导入映射（space 指向）
    c.execute("DELETE FROM knowledge_pack_imports WHERE space_id=?", (root,))
    c.commit()
    left = c.execute("SELECT COUNT(*) FROM knowledge_pages").fetchone()[0]
    print(f'清理完成。剩余页面总数: {left}')

if __name__ == '__main__':
    main()
