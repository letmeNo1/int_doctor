# -*- coding: utf-8 -*-
"""生成双人对话测试音频：交替拼接 CAM++ 示例中两位说话人的语音，中间加静音"""
import sys
import numpy as np
import soundfile as sf

CACHE = r"C:\Users\Administrator\.cache\modelscope\hub\models\iic\speech_campplus_sv_zh-cn_16k-common\examples"

def main() -> int:
    spk1_a = CACHE + r"\speaker1_a_cn_16k.wav"
    spk1_b = CACHE + r"\speaker1_b_cn_16k.wav"
    spk2_a = CACHE + r"\speaker2_a_cn_16k.wav"

    sr = 16000
    silence = np.zeros(sr // 2, dtype=np.float32)  # 0.5s 静音

    a1, _ = sf.read(spk1_a, dtype="float32")
    b1, _ = sf.read(spk1_b, dtype="float32")
    a2, _ = sf.read(spk2_a, dtype="float32")

    # 对话顺序：说话人1 -> 说话人2 -> 说话人1(另一句) -> 说话人2
    dialog = np.concatenate([
        a1, silence, a2, silence, b1, silence, a2, silence, a1,
    ])
    out = r"C:\Users\Administrator\Doubao\chats\2026-09-11\new-chat\test_dialog.wav"
    sf.write(out, dialog, sr)
    print(f"已生成: {out}")
    print(f"时长: {len(dialog)/sr:.1f}s, 采样率: {sr}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
