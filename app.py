# -*- coding: utf-8 -*-
"""医院管理后台 - FastAPI 后端
- 数据存储：patients.json(与问诊应用共享) / users.json(管理员·医生) / records.json(病例记录)
- 认证：pbkdf2 密码哈希 + 内存 token
- 角色：admin(管理后台) / doctor(医生) / patient(病人)
运行：.venv\\Scripts\\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8888
"""
import json
import os
import secrets
import sqlite3
import hashlib
import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

BASE = Path(__file__).resolve().parent
PATIENTS_FILE = BASE / "patients.json"
USERS_FILE = BASE / "users.json"
RECORDS_FILE = BASE / "records.json"
DB_PATH = BASE / "hospital.db"
STATIC_DIR = BASE / "static"

app = FastAPI(title="医院管理后台", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ---------------- 文件存储 ----------------
def read_json(path: Path, default):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else default
    except Exception:
        return default

def write_json(path: Path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)

def patients() -> list:
    return read_json(PATIENTS_FILE, [])

def save_patients(data):
    write_json(PATIENTS_FILE, data)

def users() -> list:
    return read_json(USERS_FILE, [])

def save_users(data):
    write_json(USERS_FILE, data)

# ---------------- 病例记录（SQLite）----------------
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY,
            patientNo TEXT,
            patientName TEXT,
            doctorName TEXT,
            complaint TEXT,
            history TEXT,
            dx TEXT,
            content TEXT,
            createdAt TEXT
        )""")

def list_records() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM records ORDER BY createdAt DESC").fetchall()
    return [dict(r) for r in rows]

def insert_record(rec: dict):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO records (id, patientNo, patientName, doctorName, complaint, history, dx, content, createdAt) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (rec["id"], rec["patientNo"], rec["patientName"], rec["doctorName"],
             rec["complaint"], rec["history"], rec["dx"], rec["content"], rec["createdAt"]),
        )

def migrate_records_json():
    """迁移旧的 records.json 到 SQLite（成功后备份原文件）"""
    if not RECORDS_FILE.exists():
        return
    old = read_json(RECORDS_FILE, [])
    with get_conn() as conn:
        for r in old:
            if not r.get("id"):
                continue
            conn.execute(
                "INSERT OR IGNORE INTO records (id, patientNo, patientName, doctorName, complaint, history, dx, content, createdAt) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (r["id"], r.get("patientNo", ""), r.get("patientName", ""), r.get("doctorName", ""),
                 r.get("complaint", ""), r.get("history", ""), r.get("dx", ""), r.get("content", ""),
                 r.get("createdAt", "")),
            )
    os.replace(RECORDS_FILE, RECORDS_FILE.with_suffix(".json.bak"))

# ---------------- 密码与 token ----------------
def hash_pwd(pwd: str, salt: Optional[str] = None):
    salt = salt or secrets.token_hex(8)
    h = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt.encode(), 100_000).hex()
    return salt, h

def verify_pwd(pwd: str, salt: str, h: str) -> bool:
    return hash_pwd(pwd, salt)[1] == h

SESSIONS = {}  # token -> {"role": str, "id": str}

def new_token(role: str, uid: str) -> str:
    t = secrets.token_hex(24)
    SESSIONS[t] = {"role": role, "id": uid}
    return t

def current(role: str, authorization: Optional[str] = None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "未登录")
    s = SESSIONS.get(authorization[7:])
    if not s or s["role"] != role:
        raise HTTPException(401, "登录已失效或权限不足")
    return s

def gen_patient_no() -> str:
    today = datetime.date.today().strftime("%Y%m%d")
    prefix = "P" + today
    max_seq = 0
    for p in patients():
        if p.get("no", "").startswith(prefix):
            try:
                max_seq = max(max_seq, int(p["no"][len(prefix):]))
            except ValueError:
                pass
    return f"{prefix}{max_seq + 1:03d}"

def patient_public(p):
    return {k: v for k, v in p.items() if k not in ("password_hash", "salt")}

# ---------------- 数据模型 ----------------
class LoginReq(BaseModel):
    role: str
    username: str
    password: str

class DoctorCreate(BaseModel):
    name: str
    department: str = ""
    title: str = ""
    username: str
    password: str

class PatientUpdate(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[str] = None
    phone: Optional[str] = None
    past: Optional[str] = None
    appt: Optional[str] = None

class PatientRegister(BaseModel):
    name: str
    gender: str = "男"
    age: str = ""
    phone: str = ""
    past: str = ""
    appt: str = ""
    username: str
    password: str

class PatientSelfUpdate(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[str] = None
    phone: Optional[str] = None
    past: Optional[str] = None
    appt: Optional[str] = None
    password: Optional[str] = None

class RecordCreate(BaseModel):
    patientNo: str
    complaint: str = ""
    history: str = ""
    dx: str = ""
    content: str = ""

# ---------------- 认证 ----------------
@app.post("/api/auth/login")
def login(req: LoginReq):
    if req.role == "doctor":
        # 管理员账号并入医生入口登录（按真实角色区分）
        u = next((x for x in users() if x.get("username") == req.username and x.get("role") in ("admin", "doctor")), None)
    elif req.role == "patient":
        u = next((x for x in patients() if x.get("username") == req.username), None)
    else:
        raise HTTPException(400, "未知角色")
    if not u or not verify_pwd(req.password, u.get("salt", ""), u.get("password_hash", "")):
        raise HTTPException(401, "账号或密码错误")
    token = new_token(u.get("role", req.role), str(u["id"]))
    info = {k: v for k, v in u.items() if k not in ("password_hash", "salt")}
    return {"token": token, "user": info}

# ---------------- 管理后台 ----------------
@app.get("/api/admin/doctors")
def list_doctors(authorization: Optional[str] = Header(None)):
    current("admin", authorization)
    out = [{k: v for k, v in d.items() if k not in ("password_hash", "salt")} for d in users() if d.get("role") == "doctor"]
    return {"ok": True, "doctors": out}

@app.post("/api/admin/doctors")
def create_doctor(req: DoctorCreate, authorization: Optional[str] = Header(None)):
    current("admin", authorization)
    if any(u.get("username") == req.username for u in users()):
        raise HTTPException(400, "账号已存在")
    salt, h = hash_pwd(req.password)
    d = {"id": secrets.token_hex(6), "role": "doctor", "username": req.username,
         "password_hash": h, "salt": salt, "name": req.name, "department": req.department,
         "title": req.title, "createdAt": datetime.datetime.now().isoformat()}
    data = users(); data.append(d); save_users(data)
    return {"ok": True, "doctor": {k: v for k, v in d.items() if k not in ("password_hash", "salt")}}

@app.delete("/api/admin/doctors/{did}")
def delete_doctor(did: str, authorization: Optional[str] = Header(None)):
    current("admin", authorization)
    data = users()
    data = [d for d in data if not (d.get("role") == "doctor" and d.get("id") == did)]
    save_users(data)
    return {"ok": True}

@app.get("/api/admin/patients")
def admin_patients(q: str = "", authorization: Optional[str] = Header(None)):
    current("admin", authorization)
    q = q.strip().lower()
    ps = patients()
    if q:
        ps = [p for p in ps if q in (p.get("name", "") + p.get("no", "") + p.get("phone", "")).lower()]
    return {"ok": True, "patients": [patient_public(p) for p in sorted(ps, key=lambda x: x.get("createdAt", ""), reverse=True)]}

@app.put("/api/admin/patients/{pid}")
def update_patient(pid: str, req: PatientUpdate, authorization: Optional[str] = Header(None)):
    current("admin", authorization)
    data = patients()
    for p in data:
        if str(p["id"]) == pid:
            for k in ("name", "gender", "age", "phone", "past", "appt"):
                if getattr(req, k) is not None:
                    p[k] = getattr(req, k)
            save_patients(data)
            return {"ok": True, "patient": patient_public(p)}
    raise HTTPException(404, "病人不存在")

@app.delete("/api/admin/patients/{pid}")
def delete_patient(pid: str, authorization: Optional[str] = Header(None)):
    current("admin", authorization)
    data = [p for p in patients() if str(p["id"]) != pid]
    save_patients(data)
    return {"ok": True}

@app.get("/api/admin/records")
def admin_records(authorization: Optional[str] = Header(None)):
    current("admin", authorization)
    return {"ok": True, "records": list_records()}

# ---------------- 医生 ----------------
@app.get("/api/doctor/patients")
def doctor_patients(q: str = "", authorization: Optional[str] = Header(None)):
    current("doctor", authorization)
    q = q.strip().lower()
    ps = patients()
    if q:
        ps = [p for p in ps if q in (p.get("name", "") + p.get("no", "") + p.get("phone", "")).lower()]
    return {"ok": True, "patients": [patient_public(p) for p in sorted(ps, key=lambda x: x.get("createdAt", ""), reverse=True)]}

@app.get("/api/doctor/patients/{pid}")
def doctor_patient_detail(pid: str, authorization: Optional[str] = Header(None)):
    current("doctor", authorization)
    p = next((x for x in patients() if str(x["id"]) == pid), None)
    if not p:
        raise HTTPException(404, "病人不存在")
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM records WHERE patientNo = ? ORDER BY createdAt DESC", (p.get("no", ""),)).fetchall()
    return {"ok": True, "patient": patient_public(p),
            "records": [dict(r) for r in rows]}

@app.post("/api/doctor/records")
def add_record(req: RecordCreate, authorization: Optional[str] = Header(None)):
    s = current("doctor", authorization)
    doc = next((d for d in users() if str(d.get("id")) == s["id"]), {})
    p = next((x for x in patients() if x.get("no") == req.patientNo), None)
    if not p:
        raise HTTPException(404, "病人不存在")
    r = {"id": secrets.token_hex(6), "patientNo": req.patientNo, "patientName": p.get("name", ""),
         "doctorName": doc.get("name", ""), "complaint": req.complaint, "history": req.history,
         "dx": req.dx, "content": req.content,
         "createdAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    insert_record(r)
    return {"ok": True, "record": r}

# ---------------- 病人 ----------------
@app.post("/api/patient/register")
def patient_register(req: PatientRegister):
    if any(p.get("username") == req.username for p in patients()):
        raise HTTPException(400, "账号已存在")
    salt, h = hash_pwd(req.password)
    p = {"id": secrets.token_hex(6), "no": gen_patient_no(), "name": req.name,
         "gender": req.gender, "age": req.age, "phone": req.phone, "past": req.past,
         "appt": req.appt, "username": req.username, "password_hash": h, "salt": salt,
         "createdAt": datetime.datetime.now().isoformat()}
    data = patients(); data.append(p); save_patients(data)
    return {"ok": True, "patient": patient_public(p), "message": "注册成功"}

@app.get("/api/patient/me")
def patient_me(authorization: Optional[str] = Header(None)):
    s = current("patient", authorization)
    p = next((x for x in patients() if str(x["id"]) == s["id"]), None)
    if not p:
        raise HTTPException(404, "病人不存在")
    return {"ok": True, "patient": patient_public(p)}

@app.put("/api/patient/me")
def patient_self_update(req: PatientSelfUpdate, authorization: Optional[str] = Header(None)):
    s = current("patient", authorization)
    data = patients()
    for p in data:
        if str(p["id"]) == s["id"]:
            for k in ("name", "gender", "age", "phone", "past", "appt"):
                if getattr(req, k) is not None:
                    p[k] = getattr(req, k)
            if req.password:
                salt, h = hash_pwd(req.password)
                p["salt"], p["password_hash"] = salt, h
            save_patients(data)
            return {"ok": True, "patient": patient_public(p)}
    raise HTTPException(404, "病人不存在")

# ---------------- 二维码 ----------------
@app.get("/api/qrcode/{no}")
def qrcode_png(no: str, authorization: Optional[str] = Header(None)):
    """二维码内容 = 病历号。病人本人/医生/管理员可获取。"""
    auth = None
    if authorization and authorization.startswith("Bearer "):
        auth = SESSIONS.get(authorization[7:])
    p = next((x for x in patients() if x.get("no") == no), None)
    if not p:
        raise HTTPException(404, "病人不存在")
    if not auth:
        raise HTTPException(401, "未登录")
    if auth["role"] == "patient" and str(p["id"]) != auth["id"]:
        raise HTTPException(403, "无权查看他人二维码")
    import qrcode
    from io import BytesIO
    img = qrcode.make(no)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png")

# ---------------- 页面 ----------------
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "login.html")

@app.get("/admin")
def page_admin():
    return FileResponse(STATIC_DIR / "admin.html")

@app.get("/doctor")
def page_doctor():
    return FileResponse(STATIC_DIR / "doctor.html")

@app.get("/patient")
def page_patient():
    return FileResponse(STATIC_DIR / "patient.html")

# 初始化：内置管理员 + SQLite 建表 + 迁移旧记录
def ensure_admin():
    if not any(u.get("role") == "admin" for u in users()):
        salt, h = hash_pwd("admin123")
        save_users([{"id": secrets.token_hex(6), "role": "admin", "username": "admin",
                     "password_hash": h, "salt": salt, "name": "系统管理员",
                     "createdAt": datetime.datetime.now().isoformat()}])

init_db()
migrate_records_json()
ensure_admin()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8888)
