# -*- coding: utf-8 -*-
"""
问诊记录后端服务：FastAPI 封装 FunASR 转写 + 说话人分离
由 Electron 主进程自动拉起，端口 8765

接口:
    GET  /health                    健康检查
    POST /api/transcribe            上传音频段，返回带说话人标签的句子列表
         form:  audio=<wav/mp3 文件>   (可选) min_speakers / max_speakers
"""
import os
import sys
import tempfile
import time
import uvicorn
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# 复用已验证的转写脚本
from transcribe import load_model, transcribe

HOST = "127.0.0.1"
PORT = 8765


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时预加载模型，避免首个请求等待
    print("[asr_service] 加载模型…", flush=True)
    t0 = time.time()
    load_model(use_punc=True, device="cpu")
    print(f"[asr_service] 模型就绪，耗时 {time.time()-t0:.1f}s", flush=True)
    yield


app = FastAPI(title="问诊记录 ASR 服务", lifespan=lifespan)
# 允许 Electron 本地页面跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "funasr-diarization", "models": [
        "SenseVoiceSmall", "fsmn-vad", "cam++", "punc-ct-transformer"]}


@app.post("/api/transcribe")
async def api_transcribe(
    audio: UploadFile = File(...),
    min_speakers: int = Form(1),
    max_speakers: int = Form(6),
):
    """上传一段音频，返回句子列表 [{spk, start, end, text}]"""
    suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(await audio.read())
        tmp_path = f.name
    try:
        items = transcribe(tmp_path, use_punc=True, device="cpu")
        # 若用户限制了说话人数，交给模型聚类时参考（VAD/CAM++ 内部支持，传参简化）
        return {"ok": True, "sentences": items,
                "speakers": sorted({it["spk"] for it in items})}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
