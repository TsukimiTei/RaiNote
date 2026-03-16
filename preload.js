const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  fs: {
    readFile:  (path)          => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
    listFiles: (dir)           => ipcRenderer.invoke('fs:listFiles', dir),
    deleteFile:(path)          => ipcRenderer.invoke('fs:deleteFile', path),
    exists:    (path)          => ipcRenderer.invoke('fs:exists', path)
  },
  dialog: {
    openDirectory: ()        => ipcRenderer.invoke('dialog:openDirectory'),
    openFile:      (options) => ipcRenderer.invoke('dialog:openFile', options)
  },
  config: {
    read:  ()       => ipcRenderer.invoke('config:read'),
    write: (config) => ipcRenderer.invoke('config:write', config)
  },
  app: {
    getDataPath: () => ipcRenderer.invoke('app:getDataPath')
  },
  apple: {
    createNote: (title, body) => ipcRenderer.invoke('apple:createNote', title, body)
  }
})
