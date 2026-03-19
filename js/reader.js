/* ═══════════════════════════════════════════════════════
   reader.js — 阅读模式 · 横向卷轴
   竖排文字在固定高度下自动产生新列，原生横向滚动。
   ═══════════════════════════════════════════════════════ */

const Reader = (() => {
  const wrap    = document.querySelector('.reader-wrap')
  const book    = document.getElementById('readerBook')
  const presets = document.querySelectorAll('.font-preset')

  let fontSize = 18
  let onFontSizeChange = null

  // ─── Init ─────────────────────────────────────────

  function init (opts = {}) {
    onFontSizeChange = opts.onFontSizeChange || null

    presets.forEach(btn => {
      btn.addEventListener('click', () => {
        presets.forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        fontSize = parseInt(btn.dataset.size, 10)
        book.dataset.fontsize = fontSize
        if (onFontSizeChange) onFontSizeChange(fontSize)
        // Re-render with new font size
        const rawBody = book.dataset.rawBody || ''
        if (rawBody) paginate(rawBody)
      })
    })

    // 垂直滚轮 → 横向滚动（Shift+scroll 和普通 scroll 均适用）
    wrap.addEventListener('wheel', (e) => {
      // 已有原生水平滚动意图时不干预
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      wrap.scrollBy({ left: -e.deltaY })
    }, { passive: false })

    // Annotation hover in reader
    book.addEventListener('mouseover', onAnnotationHover)
    book.addEventListener('mouseout',  onAnnotationOut)
  }

  // ─── Render content (横向卷轴 — 不分页) ──────────

  function paginate (rawBody) {
    book.dataset.rawBody = rawBody
    const html = Markdown.render(rawBody)

    book.innerHTML = ''
    const page = document.createElement('div')
    page.className = 'r-page'
    page.style.fontSize = fontSize + 'px'
    page.innerHTML = html
    book.appendChild(page)

    // Reset scroll to right edge (document start in vertical-rl)
    requestAnimationFrame(() => {
      wrap.scrollLeft = 0
    })
  }

  // ─── Layout (保留接口，卷轴模式下无实际差异) ──────

  function setLayout (_double) {
    book.className = 'reader-book'
  }

  function toggleLayout () {}

  function isDoubleLayout () { return false }

  // ─── Annotation hover ─────────────────────────────

  function onAnnotationHover (e) {
    const span = e.target.closest('.annotated-text')
    if (!span) return

    const images = JSON.parse(decodeURIComponent(span.dataset.images || '[]'))
    if (!images.length) return

    const preview  = document.getElementById('annotationPreview')
    const gallery  = document.getElementById('annotationGallery')
    gallery.innerHTML = ''

    images.forEach(src => {
      const img = document.createElement('img')
      img.src = src
      img.onerror = () => { img.style.display = 'none' }
      img.onclick = () => window.open(src)
      gallery.appendChild(img)
    })

    const rect = span.getBoundingClientRect()
    preview.classList.remove('hidden')
    preview.style.left = `${rect.right + 14}px`
    preview.style.top  = `${Math.min(rect.top, window.innerHeight - 200)}px`
    preview.style.pointerEvents = 'all'
  }

  function onAnnotationOut (e) {
    const span = e.target.closest('.annotated-text')
    if (!span) return
    setTimeout(() => {
      const preview = document.getElementById('annotationPreview')
      if (!preview.matches(':hover')) {
        preview.classList.add('hidden')
      }
    }, 120)
  }

  return {
    init, paginate, setLayout, toggleLayout, isDoubleLayout
  }
})()
