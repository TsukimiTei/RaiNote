const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { execFile, spawn } = require('child_process')
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
        // Read frontmatter 'created' field for accurate date grouping
        let created = null
        try {
          const content = fs.readFileSync(fullPath, 'utf8')
          const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
          if (fmMatch) {
            const line = fmMatch[1].split('\n').find(l => l.trim().startsWith('created:'))
            if (line) created = line.slice(line.indexOf(':') + 1).trim()
          }
        } catch {}
        return { name: f, path: fullPath, mtime: stat.mtimeMs, ctime: stat.birthtimeMs, created }
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
//
// Renderer sends pre-converted HTML body (bold as <b>, line breaks as <br>).
// This handler only escapes for AppleScript string injection and executes.

// ─── Yun Agent (Claude CLI) ─────────────────────────────────

// Resolve full path to `claude` CLI by asking the user's login shell.
// Electron doesn't load ~/.zshrc etc., so PATH is incomplete.
let resolvedClaudeBin = null

async function findClaudeBin () {
  if (resolvedClaudeBin) return resolvedClaudeBin

  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    // Run `which claude` inside a login shell so PATH is fully populated
    execFile(shell, ['-lc', 'which claude'], { timeout: 5000 }, (err, stdout) => {
      const bin = (stdout || '').trim()
      if (!err && bin && fs.existsSync(bin)) {
        resolvedClaudeBin = bin
        console.log('[yun] Resolved claude CLI:', bin)
        resolve(bin)
      } else {
        // Fallback: try common locations
        const candidates = [
          (process.env.HOME || '') + '/.local/bin/claude',
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude'
        ]
        for (const p of candidates) {
          if (fs.existsSync(p)) { resolvedClaudeBin = p; resolve(p); return }
        }
        resolve(null)
      }
    })
  })
}

// Read soul.md from a directory
ipcMain.handle('yun:readSoul', async (_, dirPath) => {
  try {
    const soulPath = path.join(dirPath, 'soul.md')
    if (fs.existsSync(soulPath)) {
      return { ok: true, content: fs.readFileSync(soulPath, 'utf8') }
    }
    return { ok: true, content: '' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Spawn claude CLI and stream response
let yunProcess = null

ipcMain.handle('yun:ask', async (event, prompt, cwd) => {
  // Kill any existing process
  if (yunProcess) {
    try { yunProcess.kill() } catch {}
    yunProcess = null
  }

  return new Promise((resolve) => {
    try {
      const claudeBin = await findClaudeBin()
      if (!claudeBin) {
        resolve({ ok: false, error: '找不到 claude CLI — 請確認已安裝 Claude Code (npm i -g @anthropic-ai/claude-code)' })
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('yun:done', { ok: false, error: '找不到 claude CLI' })
        }
        return
      }

      const proc = spawn(claudeBin, ['-p', prompt, '--output-format', 'stream-json', '--max-turns', '1'], {
        cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      yunProcess = proc

      let fullText = ''
      let buffer = ''

      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            // stream-json format: look for text content
            let text = ''
            if (obj.type === 'content_block_delta' && obj.delta?.text) {
              text = obj.delta.text
            } else if (obj.type === 'assistant' && typeof obj.content === 'string') {
              text = obj.content
            } else if (obj.result) {
              text = typeof obj.result === 'string' ? obj.result : ''
            }
            if (text) {
              fullText += text
              // Send chunk to renderer
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('yun:chunk', text)
              }
            }
          } catch {
            // Not JSON, might be raw text
            if (line.trim()) {
              fullText += line
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('yun:chunk', line)
              }
            }
          }
        }
      })

      proc.stderr.on('data', (d) => {
        console.log('[yun:stderr]', d.toString().slice(0, 200))
      })

      proc.on('close', (code) => {
        yunProcess = null
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('yun:done', { ok: code === 0, fullText })
        }
        resolve({ ok: code === 0, fullText })
      })

      proc.on('error', (err) => {
        yunProcess = null
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('yun:done', { ok: false, error: err.message })
        }
        resolve({ ok: false, error: err.message })
      })

    } catch (err) {
      resolve({ ok: false, error: err.message })
    }
  })
})

ipcMain.handle('apple:createNote', async (_, title, htmlBody) => {
  // Escape for AppleScript double-quoted string: backslashes first, then quotes
  const esc = (s) => s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '')   // HTML uses <br>; strip stray newlines from the string

  const escapedTitle = esc(title)
  const escapedBody  = esc(htmlBody)

  const script = `
tell application "Notes"
  tell account "iCloud"
    make new note at folder "Notes" with properties {name:"${escapedTitle}", body:"${escapedBody}"}
  end tell
end tell`

  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 12000 }, (err, _stdout, stderr) => {
      if (!err) { resolve({ ok: true }); return }

      const msg = (err.message + ' ' + (stderr || '')).toLowerCase()

      if (msg.includes('not authorized') || msg.includes('authorization') || msg.includes('not permitted')) {
        resolve({ ok: false, error: '权限不足 — 请前往「系统设置 → 隐私与安全 → 自动化」，允许 RaiNote 控制 Notes' })
      } else if (msg.includes('folder') || msg.includes('not found') || msg.includes('icloud')) {
        resolve({ ok: false, error: '找不到 Notes 文件夹 — 请确认 iCloud Notes 已启用' })
      } else if (err.killed || msg.includes('timeout')) {
        resolve({ ok: false, error: '操作超时 — Notes 应用无响应，请重试' })
      } else if (msg.includes('application can\'t be found') || msg.includes('no application')) {
        resolve({ ok: false, error: '未找到 Notes 应用 — 请确认系统已安装 Apple Notes' })
      } else {
        resolve({ ok: false, error: `导出失败：${err.message}` })
      }
    })
  })
})
