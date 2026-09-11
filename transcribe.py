# -*- coding: utf-8 -*-
"""
FunASR 语音转写 + 说话人分离脚本（Windows 本地，CPU）
用法:
    python transcribe.py 音频文件.wav [--out json|txt|srt] [--punc]
示例:
    python transcribe.py test.wav --out json
    python transcribe.py test.wav --out txt --punc
输出:
    json - 完整结构化结果（每句: spk / start / end / text）
    txt  - 按说话人组织的可读文本
    srt  - 字幕格式（适合剪辑/字幕软件）
"""
import argparse
import json
import sys
import os

from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess

MODEL_ASR = "iic/SenseVoiceSmall"
MODEL_VAD = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"
MODEL_SPK = "iic/speech_campplus_sv_zh-cn_16k-common"
MODEL_PUNC = "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch"

_model = None


def load_model(use_punc: bool, device: str):
    global _model
    if _model is not None:
        return _model
    kwargs = dict(
        model=MODEL_ASR,
        vad_model=MODEL_VAD,
        spk_model=MODEL_SPK,
        device=device,
        disable_update=True,
        log_level="WARNING",
    )
    if use_punc:
        kwargs["punc_model"] = MODEL_PUNC
    print(f"加载模型中（ASR+VAD+说话人分离）… device={device}", file=sys.stderr)
    _model = AutoModel(**kwargs)
    return _model


def clean_text(raw: str) -> str:
    """清理 SenseVoice 输出中的 <|zh|><|NEUTRAL|> 等标签及情感/事件 emoji"""
    try:
        text = rich_transcription_postprocess(raw)
    except Exception:
        # 兜底：正则去掉 <|...|> 标签
        import re
        text = re.sub(r"<\|[^|]*\|>", "", raw).strip()
    # 过滤 SenseVoice 保留的情感/事件 emoji（如 🎼😀 等）
    import re
    text = re.sub(
        r"[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F300-\U0001F5FF"
        r"\U0001F600-\U0001F64F\U0001F680-\U0001F6FF\U0000FE00-\U0000FE0F]",
        "", text,
    )
    return text.strip()


def transcribe(audio: str, use_punc: bool, device: str) -> list:
    model = load_model(use_punc, device)
    print(f"转写中：{audio} …", file=sys.stderr)
    res = model.generate(
        input=audio,
        output_timestamp=True,
        batch_size_s=60,
    )
    result = res[0]
    if "sentence_info" not in result:
        # 空语音（纯静音/无人说话）：模型无有效句子输出，属正常情况，返回空列表
        return []

    items = []
    for s in result["sentence_info"]:
        items.append({
            "spk": int(s["spk"]),
            "start": round(s["start"] / 1000.0, 2),   # 秒
            "end": round(s["end"] / 1000.0, 2),      # 秒
            "text": clean_text(s["text"]),
        })
    return items


def to_txt(items: list) -> str:
    lines = []
    for it in items:
        lines.append(f"[{it['start']:7.2f}-{it['end']:7.2f}] 说话人{it['spk']}: {it['text']}")
    return "\n".join(lines)


def to_srt(items: list) -> str:
    def ts(sec: float) -> str:
        h = int(sec // 3600); m = int(sec % 3600 // 60); s = int(sec % 60)
        ms = int(round((sec - int(sec)) * 1000))
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    blocks = []
    for i, it in enumerate(items, 1):
        blocks.append(f"{i}\n{ts(it['start'])} --> {ts(it['end'])}\n说话人{it['spk']}: {it['text']}\n")
    return "\n".join(blocks)


def main() -> int:
    ap = argparse.ArgumentParser(description="FunASR 语音转写 + 说话人分离")
    ap.add_argument("audio", help="音频文件路径（推荐 16k 单声道 wav/mp3）")
    ap.add_argument("--out", choices=["json", "txt", "srt"], default="json")
    ap.add_argument("--punc", action="store_true", help="启用标点恢复（额外下载约200MB模型）")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    args = ap.parse_args()

    if not os.path.exists(args.audio):
        print(f"错误：文件不存在 {args.audio}", file=sys.stderr)
        return 1

    items = transcribe(args.audio, args.punc, args.device)

    if args.out == "json":
        print(json.dumps(items, ensure_ascii=False, indent=2))
    elif args.out == "txt":
        print(to_txt(items))
    elif args.out == "srt":
        print(to_srt(items))

    # 汇总
    spk_count = sorted(set(it["spk"] for it in items))
    print(f"\n共 {len(items)} 句，检测到说话人: {spk_count}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
