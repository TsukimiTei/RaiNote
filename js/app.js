/* ═══════════════════════════════════════════════════════
   app.js — 主应用控制器
   模式切换 / 设置 / 导出 / 初始化
   ═══════════════════════════════════════════════════════ */

;(async () => {
  // ─── Bootstrap ──────────────────────────────────

  await Storage.init()

  let currentMode   = 'edit'   // 'edit' | 'read'
  let currentNote   = null
  let isDoubleLayout = false    // shared between edit and read modes

  // ─── Init sub-modules ───────────────────────────

  Editor.init({
    onSave: (meta) => {
      updateDocTitle(meta.title || currentNote?.meta?.title || '')
      updateCreateTime(meta.created)
      Sidebar.refresh()
    },
    onChange: (body) => {
      // Nothing extra needed; Editor handles word count internally
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
    await Editor.save() // save current note first

    try {
      currentNote = preloaded || await Storage.loadNote(filePath)
      Editor.load(currentNote)
      Sidebar.setActive(filePath)
      updateDocTitle(currentNote.meta?.title || Storage.filenameToTitle(filePath))
      updateCreateTime(currentNote.meta?.created)

      // If in read mode, re-paginate
      if (currentMode === 'read') {
        Reader.paginate(currentNote.body || '')
      }
    } catch (err) {
      console.error('Failed to open note:', err)
    }
  }

  function updateDocTitle (title) {
    document.getElementById('docTitle').textContent = title || ''
  }

  function updateCreateTime (iso) {
    if (!iso) return
    const d = new Date(iso)
    const label = d.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
    document.getElementById('createTimeLabel').textContent = `创建于 ${label}`
  }

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

      // Apply current layout to reader and paginate
      Reader.setLayout(isDoubleLayout)
      const body = Editor.getBody()
      Reader.paginate(body)
    }
  }

  document.getElementById('editModeBtn').addEventListener('click', () => switchMode('edit'))
  document.getElementById('readModeBtn').addEventListener('click', () => switchMode('read'))

  // ─── Single / Double page toggle ─────────────────
  // Works in both edit mode (visual divider) and read mode (Reader pagination)

  function applyLayout (double) {
    isDoubleLayout = double
    document.getElementById('layoutToggle').textContent = double ? '雙頁' : '單頁'

    // Editor mode: show/hide center divider
    document.getElementById('editorArea').dataset.layout = double ? 'double' : 'single'

    // Reader mode: re-apply layout if currently reading
    if (currentMode === 'read') {
      Reader.setLayout(double)
    }
  }

  document.getElementById('layoutToggle').addEventListener('click', () => {
    applyLayout(!isDoubleLayout)
  })

  // ─── Sidebar toggle ──────────────────────────────

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    Sidebar.toggle()
  })

  // Responsive: auto-collapse sidebar when window is narrow
  function handleResize () {
    if (window.innerWidth < 640 && Sidebar.isOpen()) {
      Sidebar.toggle() // collapse
    }
  }
  window.addEventListener('resize', handleResize)

  // ─── Annotation add button ───────────────────────

  document.getElementById('addAnnotationBtn').addEventListener('click', async () => {
    const toolbar  = document.getElementById('annotationToolbar')
    const selText  = toolbar.dataset.selectedText
    if (!selText) return

    const paths = await window.electron.dialog.openFile()
    if (!paths || !paths.length) return

    await Editor.insertAnnotation(selText, paths)
  })

  // Clicking elsewhere hides annotation toolbar
  document.addEventListener('click', (e) => {
    const tb = document.getElementById('annotationToolbar')
    if (!tb.contains(e.target)) Editor.hideAnnotationToolbar()
  })

  // Hide annotation preview when clicking elsewhere
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

  // Font choice
  document.querySelectorAll('.font-choice').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.font-choice').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')

      const font = btn.dataset.font
      document.body.classList.toggle('font-songti', font === 'songti')

      // Persist
      const config = await window.electron.config.read()
      config.font = font
      await window.electron.config.write(config)
    })
  })

  // ─── Export to Apple Notes ───────────────────────

  document.getElementById('exportBtn').addEventListener('click', async () => {
    if (!currentNote) return

    const title = currentNote.meta?.title || Storage.filenameToTitle(currentNote.path)
    const body  = Editor.getBody()

    // Convert to horizontal markdown (strip vertical metadata)
    const horizontal = body
      .replace(/::annotate\[([^\]]+)\]\{images=\[([^\]]*)\]\}::/g,
        (_, text, imgs) => {
          const imgList = imgs.split(',').map(i => i.trim()).filter(Boolean)
          return text + '\n\n' + imgList.map(img => `![](${img})`).join('\n')
        }
      )

    const result = await window.electron.apple.createNote(title, horizontal)
    if (result.ok) {
      showToast('已导出到 Apple Notes ✓')
    } else {
      showToast('导出失败: ' + result.error, 'error')
    }
  })

  // ─── Toast notification ──────────────────────────

  function showToast (message, type = 'success') {
    const toast = document.createElement('div')
    toast.textContent = message
    toast.style.cssText = `
      position: fixed;
      bottom: 48px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#c0392b' : 'var(--ink)'};
      color: #fff;
      font-family: var(--font-main);
      font-size: 13px;
      padding: 8px 20px;
      border-radius: 20px;
      z-index: 2000;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    `
    document.body.appendChild(toast)
    requestAnimationFrame(() => { toast.style.opacity = '1' })
    setTimeout(() => {
      toast.style.opacity = '0'
      setTimeout(() => toast.remove(), 300)
    }, 2500)
  }

  // ─── Load config & restore settings ──────────────

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

  // Open today's note (creates if not exists)
  const todayNote = await Storage.createNote()
  await openNote(todayNote.path, todayNote)

  // If there are more notes, show them already loaded in sidebar
  // (Sidebar.refresh already called above)

})()
