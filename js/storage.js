/* ═══════════════════════════════════════════════════════
   storage.js — 文件系统抽象层
   负责读写 Markdown 笔记文件（含 YAML frontmatter）
   ═══════════════════════════════════════════════════════ */

const Storage = (() => {
  let vaultPath = null

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

  // ─── Filename helpers ─────────────────────────────

  function todayFilename () {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}.md`
  }

  function countWords (text) {
    // 中文每字计一，英文按空格分词
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff]/g) || []).length
    const latin = (text.replace(/[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff]/g, ' ')
      .match(/\b\w+\b/g) || []).length
    return cjk + latin
  }

  // ─── Public API ───────────────────────────────────

  async function init () {
    const config = await window.electron.config.read()
    vaultPath = config.vaultPath || null

    if (!vaultPath) {
      // Fallback: app userData directory
      const dataPath = await window.electron.app.getDataPath()
      vaultPath = dataPath + '/notes'
    }
  }

  function getVaultPath () { return vaultPath }

  async function setVaultPath (p) {
    vaultPath = p
    const config = await window.electron.config.read()
    config.vaultPath = p
    await window.electron.config.write(config)
  }

  async function listNotes () {
    const res = await window.electron.fs.listFiles(vaultPath)
    return res.ok ? res.files : []
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
    return meta
  }

  async function createNote () {
    const filename = todayFilename()
    const filePath = vaultPath + '/' + filename
    const exists = await window.electron.fs.exists(filePath)

    if (exists) {
      return await loadNote(filePath)
    }

    const title = filename.replace('.md', '')
    const body = ''
    const meta = await saveNote(filePath, body, { title })
    return { meta, body, path: filePath }
  }

  async function deleteNote (filePath) {
    await window.electron.fs.deleteFile(filePath)
  }

  function filenameToTitle (filePath) {
    return filePath.split('/').pop().replace('.md', '')
  }

  function countWordsPublic (text) {
    return countWords(text)
  }

  return {
    init, getVaultPath, setVaultPath,
    listNotes, loadNote, saveNote, createNote, deleteNote,
    todayFilename, countWords: countWordsPublic, filenameToTitle
  }
})()
