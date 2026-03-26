/* ═══════════════════════════════════════════════════════
   sidebar.js — 文件列表侧边栏
   按创建日期分组 / 折叠展开 / 搜索 / 新建 / 切换笔记
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
  let onExportNote  = null

  // Remember manual collapse/expand state during session
  let collapsedGroups = new Set()
  let expandedGroups  = new Set()

  // ─── Init ─────────────────────────────────────────

  function init ({ onSelect, onNew, onExport }) {
    onSelectNote = onSelect
    onNewNote    = onNew
    onExportNote = onExport

    searchInput.addEventListener('input', () => render(searchInput.value.trim()))
    newNoteBtn.addEventListener('click', () => {
      if (onNewNote) onNewNote()
    })
  }

  // ─── Load / refresh file list ─────────────────────

  async function refresh () {
    allFiles = await Storage.listNotes()
    render(searchInput.value.trim())
  }

  // ─── Date helpers ─────────────────────────────────

  // Extract YYYY-MM-DD date string from a file for grouping
  function getFileDateStr (file) {
    // 1. Try filename date prefix (most reliable for RaiNote files)
    const nameMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})/)
    if (nameMatch) return nameMatch[1]

    // 2. Try frontmatter 'created' field
    if (file.created) {
      const d = new Date(file.created)
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
    }

    // 3. Fall back to file ctime
    const d = new Date(file.ctime)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // Format date string to display label (e.g., "3月16日 · 周日")
  function formatDateLabel (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]

    const now = new Date()
    const isThisYear = y === now.getFullYear()

    return isThisYear
      ? `${m}月${d}日 · 周${weekday}`
      : `${y}年${m}月${d}日`
  }

  // Group files by creation date, sorted descending
  function groupByDate (files) {
    const map = new Map()

    files.forEach(file => {
      const dateStr = getFileDateStr(file)
      if (!map.has(dateStr)) map.set(dateStr, [])
      map.get(dateStr).push(file)
    })

    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateStr, groupFiles]) => {
        // Within group: newest first (by mtime descending)
        groupFiles.sort((a, b) => b.mtime - a.mtime)

        const [y, m, d] = dateStr.split('-').map(Number)
        const timestamp = new Date(y, m - 1, d).getTime()

        return {
          dateStr,
          label: formatDateLabel(dateStr),
          timestamp,
          files: groupFiles
        }
      })
  }

  // ─── Display name for a file ──────────────────────

  // Returns the title to show in the sidebar.
  // Date-only filenames → "无题", custom titles → the title itself
  function getDisplayName (filename) {
    const base = filename.replace('.md', '')
    // Date-only (with optional numeric counter): "2026-03-16" or "2026-03-16-2"
    if (/^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(base)) return '无题'
    // Date + custom title: "2026-03-16-春日随笔"
    const match = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)
    if (match) return match[1]
    // No date prefix (e.g., Obsidian files)
    return base
  }

  // ─── Render ───────────────────────────────────────

  function render (query = '') {
    const lower = query.toLowerCase()
    const filtered = query
      ? allFiles.filter(f => {
          const displayName = getDisplayName(f.name)
          return f.name.toLowerCase().includes(lower) ||
                 displayName.toLowerCase().includes(lower)
        })
      : allFiles

    fileList.innerHTML = ''

    if (!filtered.length) {
      const el = document.createElement('div')
      el.className = 'file-item'
      el.innerHTML = `<div class="file-item-name" style="color:var(--ink-faint)">无笔记</div>`
      fileList.appendChild(el)
      return
    }

    // If searching, show flat list without grouping
    if (query) {
      filtered.forEach(file => renderFileItem(file, fileList))
      return
    }

    // Group by creation date
    const groups = groupByDate(filtered)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    groups.forEach(group => {
      // Determine collapsed state: manual toggle > default rule
      let isCollapsed
      if (expandedGroups.has(group.dateStr)) {
        isCollapsed = false
      } else if (collapsedGroups.has(group.dateStr)) {
        isCollapsed = true
      } else {
        // Default: collapse if older than 7 days
        isCollapsed = group.timestamp < sevenDaysAgo
      }

      // ── Date group header
      const header = document.createElement('div')
      header.className = 'date-group-header' + (isCollapsed ? ' collapsed' : '')

      header.innerHTML = `
        <span class="date-group-arrow">${isCollapsed ? '▸' : '▾'}</span>
        <span class="date-group-label">${group.label}</span>
        <span class="date-group-count">${group.files.length}</span>
      `

      fileList.appendChild(header)

      // ── File items container
      const container = document.createElement('div')
      container.className = 'date-group-items'
      if (isCollapsed) container.style.display = 'none'

      group.files.forEach(file => renderFileItem(file, container))
      fileList.appendChild(container)

      // ── Toggle collapse on header click
      header.addEventListener('click', () => {
        const nowCollapsed = container.style.display !== 'none'
        container.style.display = nowCollapsed ? 'none' : ''
        header.classList.toggle('collapsed', nowCollapsed)
        header.querySelector('.date-group-arrow').textContent = nowCollapsed ? '▸' : '▾'

        if (nowCollapsed) {
          collapsedGroups.add(group.dateStr)
          expandedGroups.delete(group.dateStr)
        } else {
          expandedGroups.add(group.dateStr)
          collapsedGroups.delete(group.dateStr)
        }
      })
    })
  }

  function renderFileItem (file, parent) {
    const el = document.createElement('div')
    el.className = 'file-item' + (file.path === activeFile ? ' active' : '')
    el.dataset.path = file.path

    const displayName = getDisplayName(file.name)
    el.innerHTML = `<div class="file-item-name">${Markdown.escapeHtml(displayName)}</div>`

    el.addEventListener('click', () => {
      setActive(file.path)
      if (onSelectNote) onSelectNote(file)
    })

    el.addEventListener('contextmenu', e => {
      e.preventDefault()
      showContextMenu(e, file)
    })

    parent.appendChild(el)
  }

  function setActive (filePath) {
    activeFile = filePath
    fileList.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === filePath)
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
    deleteItem.addEventListener('click', async (e) => {
      e.stopPropagation()
      menu.remove()
      if (!confirm(`確定刪除「${file.name}」？`)) return
      await Storage.deleteNote(file.path)
      if (file.path === activeFile) activeFile = null
      await refresh()
    })

    const finderItem = document.createElement('div')
    finderItem.textContent = '在 Finder 中顯示'
    finderItem.style.cssText = `
      padding: 7px 14px;
      cursor: pointer;
      color: var(--ink-2);
      transition: background 0.12s;
    `
    finderItem.addEventListener('mouseenter', () => {
      finderItem.style.background = 'var(--paper-shadow)'
    })
    finderItem.addEventListener('mouseleave', () => {
      finderItem.style.background = ''
    })
    finderItem.addEventListener('click', (e) => {
      e.stopPropagation()
      menu.remove()
      window.electron.shell.showInFinder(file.path)
    })

    const notesItem = document.createElement('div')
    notesItem.textContent = '發送到 Apple Notes'
    notesItem.style.cssText = `
      padding: 7px 14px;
      cursor: pointer;
      color: var(--ink-2);
      transition: background 0.12s;
    `
    notesItem.addEventListener('mouseenter', () => {
      notesItem.style.background = 'var(--paper-shadow)'
    })
    notesItem.addEventListener('mouseleave', () => {
      notesItem.style.background = ''
    })
    notesItem.addEventListener('click', async (e) => {
      e.stopPropagation()
      menu.remove()
      if (onExportNote) onExportNote(file)
    })

    menu.appendChild(finderItem)
    menu.appendChild(notesItem)
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
