# 医院问诊系统（FunASR 问诊记录桌面应用 + 医院管理后台）

环境：Windows 本地 + Python 3.10 虚拟环境 + CPU 推理 + Electron 桌面应用 + FastAPI Web 后台

## 系统组成

```
int_doctor/
├── funasr_env/              # FunASR 转写虚拟环境（语音识别+说话人分离）
├── .venv/                   # 医院后台虚拟环境（FastAPI + qrcode）
├── transcribe.py            # 命令行转写脚本：转写 + 说话人分离（JSON/TXT/SRT）
├── asr_service.py           # FastAPI 后端服务（Electron 自动拉起，端口 8765）
├── electron-app/            # Electron 问诊记录桌面应用
│   └── renderer/            # 录音/实时对话/说话人设置/记录导出/病人管理/扫码
├── app.py                   # 医院管理后台（FastAPI，端口 8888）
├── static/                  # 后台前端：login / admin / doctor / patient
├── hospital.db              # ★ 病例记录（SQLite，替代原 records.json）
├── patients.json            # ★ 病人档案（桌面应用与后台共用同一份数据）
├── users.json               # 管理员与医生账号
├── start-app.bat            # 一键启动问诊记录桌面应用
└── start-doctor.bat         # 一键启动医院管理后台
```

## 医院管理后台（本部分）

启动：双击 `start-doctor.bat`，浏览器自动打开 `http://127.0.0.1:8888`

| 角色 | 功能 |
|---|---|
| **管理员**（默认 admin/admin123，登录后请改密） | 医生账号增删、全部病人记录（编辑/删除/查看二维码）、全部病例记录 |
| **医生** | 登录后搜索查看病人列表、查看病人详情与历史病例、录入新病例 |
| **病人** | 注册（自动生成病历号 P+日期+序号）、登录后查看/修改本人信息、生成并下载专属二维码 |

**二维码内容 = 病历号**——病人就诊时出示二维码，医生用问诊记录桌面应用「📷 扫码」即可调出档案（两边共用 patients.json，数据天然一致）。

后台 API：`app.py`（登录认证 / admin / doctor / patient / qrcode），接口测试 `test_api.py`（18 项全部通过）。

**数据存储**：病例记录存 `hospital.db`（SQLite）；病人档案存 `patients.json`（与桌面应用共享）；账号存 `users.json`。旧版 `records.json` 数据启动时自动迁移入 SQLite 并备份为 `records.json.bak`。

## 问诊记录桌面应用（另见原说明）

启动：双击 `start-app.bat`（Electron 自动拉起 FunASR 后端 8765）

- 自动录音 + 静音切句 + 实时分说话人（医生/患者）
- 病人档案管理 + 身份核实（列表/病历号直达/扫码）
- 问诊字段 + 导出 Markdown/JSON


## 项目初始化说明

适用于新机器、删除环境后重建，或需要完整重新部署时。

### 1. 环境要求

- Windows 10/11
- Python 3.10.x
- Node.js 22.x
- 可联网下载 FunASR 模型

### 2. 初始化 Python 环境

在项目根目录执行：

```powershell
cd C:\Users\Administrator\int_doctor
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install funasr fastapi "uvicorn[standard]" modelscope==1.36.3 torch torchaudio numpy scipy soundfile
```

如果你继续使用仓库内现成环境，也可以直接使用 `funasr_env`，无需重复创建。

### 3. 下载语音模型

激活 Python 环境后执行：

```powershell
python download_models.py
```

模型默认会下载到当前用户目录下的 ModelScope 缓存中。首次下载时间取决于网络情况。

### 4. 初始化 Electron 依赖

进入 Electron 目录安装依赖：

```powershell
cd .\electron-app
npm install
```

如果只是恢复依赖，保留 `package-lock.json` 并执行 `npm install` 即可。

### 5. 启动与验证

回到项目根目录后，任选一种方式启动：

```powershell
cd C:\Users\Administrator\int_doctor
start-app.bat
```

或手动分别启动后端与桌面端：

```powershell
cd C:\Users\Administrator\int_doctor
.\.venv\Scripts\Activate.ps1
python asr_service.py
```

另开一个终端：

```powershell
cd C:\Users\Administrator\int_doctor\electron-app
npm start
```

验证标准：

- Electron 窗口正常打开
- 页面状态显示「后端就绪」
- 导入 `test_dialog.wav` 后能看到转写结果和说话人标签

### 6. 常见初始化问题

- 如果 PowerShell 禁止执行脚本，可先执行：`Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`
- 如果模型下载失败，优先检查网络或重试 `python download_models.py`
- 如果 `npm install` 失败，先确认 Node.js 版本是否为 22.x 左右
- 如果后端启动失败，优先确认当前激活的是 `.venv` 或 `funasr_env` 中的正确 Python 环境

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

