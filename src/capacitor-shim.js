/* ═══════════════════════════════════════════════════════
   capacitor-shim.js — Capacitor ↔ Electron 兼容层
   提供 window.electron.* API，使用 Capacitor 插件实现
   仅在 Capacitor (iOS) 环境加载，Electron 环境中不会执行
   ═══════════════════════════════════════════════════════ */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Preferences } from '@capacitor/preferences'
import { Share } from '@capacitor/share'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

;(function () {
  // If window.electron already exists, we're in Electron — do nothing
  if (window.electron) return

  const CONFIG_KEY = 'rainote_config'
  const NOTES_DIR = 'notes'

  // ─── Helpers ──────────────────────────────────────────

  // Ensure the notes directory exists
  async function ensureNotesDir () {
    try {
      await Filesystem.mkdir({
        path: NOTES_DIR,
        directory: Directory.Documents,
        recursive: true
      })
    } catch (e) {
      // Directory may already exist — that's fine
    }
  }

  // Resolve a path: if it starts with 'notes/' or is relative,
  // treat as relative to Documents directory
  function resolvePath (path) {
    if (!path) return { path: '', directory: Directory.Documents }
    // If path starts with our notes dir, keep it relative to Documents
    if (path.startsWith(NOTES_DIR + '/') || path === NOTES_DIR) {
      return { path, directory: Directory.Documents }
    }
    // If it looks like a full path from vault setting, adapt it
    // On iOS, vault path is stored as 'notes' (relative to Documents)
    return { path, directory: Directory.Documents }
  }

  // ─── window.electron shim ────────────────────────────

  window.electron = {
    fs: {
      readFile: async (filePath) => {
        try {
          const { path, directory } = resolvePath(filePath)
          const result = await Filesystem.readFile({
            path,
            directory,
            encoding: Encoding.UTF8
          })
          return { ok: true, content: result.data }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      writeFile: async (filePath, content) => {
        try {
          const { path, directory } = resolvePath(filePath)
          await Filesystem.writeFile({
            path,
            data: content,
            directory,
            encoding: Encoding.UTF8,
            recursive: true
          })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      listFiles: async (dirPath) => {
        try {
          const { path, directory } = resolvePath(dirPath)
          const result = await Filesystem.readdir({ path, directory })
          const files = []

          for (const entry of result.files) {
            if (!entry.name.endsWith('.md')) continue
            try {
              const filePath = path + '/' + entry.name
              const stat = await Filesystem.stat({
                path: filePath,
                directory
              })
              files.push({
                name: entry.name,
                path: filePath,
                mtime: stat.mtime || Date.now(),
                ctime: stat.ctime || Date.now(),
                created: null
              })
            } catch (e) {
              // Skip files we can't stat
            }
          }

          // Sort by mtime descending (newest first)
          files.sort((a, b) => b.mtime - a.mtime)
          return { ok: true, files }
        } catch (err) {
          // Directory might not exist yet
          return { ok: true, files: [] }
        }
      },

      deleteFile: async (filePath) => {
        try {
          const { path, directory } = resolvePath(filePath)
          await Filesystem.deleteFile({ path, directory })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      exists: async (filePath) => {
        try {
          const { path, directory } = resolvePath(filePath)
          await Filesystem.stat({ path, directory })
          return true
        } catch {
          return false
        }
      },

      renameFile: async (oldPath, newPath) => {
        try {
          const from = resolvePath(oldPath)
          const to = resolvePath(newPath)
          await Filesystem.rename({
            from: from.path,
            to: to.path,
            directory: from.directory,
            toDirectory: to.directory
          })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      // File watching is not needed on iOS (no external editors)
      watch: async () => ({ ok: true }),
      unwatch: async () => ({ ok: true }),
      onChanged: () => {}  // no-op
    },

    dialog: {
      openDirectory: async () => {
        // iOS doesn't have a directory picker
        // Return our default notes directory
        return NOTES_DIR
      },
      openFile: async () => {
        // TODO: implement iOS file picker if needed
        return null
      }
    },

    config: {
      read: async () => {
        try {
          const { value } = await Preferences.get({ key: CONFIG_KEY })
          return value ? JSON.parse(value) : {}
        } catch {
          return {}
        }
      },
      write: async (config) => {
        try {
          await Preferences.set({
            key: CONFIG_KEY,
            value: JSON.stringify(config)
          })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      }
    },

    app: {
      getDataPath: async () => {
        // On iOS, we use Documents directory with a 'notes' subdirectory
        return NOTES_DIR
      }
    },

    apple: {
      createNote: async (title, body) => {
        try {
          await Share.share({
            title: title,
            text: body,
            dialogTitle: '分享笔记'
          })
          // Haptic feedback on success
          try { await Haptics.impact({ style: ImpactStyle.Light }) } catch {}
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      }
    },

    shell: {
      showInFinder: async () => {
        // No-op on iOS — no Finder concept
      }
    },

    yun: {
      // Claude CLI is not available on iOS
      checkCli: async () => ({ ok: false, path: null }),
      detectCli: async () => ({ ok: false, path: null }),

      readSoul: async (dir) => {
        try {
          const { path, directory } = resolvePath(dir + '/soul.md')
          const result = await Filesystem.readFile({
            path,
            directory,
            encoding: Encoding.UTF8
          })
          return { ok: true, content: result.data }
        } catch {
          return { ok: true, content: '' }
        }
      },

      // CLI-based methods — not available on iOS
      ask: async () => {
        // Simulate done callback immediately
        if (window._yunDoneCallback) {
          window._yunDoneCallback({ ok: false, error: 'Claude CLI 在 iOS 上不可用，请使用 OpenRouter' })
        }
        return { ok: false, error: 'Claude CLI 在 iOS 上不可用' }
      },
      askSync: async () => ({ ok: false, error: 'Claude CLI 在 iOS 上不可用' }),

      // OpenRouter works on iOS (direct HTTPS fetch)
      openrouter: async (key, model, prompt) => {
        try {
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${key}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://rainote.netlify.app',
              'X-Title': 'RaiNote'
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 200,
              stream: false
            })
          })
          const data = await res.json()
          const text = data.choices?.[0]?.message?.content || ''

          // Simulate streaming by sending the full text as a single chunk
          if (text && window._yunChunkCallback) {
            window._yunChunkCallback(text)
          }
          if (window._yunDoneCallback) {
            window._yunDoneCallback({ ok: true, fullText: text })
          }
          return { ok: true, fullText: text }
        } catch (err) {
          if (window._yunDoneCallback) {
            window._yunDoneCallback({ ok: false, error: err.message })
          }
          return { ok: false, error: err.message }
        }
      },

      openrouterSync: async (key, model, prompt) => {
        try {
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${key}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://rainote.netlify.app',
              'X-Title': 'RaiNote'
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 500,
              stream: false
            })
          })
          const data = await res.json()
          const text = data.choices?.[0]?.message?.content || ''
          return { ok: res.ok, fullText: text }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      onChunk: (cb) => { window._yunChunkCallback = cb },
      onDone: (cb) => { window._yunDoneCallback = cb }
    }
  }

  // Ensure notes directory exists on startup
  ensureNotesDir()

  // Add iOS platform class to body for CSS targeting
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('capacitor-ios')
  })
  if (document.readyState !== 'loading') {
    document.body.classList.add('capacitor-ios')
  }

  console.log('[RaiNote] Capacitor shim loaded — iOS mode')
})()
