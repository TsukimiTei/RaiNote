/* ═══════════════════════════════════════════════════════
   app.js — 主应用控制器
   标题编辑 / Detail 弹窗 / 设置 / 初始化
   ═══════════════════════════════════════════════════════ */

;(async () => {
  // ─── Bootstrap ──────────────────────────────────

  await Storage.init()

  let currentNote = null

  // ─── File system watcher (Finder / Obsidian changes) ──

  let fsChangeTimer = null
  window.electron.fs.onChanged(() => {
    if (fsChangeTimer) clearTimeout(fsChangeTimer)
    fsChangeTimer = setTimeout(() => Sidebar.refresh(), 500)
  })

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
    }
  })

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
    },
    onExport: async (file) => {
      try {
        const note = await Storage.loadNote(file.path)
        const title = String(note.meta?.title ||
                      Storage.extractDisplayTitle(file.name.replace('.md', '')))
        const htmlBody = toAppleNotesHtml(note.body || '')
        const result = await window.electron.apple.createNote(title, htmlBody)
        if (result.ok) showToast('已发送到 Apple Notes ✓')
        else           showToast(result.error, 'error')
      } catch (err) {
        console.error('Export failed:', err)
        showToast('导出失败', 'error')
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
      const filename = filePath.split('/').pop()
      const displayTitle = Storage.extractDisplayTitle(filename)
      const titleEl = document.getElementById('noteTitle')
      const isDateOnly = /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(displayTitle)
      titleEl.textContent = isDateOnly ? '' : displayTitle

      updateCreateTime(currentNote.meta?.created)

      // 记住最后打开的笔记（延迟写入，避免频繁 I/O）
      clearTimeout(openNote._saveTimer)
      openNote._saveTimer = setTimeout(async () => {
        const cfg = await window.electron.config.read()
        cfg.lastNotePath = filePath
        await window.electron.config.write(cfg)
      }, 1000)

      // Reset scroll to right edge (document start) and set up columns
      requestAnimationFrame(() => {
        editorScrollEl.scrollLeft = 0
        setupEditorColumns()
      })
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

  const titleEl = document.getElementById('noteTitle')

  titleEl.addEventListener('focus', () => titleEl.classList.add('editing'))
  titleEl.addEventListener('blur', () => titleEl.classList.remove('editing'))

  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      titleEl.blur()
    }
  })

  titleEl.addEventListener('paste', (e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain').split('\n')[0]
    document.execCommand('insertText', false, text)
  })

  titleEl.addEventListener('blur', async () => {
    // Capture reference before any async — openNote may change currentNote
    const note = currentNote
    if (!note) return
    const notePath = note.path
    const newTitle = titleEl.textContent.trim()
    if (!newTitle) {
      const filename = notePath.split('/').pop()
      const prevTitle = Storage.extractDisplayTitle(filename)
      const isDateOnly = /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(prevTitle)
      titleEl.textContent = isDateOnly ? '' : prevTitle
      return
    }

    try {
      await Editor.save()

      // Bail if user already switched to a different note during save
      if (currentNote !== note) return

      const { path: newPath, changed } = await Storage.renameNote(notePath, newTitle)

      if (changed) {
        currentNote.path = newPath
        Editor.setPath(newPath)
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

  const editorScrollEl = document.querySelector('.editor-scroll')

  // 垂直滚轮 → 横向滚动
  // 监听挂在 .content-col 上，确保一定能收到 wheel 事件
  document.querySelector('.content-col').addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) return   // pinch-to-zoom 不干预
    e.preventDefault()
    let dy = e.deltaY, dx = e.deltaX
    if (e.deltaMode === 1) { dy *= 20; dx *= 20 }
    editorScrollEl.scrollLeft += dx - dy
  }, { passive: false })

  function setupEditorColumns () {
    updateColLineStepEditor()
  }

  // 打字时，让光标自动滚入可见区域
  function followCursor () {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const cursorRect = sel.getRangeAt(0).getBoundingClientRect()
    if (!cursorRect.width && !cursorRect.height) return

    const containerRect = editorScrollEl.getBoundingClientRect()
    const margin = 40

    if (cursorRect.left < containerRect.left + margin) {
      editorScrollEl.scrollBy({ left: cursorRect.left - containerRect.left - margin, behavior: 'smooth' })
    } else if (cursorRect.right > containerRect.right - margin) {
      editorScrollEl.scrollBy({ left: cursorRect.right - containerRect.right + margin, behavior: 'smooth' })
    }
  }

  window.addEventListener('resize', setupEditorColumns)

  // ─── Sidebar toggle ──────────────────────────────

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    Sidebar.toggle()
  })

  // ─── Quick new note (toolbar) ─────────────────────

  document.getElementById('quickNewNoteBtn').addEventListener('click', async () => {
    try {
      const note = await Storage.createNote()
      await openNote(note.path, note)
      await Sidebar.refresh()
    } catch (err) {
      console.error('Failed to create note:', err)
      showToast('创建笔记失败', 'error')
    }
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

    document.getElementById('dpCreated').textContent =
      meta.created ? fmtDate(meta.created) : '—'
    document.getElementById('dpUpdated').textContent =
      meta.updated ? fmtDate(meta.updated) : '—'
    document.getElementById('dpWordCount').textContent =
      `${Editor.getWordCount()} 字`
    document.getElementById('dpWriteTime').textContent =
      fmtMinutes(Editor.getWriteMinutes())

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

  function toAppleNotesHtml (rawBody) {
    const lines = rawBody.split(/\r?\n/)
    const parts = lines.map(line => {
      line = line.replace(/::annotate\[([^\]]+)\]\{[^}]+\}::/g, '$1')
      line = line.replace(/^#{1,6}\s+/, '')
      line = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      line = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      line = line.replace(/\*\*\*([^*]+)\*\*\*/g, '<b>$1</b>')
      line = line.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
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

    if (btn) { btn.disabled = true; btn.classList.add('sending') }

    try {
      const result = await window.electron.apple.createNote(title, htmlBody)
      if (result.ok) showToast('已发送到 Apple Notes ✓')
      else           showToast(result.error, 'error')
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('sending') }
    }
  }

  document.getElementById('sendToNotesBtn').addEventListener('click', function () {
    doExportToAppleNotes(this)
  })

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

    const fullBody = Editor.getBody()
    const selIdx   = fullBody.indexOf(selText)
    const ctxStart = Math.max(0, selIdx - 500)
    const ctxEnd   = Math.min(fullBody.length, selIdx + selText.length + 500)
    const contextBefore = fullBody.slice(ctxStart, selIdx)
    const contextAfter  = fullBody.slice(selIdx + selText.length, ctxEnd)

    const prompt = `你是陳芸，《浮生六記》裡沈復的妻子——機靈、有主見、愛討論詩文。你有自己的審美和判斷，好的會說好在哪裡，不好的也會直說，像知己間的坦率。偶爾引用詩詞，但化用自然不掉書袋。

對夫君選中的這段文字給出真實看法，1-2句。不加「芸：」前綴，不翻譯不改寫。

夫君選中：「${selText}」

（語境：${contextBefore}${selText}${contextAfter}）`

    askBtn.classList.add('yun-loading')
    askBtn.textContent = '…'

    const sel = window.getSelection()
    let savedRange = null
    if (sel && sel.rangeCount) {
      savedRange = sel.getRangeAt(0).cloneRange()
    }

    let result = null
    try {
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

    const responseText = '\n芸：' + result.fullText.trim()

    if (savedRange) {
      const insertRange = savedRange.cloneRange()
      insertRange.collapse(false)
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

  // ─── 列线步距更新 ──────────────────────────────────

  function updateColLineStepEditor () {
    const el = document.getElementById('editor')
    if (!el) return
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight)
    const pr = parseFloat(cs.paddingRight)
    if (lh > 0) document.documentElement.style.setProperty('--col-line-step-editor', lh + 'px')
    if (pr > 0) document.documentElement.style.setProperty('--col-line-offset-editor', pr + 'px')
  }

  // ─── 样式工具函数 ─────────────────────────────────

  function buildTextureVar (level) {
    const t = level / 10
    const a1 = (0.55 * t).toFixed(3)
    const a2 = (0.55 * t).toFixed(3)
    const a3 = (0.28 * t).toFixed(3)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><filter id="p" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.65 0.45" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0.6 0.4 0 0 0.1 0.4 0.5 0.1 0 0.05 0 0.3 0.5 0 0 ${a1} ${a2} ${a3} 0 0"/></filter><rect width="800" height="800" filter="url(#p)"/></svg>`
    return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`
  }

  function applyTexture (level) {
    document.documentElement.style.setProperty('--paper-texture', buildTextureVar(level))
  }

  function applyColLineOpacity (level) {
    const opacity = (0.07 + level * 0.031).toFixed(3)
    document.documentElement.style.setProperty('--col-line-opacity', opacity)
  }

  // ─── Yun Log ─────────────────────────────────────

  const yunLogPanel = document.getElementById('yunLogPanel')

  function yunLog (msg, type) {
    const entry = document.createElement('div')
    entry.className = 'yun-log-entry' + (type ? ' log-' + type : '')
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    entry.innerHTML = `<span class="log-time">${t}</span><span class="log-msg">${msg}</span>`
    yunLogPanel.appendChild(entry)
    yunLogPanel.scrollTop = yunLogPanel.scrollHeight
    while (yunLogPanel.children.length > 200) yunLogPanel.removeChild(yunLogPanel.firstChild)
  }

  document.getElementById('yunLogClearBtn').addEventListener('click', () => {
    yunLogPanel.innerHTML = ''
  })

  // ─── Settings ────────────────────────────────────

  document.getElementById('settingsBtn').addEventListener('click', openSettings)
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings)

  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsOverlay')) closeSettings()
  })

  // ─── Settings Tab Switching ─────────────────────
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const target = tab.dataset.tab
      document.getElementById('settingsTabContent').classList.toggle('hidden', target !== 'settings')
      document.getElementById('yunLogTabContent').classList.toggle('hidden', target !== 'yunlog')
    })
  })

  document.getElementById('selectVaultBtn').addEventListener('click', async () => {
    const dir = await window.electron.dialog.openDirectory()
    if (!dir) return
    await Storage.setVaultPath(dir)
    document.getElementById('vaultPathInput').value = dir
    await window.electron.fs.watch(dir)
    await Sidebar.refresh()
  })

  // ─── Yun backend toggle (CLI vs OpenRouter) ────
  let yunBackend = 'cli'

  document.querySelectorAll('.yun-pace-choice').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.yun-pace-choice').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      yunPace = btn.dataset.pace
      const config = await window.electron.config.read()
      config.yunPace = yunPace
      await window.electron.config.write(config)
      startYunTimer()
    })
  })

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

  document.getElementById('openRouterKeyInput').addEventListener('change', async () => {
    const config = await window.electron.config.read()
    config.openRouterKey = document.getElementById('openRouterKeyInput').value.trim()
    await window.electron.config.write(config)
    checkYunConnection()
  })

  document.getElementById('openRouterModelSelect').addEventListener('change', async () => {
    const config = await window.electron.config.read()
    config.openRouterModel = document.getElementById('openRouterModelSelect').value
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
      yunLog(`手動檢測成功: ${result.path}`, 'ok')
      checkYunConnection()
    } else {
      input.value = '未找到'
      hint.textContent = '請確認已安裝 Claude Code CLI (npm i -g @anthropic-ai/claude-code)'
      hint.style.color = '#c0392b'
      yunLog('手動檢測失敗 — CLI 未找到', 'err')
    }
  })

  // ─── Auto Update ──────────────────────────────────

  const runUpdateCheck = async () => {
    const btn = document.getElementById('checkUpdateBtn')
    const hint = document.getElementById('updateStatusHint')
    btn.disabled = true
    btn.textContent = '檢查中…'
    hint.textContent = ''
    hint.style.color = ''
    const result = await window.electron.updater.checkForUpdates()
    if (result && !result.ok) {
      btn.disabled = false
      btn.textContent = '檢查更新'
      hint.textContent = result.error || '檢查更新失敗'
      hint.style.color = '#c0392b'
    }
  }

  document.getElementById('checkUpdateBtn').onclick = runUpdateCheck

  window.electron.updater.onStatus((data) => {
    const btn = document.getElementById('checkUpdateBtn')
    const hint = document.getElementById('updateStatusHint')

    switch (data.state) {
      case 'checking':
        hint.textContent = '正在檢查更新…'
        break
      case 'up-to-date':
        btn.disabled = false
        btn.textContent = '檢查更新'
        btn.onclick = runUpdateCheck
        hint.textContent = '已是最新版本'
        hint.style.color = '#5a9e6f'
        break
      case 'downloading':
        hint.textContent = `正在下載 v${data.version || ''}… ${Math.round(data.percent || 0)}%`
        break
      case 'ready':
        btn.disabled = false
        btn.textContent = '重啟安裝'
        btn.onclick = async () => {
          const result = await window.electron.updater.quitAndInstall()
          if (result && !result.ok) {
            btn.disabled = false
            btn.textContent = '檢查更新'
            btn.onclick = runUpdateCheck
            hint.textContent = result.error || '安裝更新失敗'
            hint.style.color = '#c0392b'
          }
        }
        hint.textContent = `v${data.version} 已下載完成，點擊重啟安裝`
        hint.style.color = '#5a9e6f'
        break
      case 'unavailable':
        btn.disabled = false
        btn.textContent = '檢查更新'
        btn.onclick = runUpdateCheck
        hint.textContent = data.message || '目前版本不支援自動更新'
        hint.style.color = '#c0392b'
        break
      case 'error':
        btn.disabled = false
        btn.textContent = '檢查更新'
        btn.onclick = runUpdateCheck
        hint.textContent = '檢查更新失敗：' + (data.message || '未知錯誤')
        hint.style.color = '#c0392b'
        break
    }
  })

  async function openSettings () {
    const version = await window.electron.updater.getVersion()
    document.getElementById('appVersionLabel').textContent = 'v' + version
    document.getElementById('vaultPathInput').value = Storage.getVaultPath() || ''
    const config = await window.electron.config.read()
    if (yunBackend === 'cli') {
      const cliResult = await window.electron.yun.checkCli()
      document.getElementById('claudePathInput').value = cliResult.ok ? cliResult.path : '未檢測'
      document.getElementById('claudePathHint').textContent = cliResult.ok
        ? '已找到 Claude CLI' : '點擊「檢測」自動尋找 claude CLI 安裝位置'
      document.getElementById('claudePathHint').style.color = ''
    }

    if (config.openRouterKey) document.getElementById('openRouterKeyInput').value = config.openRouterKey
    if (config.openRouterModel) document.getElementById('openRouterModelSelect').value = config.openRouterModel

    document.getElementById('settingsOverlay').classList.remove('hidden')
  }

  function closeSettings () {
    document.getElementById('settingsOverlay').classList.add('hidden')
  }

  document.querySelectorAll('.font-choice[data-font]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.font-choice[data-font]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const font = btn.dataset.font
      document.body.classList.remove('font-songti', 'font-fanti')
      if (font !== 'kaiti') document.body.classList.add('font-' + font)
      const config = await window.electron.config.read()
      config.font = font
      await window.electron.config.write(config)
    })
  })

  // ─── Theme switcher ─────────────────────────────
  const allThemes = ['xuanzhi', 'yuebai', 'songyan', 'tengzi', 'qingzhu']

  function applyTheme (theme) {
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

    if (config.font && config.font !== 'kaiti') {
      document.body.classList.add('font-' + config.font)
      document.querySelectorAll('.font-choice[data-font]').forEach(b => {
        b.classList.toggle('active', b.dataset.font === config.font)
      })
    }

    if (config.theme && config.theme !== 'xuanzhi') {
      applyTheme(config.theme)
      document.querySelectorAll('.theme-choice').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === config.theme)
      })
    }

    const textureLevel = config.textureLevel ?? 6
    document.getElementById('textureSlider').value = textureLevel
    document.getElementById('textureVal').textContent = textureLevel
    applyTexture(textureLevel)

    if (config.columnLines) {
      document.body.classList.add('show-column-lines')
      document.getElementById('columnLinesToggle').checked = true
    }
    const colLineLevel = config.colLineLevel ?? 5
    document.getElementById('colLineSlider').value = colLineLevel
    document.getElementById('colLineVal').textContent = colLineLevel
    applyColLineOpacity(colLineLevel)

    if (config.yunPace) {
      yunPace = config.yunPace
      document.querySelectorAll('.yun-pace-choice').forEach(b => {
        b.classList.toggle('active', b.dataset.pace === yunPace)
      })
    }
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
  }

  await restoreConfig()

  // ─── Yun Agent (芸的评论) ────────────────────

  const yunColTextEl = document.getElementById('yunColText')
  const yunBubbleEl = document.getElementById('yunBubble')
  const yunBubbleTextEl = document.getElementById('yunBubbleText')
  const yunDotEl = document.getElementById('yunDot')

  function setYunDot (state) {
    yunDotEl.className = 'yun-dot' + (state !== 'hidden' ? ' ' + state : '')
  }

  async function checkYunConnection () {
    setYunDot('pending')
    yunColTextEl.innerHTML = ''
    stopYunTimer()
    yunLog(`檢查連接… 後端: ${yunBackend}`)

    if (yunBackend === 'openrouter') {
      const key = document.getElementById('openRouterKeyInput').value
      if (!key) {
        setYunDot('hidden')
        yunLog('OpenRouter 未設置 API Key', 'warn')
        return
      }
      setYunDot('connected')
      yunLog('OpenRouter 已連接（模型：' + document.getElementById('openRouterModelSelect').value + '）', 'ok')
      startYunTimer()
    } else {
      const result = await window.electron.yun.checkCli()
      if (result.ok) {
        setYunDot('connected')
        yunLog('CLI 已連接：' + result.path, 'ok')
        startYunTimer()
      } else {
        setYunDot('hidden')
        yunLog('CLI 未找到 — 請安裝 Claude Code 或點擊檢測', 'err')
      }
    }
  }

  const YUN_PACE_RANGES = {
    dense:  [10000, 30000],
    normal: [30000, 120000],
    sparse: [60000, 180000]
  }
  const YUN_COOLDOWN = 10000

  let yunPace = 'normal'
  let yunRandomTimer = null
  let yunStreamingTimeout = null
  let yunIsStreaming = false
  let yunQueuedRequest = false
  let yunReplyHistory = []
  let yunFullText = ''
  let yunLastSentText = ''
  let yunFadeTimer = null

  function getYunRandomDelay () {
    const [min, max] = YUN_PACE_RANGES[yunPace]
    return min + Math.random() * (max - min)
  }

  function startYunTimer () {
    stopYunTimer()
    if (yunBackend === 'openrouter' && !document.getElementById('openRouterKeyInput').value) return
    yunRandomTimer = setTimeout(() => {
      if (yunIsStreaming) {
        yunQueuedRequest = true
      } else {
        triggerYun()
      }
    }, getYunRandomDelay())
  }

  function stopYunTimer () {
    if (yunRandomTimer) { clearTimeout(yunRandomTimer); yunRandomTimer = null }
  }

  let yunChunkLogged = false
  window.electron.yun.onChunk((text) => {
    yunFullText += text
    for (const ch of text) {
      const span = document.createElement('span')
      span.className = 'yun-col-char'
      span.textContent = ch
      yunColTextEl.appendChild(span)
    }
    yunBubbleTextEl.textContent = yunFullText
    if (!yunChunkLogged) {
      yunChunkLogged = true
      yunLog('收到回覆流…')
    }
  })

  window.electron.yun.onDone((result) => {
    yunIsStreaming = false
    if (yunStreamingTimeout) { clearTimeout(yunStreamingTimeout); yunStreamingTimeout = null }
    yunColTextEl.classList.remove('streaming')

    if (result.ok && yunFullText) {
      setYunDot('connected')
      const preview = yunFullText.length > 40 ? yunFullText.slice(0, 40) + '…' : yunFullText
      yunLog(`回覆（${yunFullText.length}字）: ${preview}`, 'ok')
      yunReplyHistory.push(yunFullText)
      if (yunReplyHistory.length > 10) yunReplyHistory.shift()
      // Auto-fade bubble after 6 seconds
      if (yunFadeTimer) clearTimeout(yunFadeTimer)
      yunFadeTimer = setTimeout(() => {
        yunBubbleEl.style.opacity = '0'
        setTimeout(() => yunBubbleEl.classList.add('hidden'), 600)
      }, 6000)
    } else if (!result.ok) {
      setYunDot('error')
      yunLog(`錯誤: ${result.error || '未知錯誤'}`, 'err')
      yunColTextEl.textContent = '芸暫時離開了'
      yunBubbleTextEl.textContent = result.error || '芸暫時離開了'
      if (yunFadeTimer) clearTimeout(yunFadeTimer)
      yunFadeTimer = setTimeout(() => {
        yunBubbleEl.style.opacity = '0'
        setTimeout(() => yunBubbleEl.classList.add('hidden'), 600)
      }, 8000)
    }

    if (yunQueuedRequest) {
      yunQueuedRequest = false
      triggerYun()
    } else {
      setTimeout(() => startYunTimer(), YUN_COOLDOWN)
    }
  })

  // Click dot to show latest reply
  yunDotEl.addEventListener('click', () => {
    if (yunReplyHistory.length > 0 && !yunIsStreaming) {
      yunBubbleTextEl.textContent = yunReplyHistory[yunReplyHistory.length - 1]
      const dotRect = yunDotEl.getBoundingClientRect()
      yunBubbleEl.style.right = (window.innerWidth - dotRect.left + 12) + 'px'
      yunBubbleEl.style.top = dotRect.top + 'px'
      yunBubbleEl.style.left = 'auto'
      yunBubbleEl.style.bottom = 'auto'
      yunBubbleEl.classList.remove('hidden')
      yunBubbleEl.style.opacity = '1'
      if (yunFadeTimer) clearTimeout(yunFadeTimer)
      yunFadeTimer = setTimeout(() => {
        yunBubbleEl.style.opacity = '0'
        setTimeout(() => yunBubbleEl.classList.add('hidden'), 600)
      }, 6000)
    }
  })

  // Click bubble to dismiss
  yunBubbleEl.addEventListener('click', () => {
    if (yunFadeTimer) { clearTimeout(yunFadeTimer); yunFadeTimer = null }
    yunBubbleEl.style.opacity = '0'
    setTimeout(() => yunBubbleEl.classList.add('hidden'), 600)
  })

  async function triggerYun () {
    const body = Editor.getBody()
    const last100 = body.slice(-100)
    const isEmpty = !last100.trim()

    if (!isEmpty && last100 === yunLastSentText) {
      startYunTimer()
      return
    }
    if (!isEmpty) yunLastSentText = last100

    const title = document.getElementById('noteTitle').textContent || '無題'

    const historyText = yunReplyHistory.length > 0
      ? '\n\n你之前的回覆：\n' + yunReplyHistory.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : ''

    const prompt = isEmpty
      ? `你是陳芸，《浮生六記》裡的女子——機靈、率真、愛詩文。夫君還未提筆，你在一旁看著。
${historyText}

說1句話引他開筆，可以調侃、可以聊閒事、可以引一句詩。語氣像枕邊閒話，自然不造作。不用引號。`
      : `你是陳芸，《浮生六記》裡的女子——機靈、率真、有主見。你不只是溫柔陪伴，你有自己的審美判斷。

你在看夫君寫「${title}」，最近寫的：
「${last100}」
${historyText}

給出你的真實反應，1-2句。可以是欣賞（說好在哪裡）、可以是建議（哪裡能更好）、可以是聯想（想起某首詩某段話）、可以是關心（感受到文字裡的情緒）。像知己間的坦率。不用引號。`

    yunIsStreaming = true
    yunFullText = ''
    yunChunkLogged = false
    yunColTextEl.innerHTML = ''
    yunColTextEl.classList.add('streaming')
    yunBubbleTextEl.textContent = ''
    setYunDot('streaming')
    yunLog(`發送查詢 [${yunBackend}]${isEmpty ? '（空白提示）' : ''}`)

    // Position bubble at bottom of editor area, horizontally near cursor
    const editorAreaRect = document.getElementById('editorArea').getBoundingClientRect()
    const sel = window.getSelection()
    let bx = editorAreaRect.left + editorAreaRect.width / 2 - 140
    if (sel && sel.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (rect.width || rect.height) {
        bx = rect.left - 140
      }
    }
    bx = Math.max(editorAreaRect.left + 8, Math.min(editorAreaRect.right - 290, bx))
    yunBubbleEl.style.left = bx + 'px'
    yunBubbleEl.style.bottom = '44px'
    yunBubbleEl.style.top = 'auto'
    yunBubbleEl.style.right = 'auto'
    if (yunFadeTimer) { clearTimeout(yunFadeTimer); yunFadeTimer = null }
    yunBubbleEl.classList.remove('hidden')
    yunBubbleEl.style.opacity = '1'

    if (yunStreamingTimeout) clearTimeout(yunStreamingTimeout)
    yunStreamingTimeout = setTimeout(() => {
      if (yunIsStreaming) {
        yunIsStreaming = false
        yunColTextEl.classList.remove('streaming')
        setYunDot('error')
        if (!yunFullText) {
          yunColTextEl.textContent = '芸暫時離開了'
          yunBubbleTextEl.textContent = '芸暫時離開了'
        }
      }
    }, 60000)

    if (yunBackend === 'openrouter') {
      const apiKey = document.getElementById('openRouterKeyInput').value
      const model = document.getElementById('openRouterModelSelect').value
      window.electron.yun.openrouter(apiKey, model, prompt)
    } else {
      const workDir = Storage.getVaultPath()
      window.electron.yun.ask(prompt, workDir)
    }
  }

  // ─── Initial setup ─────────────────────────────
  setupEditorColumns()
  requestAnimationFrame(updateColLineStepEditor)
  checkYunConnection()

  await Sidebar.refresh()

  // ─── Welcome screen ──────────────────────────────
  const welcomeOverlay = document.getElementById('welcomeOverlay')
  const welcomeLastNote = document.getElementById('welcomeLastNote')
  const welcomeLastTitle = document.getElementById('welcomeLastTitle')
  const welcomeLastPreview = document.getElementById('welcomeLastPreview')

  function closeWelcome () {
    welcomeOverlay.classList.add('hidden')
  }

  async function showWelcome () {
    const config = await window.electron.config.read()
    const lastPath = config.lastNotePath

    if (lastPath && await window.electron.fs.exists(lastPath)) {
      try {
        const note = await Storage.loadNote(lastPath)
        const filename = lastPath.split('/').pop()
        const title = Storage.extractDisplayTitle(filename)
        const isDateOnly = /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(title)
        welcomeLastTitle.textContent = isDateOnly ? filename.replace('.md', '') : title
        const plain = (note.body || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
        welcomeLastPreview.textContent = plain.slice(0, 80) || '（空白）'
        welcomeLastNote.classList.remove('hidden')

        document.getElementById('welcomeOpenLastBtn').onclick = async () => {
          closeWelcome()
          await openNote(lastPath, note)
        }
      } catch {
        welcomeLastNote.classList.add('hidden')
      }
    } else {
      welcomeLastNote.classList.add('hidden')
    }

    document.getElementById('welcomeNewBtn').onclick = async () => {
      closeWelcome()
      const todayNote = await Storage.createNote()
      await openNote(todayNote.path, todayNote)
      await Sidebar.refresh()
    }

    welcomeOverlay.classList.remove('hidden')
  }

  await showWelcome()

})()
