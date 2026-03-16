const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')

let mainWindow

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f0ebe0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // allow loading local file:// images
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── File System ──────────────────────────────────────────────────

ipcMain.handle('fs:readFile', async (_, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return { ok: true, content }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs:writeFile', async (_, filePath, content) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs:listFiles', async (_, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return { ok: true, files: [] }
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = path.join(dirPath, f)
        const stat = fs.statSync(fullPath)
        return { name: f, path: fullPath, mtime: stat.mtimeMs, ctime: stat.birthtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    return { ok: true, files }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs:deleteFile', async (_, filePath) => {
  try {
    fs.unlinkSync(filePath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs:exists', async (_, filePath) => {
  return fs.existsSync(filePath)
})

ipcMain.handle('fs:renameFile', async (_, oldPath, newPath) => {
  try {
    fs.renameSync(oldPath, newPath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ─── Dialogs ──────────────────────────────────────────────────────

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择笔记目录'
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openFile', async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    title: '选择图片',
    ...options
  })
  return result.canceled ? null : result.filePaths
})

// ─── Config ──────────────────────────────────────────────────────

const configPath = path.join(app.getPath('userData'), 'rainote-config.json')

ipcMain.handle('config:read', async () => {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
    return {}
  } catch { return {} }
})

ipcMain.handle('config:write', async (_, config) => {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('app:getDataPath', () => app.getPath('userData'))

// ─── Apple Notes Export ───────────────────────────────────────────

ipcMain.handle('apple:createNote', async (_, title, body) => {
  // Convert to plain text, remove annotation syntax
  const plain = body
    .replace(/::annotate\[([^\]]+)\]\{[^}]+\}::/g, '$1')
    .replace(/[#*_]/g, '')

  const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const escapedBody = plain.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

  const script = `
tell application "Notes"
  tell account "iCloud"
    make new note at folder "Notes" with properties {name:"${escapedTitle}", body:"${escapedBody}"}
  end tell
end tell`

  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (err) => {
      if (err) resolve({ ok: false, error: err.message })
      else resolve({ ok: true })
    })
  })
})
