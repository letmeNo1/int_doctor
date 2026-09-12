# -*- coding: utf-8 -*-
"""清理接口测试产生的数据（zhang*/liming* 测试账号、关联病例 JSON 与 SQLite）"""
import json
import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent

def clean_list(path, pred):
    p = Path(path)
    if not p.exists():
        return 0
    data = json.loads(p.read_text(encoding="utf-8"))
    kept = [x for x in data if not pred(x)]
    p.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(data) - len(kept)

n1 = clean_list(BASE / "users.json", lambda u: str(u.get("username", "")).startswith(("zhang", "liming")))
n2 = clean_list(BASE / "patients.json", lambda p: str(p.get("username", "")).startswith(("zhang", "liming")))

# SQLite 病例清理
n3 = 0
db = BASE / "hospital.db"
if db.exists():
    conn = sqlite3.connect(db)
    cur = conn.execute("DELETE FROM records WHERE patientName = '李小明'")
    n3 = cur.rowcount
    conn.commit()
    conn.close()

print(f"清理完成：医生 {n1} 条、病人 {n2} 条、SQLite病例 {n3} 条")
