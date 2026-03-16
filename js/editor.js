/* ═══════════════════════════════════════════════════════
   editor.js — 竖排编辑器
   contenteditable + writing-mode:vertical-rl
   自动保存 / 字数统计 / 写作时间 / 图片标注
   ═══════════════════════════════════════════════════════ */

const Editor = (() => {
  const el = document.getElementById('editor')

  let currentPath    = null
  let currentMeta    = {}
  let saveTimer      = null
  let writeTimer     = null
  let writeSeconds   = 0
  let isFocused      = false
  let isDirty        = false
  let onSaveCallback = null
  let onChangeCallback = null

  // ─── Init ─────────────────────────────────────────

  function init ({ onSave, onChange } = {}) {
    onSaveCallback  = onSave
    onChangeCallback = onChange

    el.addEventListener('input', onInput)
    el.addEventListener('focus', onFocus)
    el.addEventListener('blur', onBlur)
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('keyup', onMouseUp) // also track keyboard selection
    el.addEventListener('paste', onPaste)

    // Annotation hover
    el.addEventListener('mouseover', onAnnotationHover)
    el.addEventListener('mouseout',  onAnnotationOut)
  }

  // ─── Load note into editor ─────────────────────────

  function load (note) {
    currentPath = note.path
    currentMeta = note.meta || {}
    writeSeconds = (currentMeta.writeMinutes || 0) * 60

    // Display raw text (not rendered HTML) in the editor
    // This preserves the annotation syntax ::annotate[...]:: visually
    el.textContent = note.body || ''

    updateWordCount()
    updateWriteTime()

    // writing-mode: vertical-rl without direction:rtl — columns flow right to left.
    // scrollLeft=0 naturally shows the rightmost column (document start).
    // The browser will follow the cursor during typing automatically.
    requestAnimationFrame(() => {
      el.parentElement.scrollLeft = 0
    })
  }

  function getBody () {
    return el.textContent || ''
  }

  // ─── Auto-save (debounced 1.5s) ───────────────────

  function onInput () {
    isDirty = true
    updateWordCount()
    if (onChangeCallback) onChangeCallback(getBody())

    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(doSave, 1500)

    setSaveStatus('saving')
  }

  async function doSave () {
    if (!currentPath || !isDirty) return
    try {
      const body = getBody()
      const meta = await Storage.saveNote(currentPath, body, {
        writeMinutes: Math.round(writeSeconds / 60)
      })
      currentMeta = meta
      isDirty = false
      setSaveStatus('saved')
      if (onSaveCallback) onSaveCallback(meta)
    } catch (err) {
      setSaveStatus('error')
      console.error('Save failed:', err)
    }
  }

  // Force immediate save
  async function save () {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    await doSave()
  }

  // ─── Writing timer ────────────────────────────────

  function onFocus () {
    isFocused = true
    if (!writeTimer) {
      writeTimer = setInterval(() => {
        if (isFocused) {
          writeSeconds++
          updateWriteTime()
        }
      }, 1000)
    }
  }

  function onBlur () {
    isFocused = false
  }

  // ─── Word count + write time display ─────────────

  function updateWordCount () {
    const count = Storage.countWords(getBody())
    document.getElementById('wordCountPill').textContent = `${count}字`
  }

  function updateWriteTime () {
    const mins = Math.round(writeSeconds / 60)
    document.getElementById('writeTimePill').textContent = mins < 60
      ? `${mins}分`
      : `${Math.floor(mins / 60)}时${mins % 60}分`
  }

  function setSaveStatus (state) {
    const el = document.getElementById('saveStatus')
    el.className = 'save-status ' + state
    if (state === 'saving') el.textContent = '储存中…'
    else if (state === 'saved') el.textContent = '已储存'
    else if (state === 'error') el.textContent = '储存失败'
  }

  // ─── Paste handling (plain text only) ────────────

  function onPaste (e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  // ─── Text selection → annotation toolbar ─────────

  function onMouseUp () {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hideAnnotationToolbar()
      return
    }
    const selectedText = sel.toString().trim()
    if (!selectedText) {
      hideAnnotationToolbar()
      return
    }

    // Show annotation toolbar near selection
    const range = sel.getRangeAt(0)
    const rect  = range.getBoundingClientRect()

    const toolbar = document.getElementById('annotationToolbar')
    toolbar.classList.remove('hidden')
    toolbar.style.left = `${rect.left + rect.width / 2 - toolbar.offsetWidth / 2}px`
    toolbar.style.top  = `${rect.top - 44}px`

    // Store selected text for the annotation button
    toolbar.dataset.selectedText = selectedText
  }

  function hideAnnotationToolbar () {
    document.getElementById('annotationToolbar').classList.add('hidden')
  }

  // ─── Annotation hover (image preview) ────────────

  function onAnnotationHover (e) {
    const span = e.target.closest('.annotated-text')
    if (!span) return

    const images = JSON.parse(decodeURIComponent(span.dataset.images || '[]'))
    if (!images.length) return

    showAnnotationPreview(span, images)
  }

  function onAnnotationOut (e) {
    const span = e.target.closest('.annotated-text')
    if (!span) return

    // Small delay so preview doesn't flicker
    setTimeout(() => {
      const preview = document.getElementById('annotationPreview')
      if (!preview.matches(':hover')) {
        preview.classList.add('hidden')
      }
    }, 100)
  }

  function showAnnotationPreview (spanEl, images) {
    const preview  = document.getElementById('annotationPreview')
    const gallery  = document.getElementById('annotationGallery')
    gallery.innerHTML = ''

    images.forEach(src => {
      const img = document.createElement('img')
      img.src = src.startsWith('/') || src.startsWith('file://') ? src : src
      img.onerror = () => { img.style.display = 'none' }
      img.onclick = () => window.open(src)
      gallery.appendChild(img)
    })

    const rect = spanEl.getBoundingClientRect()
    preview.classList.remove('hidden')
    preview.style.left = `${rect.right + 12}px`
    preview.style.top  = `${rect.top}px`
  }

  // ─── Insert annotation into editor ───────────────

  async function insertAnnotation (selectedText, imagePaths) {
    const syntax = Markdown.buildAnnotation(selectedText, imagePaths)
    // Replace selected text with annotation syntax
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(document.createTextNode(syntax))
      sel.removeAllRanges()
    }
    hideAnnotationToolbar()
    // Trigger save
    onInput()
  }

  // ─── Delete annotation from text ─────────────────

  function unwrapAnnotation (spanEl) {
    const text = spanEl.textContent
    const textNode = document.createTextNode(text)
    spanEl.parentNode.replaceChild(textNode, spanEl)
    onInput()
  }

  // ─── Render annotated spans in editor ────────────
  // Called after load to highlight existing annotations visually
  // We do a simple highlight by scanning textContent with regex

  function refreshAnnotationHighlights () {
    // This is a best-effort visual enhancement.
    // Since the editor shows raw text, we just let the ::annotate[...]:: syntax
    // be visible as plain text. Full rendering happens in reading mode.
    // Future improvement: use Shadow DOM or overlay for rich annotation display.
  }

  return {
    init, load, save, getBody,
    insertAnnotation, hideAnnotationToolbar,
    updateWordCount
  }
})()
