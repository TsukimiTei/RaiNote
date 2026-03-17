const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  fs: {
    readFile:   (path)              => ipcRenderer.invoke('fs:readFile', path),
    writeFile:  (path, content)     => ipcRenderer.invoke('fs:writeFile', path, content),
    listFiles:  (dir)               => ipcRenderer.invoke('fs:listFiles', dir),
    deleteFile: (path)              => ipcRenderer.invoke('fs:deleteFile', path),
    exists:     (path)              => ipcRenderer.invoke('fs:exists', path),
    renameFile: (oldPath, newPath)  => ipcRenderer.invoke('fs:renameFile', oldPath, newPath),
    watch:      (dir)              => ipcRenderer.invoke('fs:watch', dir),
    unwatch:    ()                 => ipcRenderer.invoke('fs:unwatch'),
    onChanged:  (cb)               => ipcRenderer.on('fs:changed', (_, data) => cb(data))
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
  },
  shell: {
    showInFinder: (path) => ipcRenderer.invoke('shell:showInFinder', path)
  },
  yun: {
    checkCli: () => ipcRenderer.invoke('yun:checkCli'),
    detectCli: () => ipcRenderer.invoke('yun:detectCli'),
    readSoul: (dir) => ipcRenderer.invoke('yun:readSoul', dir),
    ask: (prompt, cwd) => ipcRenderer.invoke('yun:ask', prompt, cwd),
    openrouter: (key, model, prompt) => ipcRenderer.invoke('yun:openrouter', key, model, prompt),
    askSync: (prompt, cwd) => ipcRenderer.invoke('yun:askSync', prompt, cwd),
    openrouterSync: (key, model, prompt) => ipcRenderer.invoke('yun:openrouterSync', key, model, prompt),
    onChunk: (cb) => ipcRenderer.on('yun:chunk', (_, text) => cb(text)),
    onDone: (cb) => ipcRenderer.on('yun:done', (_, result) => cb(result))
  }
})
