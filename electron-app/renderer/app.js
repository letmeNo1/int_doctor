// 问诊记录：录音 + 静音切句 + 后端转写(分说话人) + 记录导出
'use strict';

const API = 'http://127.0.0.1:8765';
const SPK_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];

// 切句参数
const SILENCE_RMS = 0.012;    // 静音能量阈值
const SILENCE_MS = 800;       // 连续静音多少毫秒切句
const MIN_SEG_MS = 1200;      // 最短句段
const MAX_SEG_MS = 10000;     // 最长句段（强制切）

// ---- 状态 ----
let backendReady = false;
let recording = false;
let stream = null, audioCtx = null, scriptNode = null, gainNode = null;
let segPcm = null;            // 当前段积累的原始采样 PCM
let segStartSample = 0;       // 当前段起始全局采样
let segHadVoice = false;      // 当前段是否出现过语音（纯静音段不发送）
let totalSamples = 0;         // 全局采样计数
let silenceMs = 0;
let recStartWall = 0;         // 录音开始的墙钟时间
let sentences = [];           // 全部句子 {spk,start,end,text,wall}
let sendQueue = [];           // 待发送段
let sending = false;
let sessionSec = 0;           // 录音累计秒数

const $ = (id) => document.getElementById(id);
const els = {
  conn: $('conn-status'), start: $('btn-start'), stop: $('btn-stop'),
  file: $('file-import'), expMd: $('btn-export-md'), expJson: $('btn-export-json'),
  transcript: $('transcript'), dur: $('stat-dur'), count: $('stat-count'),
  spkStats: $('spk-stats'),
  spk0: $('spk0-name'), spk1: $('spk1-name'), saveSpk: $('btn-save-spk'),
  fComplaint: $('f-complaint'), fHistory: $('f-history'), fPast: $('f-past'), fDx: $('f-dx'),
  // 病人管理
  btnPatient: $('btn-patient'), currentPatient: $('current-patient'),
  modal: $('patient-modal'), modalClose: $('modal-close'),
  tabExist: $('tab-exist'), tabNew: $('tab-new'),
  panelExist: $('panel-exist'), panelNew: $('panel-new'),
  search: $('patient-search'), list: $('patient-list'),
  patientNoInput: $('patient-no-input'), btnScan: $('btn-scan'),
  scanModal: $('scan-modal'), scanClose: $('scan-close'),
  scanVideo: $('scan-video'), scanStatus: $('scan-status'), scanStop: $('scan-stop'),
  pName: $('p-name'), pGender: $('p-gender'), pAge: $('p-age'),
  pNo: $('p-no'), pAppt: $('p-appt'), pPhone: $('p-phone'), pPast: $('p-past'),
  btnAddPatient: $('btn-add-patient'),
};

// ---- 病人管理 ----
let currentPatient = null;
let patientList = [];
let editingId = null;   // 非空表示正在编辑该病人

function renderCurrentPatient() {
  if (currentPatient) {
    els.currentPatient.textContent =
      `${currentPatient.name}（${currentPatient.gender || '?'}/${currentPatient.age || '?'}岁${currentPatient.no ? '，' + currentPatient.no : ''}）`;
    els.currentPatient.className = 'patient-name';
  } else {
    els.currentPatient.textContent = '未选择';
    els.currentPatient.className = 'patient-name empty';
  }
}

function openPatientModal() {
  els.modal.hidden = false;
  switchTab('exist');
  loadPatientList();
  checkCamera();   // 只枚举设备，不打开摄像头
}

function closePatientModal() {
  closeScan();
  els.modal.hidden = true;
}

function switchTab(which) {
  const exist = which === 'exist';
  els.tabExist.classList.toggle('active', exist);
  els.tabNew.classList.toggle('active', !exist);
  els.panelExist.hidden = !exist;
  els.panelNew.hidden = exist;
  if (exist) {
    editingId = null;
    els.btnAddPatient.textContent = '保存并选择';
    loadPatientList();
    els.search.focus();
  }
}

async function loadPatientList() {
  try {
    patientList = await window.patientsApi.list();
    renderPatientList();
  } catch (e) {
    els.list.innerHTML = `<div class="patient-empty">读取病人档案失败：${e.message}</div>`;
  }
}

function renderPatientList() {
  const kw = els.search.value.trim().toLowerCase();
  const filtered = patientList.filter((p) =>
    !kw || (p.name || '').toLowerCase().includes(kw)
      || (p.no || '').toLowerCase().includes(kw)
      || (p.phone || '').toLowerCase().includes(kw));
  // 预约时间排序：有预约的按时间先后在前（未填的按创建时间）
  const now = Date.now();
  const sortKey = (p) => {
    if (!p.appt) return 2;                 // 无预约排最后
    const t = new Date(p.appt.replace(' ', 'T')).getTime();
    if (isNaN(t)) return 1;                // 预约格式无效
    return t < now - 3600e3 ? 1.5 : 0;     // 已过期预约排在有效预约后
  };
  filtered.sort((a, b) => sortKey(a) - sortKey(b) || (a.createdAt || '').localeCompare(b.createdAt || ''));

  if (filtered.length === 0) {
    els.list.innerHTML = `<div class="patient-empty">${kw ? '没有匹配的病人' : '还没有病人档案，切到「新增病人」录入'}</div>`;
    return;
  }
  els.list.innerHTML = '';
  for (const p of filtered) {
    const item = document.createElement('div');
    item.className = 'patient-item';
    const info = document.createElement('div');
    info.className = 'info';
    let apptTag = '';
    if (p.appt) {
      const t = new Date(p.appt.replace(' ', 'T')).getTime();
      const isToday = !isNaN(t) && new Date(t).toDateString() === new Date().toDateString();
      apptTag = `<span class="appt${isToday ? ' appt-today' : ''}">预约 ${escapeHtml(p.appt)}</span>`;
    }
    info.innerHTML = `<b>${escapeHtml(p.name || '未命名')}</b>` +
      `<span>${escapeHtml(p.gender || '')} ${p.age ? escapeHtml(p.age) + '岁' : ''}</span>${apptTag}` +
      `<div class="sub">${p.no ? '病历号 ' + escapeHtml(p.no) : ''}${p.phone ? ' · ' + escapeHtml(p.phone) : ''}` +
      `${p.past ? ' · ' + escapeHtml(p.past).slice(0, 30) + (p.past.length > 30 ? '…' : '') : ''}</div>`;
    const ops = document.createElement('div');
    ops.className = 'ops';
    const sel = document.createElement('button');
    sel.className = 'btn btn-small';
    sel.textContent = '选择';
    sel.addEventListener('click', () => selectPatient(p.id));
    ops.appendChild(sel);
    const edit = document.createElement('button');
    edit.className = 'btn btn-small btn-ghost';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => editPatient(p));
    ops.appendChild(edit);
    const del = document.createElement('button');
    del.className = 'btn btn-small btn-danger-ghost';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      if (confirm(`确定删除病人「${p.name}」的档案？`)) {
        await window.patientsApi.remove(p.id);
        if (currentPatient && currentPatient.id === p.id) { currentPatient = null; renderCurrentPatient(); }
        loadPatientList();
      }
    });
    ops.appendChild(del);
    item.append(info, ops);
    els.list.appendChild(item);
  }
}

function editPatient(p) {
  editingId = p.id;
  els.pName.value = p.name || '';
  els.pGender.value = p.gender || '男';
  els.pAge.value = p.age || '';
  els.pNo.value = p.no || '';
  els.pAppt.value = p.appt || '';
  els.pPhone.value = p.phone || '';
  els.pPast.value = p.past || '';
  els.btnAddPatient.textContent = '保存修改';
  switchTab('new');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectPatient(id) {
  const p = patientList.find((x) => x.id === id);
  if (!p) return;
  currentPatient = p;
  renderCurrentPatient();
  closePatientModal();
}

async function addPatientSubmit() {
  const name = els.pName.value.trim();
  if (!name) { alert('请填写姓名'); els.pName.focus(); return; }
  const data = {
    name,
    gender: els.pGender.value,
    age: els.pAge.value.trim(),
    no: els.pNo.value.trim(),
    appt: els.pAppt.value.trim(),
    phone: els.pPhone.value.trim(),
    past: els.pPast.value.trim(),
  };
  try {
    let p;
    if (editingId) {
      p = await window.patientsApi.update(editingId, data);
      editingId = null;
    } else {
      p = await window.patientsApi.add(data);
    }
    currentPatient = p;
    renderCurrentPatient();
    closePatientModal();
    // 清空表单
    els.pName.value = ''; els.pAge.value = ''; els.pNo.value = '';
    els.pAppt.value = ''; els.pPhone.value = ''; els.pPast.value = '';
    els.btnAddPatient.textContent = '保存并选择';
  } catch (e) {
    alert('保存失败：' + e.message);
  }
}

// 病历号直达：回车精确匹配，唯一命中即选中
async function quickSelectByNo() {
  const no = els.patientNoInput.value.trim();
  if (!no) return;
  const list = await window.patientsApi.list();
  const hits = list.filter((p) => (p.no || '').trim().toLowerCase() === no.toLowerCase());
  if (hits.length === 1) {
    currentPatient = hits[0];
    renderCurrentPatient();
    closePatientModal();
    els.patientNoInput.value = '';
  } else if (hits.length > 1) {
    alert(`病历号 ${no} 匹配到 ${hits.length} 个档案，请在列表中选择`);
    patientList = list;
    els.search.value = no;
    renderPatientList();
  } else {
    const fuzzy = list.filter((p) =>
      (p.name || '').toLowerCase().includes(no.toLowerCase())
      || (p.phone || '').includes(no));
    if (fuzzy.length === 1) {
      currentPatient = fuzzy[0];
      renderCurrentPatient();
      closePatientModal();
      els.patientNoInput.value = '';
    } else {
      alert(`未找到病历号/姓名/电话为「${no}」的病人，请新增档案`);
    }
  }
}

// ---- 扫码 ----
let scanStream = null;
let scanTimer = null;
let scanClosed = false;
let hasCamera = false;   // 是否检测到摄像头（仅枚举设备，不打开摄像头）

// 检测摄像头是否存在（只枚举设备，不触发摄像头开启）
async function checkCamera() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    hasCamera = devices.some((d) => d.kind === 'videoinput');
  } catch (e) {
    hasCamera = false;
  }
  if (hasCamera) {
    els.btnScan.disabled = false;
    els.btnScan.textContent = '📷 扫码';
  } else {
    els.btnScan.disabled = true;
    els.btnScan.textContent = '📷 扫码（无摄像头）';
    els.btnScan.title = '未检测到摄像头，请用病历号直达或列表选择';
  }
  return hasCamera;
}

function openScan() {
  stopScan();
  scanClosed = false;
  els.scanModal.hidden = false;
  els.scanStatus.textContent = '正在检查摄像头…';
  els.scanStatus.className = 'scan-status';
  startScan();
}

function closeScan() {
  scanClosed = true;
  stopScan();
  els.scanModal.hidden = true;
}

// 带超时的 getUserMedia：无摄像头/被占用/系统拒绝时避免无限挂起
function getUserMediaWithTimeout(constraints, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('摄像头无响应（超时）')), ms);
    navigator.mediaDevices.getUserMedia(constraints)
      .then((s) => { clearTimeout(timer); resolve(s); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

async function startScan() {
  scanClosed = false;
  try {
    // 1) 扫码组件是否就绪
    if (typeof window.ZXing === 'undefined' || !window.ZXing.BrowserMultiFormatReader) {
      throw new Error('扫码组件未加载，请重启应用后重试');
    }
    // 2) 预检：无摄像头则直接提示（checkCamera 已检测过，这里再兜底一次）
    if (!hasCamera) {
      els.scanStatus.textContent = '未检测到摄像头，请改用「病历号直达」或列表选择';
      els.scanStatus.className = 'scan-status err';
      return;
    }
    // 3) 打开摄像头（带 6 秒超时）
    els.scanStatus.textContent = '正在启动摄像头…';
    scanStream = await getUserMediaWithTimeout({
      video: { width: 640, height: 480 },
      audio: false,
    }, 6000);
    if (scanClosed) { stopScan(); return; }
    els.scanVideo.srcObject = scanStream;
    els.scanStatus.textContent = '请将二维码对准摄像头';
    const reader = new window.ZXing.BrowserMultiFormatReader();
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    scanTimer = setInterval(async () => {
      if (scanClosed) { stopScan(); return; }
      try {
        const v = els.scanVideo;
        if (!v.videoWidth) return;
        ctx.drawImage(v, 0, 0, 640, 480);
        const result = await reader.decodeFromCanvas(canvas);
        if (result && result.getText) {
          handleScanResult(result.getText());
        }
      } catch (e) { /* 单帧未识别，继续 */ }
    }, 350);
  } catch (e) {
    if (scanClosed) return;
    stopScan();
    els.scanStatus.textContent = '摄像头启动失败：' + e.message;
    els.scanStatus.className = 'scan-status err';
  }
}

function stopScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  // 先解除 video 元素对流的引用，再停止所有轨道，最后延时兜底再停一次
  els.scanVideo.srcObject = null;
  if (scanStream) {
    const tracks = scanStream.getTracks();
    scanStream = null;
    tracks.forEach((t) => { try { t.stop(); } catch (e) {} });
    // Chromium 偶发未立即释放摄像头：延时再强制停一次
    setTimeout(() => {
      tracks.forEach((t) => { try { t.stop(); } catch (e) {} });
    }, 300);
  }
}

async function handleScanResult(text) {
  stopScan();
  const no = text.trim();
  els.scanStatus.textContent = '识别到：' + no + '，正在匹配…';
  els.scanStatus.className = 'scan-status ok';
  const list = await window.patientsApi.list();
  const hit = list.find((p) => (p.no || '').trim().toLowerCase() === no.toLowerCase());
  if (hit) {
    currentPatient = hit;
    renderCurrentPatient();
    setTimeout(() => { els.scanModal.hidden = true; els.scanStatus.textContent = ''; }, 600);
  } else {
    els.scanStatus.textContent = `未找到病历号「${no}」的病人`;
    els.scanStatus.className = 'scan-status err';
    setTimeout(() => els.scanModal.hidden = true, 2000);
  }
}

// ---- 说话人名字 ----
let spkNames = { 0: '医生', 1: '患者' };
try { spkNames = Object.assign(spkNames, JSON.parse(localStorage.getItem('spkNames') || '{}')); } catch (e) {}
els.spk0.value = spkNames[0]; els.spk1.value = spkNames[1];
els.saveSpk.addEventListener('click', () => {
  spkNames[0] = els.spk0.value.trim() || '说话人0';
  spkNames[1] = els.spk1.value.trim() || '说话人1';
  localStorage.setItem('spkNames', JSON.stringify(spkNames));
  rerender();
});

function spkName(i) { return spkNames[i] || ('说话人' + i); }
function spkColor(i) { return SPK_COLORS[i % SPK_COLORS.length]; }

// ---- 后端健康检查 ----
async function pollHealth() {
  try {
    const r = await fetch(API + '/health', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    if (j.status === 'ok') {
      backendReady = true;
      els.conn.textContent = '后端就绪';
      els.conn.className = 'badge badge-ok';
      els.start.disabled = false;
      els.expMd.disabled = false;
      els.expJson.disabled = false;
      return;
    }
  } catch (e) { /* 未就绪 */ }
  els.conn.textContent = '后端加载中…';
  els.conn.className = 'badge badge-wait';
  setTimeout(pollHealth, 2000);
}

// ---- 录音 ----
async function startRecording() {
  if (!backendReady) return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;          // 静音输出，避免回放
  src.connect(scriptNode);
  scriptNode.connect(gainNode).connect(audioCtx.destination);

  segPcm = new Float32Array(0);
  segStartSample = 0;
  segHadVoice = false;
  totalSamples = 0;
  silenceMs = 0;
  sessionSec = 0;
  recStartWall = Date.now();
  sentences = [];
  sendQueue = [];
  sending = false;
  rerender();

  scriptNode.onaudioprocess = onAudio;
  recording = true;
  els.start.disabled = true;
  els.stop.disabled = false;
  els.conn.textContent = '录音中…';
  els.conn.className = 'badge badge-rec';
}

function onAudio(e) {
  if (!recording) return;
  const d = e.inputBuffer.getChannelData(0);
  const rate = audioCtx.sampleRate;
  const durSec = d.length / rate;

  // 累积到当前段
  const merged = new Float32Array(segPcm.length + d.length);
  merged.set(segPcm); merged.set(d, segPcm.length);
  segPcm = merged;
  totalSamples += d.length;
  sessionSec = totalSamples / rate;

  // RMS 能量
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
  const rms = Math.sqrt(sum / d.length);
  if (rms >= SILENCE_RMS) segHadVoice = true;

  const segDurMs = (totalSamples - segStartSample) / rate * 1000;
  if (rms < SILENCE_RMS) {
    silenceMs += durSec * 1000;
  } else {
    silenceMs = 0;
  }

  const shouldCut = (silenceMs >= SILENCE_MS && segDurMs >= MIN_SEG_MS)
    || segDurMs >= MAX_SEG_MS;
  if (shouldCut) {
    const pcm = segPcm;
    const startSample = segStartSample;
    const hadVoice = segHadVoice;
    segPcm = new Float32Array(0);
    segStartSample = totalSamples;
    segHadVoice = false;
    silenceMs = 0;
    // 纯静音段（无语音）不发送，节省后端开销
    if (hadVoice) enqueueSegment(pcm, rate, startSample / rate);
  }
}

function enqueueSegment(pcm, rate, startSec) {
  sendQueue.push({ pcm, rate, startSec });
  processQueue();
}

async function processQueue() {
  if (sending || sendQueue.length === 0) return;
  sending = true;
  const seg = sendQueue.shift();
  try {
    const wav = await encodeWav16k(seg.pcm, seg.rate);
    const fd = new FormData();
    fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'seg.wav');
    const resp = await fetch(API + '/api/transcribe', { method: 'POST', body: fd });
    const j = await resp.json();
    if (j.ok) {
      const wallBase = recStartWall + seg.startSec * 1000;
      for (const s of j.sentences) {
        sentences.push({
          spk: s.spk,
          start: s.start,
          end: s.end,
          text: s.text,
          wall: new Date(wallBase + s.start * 1000),
        });
      }
      rerender();
    } else {
      appendError(seg.startSec, j.error || '后端返回错误');
    }
  } catch (e) {
    appendError(seg.startSec, '请求失败: ' + e.message);
  } finally {
    sending = false;
    processQueue();
  }
}

function appendError(sec, msg) {
  sentences.push({
    spk: -1, start: sec, end: sec, text: '⚠ ' + msg,
    wall: new Date(recStartWall + sec * 1000),
  });
  rerender();
}

function stopRecording() {
  recording = false;
  // 发送剩余尾巴（仅当含语音）
  if (segPcm && segPcm.length > 0 && segHadVoice) {
    const pcm = segPcm;
    segPcm = new Float32Array(0);
    enqueueSegment(pcm, audioCtx.sampleRate, segStartSample / audioCtx.sampleRate);
  }
  if (scriptNode) { try { scriptNode.disconnect(); } catch (e) {} scriptNode = null; }
  if (gainNode) { try { gainNode.disconnect(); } catch (e) {} gainNode = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }

  els.start.disabled = false;
  els.stop.disabled = true;
  els.conn.textContent = backendReady ? '后端就绪' : '后端加载中…';
  els.conn.className = 'badge ' + (backendReady ? 'badge-ok' : 'badge-wait');
}

// ---- 重采样 16k + WAV 编码 ----
async function encodeWav16k(pcm, fromRate) {
  const data = fromRate === 16000 ? pcm : await resampleTo16k(pcm, fromRate);
  const n = data.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
  v.setUint32(28, 16000 * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

function resampleTo16k(pcm, fromRate) {
  return new Promise((resolve) => {
    const targetLen = Math.floor(pcm.length * 16000 / fromRate);
    const ctx = new OfflineAudioContext(1, targetLen, 16000);
    const buf = ctx.createBuffer(1, pcm.length, fromRate);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    ctx.startRendering().then((rendered) => resolve(rendered.getChannelData(0)));
  });
}

// ---- 渲染 ----
function fmtWall(d) {
  if (!d || isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtDur(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function rerender() {
  const body = els.transcript;
  body.innerHTML = '';
  if (sentences.length === 0) {
    body.innerHTML = '<div class="empty-hint">点击「开始录音」，应用将自动切分对话并区分说话人。<br>也可「导入音频」直接转写已有录音。</div>';
  } else {
    for (const s of sentences) {
      const div = document.createElement('div');
      div.className = 'msg';
      const t = document.createElement('span'); t.className = 't'; t.textContent = fmtWall(s.wall);
      const tag = document.createElement('span'); tag.className = 'tag';
      tag.style.background = s.spk < 0 ? '#9ca3af' : spkColor(s.spk);
      tag.textContent = s.spk < 0 ? '系统' : spkName(s.spk);
      const tx = document.createElement('span'); tx.className = 'text';
      tx.textContent = s.text;
      if (s.spk >= 0 && s.end > s.start) {
        const dur = document.createElement('span'); dur.className = 'dur';
        dur.textContent = `[${fmtDur(s.start)}–${fmtDur(s.end)}]`;
        tx.appendChild(dur);
      }
      div.append(t, tag, tx);
      body.appendChild(div);
    }
  }
  body.scrollTop = body.scrollHeight;

  // 统计
  els.dur.textContent = fmtDur(sessionSec);
  els.count.textContent = sentences.filter(s => s.spk >= 0).length;
  const bySpk = {};
  let total = 0;
  for (const s of sentences) {
    if (s.spk < 0) continue;
    bySpk[s.spk] = (bySpk[s.spk] || 0) + 1;
    total++;
  }
  els.spkStats.textContent = Object.keys(bySpk)
    .map(k => `${spkName(+k)} ${bySpk[k]}句 ${total ? Math.round(bySpk[k] / total * 100) : 0}%`)
    .join(' · ');
}

// ---- 导入音频 ----
els.file.addEventListener('change', async () => {
  const f = els.file.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('audio', f, f.name);
  const div = document.createElement('div');
  div.className = 'msg pending';
  div.innerHTML = `<span class="t"></span><span class="tag" style="background:#9ca3af">系统</span><span class="text">正在转写 ${f.name}…</span>`;
  els.transcript.appendChild(div);
  try {
    const resp = await fetch(API + '/api/transcribe', { method: 'POST', body: fd });
    const j = await resp.json();
    div.remove();
    if (j.ok) {
      const base = Date.now() - (j.sentences.length ? j.sentences[j.sentences.length - 1].end * 1000 : 0);
      for (const s of j.sentences) {
        sentences.push({ spk: s.spk, start: s.start, end: s.end, text: s.text,
          wall: new Date(base + s.start * 1000) });
      }
      sessionSec = j.sentences.length ? j.sentences[j.sentences.length - 1].end : sessionSec;
      rerender();
    } else {
      appendError(0, '导入转写失败: ' + (j.error || ''));
    }
  } catch (e) {
    div.remove();
    appendError(0, '导入请求失败: ' + e.message);
  }
  els.file.value = '';
});

// ---- 导出 ----
function structuredFields() {
  return {
    complaint: els.fComplaint.value.trim(),
    history: els.fHistory.value.trim(),
    past: els.fPast.value.trim(),
    dx: els.fDx.value.trim(),
  };
}

function exportMarkdown() {
  const f = structuredFields();
  const date = new Date();
  const lines = [];
  lines.push('# 问诊记录');
  lines.push('');
  lines.push(`- 日期：${date.toLocaleString('zh-CN')}`);
  if (currentPatient) {
    lines.push(`- 病人：${currentPatient.name}（${currentPatient.gender || '?'}/${currentPatient.age ? currentPatient.age + '岁' : '?'}${currentPatient.no ? '，病历号 ' + currentPatient.no : ''}）`);
    if (currentPatient.phone) lines.push(`- 联系电话：${currentPatient.phone}`);
    if (currentPatient.past) lines.push(`- 既往史/过敏史：${currentPatient.past}`);
  } else {
    lines.push('- 病人：未选择');
  }
  lines.push(`- 录音时长：${fmtDur(sessionSec)}`);
  lines.push(`- 说话人：${Object.keys(spkNames).map(k => `${spkName(+k)}（${k}）`).join('、')}`);
  lines.push('');
  lines.push('## 对话记录');
  lines.push('');
  for (const s of sentences) {
    if (s.spk < 0) { lines.push(`> ${s.text}`); continue; }
    lines.push(`**[${fmtWall(s.wall)}] ${spkName(s.spk)}**：${s.text}`);
  }
  lines.push('');
  lines.push('## 问诊摘要');
  lines.push('');
  lines.push('**主诉：**' + (f.complaint || '（待填）'));
  lines.push('');
  lines.push('**现病史：**' + (f.history || '（待填）'));
  lines.push('');
  lines.push('**既往史：**' + (f.past || '（待填）'));
  lines.push('');
  lines.push('**诊断/处置：**' + (f.dx || '（待填）'));
  downloadBlob('问诊记录_' + date.toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.md',
    lines.join('\n'), 'text/markdown;charset=utf-8');
}

function exportJson() {
  const date = new Date();
  const data = {
    meta: { createdAt: date.toISOString(), durationSec: Math.round(sessionSec),
      patient: currentPatient ? { ...currentPatient } : null,
      speakers: Object.fromEntries(Object.entries(spkNames).map(([k, v]) => [k, v])) },
    structured: structuredFields(),
    sentences: sentences.map(s => s.spk < 0 ? { note: s.text } :
      ({ spk: s.spk, speaker: spkName(s.spk), start: s.start, end: s.end,
         wall: fmtWall(s.wall), text: s.text })),
  };
  downloadBlob('问诊记录_' + date.toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json',
    JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

function downloadBlob(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

els.start.addEventListener('click', () => startRecording().catch(e => appendError(0, '录音启动失败: ' + e.message)));
els.stop.addEventListener('click', stopRecording);
els.expMd.addEventListener('click', exportMarkdown);
els.expJson.addEventListener('click', exportJson);

// 病人管理事件
els.btnPatient.addEventListener('click', openPatientModal);
els.modalClose.addEventListener('click', closePatientModal);
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closePatientModal(); });
els.tabExist.addEventListener('click', () => switchTab('exist'));
els.tabNew.addEventListener('click', () => switchTab('new'));
els.search.addEventListener('input', renderPatientList);
els.btnAddPatient.addEventListener('click', addPatientSubmit);
// 新增表单回车快速提交
['p-name', 'p-phone'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') addPatientSubmit(); });
});
// 病历号直达 + 扫码（扫码为显式确认制：不默认打开摄像头）
els.patientNoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickSelectByNo(); });
els.btnScan.addEventListener('click', async () => {
  if (!hasCamera) { alert('未检测到摄像头，请用病历号直达或列表选择'); return; }
  if (!confirm('将打开摄像头进行扫码，是否继续？')) return;
  openScan();
});
els.scanStop.addEventListener('click', closeScan);
els.scanClose.addEventListener('click', closeScan);
els.scanModal.addEventListener('click', (e) => { if (e.target === els.scanModal) closeScan(); });

// 定时刷新录音时长显示
setInterval(() => { if (recording) els.dur.textContent = fmtDur(sessionSec); }, 500);

renderCurrentPatient();
els.modal.hidden = true;
els.scanModal.hidden = true;
stopScan();
pollHealth();
