# -*- coding: utf-8 -*-
"""下载 FunASR 所需模型（SenseVoiceSmall + CAM++ 说话人聚类 + FSMN-VAD）"""
import sys
from modelscope.hub.snapshot_download import snapshot_download

MODELS = [
    "iic/SenseVoiceSmall",
    "iic/speech_campplus_sv_zh-cn_16k-common",
    "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
]

def main() -> int:
    for model_id in MODELS:
        print(f"\n===== 开始下载: {model_id} =====", flush=True)
        try:
            path = snapshot_download(model_id)
            print(f"OK: {model_id} -> {path}", flush=True)
        except Exception as e:
            print(f"FAIL: {model_id} -> {e}", flush=True)
            return 1
    print("\n全部模型下载完成", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
