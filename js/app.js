/* ═══════════════════════════════════════════════════════
   app.js — 主应用控制器
   模式切换 / 标题编辑 / Detail 弹窗 / 设置 / 初始化
   ═══════════════════════════════════════════════════════ */

;(async () => {
  // ─── Bootstrap ──────────────────────────────────

  await Storage.init()

  let currentMode    = 'edit'   // 'edit' | 'read'
  let currentNote    = null
  let isDoubleLayout = false

  // ─── Init sub-modules ───────────────────────────

  Editor.init({
    onSave: (meta) => {
      if (currentNote) currentNote.meta = meta
      updateCreateTime(meta.created)
      Sidebar.refresh()
    }
  })

  Reader.init()

  Sidebar.init({
    onSelect: async (file) => {
      await openNote(file.path)
    },
    onNew: async () => {
      const note = await Storage.createNote()
      await openNote(note.path, note)
      await Sidebar.refresh()
    }
  })

  // ─── Open a note ────────────────────────────────

  async function openNote (filePath, preloaded) {
    await Editor.save()

    try {
      currentNote = preloaded || await Storage.loadNote(filePath)
      Editor.load(currentNote)
      Sidebar.setActive(filePath)

      // Set title input
      const filename = filePath.split('/').pop()
      const displayTitle = Storage.extractDisplayTitle(filename)
      document.getElementById('noteTitle').value = displayTitle

      updateCreateTime(currentNote.meta?.created)

      if (currentMode === 'read') {
        Reader.setLayout(isDoubleLayout)
        Reader.paginate(currentNote.body || '')
      }
    } catch (err) {
      console.error('Failed to open note:', err)
    }
  }

  function updateCreateTime (iso) {
    if (!iso) return
    const d = new Date(iso)
    const label = d.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
    document.getElementById('createTimeLabel').textContent = `创建于 ${label}`
  }

  // ─── Note title input ────────────────────────────
  // Independent input above the editor. On blur/Enter → rename file.

  const titleInput = document.getElementById('noteTitle')

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      titleInput.blur()
    }
  })

  titleInput.addEventListener('blur', async () => {
    if (!currentNote) return
    const newTitle = titleInput.value.trim()
    if (!newTitle) {
      // Restore previous title
      const filename = currentNote.path.split('/').pop()
      titleInput.value = Storage.extractDisplayTitle(filename)
      return
    }

    try {
      await Editor.save() // save content first
      const { path: newPath, changed } = await Storage.renameNote(currentNote.path, newTitle)

      if (changed) {
        // Update the note's path and frontmatter title
        currentNote.path = newPath
        currentNote.meta = await Storage.saveNote(newPath, Editor.getBody(), {
          title: newTitle
        })
        Sidebar.setActive(newPath)
        await Sidebar.refresh()
      }
    } catch (err) {
      console.error('Rename failed:', err)
      showToast('重命名失败', 'error')
    }
  })

  // ─── Mode switching ──────────────────────────────

  function switchMode (mode) {
    if (mode === currentMode) return
    currentMode = mode

    const editorArea = document.getElementById('editorArea')
    const readerArea = document.getElementById('readerArea')
    const editBtn    = document.getElementById('editModeBtn')
    const readBtn    = document.getElementById('readModeBtn')

    if (mode === 'edit') {
      editorArea.classList.remove('hidden')
      readerArea.classList.add('hidden')
      editBtn.classList.add('active')
      readBtn.classList.remove('active')
    } else {
      editorArea.classList.add('hidden')
      readerArea.classList.remove('hidden')
      editBtn.classList.remove('active')
      readBtn.classList.add('active')

      Reader.setLayout(isDoubleLayout)
      const body = Editor.getBody()
      Reader.paginate(body)
    }
  }

  document.getElementById('editModeBtn').addEventListener('click', () => switchMode('edit'))
  document.getElementById('readModeBtn').addEventListener('click', () => switchMode('read'))

  // ─── Single / Double page toggle ─────────────────

  function applyLayout (double) {
    isDoubleLayout = double
    document.getElementById('layoutToggle').textContent = double ? '雙頁' : '單頁'
    document.getElementById('editorArea').dataset.layout = double ? 'double' : 'single'
    if (currentMode === 'read') Reader.setLayout(double)
  }

  document.getElementById('layoutToggle').addEventListener('click', () => {
    applyLayout(!isDoubleLayout)
  })

  // ─── Sidebar toggle ──────────────────────────────

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    Sidebar.toggle()
  })

  function handleResize () {
    if (window.innerWidth < 640 && Sidebar.isOpen()) Sidebar.toggle()
  }
  window.addEventListener('resize', handleResize)

  // ─── Detail Popover ──────────────────────────────

  const detailBtn     = document.getElementById('detailBtn')
  const detailPopover = document.getElementById('detailPopover')
  let detailOpen      = false

  detailBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (detailOpen) {
      closeDetail()
    } else {
      openDetail()
    }
  })

  function openDetail () {
    if (!currentNote) return
    const meta = currentNote.meta || {}

    // Populate fields
    document.getElementById('dpCreated').textContent =
      meta.created ? fmtDate(meta.created) : '—'
    document.getElementById('dpUpdated').textContent =
      meta.updated ? fmtDate(meta.updated) : '—'
    document.getElementById('dpWordCount').textContent =
      `${Editor.getWordCount()} 字`
    document.getElementById('dpWriteTime').textContent =
      fmtMinutes(Editor.getWriteMinutes())

    // Position: below the detail button
    const rect = detailBtn.getBoundingClientRect()
    detailPopover.style.right  = `${window.innerWidth - rect.right}px`
    detailPopover.style.top    = `${rect.bottom + 8}px`
    detailPopover.style.left   = 'auto'

    detailPopover.classList.remove('hidden')
    detailOpen = true
  }

  function closeDetail () {
    detailPopover.classList.add('hidden')
    detailOpen = false
  }

  document.addEventListener('click', (e) => {
    if (detailOpen && !detailPopover.contains(e.target) && e.target !== detailBtn) {
      closeDetail()
    }
  })

  // ─── Export (in Detail popover) ──────────────────

  document.getElementById('popoverExportBtn').addEventListener('click', async () => {
    closeDetail()
    if (!currentNote) return

    const title    = currentNote.meta?.title || Storage.filenameToTitle(currentNote.path)
    const body     = Editor.getBody()
    const horizontal = body.replace(
      /::annotate\[([^\]]+)\]\{images=\[([^\]]*)\]\}::/g,
      (_, text, imgs) => {
        const list = imgs.split(',').map(i => i.trim()).filter(Boolean)
        return text + '\n\n' + list.map(img => `![](${img})`).join('\n')
      }
    )

    const result = await window.electron.apple.createNote(title, horizontal)
    if (result.ok) showToast('已导出到 Apple Notes ✓')
    else showToast('导出失败: ' + result.error, 'error')
  })

  // ─── Annotation toolbar ──────────────────────────

  document.getElementById('addAnnotationBtn').addEventListener('click', async () => {
    const toolbar = document.getElementById('annotationToolbar')
    const selText = toolbar.dataset.selectedText
    if (!selText) return
    const paths = await window.electron.dialog.openFile()
    if (!paths || !paths.length) return
    await Editor.insertAnnotation(selText, paths)
  })

  document.addEventListener('click', (e) => {
    const tb = document.getElementById('annotationToolbar')
    if (!tb.contains(e.target)) Editor.hideAnnotationToolbar()
  })

  document.getElementById('annotationPreview').addEventListener('mouseleave', () => {
    setTimeout(() => {
      document.getElementById('annotationPreview').classList.add('hidden')
    }, 200)
  })

  // ─── Settings ────────────────────────────────────

  document.getElementById('settingsBtn').addEventListener('click', openSettings)
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings)

  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsOverlay')) closeSettings()
  })

  document.getElementById('selectVaultBtn').addEventListener('click', async () => {
    const dir = await window.electron.dialog.openDirectory()
    if (!dir) return
    await Storage.setVaultPath(dir)
    document.getElementById('vaultPathInput').value = dir
    await Sidebar.refresh()
  })

  function openSettings () {
    document.getElementById('vaultPathInput').value = Storage.getVaultPath() || ''
    document.getElementById('settingsOverlay').classList.remove('hidden')
  }

  function closeSettings () {
    document.getElementById('settingsOverlay').classList.add('hidden')
  }

  document.querySelectorAll('.font-choice').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.font-choice').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const font = btn.dataset.font
      document.body.classList.toggle('font-songti', font === 'songti')
      const config = await window.electron.config.read()
      config.font = font
      await window.electron.config.write(config)
    })
  })

  // ─── Helpers ─────────────────────────────────────

  function fmtDate (iso) {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  function fmtMinutes (mins) {
    if (mins < 1) return '不足1分钟'
    if (mins < 60) return `${mins} 分钟`
    return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟`
  }

  function showToast (message, type = 'success') {
    const toast = document.createElement('div')
    toast.textContent = message
    toast.style.cssText = `
      position: fixed; bottom: 48px; left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#c0392b' : 'var(--ink)'};
      color: #fff; font-family: var(--font-main); font-size: 13px;
      padding: 8px 20px; border-radius: 20px; z-index: 2000;
      opacity: 0; transition: opacity 0.2s; pointer-events: none;
    `
    document.body.appendChild(toast)
    requestAnimationFrame(() => { toast.style.opacity = '1' })
    setTimeout(() => {
      toast.style.opacity = '0'
      setTimeout(() => toast.remove(), 300)
    }, 2500)
  }

  // ─── Restore config ──────────────────────────────

  async function restoreConfig () {
    const config = await window.electron.config.read()
    if (config.font === 'songti') {
      document.body.classList.add('font-songti')
      document.querySelectorAll('.font-choice').forEach(b => {
        b.classList.toggle('active', b.dataset.font === 'songti')
      })
    }
  }

  await restoreConfig()

  // ─── Initial note load ───────────────────────────

  await Sidebar.refresh()

  const todayNote = await Storage.createNote()
  await openNote(todayNote.path, todayNote)

})()
