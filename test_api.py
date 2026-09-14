# -*- coding: utf-8 -*-
"""医院管理后台 - 端到端接口测试"""
import json
import time
import urllib.request
from urllib.parse import quote

BASE = "http://127.0.0.1:8888"
TS = str(int(time.time()))[-6:]   # 唯一后缀，避免与真实数据冲突

def call(method, path, data=None, token=None):
    url = BASE + path
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def jj(method, path, data=None, token=None):
    s, b = call(method, path, data, token)
    try:
        return s, json.loads(b.decode("utf-8"))
    except Exception:
        return s, b[:200]

ok = True
def check(name, cond, extra=""):
    global ok
    print(("PASS" if cond else "FAIL"), name, extra)
    if not cond:
        ok = False

# 1. admin 登录（管理员并入医生入口）
s, r = jj("POST", "/api/auth/login", {"role": "doctor", "username": "admin", "password": "admin123"})
check("admin 登录(医生入口)", s == 200 and r.get("user", {}).get("role") == "admin", f"s={s}")
admin_token = r.get("token", "")

# 2. admin 错误密码
s, r = jj("POST", "/api/auth/login", {"role": "doctor", "username": "admin", "password": "wrong"})
check("admin 错误密码被拒", s == 401)

# 3. 创建医生
s, r = jj("POST", "/api/admin/doctors", {"name": "张医生", "department": "内科", "title": "主任医师",
                                          "username": "zhang" + TS, "password": "zhang123"}, admin_token)
check("创建医生", s == 200 and r.get("ok"), str(r)[:80])
s, r = jj("GET", "/api/admin/doctors", token=admin_token)
check("医生列表", s == 200 and any(d.get("username") == "zhang" + TS for d in r.get("doctors", [])))

# 4. 病人注册
s, r = jj("POST", "/api/patient/register", {"name": "李小明", "gender": "男", "age": "45", "phone": "13800001111",
                                             "past": "高血压史", "appt": "2026-09-12 09:30",
                                             "username": "liming" + TS, "password": "liming123"})
check("病人注册", s == 200 and r.get("ok"), str(r)[:100])
no = r.get("patient", {}).get("no", "")
check("病历号生成", no.startswith("P") and len(no) > 5, no)

# 5. 病人登录 + 信息
s, r = jj("POST", "/api/auth/login", {"role": "patient", "username": "liming" + TS, "password": "liming123"})
check("病人登录", s == 200, f"s={s}")
pt_token = r.get("token", "")
s, r = jj("GET", "/api/patient/me", token=pt_token)
check("病人信息", s == 200 and r.get("patient", {}).get("name") == "李小明")

# 6. 病人二维码（PNG 校验）
s, b = call("GET", "/api/qrcode/" + no, token=pt_token)
check("二维码 PNG", s == 200 and b[:4] == b"\x89PNG", f"s={s} len={len(b)}")

# 7. 病人修改信息
s, r = jj("PUT", "/api/patient/me", {"phone": "13900002222", "age": "46"}, pt_token)
check("病人修改", s == 200 and r.get("patient", {}).get("age") == "46")

# 8. 医生登录 + 病人列表 + 添加病例
s, r = jj("POST", "/api/auth/login", {"role": "doctor", "username": "zhang" + TS, "password": "zhang123"})
check("医生登录", s == 200, f"s={s}")
doc_token = r.get("token", "")
s, r = jj("GET", "/api/doctor/patients", token=doc_token)
check("医生病人列表", s == 200 and any(p.get("no") == no for p in r.get("patients", [])))
s, r = jj("GET", "/api/doctor/patients?q=" + quote("李小"), token=doc_token)
check("医生搜索", s == 200 and len(r.get("patients", [])) == 1)
pid = r["patients"][0]["id"]
s, r = jj("GET", "/api/doctor/patients/" + pid, token=doc_token)
check("病人详情", s == 200 and "records" in r)
s, r = jj("POST", "/api/doctor/records", {"patientNo": no, "complaint": "咳嗽3天", "dx": "上呼吸道感染",
                                           "content": "建议多喝水，口服药物"}, doc_token)
check("添加病例", s == 200 and r.get("ok"), str(r)[:80])

# 9. admin 查看病人/病例
s, r = jj("GET", "/api/admin/patients", token=admin_token)
check("admin 病人列表", s == 200 and any(p.get("no") == no for p in r.get("patients", [])))
s, r = jj("GET", "/api/admin/records", token=admin_token)
check("admin 病例列表", s == 200 and len(r.get("records", [])) >= 1)

# 10. 权限校验：无 token 访问医生接口应 401
s, r = jj("GET", "/api/doctor/patients")
check("无 token 被拒", s == 401)

print("\n=== 测试" + ("全部通过 [OK]" if ok else "存在失败 [FAIL]") + " ===")
raise SystemExit(0 if ok else 1)
