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

  // ─── File system watcher (Finder / Obsidian changes) ──

  let fsChangeTimer = null
  window.electron.fs.onChanged(() => {
    // Debounce: multiple events fire for a single operation
    if (fsChangeTimer) clearTimeout(fsChangeTimer)
    fsChangeTimer = setTimeout(() => Sidebar.refresh(), 500)
  })

  // Start watching the vault directory
  const vaultDir = Storage.getVaultPath()
  if (vaultDir) window.electron.fs.watch(vaultDir)

  // ─── Init sub-modules ───────────────────────────

  const editorPlaceholderEl = document.getElementById('editorPlaceholder')

  function updatePlaceholder () {
    const el = document.getElementById('editor')
    const text = (el.textContent || '').replace(/\u200B/g, '').trim()
    const hasContent = text || el.querySelector('img') || el.querySelector('.annotated-text')
    editorPlaceholderEl.style.display = hasContent ? 'none' : ''
  }

  Editor.init({
    onSave: (meta) => {
      if (currentNote) currentNote.meta = meta
      updateCreateTime(meta.created)
      Sidebar.refresh()
    },
    onChange: () => {
      updatePlaceholder()
      requestAnimationFrame(followCursor)
      scheduleYun()
    }
  })

  Reader.init({ onFontSizeChange: updateColLineStepReader })

  Sidebar.init({
    onSelect: async (file) => {
      await openNote(file.path)
    },
    onNew: async () => {
      try {
        const note = await Storage.createNote()
        await openNote(note.path, note)
        await Sidebar.refresh()
      } catch (err) {
        console.error('Failed to create note:', err)
        showToast('创建笔记失败', 'error')
      }
    }
  })

  // ─── Open a note ────────────────────────────────

  async function openNote (filePath, preloaded) {
    await Editor.save()

    try {
      currentNote = preloaded || await Storage.loadNote(filePath)
      Editor.load(currentNote)
      updatePlaceholder()
      Sidebar.setActive(filePath)

      // Set title in vertical title column
      // Date-only filenames show empty (placeholder "无题" will appear)
      const filename = filePath.split('/').pop()
      const displayTitle = Storage.extractDisplayTitle(filename)
      const titleEl = document.getElementById('noteTitle')
      const isDateOnly = /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(displayTitle)
      titleEl.textContent = isDateOnly ? '' : displayTitle

      updateCreateTime(currentNote.meta?.created)

      // Reset scroll to right edge (document start) and set up height
      requestAnimationFrame(() => {
        editorScrollEl.scrollLeft = 0
        setupEditorColumns()
      })

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

  // ─── Note title (contenteditable vertical column) ──
  // On blur/Enter → rename file.

  const titleEl = document.getElementById('noteTitle')

  // Title is pointer-events:none by default; click on it to start editing
  titleEl.addEventListener('focus', () => titleEl.classList.add('editing'))
  titleEl.addEventListener('blur', () => titleEl.classList.remove('editing'))

  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      titleEl.blur()
    }
  })

  // Prevent multi-line paste — only keep first line
  titleEl.addEventListener('paste', (e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain').split('\n')[0]
    document.execCommand('insertText', false, text)
  })

  titleEl.addEventListener('blur', async () => {
    if (!currentNote) return
    const newTitle = titleEl.textContent.trim()
    if (!newTitle) {
      // Restore previous title for titled files; keep empty for date-only files
      const filename = currentNote.path.split('/').pop()
      const prevTitle = Storage.extractDisplayTitle(filename)
      const isDateOnly = /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(prevTitle)
      titleEl.textContent = isDateOnly ? '' : prevTitle
      return
    }

    try {
      await Editor.save() // save content first
      const { path: newPath, changed } = await Storage.renameNote(currentNote.path, newTitle)

      if (changed) {
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

  // ─── Editor horizontal scroll (横向卷轴) ──────────
  //
  // writing-mode: vertical-rl 下内容自然向左延伸，
  // .editor-scroll overflow-x: auto 提供原生横向滚动。
  // 打字时自动将光标滚入可见区域。

  const editorScrollEl = document.querySelector('.editor-scroll')

  // 设置编辑器高度（适配容器）
  function setupEditorColumns () {
    const editorEl = document.getElementById('editor')
    const h = editorScrollEl.clientHeight
    if (h) editorEl.style.minHeight = h + 'px'
    updateColLineStepEditor()
  }

  // 打字时，让光标自动滚入可见区域
  function followCursor () {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const cursorRect = sel.getRangeAt(0).getBoundingClientRect()
    if (!cursorRect.width && !cursorRect.height) return

    const containerRect = editorScrollEl.getBoundingClientRect()
    const margin = 40  // 留一点边距

    if (cursorRect.left < containerRect.left + margin) {
      // 光标在左侧看不见 → 向左滚
      editorScrollEl.scrollBy({ left: cursorRect.left - containerRect.left - margin, behavior: 'smooth' })
    } else if (cursorRect.right > containerRect.right - margin) {
      // 光标在右侧看不见 → 向右滚
      editorScrollEl.scrollBy({ left: cursorRect.right - containerRect.right + margin, behavior: 'smooth' })
    }
  }

  // Recalculate on resize
  window.addEventListener('resize', setupEditorColumns)

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

  const singlePageSVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="4" y="2" width="8" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/>
  </svg>`

  const doublePageSVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="2" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/>
    <rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/>
  </svg>`

  function applyLayout (double) {
    isDoubleLayout = double
    const btn = document.getElementById('layoutToggle')
    btn.innerHTML = double ? doublePageSVG : singlePageSVG
    btn.classList.toggle('active', double)
    document.getElementById('editorArea').dataset.layout = double ? 'double' : 'single'
    if (currentMode === 'read') {
      Reader.setLayout(double)
    } else {
      setupEditorColumns()
    }
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

    // Position: to the right of the detail button in the vtoolbar
    const rect = detailBtn.getBoundingClientRect()
    detailPopover.style.left  = `${rect.right + 8}px`
    detailPopover.style.top   = `${rect.top}px`
    detailPopover.style.right = 'auto'

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

  // ─── Export to Apple Notes ───────────────────────
  //
  // Converts Markdown body to HTML for Apple Notes:
  //   • 去除标题标记、图片、链接标记、斜体、标注语法
  //   • 保留加粗（** ** → <b>）和换行（\n → <br>）
  //   • V1：每次都新建 Note，不更新已有 Note

  function toAppleNotesHtml (rawBody) {
    const lines = rawBody.split(/\r?\n/)
    const parts = lines.map(line => {
      // Strip annotation syntax → keep annotated text only
      line = line.replace(/::annotate\[([^\]]+)\]\{[^}]+\}::/g, '$1')
      // Strip heading markers
      line = line.replace(/^#{1,6}\s+/, '')
      // Strip image syntax (remove entirely)
      line = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      // Strip link syntax → keep link text
      line = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Bold + italic → bold (preserve bold, strip italic markers)
      line = line.replace(/\*\*\*([^*]+)\*\*\*/g, '<b>$1</b>')
      // Bold → <b>
      line = line.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      // Italic → plain text
      line = line.replace(/\*([^*]+)\*/g, '$1')
      return line
    })
    return parts.join('<br>')
  }

  async function doExportToAppleNotes (btn) {
    if (!currentNote) return

    const title   = currentNote.meta?.title ||
                    Storage.extractDisplayTitle(currentNote.path.split('/').pop())
    const htmlBody = toAppleNotesHtml(Editor.getBody())

    // Button loading state
    if (btn) { btn.disabled = true; btn.classList.add('sending') }

    try {
      const result = await window.electron.apple.createNote(title, htmlBody)
      if (result.ok) showToast('已发送到 Apple Notes ✓')
      else           showToast(result.error, 'error')
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('sending') }
    }
  }

  // Button in title column
  document.getElementById('sendToNotesBtn').addEventListener('click', function () {
    doExportToAppleNotes(this)
  })

  // Button in detail popover (existing, reuse new function)
  document.getElementById('popoverExportBtn').addEventListener('click', async () => {
    closeDetail()
    await doExportToAppleNotes(null)
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

  // ─── "問芸" inline selection handler ──────────────
  document.getElementById('askYunBtn').addEventListener('click', async () => {
    const toolbar = document.getElementById('annotationToolbar')
    const askBtn  = document.getElementById('askYunBtn')
    const selText = toolbar.dataset.selectedText
    if (!selText) return

    // Get the full editor body to extract context around the selection
    const fullBody = Editor.getBody()
    const selIdx   = fullBody.indexOf(selText)
    const ctxStart = Math.max(0, selIdx - 500)
    const ctxEnd   = Math.min(fullBody.length, selIdx + selText.length + 500)
    const contextBefore = fullBody.slice(ctxStart, selIdx)
    const contextAfter  = fullBody.slice(selIdx + selText.length, ctxEnd)

    // Build the prompt
    const prompt = `你是陳芸，《浮生六記》中沈復的妻子。你溫婉聰慧、情趣盎然，與夫君既是伴侶亦是知己。你說話自然親切，帶著清代文人妻子的雅致，但不矯揉造作——是閨房中夫妻間的私語，不是寫給外人看的書信。

用口語化的方式回應，1-2句即可。不要加「芸：」前綴，不要翻譯或改寫，不要結構化輸出。

夫君對你說：「${selText}」

（夫君正在寫的文章，供你了解語境：${contextBefore}${selText}${contextAfter}）`

    // Show loading state
    askBtn.classList.add('yun-loading')
    askBtn.textContent = '…'

    // Save the current selection range before the async call
    const sel = window.getSelection()
    let savedRange = null
    if (sel && sel.rangeCount) {
      savedRange = sel.getRangeAt(0).cloneRange()
    }

    let result = null
    try {
      // Call the appropriate non-streaming backend
      if (yunBackend === 'openrouter') {
        const apiKey = document.getElementById('openRouterKeyInput').value
        const model  = document.getElementById('openRouterModelSelect').value
        if (!apiKey) { showToast('請先設置 OpenRouter API Key', 'error'); return }
        result = await window.electron.yun.openrouterSync(apiKey, model, prompt)
      } else {
        const projectDir = document.getElementById('projectDirInput').value
        result = await window.electron.yun.askSync(prompt, projectDir || undefined)
      }
    } catch (err) {
      showToast('芸暫時無法回應：' + (err.message || '未知錯誤'), 'error')
      return
    } finally {
      askBtn.classList.remove('yun-loading')
      askBtn.textContent = '芸'
    }

    if (!result || !result.ok || !result.fullText) {
      showToast('芸暫時無法回應' + (result?.error ? '：' + result.error : ''), 'error')
      return
    }

    // Insert response after the selected text
    const responseText = '\n芸：' + result.fullText.trim()

    // Restore selection and collapse to end, then insert
    if (savedRange) {
      const insertRange = savedRange.cloneRange()
      insertRange.collapse(false)  // collapse to end of selection
      sel.removeAllRanges()
      sel.addRange(insertRange)
    }
    document.execCommand('insertText', false, responseText)

    Editor.hideAnnotationToolbar()
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

  // ─── 列线步距更新（从实际 computed line-height 获取像素值）──

  function updateColLineStepEditor () {
    const el = document.getElementById('editor')
    if (!el) return
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight)
    const pr = parseFloat(cs.paddingRight)   // writing-mode:vertical-rl → 物理 right = block-start
    if (lh > 0) document.documentElement.style.setProperty('--col-line-step-editor', lh + 'px')
    if (pr > 0) document.documentElement.style.setProperty('--col-line-offset-editor', pr + 'px')
  }

  function updateColLineStepReader (size) {
    const step   = size * 2.0   // reader line-height = 2.0
    const offset = 48           // r-page padding-right（物理 right = block-start in vertical-rl）
    document.documentElement.style.setProperty('--col-line-step-reader',   step + 'px')
    document.documentElement.style.setProperty('--col-line-offset-reader', offset + 'px')
  }

  // ─── 样式工具函数 ─────────────────────────────────

  // 根据强度值（0-10）动态生成宣纸纹理 CSS 变量值
  function buildTextureVar (level) {
    const t = level / 10  // 0.0 – 1.0
    const a1 = (0.55 * t).toFixed(3)
    const a2 = (0.55 * t).toFixed(3)
    const a3 = (0.28 * t).toFixed(3)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="p" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.65 0.45" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0.6 0.4 0 0 0.1 0.4 0.5 0.1 0 0.05 0 0.3 0.5 0 0 ${a1} ${a2} ${a3} 0 0"/></filter><rect width="300" height="300" filter="url(#p)"/></svg>`
    return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`
  }

  function applyTexture (level) {
    document.documentElement.style.setProperty('--paper-texture', buildTextureVar(level))
  }

  function applyColLineOpacity (level) {
    // level 1-10 → opacity 0.08–0.38
    const opacity = (0.07 + level * 0.031).toFixed(3)
    document.documentElement.style.setProperty('--col-line-opacity', opacity)
  }

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
    await window.electron.fs.watch(dir)  // Switch watcher to new vault
    await Sidebar.refresh()
  })

  document.getElementById('selectProjectDirBtn').addEventListener('click', async () => {
    const dir = await window.electron.dialog.openDirectory()
    if (!dir) return
    document.getElementById('projectDirInput').value = dir
    const config = await window.electron.config.read()
    config.projectDir = dir
    await window.electron.config.write(config)
    checkYunConnection()
  })

  // ─── Yun backend toggle (CLI vs OpenRouter) ────
  let yunBackend = 'cli'  // 'cli' | 'openrouter'

  document.querySelectorAll('.yun-backend-choice').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.yun-backend-choice').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      yunBackend = btn.dataset.backend
      document.getElementById('yunCliSettings').style.display = yunBackend === 'cli' ? '' : 'none'
      document.getElementById('yunOpenRouterSettings').style.display = yunBackend === 'openrouter' ? '' : 'none'
      const config = await window.electron.config.read()
      config.yunBackend = yunBackend
      await window.electron.config.write(config)
      checkYunConnection()
    })
  })

  // OpenRouter API key save on blur
  document.getElementById('openRouterKeyInput').addEventListener('change', async () => {
    const config = await window.electron.config.read()
    config.openRouterKey = document.getElementById('openRouterKeyInput').value.trim()
    await window.electron.config.write(config)
    checkYunConnection()
  })

  // OpenRouter model save on change
  document.getElementById('openRouterModelSelect').addEventListener('change', async () => {
    const config = await window.electron.config.read()
    config.openRouterModel = document.getElementById('openRouterModelSelect').value
    await window.electron.config.write(config)
  })

  // Soul file picker for OpenRouter
  document.getElementById('selectSoulFileBtn').addEventListener('click', async () => {
    const paths = await window.electron.dialog.openFile({ filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }] })
    if (!paths || !paths.length) return
    document.getElementById('openRouterSoulPath').value = paths[0]
    const config = await window.electron.config.read()
    config.openRouterSoulPath = paths[0]
    await window.electron.config.write(config)
  })

  document.getElementById('detectClaudeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('detectClaudeBtn')
    const input = document.getElementById('claudePathInput')
    const hint = document.getElementById('claudePathHint')
    btn.disabled = true
    btn.textContent = '檢測中…'
    input.value = '正在搜尋…'
    hint.textContent = ''

    const result = await window.electron.yun.detectCli()

    btn.disabled = false
    btn.textContent = '檢測'
    if (result.ok) {
      input.value = result.path
      hint.textContent = '已找到 Claude CLI'
      hint.style.color = '#5a9e6f'
      checkYunConnection()
    } else {
      input.value = '未找到'
      hint.textContent = '請確認已安裝 Claude Code CLI (npm i -g @anthropic-ai/claude-code)'
      hint.style.color = '#c0392b'
    }
  })

  async function openSettings () {
    document.getElementById('vaultPathInput').value = Storage.getVaultPath() || ''
    const config = await window.electron.config.read()
    if (config.projectDir) {
      document.getElementById('projectDirInput').value = config.projectDir
    }
    // Show current CLI path if known
    if (yunBackend === 'cli') {
      const cliResult = await window.electron.yun.checkCli()
      document.getElementById('claudePathInput').value = cliResult.ok ? cliResult.path : '未檢測'
      document.getElementById('claudePathHint').textContent = cliResult.ok
        ? '已找到 Claude CLI' : '點擊「檢測」自動尋找 claude CLI 安裝位置'
      document.getElementById('claudePathHint').style.color = ''
    }

    // Restore OpenRouter fields
    if (config.openRouterKey) document.getElementById('openRouterKeyInput').value = config.openRouterKey
    if (config.openRouterModel) document.getElementById('openRouterModelSelect').value = config.openRouterModel
    if (config.openRouterSoulPath) document.getElementById('openRouterSoulPath').value = config.openRouterSoulPath

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

  // ─── Theme switcher ─────────────────────────────
  const allThemes = ['xuanzhi', 'yuebai', 'songyan', 'tengzi', 'qingzhu']

  function applyTheme (theme) {
    // Remove all theme classes, then add the selected one (xuanzhi = default, no class)
    allThemes.forEach(t => document.body.classList.remove('theme-' + t))
    if (theme !== 'xuanzhi') {
      document.body.classList.add('theme-' + theme)
    }
  }

  document.querySelectorAll('.theme-choice').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.theme-choice').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const theme = btn.dataset.theme
      applyTheme(theme)
      const config = await window.electron.config.read()
      config.theme = theme
      await window.electron.config.write(config)
    })
  })

  document.getElementById('columnLinesToggle').addEventListener('change', async (e) => {
    const on = e.target.checked
    document.body.classList.toggle('show-column-lines', on)
    const config = await window.electron.config.read()
    config.columnLines = on
    await window.electron.config.write(config)
  })

  document.getElementById('textureSlider').addEventListener('input', async (e) => {
    const level = Number(e.target.value)
    document.getElementById('textureVal').textContent = level
    applyTexture(level)
    const config = await window.electron.config.read()
    config.textureLevel = level
    await window.electron.config.write(config)
  })

  document.getElementById('colLineSlider').addEventListener('input', async (e) => {
    const level = Number(e.target.value)
    document.getElementById('colLineVal').textContent = level
    applyColLineOpacity(level)
    const config = await window.electron.config.read()
    config.colLineLevel = level
    await window.electron.config.write(config)
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

    // 主题
    if (config.theme && config.theme !== 'xuanzhi') {
      applyTheme(config.theme)
      document.querySelectorAll('.theme-choice').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === config.theme)
      })
    }

    // 宣纸纹理强度（默认 6）
    const textureLevel = config.textureLevel ?? 6
    document.getElementById('textureSlider').value = textureLevel
    document.getElementById('textureVal').textContent = textureLevel
    applyTexture(textureLevel)

    // 列线开关 + 濃度（默认 5）
    if (config.columnLines) {
      document.body.classList.add('show-column-lines')
      document.getElementById('columnLinesToggle').checked = true
    }
    const colLineLevel = config.colLineLevel ?? 5
    document.getElementById('colLineSlider').value = colLineLevel
    document.getElementById('colLineVal').textContent = colLineLevel
    applyColLineOpacity(colLineLevel)

    if (config.projectDir) {
      document.getElementById('projectDirInput').value = config.projectDir
    }

    // Yun backend
    if (config.yunBackend) {
      yunBackend = config.yunBackend
      document.querySelectorAll('.yun-backend-choice').forEach(b => {
        b.classList.toggle('active', b.dataset.backend === yunBackend)
      })
      document.getElementById('yunCliSettings').style.display = yunBackend === 'cli' ? '' : 'none'
      document.getElementById('yunOpenRouterSettings').style.display = yunBackend === 'openrouter' ? '' : 'none'
    }
    if (config.openRouterKey) {
      document.getElementById('openRouterKeyInput').value = config.openRouterKey
    }
    if (config.openRouterModel) {
      document.getElementById('openRouterModelSelect').value = config.openRouterModel
    }
    if (config.openRouterSoulPath) {
      document.getElementById('openRouterSoulPath').value = config.openRouterSoulPath
    }
  }

  await restoreConfig()

  // ─── Yun Agent (芸的评论) ────────────────────

  const yunColTextEl = document.getElementById('yunColText')   // right column
  const yunBubbleEl = document.getElementById('yunBubble')
  const yunBubbleTextEl = document.getElementById('yunBubbleText')
  const yunDotEl = document.getElementById('yunDot')

  function setYunDot (state) {
    // state: 'hidden' | 'pending' | 'connected' | 'streaming' | 'error'
    yunDotEl.className = 'yun-dot' + (state !== 'hidden' ? ' ' + state : '')
  }

  // Check connection availability and show dot
  async function checkYunConnection () {
    setYunDot('pending')
    yunColTextEl.innerHTML = ''

    if (yunBackend === 'openrouter') {
      const key = document.getElementById('openRouterKeyInput').value
      if (!key) { setYunDot('hidden'); return }
      setYunDot('connected')
    } else {
      const projectDir = document.getElementById('projectDirInput').value
      if (!projectDir) { setYunDot('hidden'); return }
      const result = await window.electron.yun.checkCli()
      if (result.ok) {
        setYunDot('connected')
      } else {
        setYunDot('error')
        yunColTextEl.textContent = '芸暫時離開了'
        yunBubbleTextEl.textContent = '找不到 Claude CLI — 請確認已安裝'
      }
    }
  }

  let yunDebounceTimer = null
  let yunStreamingTimeout = null
  let yunIsStreaming = false
  let yunQueuedRequest = false
  let yunReplyHistory = []  // last 10 replies
  let yunFullText = ''
  let yunLastSentText = ''  // avoid re-triggering for same content

  // Listen for streaming chunks from main process
  window.electron.yun.onChunk((text) => {
    yunFullText += text
    // Append each character with ink-appear animation
    for (const ch of text) {
      const span = document.createElement('span')
      span.className = 'yun-col-char'
      span.textContent = ch
      yunColTextEl.appendChild(span)
    }
    yunBubbleTextEl.textContent = yunFullText
  })

  // Listen for stream completion
  window.electron.yun.onDone((result) => {
    yunIsStreaming = false
    if (yunStreamingTimeout) { clearTimeout(yunStreamingTimeout); yunStreamingTimeout = null }
    yunColTextEl.classList.remove('streaming')

    if (result.ok && yunFullText) {
      setYunDot('connected')
      yunReplyHistory.push(yunFullText)
      if (yunReplyHistory.length > 10) yunReplyHistory.shift()
    } else if (!result.ok) {
      setYunDot('error')
      yunColTextEl.textContent = '芸暫時離開了'
      yunBubbleTextEl.textContent = result.error || '無法連接'
    }

    // Process queued request if any
    if (yunQueuedRequest) {
      yunQueuedRequest = false
      triggerYun()
    }
  })

  // Hover to show full bubble
  // Hover on yun column to show full reply bubble
  yunColTextEl.addEventListener('mouseenter', () => {
    if (yunColTextEl.textContent && yunColTextEl.textContent !== '') {
      yunBubbleEl.classList.remove('hidden')
    }
  })

  yunColTextEl.addEventListener('mouseleave', () => {
    setTimeout(() => {
      if (!yunBubbleEl.matches(':hover')) {
        yunBubbleEl.classList.add('hidden')
      }
    }, 100)
  })

  yunBubbleEl.addEventListener('mouseleave', () => {
    yunBubbleEl.classList.add('hidden')
  })

  // Schedule Yun check — called whenever editor content changes
  function scheduleYun () {
    // Check if any backend is configured
    if (yunBackend === 'cli') {
      if (!document.getElementById('projectDirInput').value) return
    } else {
      if (!document.getElementById('openRouterKeyInput').value) return
    }

    if (yunDebounceTimer) clearTimeout(yunDebounceTimer)
    yunDebounceTimer = setTimeout(() => {
      if (yunIsStreaming) {
        yunQueuedRequest = true  // queue it
      } else {
        triggerYun()
      }
    }, 30000)  // 30 seconds after last input
  }

  async function triggerYun () {
    const body = Editor.getBody()
    const last100 = body.slice(-100)
    if (!last100.trim()) return
    if (last100 === yunLastSentText) return
    yunLastSentText = last100

    const title = document.getElementById('noteTitle').textContent || '無題'

    // Read soul.md — from project dir (CLI) or explicit file (OpenRouter)
    let soulContent = ''
    try {
      if (yunBackend === 'cli') {
        const projectDir = document.getElementById('projectDirInput').value
        if (!projectDir) return
        const result = await window.electron.yun.readSoul(projectDir)
        if (result.ok) soulContent = result.content
      } else {
        const soulPath = document.getElementById('openRouterSoulPath').value
        if (soulPath) {
          const result = await window.electron.fs.readFile(soulPath)
          if (result.ok) soulContent = result.content
        }
      }
    } catch {}

    // Build prompt
    const historyText = yunReplyHistory.length > 0
      ? '\n\n你之前的回覆：\n' + yunReplyHistory.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : ''

    const soulSection = soulContent
      ? `\n\n以下是你的性格設定（soul.md）：\n${soulContent}\n\n`
      : ''

    const prompt = `${soulSection}你是陳芸，《浮生六記》中沈復的妻子。你溫婉聰慧、情趣盎然，與夫君既是伴侶亦是知己。你在一旁靜靜看著夫君寫字，偶爾輕聲說上一句。

夫君正在寫「${title}」，最近寫下的文字：
「${last100}」
${historyText}

用閨房私語的口吻輕聲回應1句，自然親切，不矯揉。不要用引號包裹。`

    // Start streaming
    yunIsStreaming = true
    yunFullText = ''
    yunColTextEl.innerHTML = ''
    yunColTextEl.classList.add('streaming')
    yunBubbleTextEl.textContent = ''
    setYunDot('streaming')

    // Safety timeout
    if (yunStreamingTimeout) clearTimeout(yunStreamingTimeout)
    yunStreamingTimeout = setTimeout(() => {
      if (yunIsStreaming) {
        yunIsStreaming = false
        yunColTextEl.classList.remove('streaming')
        setYunDot('error')
        if (!yunFullText) {
          yunColTextEl.textContent = '芸暫時離開了'
        }
      }
    }, 60000)

    // Call appropriate backend
    if (yunBackend === 'openrouter') {
      const apiKey = document.getElementById('openRouterKeyInput').value
      const model = document.getElementById('openRouterModelSelect').value
      window.electron.yun.openrouter(apiKey, model, prompt)
    } else {
      const projectDir = document.getElementById('projectDirInput').value
      window.electron.yun.ask(prompt, projectDir)
    }
  }

  // ─── Initial columns setup ───────────────────────
  setupEditorColumns()
  // 延迟一帧确保字体渲染完成后再读 computed line-height
  requestAnimationFrame(updateColLineStepEditor)

  // ─── Check Yun CLI connection ───────────────────
  checkYunConnection()

  // ─── Initial note load ───────────────────────────

  await Sidebar.refresh()

  const todayNote = await Storage.createNote()
  await openNote(todayNote.path, todayNote)

})()
