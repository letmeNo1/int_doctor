# FunASR 语音转写 + 说话人分离（Windows 本地部署）+ 问诊记录桌面应用

部署日期：2026-09-11
环境：Python 3.10 虚拟环境 + CPU 推理 + Electron 桌面应用

## 目录结构

```
new-chat/
├── funasr_env/              # Python 3.10 虚拟环境（已装好全部依赖）
├── transcribe.py            # 命令行转写脚本：转写 + 说话人分离（JSON/TXT/SRT）
├── asr_service.py           # FastAPI 后端服务（Electron 自动拉起，端口 8765）
├── download_models.py       # 模型下载脚本（重装/换机时用）
├── make_test_audio.py       # 生成双人对话测试音频
├── test_dialog.wav          # 25s 双人对话测试音频（已通过验证）
├── electron-app/            # Electron 问诊记录应用
│   ├── main.js              # 主进程：拉起 Python 后端 + 窗口 + 麦克风权限
│   ├── preload.js
│   ├── renderer/            # 界面：录音/实时对话/说话人设置/记录导出
│   └── package.json
└── start-app.bat            # 一键启动（双击即可）
```

## 快速启动（推荐）

双击 `start-app.bat`，等待右上角状态从「后端加载中…」变为「后端就绪」（首次约 30-60 秒），点「开始录音」。

## 命令行使用（不打开界面）

```powershell
cd C:\Users\Administrator\Doubao\chats\2026-09-11\new-chat
.\funasr_env\Scripts\activate
python transcribe.py 你的音频.wav --out json --punc
# --out 可选 json / txt / srt；必须带 --punc 才有说话人分离
```

## 问诊记录应用功能

- **自动录音 + 自动切句**：静音 0.8 秒自动切分对话，最长 10 秒强制切分
- **自动分说话人**：后端 VAD+CAM++ 聚类，实时标注「医生/患者」
- **说话人设置**：可把 spk0/spk1 改成「医生/患者」（记住设置）
- **问诊记录**：主诉/现病史/既往史/诊断处置字段 + 导出 Markdown/JSON
- **导入音频**：直接转写已有录音（无需麦克风）
- **病人档案管理**：新增 / 编辑 / 删除 / 搜索病人，档案存 patients.json
- **病人身份核实（三种入口）**：
  1. 从列表选择（按预约时间排序，当天预约高亮「预约 今天」标签）
  2. 输入病历号回车直达（唯一匹配自动选中；支持姓名/电话模糊匹配）
  3. 摄像头扫码（二维码内容=病历号，识别后自动匹配并选中）
- **预约时间**：病人档案可填预约时间，列表按预约先后排列
- 纯静音段自动丢弃，不浪费后端算力

## 已安装组件

| 组件 | 版本 | 说明 |
|---|---|---|
| Python | 3.10.0 | 虚拟环境 funasr_env\ |
| torch | 2.14.0+cpu | CPU 版 |
| funasr | 1.4.15 | 阿里达摩院语音识别工具箱 |
| modelscope | 1.36.3 | 模型下载（勿升 1.40，有兼容 bug） |
| fastapi / uvicorn | 0.141 / 0.52 | 后端推理服务 |
| Node / Electron | 22.x / 44.3.0 | 桌面应用 |

## 已下载模型（缓存目录）

`C:\Users\Administrator\.cache\modelscope\hub\models\iic\`

| 模型 | 用途 |
|---|---|
| SenseVoiceSmall | 语音识别（中/英/日/韩/粤，带情感识别） |
| speech_fsmn_vad_zh-cn-16k-common-pytorch | 语音活动检测（VAD 切句） |
| speech_campplus_sv_zh-cn_16k-common | 说话人聚类（CAM++，分 spk0/spk1...） |
| punc_ct-transformer_zh-cn-common-vocab272727-pytorch | 标点恢复（必须启用，否则不说话人分离） |

## 常见问题

1. **为什么不加 --punc 不说话人分离？**
   FunASR 的说话人分离依赖 punc 模型的按句切分模式（fallback 会把整段当一个长句）。

2. **说话人是编号不是名字？**
   spk0/spk1 只是聚类编号，不识别"张三李四"。应用内可手动改成「医生/患者」；要自动实名需二开声纹注册（CAM++ 支持）。

3. **modelscope 报 `_logged_out` 错误？**
   是 modelscope 1.40 的 bug，当前环境已固定 1.36.3，不要升级。

4. **录音没有文字？**
   确认系统麦克风有输入；纯静音段会被丢弃属正常。

## 二开扩展方向

- 声纹注册自动实名：用 CAM++ 提取参考音频 embedding，把 spk 编号映射成姓名
- 长音频分片 + 并行处理
- 自动生成问诊摘要（接 LLM API）
- 打包成安装程序（electron-builder）

