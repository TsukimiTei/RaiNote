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

  // Annotation syntax regex
  const ANNOTATE_RE = /::annotate\[([^\]]+)\]\{images=\[([^\]]*)\]\}::/g

  // ─── Init ─────────────────────────────────────────

  function init ({ onSave, onChange } = {}) {
    onSaveCallback  = onSave
    onChangeCallback = onChange

    el.addEventListener('input', onInput)
    el.addEventListener('focus', onFocus)
    el.addEventListener('blur', onBlur)
    el.addEventListener('keydown', onKeyDown)
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

    const body = note.body || ''
    if (body === '') {
      // Chromium bug: empty contenteditable + writing-mode:vertical-rl 时
      // caret 忽略 padding-right，落在元素右边缘（0px）而非内容区（52px）。
      // 注入零宽空格让 caret 锚定到正确的 block-start 位置。
      el.innerHTML = '\u200B'
    } else {
      // Parse annotations into styled spans; plain text is escaped
      el.innerHTML = bodyToHtml(body)
    }

    updateWordCount()
    updateWriteTime()

    // writing-mode: vertical-rl — scrollLeft=0 shows rightmost column (doc start)
    requestAnimationFrame(() => {
      el.parentElement.scrollLeft = 0
    })
  }

  // ─── Body ↔ HTML conversion ────────────────────────

  // Convert raw body text → innerHTML with annotation spans
  function bodyToHtml (body) {
    ANNOTATE_RE.lastIndex = 0
    let html = ''
    let lastIdx = 0
    let m

    while ((m = ANNOTATE_RE.exec(body)) !== null) {
      // Text before annotation
      html += Markdown.escapeHtml(body.slice(lastIdx, m.index))
      // Annotation span — editable so cursor can navigate freely
      const text = m[1]
      const images = m[2].split(',').map(s => s.trim()).filter(Boolean)
      const data = encodeURIComponent(JSON.stringify(images))
      html += `<span class="annotated-text" data-images="${data}">${Markdown.escapeHtml(text)}</span>\u200B`
      lastIdx = m.index + m[0].length
    }

    html += Markdown.escapeHtml(body.slice(lastIdx))
    return html || '\u200B'
  }

  // Walk DOM → raw text with annotation syntax restored
  function domToText (node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (node.nodeName === 'BR') return '\n'

    // Annotation span → ::annotate[text]{images=[...]}::
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('annotated-text')) {
      const images = JSON.parse(decodeURIComponent(node.dataset.images || '[]'))
      return `::annotate[${node.textContent}]{images=[${images.join(', ')}]}::`
    }

    let text = ''
    for (const child of node.childNodes) {
      text += domToText(child)
    }

    // Chromium wraps Enter in <div>; treat as paragraph break.
    // Only add newline if there's a preceding sibling that isn't
    // purely whitespace (avoids spurious leading newline when first
    // child is already a <div>).
    if (node !== el && node.nodeType === Node.ELEMENT_NODE &&
        (node.nodeName === 'DIV' || node.nodeName === 'P') && node.previousSibling) {
      const prev = node.previousSibling
      const prevEmpty = prev.nodeType === Node.TEXT_NODE && !prev.textContent.replace(/\u200B/g, '').trim()
      if (!prevEmpty) text = '\n' + text
    }

    return text
  }

  function getBody () {
    return domToText(el).replace(/\u200B/g, '')
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

  // ─── Word count + write time (internal state) ────

  function updateWordCount () {
    // No DOM update — values stored as module state
  }

  function getWordCount () {
    return Storage.countWords(getBody())
  }

  function getWriteMinutes () {
    return Math.round(writeSeconds / 60)
  }

  function setSaveStatus (state) {
    const el = document.getElementById('saveStatus')
    el.className = 'save-status ' + state
    if (state === 'saving') el.textContent = '储存中…'
    else if (state === 'saved') el.textContent = '已储存'
    else if (state === 'error') el.textContent = '储存失败'
  }

  // ─── Keyboard shortcuts ───────────────────────────

  function onKeyDown (e) {
    // Tab → 首行缩进两个全角空格（等同于两个汉字宽度）
    if (e.key === 'Tab') {
      e.preventDefault()
      document.execCommand('insertText', false, '\u3000\u3000')
      return
    }

    // Cmd+Up → 列首（vertical-rl: physical top = inline-start）
    // Cmd+Down → 列尾（vertical-rl: physical bottom = inline-end）
    if (e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount) return

      const range = sel.getRangeAt(0)
      const node = sel.focusNode
      if (!node) return

      // Find the text node or element we're in
      const textNode = node.nodeType === 3 ? node : node.firstChild || node

      if (e.key === 'ArrowUp') {
        // Move to start of current text node / line
        range.setStart(textNode, 0)
        range.collapse(true)
      } else {
        // Move to end of current text node / line
        const len = textNode.nodeType === 3 ? textNode.length : 0
        range.setStart(textNode, len)
        range.collapse(true)
      }
      sel.removeAllRanges()
      sel.addRange(range)
    }
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

    // Position: prefer above selection, fall back to below if too close to top
    const toolbarH = toolbar.offsetHeight || 36
    const toolbarW = toolbar.offsetWidth || 100
    const gap = 8
    let top = rect.top - toolbarH - gap
    if (top < 40) {
      // Not enough room above (drag region + margin) → place below selection
      top = rect.bottom + gap
    }
    // Horizontal: center on selection, clamp to viewport
    let left = rect.left + rect.width / 2 - toolbarW / 2
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarW - 8))

    toolbar.style.left = `${left}px`
    toolbar.style.top  = `${top}px`

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
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return

    const range = sel.getRangeAt(0)
    range.deleteContents()

    // Create styled annotation span (editable so cursor can navigate)
    const span = document.createElement('span')
    span.className = 'annotated-text'
    span.dataset.images = encodeURIComponent(JSON.stringify(imagePaths))
    span.textContent = selectedText

    // Insert span + zero-width space after it for cursor landing
    const spacer = document.createTextNode('\u200B')
    range.insertNode(spacer)
    range.insertNode(span)

    // Move cursor after the spacer
    range.setStartAfter(spacer)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    hideAnnotationToolbar()
    onInput()
  }

  // ─── Delete annotation from text ─────────────────

  function unwrapAnnotation (spanEl) {
    const text = spanEl.textContent
    const textNode = document.createTextNode(text)
    spanEl.parentNode.replaceChild(textNode, spanEl)
    onInput()
  }

  return {
    init, load, save, getBody,
    insertAnnotation, hideAnnotationToolbar,
    getWordCount, getWriteMinutes
  }
})()
