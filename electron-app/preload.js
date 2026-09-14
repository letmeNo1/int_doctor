// 预加载脚本：向渲染进程暴露最小安全 API
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});

