/* ═══════════════════════════════════════════════════════
   sidebar.js — 文件列表侧边栏（最小稳定实现）
   负责刷新 / 搜索 / 选择 / 折叠
   ═══════════════════════════════════════════════════════ */

const Sidebar = (() => {
  const sidebar = document.getElementById('sidebar')
  const fileList = document.getElementById('fileList')
  const searchInput = document.getElementById('searchInput')
  const newNoteBtn = document.getElementById('newNoteBtn')
  const refreshNotesBtn = document.getElementById('refreshNotesBtn')

  let allFiles = []
  let activeFile = null
  let onSelectNote = null
  let onNewNote = null
  let onRefreshNotes = null

  function init ({ onSelect, onNew, onRefresh }) {
    onSelectNote = onSelect
    onNewNote = onNew
    onRefreshNotes = onRefresh

    searchInput.addEventListener('input', () => {
      render(searchInput.value.trim())
    })

    newNoteBtn.addEventListener('click', () => {
      if (onNewNote) onNewNote()
    })

    if (refreshNotesBtn) {
      refreshNotesBtn.addEventListener('click', async () => {
        if (onRefreshNotes) await onRefreshNotes()
      })
    }
  }

  async function refresh (options = {}) {
    try {
      allFiles = await Storage.listNotes(options)
      allFiles.sort((a, b) => b.mtime - a.mtime)
      render(searchInput.value.trim())
      return allFiles
    } catch (err) {
      renderMessage('读取笔记失败', err?.message || String(err), true)
      return []
    }
  }

  function getDisplayName (filename) {
    const base = filename.replace('.md', '')
    if (/^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(base)) return '无题'
    const match = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)
    return match ? match[1] : base
  }

  function render (query = '') {
    const lower = query.toLowerCase()
    const files = query
      ? allFiles.filter(file => {
          const name = getDisplayName(file.name).toLowerCase()
          return file.name.toLowerCase().includes(lower) || name.includes(lower)
        })
      : allFiles

    fileList.innerHTML = ''

    if (!files.length) {
      const status = Storage.getLastListStatus ? Storage.getLastListStatus() : null
      if (status && !status.ok) {
        renderMessage('读取笔记失败', status.error || '未知错误', true)
      } else {
        renderMessage('无笔记', status?.path || Storage.getVaultPath() || '未设置目录')
      }
      return
    }

    for (const file of files) {
      fileList.appendChild(createFileItem(file))
    }
  }

  function renderMessage (title, detail = '', isError = false) {
    fileList.innerHTML = ''

    const item = document.createElement('div')
    item.className = 'file-item'

    const titleEl = document.createElement('div')
    titleEl.className = 'file-item-name'
    titleEl.textContent = title
    if (isError) titleEl.style.color = '#c0392b'
    else titleEl.style.color = 'var(--ink-faint)'

    item.appendChild(titleEl)

    if (detail) {
      const detailEl = document.createElement('div')
      detailEl.className = 'file-item-debug'
      detailEl.textContent = detail
      item.appendChild(detailEl)
    }

    fileList.appendChild(item)
  }

  function createFileItem (file) {
    const item = document.createElement('div')
    item.className = 'file-item' + (file.path === activeFile ? ' active' : '')
    item.dataset.path = file.path

    const titleEl = document.createElement('div')
    titleEl.className = 'file-item-name'
    titleEl.textContent = getDisplayName(file.name)
    item.appendChild(titleEl)

    item.addEventListener('click', async () => {
      setActive(file.path)
      if (onSelectNote) onSelectNote(file)
    })

    return item
  }

  function setActive (filePath) {
    activeFile = filePath
    fileList.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === filePath)
    })
  }

  function toggle () {
    sidebar.classList.toggle('collapsed')
    return !sidebar.classList.contains('collapsed')
  }

  function isOpen () {
    return !sidebar.classList.contains('collapsed')
  }

  return { init, refresh, setActive, toggle, isOpen }
})()
