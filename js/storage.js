/* ═══════════════════════════════════════════════════════
   storage.js — 文件系统抽象层
   负责读写 Markdown 笔记文件（含 YAML frontmatter）
   ═══════════════════════════════════════════════════════ */

const Storage = (() => {
  let vaultPath = null
  let noteIndex = []
  let noteIndexLoaded = false
  let lastListStatus = { ok: true, error: null, path: null, count: 0 }

  function getDirname (filePath) {
    if (!filePath || typeof filePath !== 'string') return null
    const idx = filePath.lastIndexOf('/')
    return idx > 0 ? filePath.slice(0, idx) : null
  }

  function uniqueFiles (files) {
    const seen = new Set()
    return (Array.isArray(files) ? files : []).filter(file => {
      if (!file || !file.path || seen.has(file.path)) return false
      seen.add(file.path)
      return true
    })
  }

  function buildCachedFile (filePath, meta = {}) {
    if (!filePath) return null
    const name = filePath.split('/').pop()
    return {
      name,
      path: filePath,
      mtime: meta.mtime || 0,
      ctime: meta.ctime || meta.mtime || 0,
      created: meta.created || null
    }
  }

  async function persistNoteIndex () {
    const config = await window.electron.config.read()
    config.noteListCache = {
      vaultPath,
      files: uniqueFiles(noteIndex)
    }
    await window.electron.config.write(config)
  }

  function sortFiles (files) {
    return uniqueFiles(files).sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
  }

  async function setNoteIndex (files) {
    noteIndex = sortFiles(files)
    noteIndexLoaded = true
    await persistNoteIndex()
    lastListStatus = {
      ok: true,
      error: null,
      path: vaultPath,
      count: noteIndex.length
    }
    return getCachedNotes()
  }

  function getCachedNotes () {
    return noteIndex.map(file => ({ ...file }))
  }

  async function upsertCachedNote (file) {
    if (!file || !file.path) return
    const next = uniqueFiles([file, ...noteIndex.filter(item => item.path !== file.path)])
    await setNoteIndex(next)
  }

  async function removeCachedNote (filePath) {
    noteIndex = noteIndex.filter(file => file.path !== filePath)
    noteIndexLoaded = true
    await persistNoteIndex()
    lastListStatus = {
      ok: true,
      error: null,
      path: vaultPath,
      count: noteIndex.length
    }
  }

  async function renameCachedNote (oldPath, newPath) {
    const existing = noteIndex.find(file => file.path === oldPath)
    const next = buildCachedFile(newPath, existing || {})
    await upsertCachedNote(next)
    if (oldPath !== newPath) {
      noteIndex = noteIndex.filter(file => file.path !== oldPath)
      noteIndex = sortFiles(noteIndex)
      await persistNoteIndex()
    }
  }

  // ─── Frontmatter helpers ──────────────────────────

  function parseFrontmatter (raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m)
    if (!match) return { meta: {}, body: raw }

    const meta = {}
    match[1].split(/\r?\n/).forEach(line => {
      const sep = line.indexOf(':')
      if (sep === -1) return
      const key = line.slice(0, sep).trim()
      let val = line.slice(sep + 1).trim()

      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      } else if (val === 'true') {
        val = true
      } else if (val === 'false') {
        val = false
      } else if (!isNaN(val) && val !== '') {
        val = Number(val)
      }
      meta[key] = val
    })

    return { meta, body: match[2] }
  }

  function buildFrontmatter (meta) {
    const lines = ['---']
    for (const [k, v] of Object.entries(meta)) {
      if (Array.isArray(v)) {
        lines.push(`${k}: [${v.join(', ')}]`)
      } else {
        lines.push(`${k}: ${v}`)
      }
    }
    lines.push('---', '')
    return lines.join('\n')
  }

  // ─── Filename / title helpers ─────────────────────

  function todayFilename () {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}.md`
  }

  // Extract the display title from a filename:
  //   "2026-03-16.md"          → "2026-03-16"
  //   "2026-03-16-春日随笔.md" → "春日随笔"
  function extractDisplayTitle (filename) {
    const base = filename.replace('.md', '')
    const match = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)
    return match ? match[1] : base
  }

  // Build new filename given old path and a new title:
  //   old: "2026-03-16.md", newTitle: "春日随笔"
  //   → "2026-03-16-春日随笔.md"
  //   old: "2026-03-16.md", newTitle: "2026-03-16"  (same as date)
  //   → "2026-03-16.md"
  function buildNewFilename (oldFilename, newTitle) {
    const base       = oldFilename.replace('.md', '')
    const dateMatch  = base.match(/^(\d{4}-\d{2}-\d{2})/)
    const datePrefix = dateMatch ? dateMatch[1] : null

    if (!datePrefix) return `${newTitle}.md`
    const cleanTitle = newTitle.trim()
    if (!cleanTitle || cleanTitle === datePrefix) return `${datePrefix}.md`
    return `${datePrefix}-${cleanTitle}.md`
  }

  function normalizeTextForWordCount (text) {
    return String(text || '')
      // Count custom annotation markup as its visible text only.
      .replace(/::annotate\[([^\]]+)\]\{images=\[[^\]]*\]\}::/g, '$1')
      .replace(/\u200B/g, '')
  }

  function countWords (text) {
    const normalized = normalizeTextForWordCount(text)

    // 中文/日文/韩文逐字计数；其余语言按单词计数。
    const cjkChars = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
    const cjk = (normalized.match(cjkChars) || []).length
    const nonCjkText = normalized.replace(cjkChars, ' ')
    const words = nonCjkText.match(/[\p{Letter}\p{Number}]+(?:['’-][\p{Letter}\p{Number}]+)*/gu) || []
    return cjk + words.length
  }

  // ─── Public API ───────────────────────────────────

  async function init () {
    const config = await window.electron.config.read()
    const configuredVaultPath = config.vaultPath || null
    const inferredVaultPath = getDirname(config.lastNotePath)

    vaultPath = configuredVaultPath || inferredVaultPath || null
    noteIndex = sortFiles(config.noteListCache?.files || [])
    noteIndexLoaded = true

    if (!vaultPath) {
      const dataPath = await window.electron.app.getDataPath()
      vaultPath = dataPath + '/notes'
    }
  }

  function getVaultPath () { return vaultPath }

  async function setVaultPath (p, bookmark = null) {
    vaultPath = p
    const config = await window.electron.config.read()
    config.vaultPath = p
    if (bookmark) config.vaultBookmark = bookmark
    await window.electron.config.write(config)
  }

  async function syncNoteIndex () {
    const config = await window.electron.config.read()
    const candidates = [
      vaultPath,
      config.vaultPath || null,
      getDirname(config.lastNotePath)
    ].filter((value, index, arr) => value && arr.indexOf(value) === index)

    let fallbackEmpty = null
    let lastError = null

    for (const candidate of candidates) {
      const res = await window.electron.fs.listFiles(candidate)
      if (res.ok && res.files.length > 0) {
        vaultPath = candidate
        if (config.vaultPath !== candidate) {
          config.vaultPath = candidate
          await window.electron.config.write(config)
        }
        return await setNoteIndex(res.files)
      }

      if (res.ok && !fallbackEmpty) {
        fallbackEmpty = { path: candidate, files: res.files }
      }

      if (!res.ok) {
        lastError = { path: candidate, error: res.error || '未知錯誤' }
      }
    }

    if (fallbackEmpty) {
      vaultPath = fallbackEmpty.path
      lastListStatus = {
        ok: true,
        error: null,
        path: fallbackEmpty.path,
        count: 0
      }
      return getCachedNotes()
    }

    const cachedPath = config.noteListCache?.vaultPath || getDirname(config.lastNotePath) || vaultPath
    if (cachedPath && noteIndex.length > 0) {
      vaultPath = cachedPath
      lastListStatus = {
        ok: true,
        error: null,
        path: cachedPath,
        count: noteIndex.length
      }
      return getCachedNotes()
    }

    lastListStatus = {
      ok: false,
      error: lastError ? lastError.error : '未知錯誤',
      path: lastError ? lastError.path : vaultPath,
      count: 0
    }
    return getCachedNotes()
  }

  async function listNotes (options = {}) {
    if (options.forceSync) {
      return await syncNoteIndex()
    }

    if (!noteIndexLoaded) {
      const config = await window.electron.config.read()
      noteIndex = sortFiles(config.noteListCache?.files || [])
      noteIndexLoaded = true
    }

    if (noteIndex.length > 0) {
      lastListStatus = {
        ok: true,
        error: null,
        path: vaultPath,
        count: noteIndex.length
      }
      return getCachedNotes()
    }

    return await syncNoteIndex()
  }

  async function touchNote (filePath) {
    const existing = noteIndex.find(file => file.path === filePath)
    await upsertCachedNote(buildCachedFile(filePath, {
      ...(existing || {}),
      mtime: Date.now()
    }))
  }

  async function seedLastNote (filePath) {
    const cached = buildCachedFile(filePath)
    if (cached) await upsertCachedNote(cached)
  }

  function hasCachedNotes () {
    return noteIndex.length > 0
  }

  function getCachedNoteCount () {
    return noteIndex.length
  }

  async function clearNoteIndex () {
    noteIndex = []
    noteIndexLoaded = true
    await persistNoteIndex()
    return []
  }

  function getLastListStatus () {
    return { ...lastListStatus }
  }

  async function loadNote (filePath) {
    const res = await window.electron.fs.readFile(filePath)
    if (!res.ok) throw new Error(res.error)

    const { meta, body } = parseFrontmatter(res.content)
    return { meta, body, path: filePath }
  }

  async function saveNote (filePath, body, metaOverrides = {}) {
    // Load existing meta if file exists
    let existingMeta = {}
    const exists = await window.electron.fs.exists(filePath)
    if (exists) {
      const res = await window.electron.fs.readFile(filePath)
      if (res.ok) existingMeta = parseFrontmatter(res.content).meta
    }

    const now = new Date().toISOString()
    const meta = {
      title: existingMeta.title || metaOverrides.title || filenameToTitle(filePath),
      created: existingMeta.created || now,
      updated: now,
      tags: existingMeta.tags || [],
      wordCount: countWords(body),
      writeMinutes: metaOverrides.writeMinutes ?? (existingMeta.writeMinutes || 0),
      vertical: true,
      ...metaOverrides
    }

    const content = buildFrontmatter(meta) + body
    const res = await window.electron.fs.writeFile(filePath, content)
    if (!res.ok) throw new Error(res.error)
    await upsertCachedNote(buildCachedFile(filePath, {
      mtime: Date.now(),
      created: meta.created
    }))
    return meta
  }

  async function createNote () {
    const datePrefix = todayFilename().replace('.md', '')

    // 找到一个不存在的文件名（2026-03-16.md → 2026-03-16-2.md → …）
    let filename = `${datePrefix}.md`
    let filePath = vaultPath + '/' + filename
    let counter = 2
    while (await window.electron.fs.exists(filePath)) {
      filename = `${datePrefix}-${counter}.md`
      filePath = vaultPath + '/' + filename
      counter++
    }

    const title = filename.replace('.md', '')
    const body = ''
    const meta = await saveNote(filePath, body, { title })
    return { meta, body, path: filePath }
  }

  async function deleteNote (filePath) {
    await window.electron.fs.deleteFile(filePath)
    await removeCachedNote(filePath)
  }

  // Rename a note, preserving date prefix in filename.
  // Returns { path: newPath, changed: bool }
  async function renameNote (oldPath, newTitle) {
    const dir         = oldPath.substring(0, oldPath.lastIndexOf('/'))
    const oldFilename = oldPath.split('/').pop()
    const newFilename = buildNewFilename(oldFilename, newTitle)
    const newPath     = dir + '/' + newFilename

    if (oldPath === newPath) return { path: oldPath, changed: false }

    const res = await window.electron.fs.renameFile(oldPath, newPath)
    if (!res.ok) throw new Error(res.error)
    await renameCachedNote(oldPath, newPath)
    return { path: newPath, changed: true }
  }

  function filenameToTitle (filePath) {
    return filePath.split('/').pop().replace('.md', '')
  }

  function countWordsPublic (text) {
    return countWords(text)
  }

  return {
    init, getVaultPath, setVaultPath,
    listNotes, syncNoteIndex, loadNote, saveNote, createNote, deleteNote, renameNote,
    getLastListStatus,
    getCachedNotes, hasCachedNotes, getCachedNoteCount, touchNote, seedLastNote, clearNoteIndex,
    todayFilename, countWords: countWordsPublic, filenameToTitle,
    extractDisplayTitle, buildNewFilename
  }
})()
