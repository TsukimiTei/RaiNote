/* ═══════════════════════════════════════════════════════
   sidebar.js — 文件列表侧边栏
   搜索 / 新建 / 切换笔记
   ═══════════════════════════════════════════════════════ */

const Sidebar = (() => {
  const sidebar     = document.getElementById('sidebar')
  const fileList    = document.getElementById('fileList')
  const searchInput = document.getElementById('searchInput')
  const newNoteBtn  = document.getElementById('newNoteBtn')

  let allFiles      = []
  let activeFile    = null
  let onSelectNote  = null
  let onNewNote     = null

  // ─── Init ─────────────────────────────────────────

  function init ({ onSelect, onNew }) {
    onSelectNote = onSelect
    onNewNote    = onNew

    searchInput.addEventListener('input', () => render(searchInput.value.trim()))
    newNoteBtn.addEventListener('click', () => onNewNote && onNewNote())
  }

  // ─── Load / refresh file list ─────────────────────

  async function refresh () {
    allFiles = await Storage.listNotes()
    render(searchInput.value.trim())
  }

  function render (query = '') {
    const lower = query.toLowerCase()
    const filtered = query
      ? allFiles.filter(f => f.name.toLowerCase().includes(lower))
      : allFiles

    fileList.innerHTML = ''

    if (!filtered.length) {
      const li = document.createElement('li')
      li.className = 'file-item'
      li.innerHTML = `<div class="file-item-name" style="color:var(--ink-faint)">无笔记</div>`
      fileList.appendChild(li)
      return
    }

    filtered.forEach(file => {
      const li    = document.createElement('li')
      li.className = 'file-item' + (file.path === activeFile ? ' active' : '')
      li.dataset.path = file.path

      const name = file.name.replace('.md', '')
      const date = new Date(file.mtime).toLocaleDateString('zh-CN', {
        month: 'short', day: 'numeric'
      })

      li.innerHTML = `
        <div class="file-item-name">${Markdown.escapeHtml(name)}</div>
        <div class="file-item-meta">${date}</div>
      `

      li.addEventListener('click', () => {
        setActive(file.path)
        if (onSelectNote) onSelectNote(file)
      })

      // Right-click context menu placeholder (future: delete)
      li.addEventListener('contextmenu', e => {
        e.preventDefault()
        showContextMenu(e, file)
      })

      fileList.appendChild(li)
    })
  }

  function setActive (filePath) {
    activeFile = filePath
    fileList.querySelectorAll('.file-item').forEach(li => {
      li.classList.toggle('active', li.dataset.path === filePath)
    })
  }

  // ─── Context menu (delete) ────────────────────────

  function showContextMenu (e, file) {
    const existing = document.getElementById('contextMenu')
    if (existing) existing.remove()

    const menu = document.createElement('div')
    menu.id = 'contextMenu'
    menu.style.cssText = `
      position: fixed;
      left: ${e.clientX}px;
      top: ${e.clientY}px;
      background: var(--paper-light);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      z-index: 900;
      font-family: var(--font-ui);
      font-size: 13px;
      min-width: 120px;
    `

    const deleteItem = document.createElement('div')
    deleteItem.textContent = '刪除笔記'
    deleteItem.style.cssText = `
      padding: 7px 14px;
      cursor: pointer;
      color: #c0392b;
      transition: background 0.12s;
    `
    deleteItem.addEventListener('mouseenter', () => {
      deleteItem.style.background = 'rgba(192,57,43,0.08)'
    })
    deleteItem.addEventListener('mouseleave', () => {
      deleteItem.style.background = ''
    })
    deleteItem.addEventListener('click', async () => {
      menu.remove()
      if (!confirm(`確定刪除「${file.name}」？`)) return
      await Storage.deleteNote(file.path)
      if (file.path === activeFile) activeFile = null
      await refresh()
    })

    menu.appendChild(deleteItem)
    document.body.appendChild(menu)

    const closeMenu = () => menu.remove()
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10)
  }

  // ─── Toggle sidebar ───────────────────────────────

  function toggle () {
    sidebar.classList.toggle('collapsed')
    return !sidebar.classList.contains('collapsed')
  }

  function isOpen () {
    return !sidebar.classList.contains('collapsed')
  }

  return { init, refresh, setActive, toggle, isOpen }
})()
