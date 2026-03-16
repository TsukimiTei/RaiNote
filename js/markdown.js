/* ═══════════════════════════════════════════════════════
   markdown.js — Markdown 解析器
   支持：标题 / 粗体 / 斜体 / 链接 / 图片 / 图片标注
   图片标注语法：::annotate[文字]{images=[img1.png, img2.png]}::
   ═══════════════════════════════════════════════════════ */

const Markdown = (() => {

  // ─── Annotation syntax ───────────────────────────
  // ::annotate[text]{images=[path1, path2]}::
  const ANNOTATE_RE = /::annotate\[([^\]]+)\]\{images=\[([^\]]*)\]\}::/g

  function parseAnnotations (text) {
    return text.replace(ANNOTATE_RE, (_, annotatedText, imagesStr) => {
      const images = imagesStr.split(',').map(s => s.trim()).filter(Boolean)
      const data = encodeURIComponent(JSON.stringify(images))
      // Escape the inner text before inserting into HTML
      const safe = escapeHtml(annotatedText)
      return `<span class="annotated-text" data-images="${data}">${safe}</span>`
    })
  }

  // ─── Build annotation syntax string ──────────────
  function buildAnnotation (text, imagePaths) {
    return `::annotate[${text}]{images=[${imagePaths.join(', ')}]}::`
  }

  // ─── Main renderer ───────────────────────────────
  function render (rawText) {
    if (!rawText) return ''

    // 1. Split into lines for block-level parsing
    const lines = rawText.split(/\r?\n/)
    const rendered = lines.map(line => renderLine(line))
    // Join with <br> — in vertical mode each line creates visual separation
    return rendered.join('<br>')
  }

  function renderLine (line) {
    // Headings
    if (line.startsWith('### ')) {
      return `<h3>${renderInline(line.slice(4))}</h3>`
    }
    if (line.startsWith('## ')) {
      return `<h2>${renderInline(line.slice(3))}</h2>`
    }
    if (line.startsWith('# ')) {
      return `<h1>${renderInline(line.slice(2))}</h1>`
    }
    // Empty line
    if (line.trim() === '') {
      return '<span class="para-break"> </span>'
    }
    return renderInline(line)
  }

  function renderInline (text) {
    // First handle annotations (before escaping)
    text = text.replace(ANNOTATE_RE, (_, annotatedText, imagesStr) => {
      const images = imagesStr.split(',').map(s => s.trim()).filter(Boolean)
      const data = encodeURIComponent(JSON.stringify(images))
      const safe = escapeHtml(annotatedText)
      return `\x00ANNOT:${data}:${safe}\x01`
    })

    // Escape remaining HTML chars
    text = escapeHtml(text)

    // Restore annotation placeholders
    text = text.replace(/\x00ANNOT:([^:]+):([^\x01]+)\x01/g, (_, data, safe) => {
      return `<span class="annotated-text" data-images="${data}">${safe}</span>`
    })

    // Images: ![alt](src)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      return `<img alt="${alt}" src="${src}" loading="lazy">`
    })

    // Links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, url) => {
      return `<a href="${url}" target="_blank">${t}</a>`
    })

    // Bold + italic: ***text***
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')

    // Bold: **text**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

    // Italic: *text*
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')

    return text
  }

  // ─── Utilities ───────────────────────────────────
  function escapeHtml (str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // Extract annotation spans from a DOM element
  function getAnnotationsInEl (el) {
    return Array.from(el.querySelectorAll('.annotated-text')).map(span => ({
      element: span,
      text: span.textContent,
      images: JSON.parse(decodeURIComponent(span.dataset.images || '[]'))
    }))
  }

  // Parse raw text to extract just the plain text (no annotation syntax)
  function stripAnnotations (text) {
    return text.replace(ANNOTATE_RE, '$1')
  }

  return {
    render, renderInline,
    buildAnnotation, parseAnnotations,
    getAnnotationsInEl, stripAnnotations,
    escapeHtml
  }
})()
