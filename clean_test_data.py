# -*- coding: utf-8 -*-
"""清理接口测试产生的数据（zhang*/liming* 测试账号、关联病例 SQLite）"""
import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent

n3 = 0
n4 = 0
n5 = 0
db = BASE / "hospital.db"
if db.exists():
    conn = sqlite3.connect(db)
    cur = conn.execute("DELETE FROM records WHERE patientName = '李小明' OR doctorName = '张医生'")
    n3 = cur.rowcount
    cur = conn.execute("DELETE FROM users WHERE username LIKE 'zhang%' OR username LIKE 'liming%'")
    n4 = cur.rowcount
    cur = conn.execute("DELETE FROM patients WHERE username LIKE 'zhang%' OR username LIKE 'liming%'")
    n5 = cur.rowcount
    conn.commit()
    conn.close()

print(f"清理完成：SQLite病例 {n3} 条、SQLite账号 {n4} 条、SQLite病人 {n5} 条")
