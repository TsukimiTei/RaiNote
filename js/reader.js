/* ═══════════════════════════════════════════════════════
   reader.js — 阅读模式
   竖排分页 · 3D翻页动画 · 单页/双页切换
   ═══════════════════════════════════════════════════════ */

const Reader = (() => {
  const book      = document.getElementById('readerBook')
  const navNext   = document.getElementById('navNext')
  const navPrev   = document.getElementById('navPrev')
  const pageNum   = document.getElementById('pageNum')
  const pageTot   = document.getElementById('pageTot')
  const presets   = document.querySelectorAll('.font-preset')

  let pages       = []      // Array of HTML strings (one per page)
  let currentPage = 0       // Index of the currently visible right page (or single page)
  let isDouble    = false   // Single / double page mode
  let fontSize    = 18      // px
  let isFlipping  = false

  // ─── Init ─────────────────────────────────────────

  function init () {
    navNext.addEventListener('click', () => turnPage('forward'))
    navPrev.addEventListener('click', () => turnPage('backward'))

    presets.forEach(btn => {
      btn.addEventListener('click', () => {
        presets.forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        fontSize = parseInt(btn.dataset.size, 10)
        book.dataset.fontsize = fontSize
        // Re-paginate with new font size
        if (pages.length) {
          const rawBody = book.dataset.rawBody || ''
          paginate(rawBody)
        }
      })
    })

    // Keyboard navigation
    document.addEventListener('keydown', e => {
      if (document.getElementById('readerArea').classList.contains('hidden')) return
      if (e.key === 'ArrowLeft')  turnPage('forward')
      if (e.key === 'ArrowRight') turnPage('backward')
    })

    // Annotation hover in reader
    book.addEventListener('mouseover', onAnnotationHover)
    book.addEventListener('mouseout',  onAnnotationOut)
  }

  // ─── Paginate content ─────────────────────────────
  // Strategy: render into a hidden "ruler" div with same dimensions,
  // then split text at overflow boundaries.

  function paginate (rawBody) {
    book.dataset.rawBody = rawBody
    const html = Markdown.render(rawBody)

    // Measure page dimensions
    const { pageW, pageH } = getPageDimensions()

    // Split rendered HTML into pages
    pages = splitIntoPages(html, pageW, pageH)
    currentPage = 0

    updateDisplay()
  }

  function getPageDimensions () {
    const wrap = document.querySelector('.reader-wrap')
    const wW   = wrap.clientWidth  - 160  // subtract nav button space
    const wH   = wrap.clientHeight - 80

    if (isDouble) {
      return {
        pageW: Math.min(Math.floor(wW / 2), 520),
        pageH: Math.min(wH, 720)
      }
    }
    return {
      pageW: Math.min(wW, 520),
      pageH: Math.min(wH, 720)
    }
  }

  // Measure how many characters fit in one page
  function splitIntoPages (html, pageW, pageH) {
    // Create ruler
    const ruler = createRuler(pageW, pageH)
    document.body.appendChild(ruler)

    const chunks = []
    // We'll work with the raw lines from the HTML to avoid partial-tag splits
    const lines  = html.split('<br>')
    let current  = ''

    for (const line of lines) {
      const test = current ? current + '<br>' + line : line
      ruler.innerHTML = test

      if (ruler.scrollHeight > ruler.clientHeight && current) {
        // Current line causes overflow — start new page
        chunks.push(current)
        current = line
      } else {
        current = test
      }
    }
    if (current) chunks.push(current)

    document.body.removeChild(ruler)
    return chunks.length ? chunks : ['']
  }

  function createRuler (pageW, pageH) {
    const div = document.createElement('div')
    div.style.cssText = `
      position: absolute;
      visibility: hidden;
      pointer-events: none;
      top: -9999px;
      left: -9999px;
      width: ${pageW}px;
      height: ${pageH}px;
      overflow: hidden;
      writing-mode: vertical-rl;
      direction: rtl;
      font-family: ${getFontFamily()};
      font-size: ${fontSize}px;
      line-height: 2.0;
      letter-spacing: 0.06em;
      padding: 44px 48px;
      box-sizing: border-box;
    `
    return div
  }

  function getFontFamily () {
    return document.body.classList.contains('font-songti')
      ? 'STSong, Songti SC, SimSun, serif'
      : 'STKaiti, KaiTi SC, BiauKai, KaiTi, serif'
  }

  // ─── Display ──────────────────────────────────────

  function updateDisplay () {
    renderPages()
    updateNavButtons()
  }

  function renderPages () {
    book.innerHTML = ''

    if (isDouble) {
      // Right page = current (earlier content)
      // Left page  = next   (later content)
      const rightContent = pages[currentPage]     || ''
      const leftContent  = pages[currentPage + 1] || ''

      const right = makePage('r-page r-page-right', rightContent)
      const left  = makePage('r-page r-page-left',  leftContent)

      book.appendChild(right)
      book.appendChild(left)
    } else {
      const content = pages[currentPage] || ''
      const page = makePage('r-page', content)
      book.appendChild(page)
    }
  }

  function makePage (cls, html) {
    const div = document.createElement('div')
    div.className = cls
    div.innerHTML = html
    div.style.fontSize = fontSize + 'px'
    return div
  }

  // ─── 3D Page Turn ─────────────────────────────────

  function turnPage (direction) {
    if (isFlipping) return

    if (direction === 'forward') {
      const next = isDouble ? currentPage + 2 : currentPage + 1
      if (next > pages.length - 1) return
      animateFlip('forward', next)
    } else {
      const prev = isDouble ? currentPage - 2 : currentPage - 1
      if (prev < 0) return
      animateFlip('backward', prev)
    }
  }

  function animateFlip (direction, destPage) {
    isFlipping = true

    // Capture content of the page that will visually flip
    const flippingContent = direction === 'forward'
      ? (pages[currentPage] || '')          // right page flips forward
      : (pages[destPage] || '')             // dest page flips back in

    // Pre-render destination pages underneath so they're visible as the flip reveals
    const savedPage = currentPage
    currentPage = destPage
    renderPages()
    currentPage = savedPage  // restore for wrapper creation

    // ── Build flip wrapper ──
    const wrapper = document.createElement('div')
    wrapper.className = 'flip-wrapper'

    const front = document.createElement('div')
    front.className = 'flip-front'
    front.style.fontSize = fontSize + 'px'
    front.innerHTML = flippingContent

    const back = document.createElement('div')
    back.className = 'flip-back'

    wrapper.appendChild(front)
    wrapper.appendChild(back)

    if (direction === 'forward') {
      wrapper.style.transformOrigin = 'left center'
      if (isDouble) wrapper.style.left = '50%'
    } else {
      wrapper.style.transformOrigin = 'right center'
      // Start pre-rotated so page appears to come in from the left
      wrapper.style.transform = 'rotateY(-180deg)'
    }

    book.appendChild(wrapper)

    // Trigger animation on next frame (ensures initial transform is applied)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrapper.classList.add(
          direction === 'forward' ? 'flipping-forward' : 'flipping-backward'
        )
      })
    })

    wrapper.addEventListener('animationend', () => {
      book.removeChild(wrapper)
      currentPage = destPage
      isFlipping = false
      updateNavButtons()
    }, { once: true })
  }

  function updateNavButtons () {
    const total = pages.length
    pageNum.textContent = currentPage + 1
    pageTot.textContent = total
    navPrev.disabled = currentPage <= 0
    navNext.disabled = isDouble
      ? currentPage + 1 >= total - 1
      : currentPage >= total - 1
  }

  // ─── Single / Double page toggle ──────────────────

  function setLayout (double) {
    isDouble = double
    book.className = 'reader-book ' + (double ? 'double-page' : 'single-page')
    document.getElementById('layoutToggle').textContent = double ? '雙頁' : '單頁'

    // Re-paginate for new layout
    const rawBody = book.dataset.rawBody || ''
    if (rawBody) paginate(rawBody)
  }

  function toggleLayout () {
    setLayout(!isDouble)
  }

  function isDoubleLayout () { return isDouble }

  // ─── Annotation hover (in reader) ─────────────────

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
