const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { execFile, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let mainWindow

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

function createWindow () {
  const winOptions = {
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#f0ebe0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // allow loading local file:// images
    }
  }

  if (isMac) {
    winOptions.titleBarStyle = 'hiddenInset'
  } else {
    // Windows / Linux: frameless with custom drag region
    winOptions.titleBarStyle = 'hidden'
    winOptions.titleBarOverlay = {
      color: '#f0ebe0',
      symbolColor: '#7a6a58',
      height: 30
    }
  }

  mainWindow = new BrowserWindow(winOptions)

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
    const entries = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'))

    // Build file list with stat info (sync stat is cheap)
    const files = entries.map(f => {
      const fullPath = path.join(dirPath, f)
      const stat = fs.statSync(fullPath)
      return { name: f, path: fullPath, mtime: stat.mtimeMs, ctime: stat.birthtimeMs, created: null }
    })

    // Read frontmatter 'created' field async — only first 1KB per file to avoid blocking
    await Promise.all(files.map(async (entry) => {
      try {
        const fd = await fs.promises.open(entry.path, 'r')
        const buf = Buffer.alloc(1024)
        const { bytesRead } = await fd.read(buf, 0, 1024, 0)
        await fd.close()
        const header = buf.toString('utf8', 0, bytesRead)
        const fmMatch = header.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        if (fmMatch) {
          const line = fmMatch[1].split('\n').find(l => l.trim().startsWith('created:'))
          if (line) entry.created = line.slice(line.indexOf(':') + 1).trim()
        }
      } catch {}
    }))

    files.sort((a, b) => b.mtime - a.mtime)
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

// ─── File System Watcher ─────────────────────────────────────────
// Watches the vault directory for external changes (Finder, Obsidian, etc.)
// and notifies the renderer to refresh the sidebar.

let fsWatcher = null

ipcMain.handle('fs:watch', async (_, dirPath) => {
  if (fsWatcher) { fsWatcher.close(); fsWatcher = null }
  if (!dirPath || !fs.existsSync(dirPath)) return { ok: false }

  try {
    fsWatcher = fs.watch(dirPath, { persistent: false }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('fs:changed', { eventType, filename })
        }
      }
    })

    fsWatcher.on('error', () => {
      if (fsWatcher) { fsWatcher.close(); fsWatcher = null }
    })

    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('fs:unwatch', async () => {
  if (fsWatcher) { fsWatcher.close(); fsWatcher = null }
  return { ok: true }
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

ipcMain.handle('shell:showInFinder', async (_, filePath) => {
  if (isMac) {
    execFile('open', ['-R', filePath], (err) => {
      if (err) console.error('[showInFinder] failed:', err.message)
    })
  } else {
    const { shell } = require('electron')
    shell.showItemInFolder(filePath)
  }
})

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

  // 1. Try common known locations first (fastest, no shell spawn)
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const candidates = isWin
    ? [
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude'),
        path.join(home, '.local', 'bin', 'claude'),
      ]
    : [
        home + '/.local/bin/claude',
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude'
      ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      resolvedClaudeBin = p
      console.log('[yun] Found claude CLI at:', p)
      return p
    }
  }

  // 2. Fallback: ask shell for full path
  const whichCmd = isWin ? 'where' : 'which'
  const shellArgs = isWin
    ? [whichCmd, ['claude']]
    : [process.env.SHELL || '/bin/zsh', ['-lc', 'which claude']]

  return new Promise((resolve) => {
    execFile(shellArgs[0], shellArgs[1], { timeout: 5000 }, (err, stdout) => {
      const bin = (stdout || '').split('\n')[0].trim()
      if (!err && bin && fs.existsSync(bin)) {
        resolvedClaudeBin = bin
        console.log('[yun] Resolved claude CLI:', bin)
        resolve(bin)
      } else {
        console.log('[yun] claude CLI not found. err:', err?.message)
        resolve(null)
      }
    })
  })
}

// Check if claude CLI is available
ipcMain.handle('yun:checkCli', async () => {
  const bin = await findClaudeBin()
  return { ok: !!bin, path: bin || null }
})

// Force re-detect claude CLI (clears cache)
ipcMain.handle('yun:detectCli', async () => {
  resolvedClaudeBin = null
  const bin = await findClaudeBin()
  return { ok: !!bin, path: bin || null }
})

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

// ─── Yun Sync (non-streaming, for inline selection queries) ─────────

ipcMain.handle('yun:askSync', async (event, prompt, cwd) => {
  const claudeBin = await findClaudeBin()
  if (!claudeBin) return { ok: false, error: '找不到 claude CLI' }

  return new Promise((resolve) => {
    try {
      const proc = spawn(claudeBin, ['-p', '--output-format', 'text', '--max-turns', '1'], {
        cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      proc.stdin.write(prompt)
      proc.stdin.end()

      let fullText = ''
      proc.stdout.on('data', (d) => { fullText += d.toString() })
      proc.stderr.on('data', () => {})
      proc.on('close', (code) => resolve({ ok: code === 0, fullText }))
      proc.on('error', (err) => resolve({ ok: false, error: err.message }))
    } catch (err) {
      resolve({ ok: false, error: err.message })
    }
  })
})

ipcMain.handle('yun:openrouterSync', async (event, apiKey, model, prompt) => {
  const https = require('https')

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 500
  })

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rainote.netlify.app',
        'X-Title': 'RaiNote'
      }
    }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => {
        try {
          const obj = JSON.parse(data)
          const text = obj.choices?.[0]?.message?.content || ''
          resolve({ ok: res.statusCode === 200, fullText: text })
        } catch {
          resolve({ ok: false, error: 'Parse error' })
        }
      })
    })

    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.write(body)
    req.end()
  })
})

// Spawn claude CLI and stream response
let yunProcess = null

ipcMain.handle('yun:ask', async (event, prompt, cwd) => {
  // Kill any existing process
  if (yunProcess) {
    try { yunProcess.kill() } catch {}
    yunProcess = null
  }

  const claudeBin = await findClaudeBin()
  if (!claudeBin) {
    const err = { ok: false, error: '找不到 claude CLI — 請確認已安裝 Claude Code' }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yun:done', err)
    }
    return err
  }

  return new Promise((resolve) => {
    try {
      // Pass prompt via stdin pipe (not CLI arg) to avoid arg-length limits
      // and ensure stdin closes so claude doesn't hang waiting for more input
      const proc = spawn(claudeBin, ['-p', '--output-format', 'text', '--max-turns', '1'], {
        cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      yunProcess = proc
      proc.stdin.write(prompt)
      proc.stdin.end()

      let fullText = ''

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString()
        if (text) {
          fullText += text
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('yun:chunk', text)
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
      // Ensure renderer always receives yun:done to avoid yunIsStreaming stuck true
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('yun:done', { ok: false, error: err.message })
      }
      resolve({ ok: false, error: err.message })
    }
  })
})

// ─── OpenRouter API ──────────────────────────────────────────────

ipcMain.handle('yun:openrouter', async (event, apiKey, model, prompt) => {
  const https = require('https')

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 200,
    stream: true
  })

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rainote.netlify.app',
        'X-Title': 'RaiNote'
      }
    }, (res) => {
      let fullText = ''
      let buffer = ''

      res.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const obj = JSON.parse(data)
            const text = obj.choices?.[0]?.delta?.content || ''
            if (text) {
              fullText += text
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('yun:chunk', text)
              }
            }
          } catch {}
        }
      })

      res.on('end', () => {
        const ok = res.statusCode === 200
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('yun:done', { ok, fullText, error: ok ? null : `HTTP ${res.statusCode}` })
        }
        resolve({ ok, fullText })
      })
    })

    req.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('yun:done', { ok: false, error: err.message })
      }
      resolve({ ok: false, error: err.message })
    })

    req.write(body)
    req.end()
  })
})

ipcMain.handle('apple:createNote', async (_, title, htmlBody) => {
  if (!isMac) {
    return { ok: false, error: 'Apple Notes 仅在 macOS 上可用' }
  }
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
