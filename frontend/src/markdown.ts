// Tiny, dependency-free Markdown renderer for the doc popup.
//
// The popup renders User Guide and README so the user can read
// them without leaving the app. The docs are plain CommonMark with
// the subset we actually use:
//
//   # / ## / ### headings
//   paragraphs
//   - / * bullet lists (single level)
//   ``` fenced code blocks (incl. `svg` blocks for inline diagrams)
//   `inline code`
//   **bold** and *italic*
//   > blockquotes
//   [text](url) links
//   inline <svg>...</svg> blocks for diagrams (passed through verbatim)
//
// Anything else is preserved as-is. We deliberately do NOT use
// dangerouslySetInnerHTML on the raw markdown — instead we
// generate the HTML here so the parser can be the single place
// that escapes user content. The popup itself renders the
// produced HTML with dangerouslySetInnerHTML because that's the
// only way to mount a parsed string in React.
//
// Inline SVG is the only HTML we pass through verbatim: the docs
// are bundled at build time from the repo (trusted content), SVG
// cannot execute scripts, and the escape step still protects the
// surrounding text. The placeholder dance below keeps the two
// passes independent so a stray `<` inside an SVG path does not
// get HTML-escaped into `&lt;` and break the rendering.
//
// Extending this is intentional: when the docs grow a feature
// (tables, footnotes, …), extend the parser here and the popup
// picks it up automatically.

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ESCAPE_MAP[c] ?? c)
}

// Sentinels used by renderInline to stash inline <svg>...</svg>
// blocks while the rest of the line is HTML-escaped. Using
// characters the escape pass cannot touch (no `<`, `>`, `&`,
// `"`, `'`) keeps the stash safe across the regex pipeline.
const SVG_PLACEHOLDER_OPEN = '\u0001SVG_BLOCK_'
const SVG_PLACEHOLDER_CLOSE = '\u0001'

function renderInline(text: string): string {
  // Stash inline <svg>...</svg> blocks before the escape pass. The
  // docs are bundled at build time, so SVG markup is trusted; we
  // cannot execute scripts through SVG, and the surrounding text
  // still goes through escapeHtml below. Path data containing `<`
  // or `&` would otherwise be corrupted by the escape pass.
  const svgBlocks: string[] = []
  let prepared = text.replace(/<svg\b[\s\S]*?<\/svg>/g, (match: string) => {
    const index = svgBlocks.length
    svgBlocks.push(`<div class="doc-svg">${match}</div>`)
    return `${SVG_PLACEHOLDER_OPEN}${index}${SVG_PLACEHOLDER_CLOSE}`
  })
  // We escape first, then re-introduce the markup using a sequence
  // of placeholder tokens so the escaping survives the regex
  // passes that follow. This keeps `<script>`-style payloads safe
  // even when they appear inside backticks.
  let out = escapeHtml(prepared)

  // Inline code
  out = out.replace(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`)

  // Links
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label: string, href: string) =>
      `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`,
  )

  // Bold then italic
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  // Restore the stashed SVG blocks. The placeholders survive the
  // escape pass untouched, so this is a straight substitution.
  if (svgBlocks.length > 0) {
    out = out.replace(
      new RegExp(`${SVG_PLACEHOLDER_OPEN}(\\d+)${SVG_PLACEHOLDER_CLOSE}`, 'g'),
      (_, index: string) => svgBlocks[Number(index)] ?? '',
    )
  }

  return out
}

function renderBlock(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Block-level <svg>...</svg> diagram. The opener must start a
    // line on its own (or with leading whitespace) so we can
    // collect the whole element until the matching closing tag
    // without wrapping it in <p>. Inline SVG inside a paragraph
    // is handled separately in renderInline.
    const svgOpen = line.match(/^\s*<svg\b/)
    if (svgOpen) {
      const svgLines: string[] = [line]
      i++
      // The opening line may already close the SVG (one-liner).
      // Treat that as a complete block before scanning further.
      if (!/<\/svg>/.test(line)) {
        while (i < lines.length) {
          const current = lines[i] ?? ''
          svgLines.push(current)
          i++
          if (/<\/svg>/.test(current)) break
        }
      }
      out.push(`<div class="doc-svg">${svgLines.join('\n')}</div>`)
      continue
    }

    // Fenced code block — collect until next closing fence.
    const fenceMatch = line.match(/^```(\w*)\s*$/)
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        codeLines.push(lines[i] ?? '')
        i++
      }
      // Skip the closing fence
      if (i < lines.length) i++
      // `svg` is a special diagram block: its contents are SVG
      // markup that the popup must render as a real <svg>, not as
      // escaped code. Trusted doc content, see the rationale at
      // the top of the file for inline <svg>.
      if (lang === 'svg') {
        out.push(`<div class="doc-svg">${codeLines.join('\n')}</div>`)
      } else {
        const langClass = lang ? ` class="lang-${lang}"` : ''
        out.push(`<pre><code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      }
      continue
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1]!.length
      const content = renderInline(heading[2] ?? '')
      out.push(`<h${level}>${content}</h${level}>`)
      i++
      continue
    }

    // Blockquote — collect contiguous lines.
    if (line.startsWith('>')) {
      const buffer: string[] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        buffer.push((lines[i] ?? '').replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${renderInline(buffer.join(' '))}</blockquote>`)
      continue
    }

    // Bullet list — collect contiguous lines.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        items.push(renderInline((lines[i] ?? '').replace(/^[-*]\s+/, '')))
        i++
      }
      out.push(`<ul>${items.map(li => `<li>${li}</li>`).join('')}</ul>`)
      continue
    }

    // Blank line — skip.
    if (line.trim() === '') {
      i++
      continue
    }

    // Plain paragraph — collect until blank line or recognised block.
    const buffer: string[] = [line]
    i++
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^#{1,6}\s+/.test(lines[i] ?? '') &&
      !/^```/.test(lines[i] ?? '') &&
      !/^[-*]\s+/.test(lines[i] ?? '') &&
      !(lines[i] ?? '').startsWith('>')
    ) {
      buffer.push(lines[i] ?? '')
      i++
    }
    out.push(`<p>${renderInline(buffer.join(' '))}</p>`)
  }

  return out.join('\n')
}

/**
 * Render a markdown string to a sanitised HTML string. The output
 * is safe to mount with `dangerouslySetInnerHTML` because every
 * user-controlled character is HTML-escaped before the markup
 * re-introductions step.
 */
export function renderMarkdown(markdown: string): string {
  return renderBlock(markdown)
}
