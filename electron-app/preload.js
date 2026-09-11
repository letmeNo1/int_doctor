// 预加载脚本：向渲染进程暴露最小安全 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});

// 病人档案 API（主进程读写 patients.json）
contextBridge.exposeInMainWorld('patientsApi', {
  list: () => ipcRenderer.invoke('patients:list'),
  add: (data) => ipcRenderer.invoke('patients:add', data),
  update: (id, data) => ipcRenderer.invoke('patients:update', id, data),
  remove: (id) => ipcRenderer.invoke('patients:remove', id),
});
