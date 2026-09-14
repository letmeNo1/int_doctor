// 问诊记录 Electron 主进程
// 职责：拉起 Python 后端(ASR服务)、创建窗口、处理麦克风权限、退出时清理后端
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const BACKEND_PORT = 8765;
const PROJECT_ROOT = path.join(__dirname, '..');
const PYTHON = path.join(PROJECT_ROOT, 'funasr_env', 'Scripts', 'python.exe');
const BACKEND_SCRIPT = path.join(PROJECT_ROOT, 'asr_service.py');

let backendProc = null;
let mainWindow = null;

function startBackend() {
  console.log('[main] 启动 Python 后端…', PYTHON);
  backendProc = spawn(PYTHON, [BACKEND_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProc.stdout.on('data', (d) => process.stdout.write('[asr] ' + d));
  backendProc.stderr.on('data', (d) => process.stderr.write('[asr] ' + d));
  backendProc.on('exit', (code) => {
    console.log('[main] 后端退出，code=', code);
    backendProc = null;
  });
}

function stopBackend() {
  if (backendProc) {
    console.log('[main] 停止后端…');
    try { backendProc.kill(); } catch (e) { /* ignore */ }
    backendProc = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    title: '问诊记录',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 转发渲染进程 console 到主进程输出（便于排查界面问题）
  mainWindow.webContents.on('console-message', (e, levelOrDetails, message) => {
    if (typeof levelOrDetails === 'object') {
      console.log(`[renderer:${levelOrDetails.level}] ${levelOrDetails.message}`);
    } else {
      console.log(`[renderer:${levelOrDetails}] ${message}`);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // 默认不放行通用 media 权限，避免应用启动时被系统误判为启用摄像头。
  // 当前渲染进程的录音逻辑只请求 audio；扫码是否允许摄像头应走显式交互。
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(false);
  });
  startBackend();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => stopBackend());
