// The doc popup renders the markdown body via the small, safe
// parser in `markdown.ts`. The parser is the single place that
// escapes user content — bugs here would let XSS slip into the
// popup. These tests cover the headline renderings plus a few
// hostile inputs.
import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { renderMarkdown } from './markdown.ts'

test('renders headings at the requested level', () => {
  const html = renderMarkdown('# Title\n\n## Subtitle\n\n### Tiny')
  ok(html.includes('<h1>Title</h1>'))
  ok(html.includes('<h2>Subtitle</h2>'))
  ok(html.includes('<h3>Tiny</h3>'))
})

test('renders paragraphs', () => {
  const html = renderMarkdown('First paragraph.\n\nSecond paragraph.')
  ok(html.includes('<p>First paragraph.</p>'))
  ok(html.includes('<p>Second paragraph.</p>'))
})

test('renders inline code, bold and italic', () => {
  const html = renderMarkdown('with `inline` and **bold** and *italic*.')
  ok(html.includes('<code>inline</code>'))
  ok(html.includes('<strong>bold</strong>'))
  ok(html.includes('<em>italic</em>'))
})

test('renders fenced code blocks', () => {
  const html = renderMarkdown('```bash\ndocker compose up\n```')
  ok(html.includes('<pre>'))
  ok(html.includes('<code class="lang-bash">docker compose up'))
})

test('treats fenced ```svg blocks as diagrams, not as code', () => {
  // The svg fence is a doc-only extension: its body is rendered
  // as a real <svg> wrapped in the doc-svg container, NOT as a
  // <pre><code> block. This lets the docs embed schematic
  // mockups of report sections.
  const html = renderMarkdown('```svg\n<svg viewBox="0 0 10 10"><rect/></svg>\n```')
  ok(html.includes('<div class="doc-svg">'))
  ok(html.includes('<svg viewBox="0 0 10 10">'))
  ok(!html.includes('<pre>'), 'svg fence must not produce a <pre>')
  ok(!html.includes('&lt;svg'), 'svg fence body must NOT be HTML-escaped')
})

test('renders lists with one level of nesting', () => {
  const html = renderMarkdown('- one\n- two\n- three')
  ok(html.includes('<ul>'))
  ok(html.includes('<li>one</li>'))
  ok(html.includes('<li>three</li>'))
})

test('renders blockquotes', () => {
  const html = renderMarkdown('> a quoted note')
  ok(html.includes('<blockquote>a quoted note</blockquote>'))
})

test('renders links with target=_blank and rel=noopener', () => {
  const html = renderMarkdown('Open [Swagger](https://swagger.io).')
  ok(html.includes('<a href="https://swagger.io" target="_blank" rel="noreferrer">Swagger</a>'))
})

test('escapes malicious HTML in source content', () => {
  const html = renderMarkdown('Hello <script>alert(1)</script>!')
  ok(!html.includes('<script>'), 'raw <script> tags must not survive')
  ok(html.includes('&lt;script&gt;'))
})

test('escapes attribute-breaking characters in headings', () => {
  const html = renderMarkdown('# Title "with quotes" & ampersand')
  ok(html.includes('Title &quot;with quotes&quot; &amp; ampersand'))
})

test('renders an empty string without crashing', () => {
  equal(renderMarkdown(''), '')
})

test('renders inline <svg> blocks verbatim and wraps them in a doc-svg container', () => {
  const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
  const html = renderMarkdown(`Diagram: ${svg} done.`)
  ok(html.includes('<div class="doc-svg">'), 'inline SVG must be wrapped in a doc-svg container')
  ok(html.includes(svg), 'inline SVG markup must survive verbatim')
  // The surrounding text still goes through the normal pipeline
  // — leading "Diagram:" appears in a <p> above the SVG.
  ok(html.includes('<p>Diagram:'), 'text before the SVG must still be in a paragraph')
  ok(html.includes(' done.</p>'), 'text after the SVG must close the paragraph')
})

test('preserves < and & inside SVG path data', () => {
  // Path data can contain text and attribute values; the escape
  // pass must NOT corrupt them, otherwise the SVG renders wrong
  // shapes or fails to mount entirely.
  const html = renderMarkdown(
    '<svg viewBox="0 0 10 10"><text x="1" y="2">a &amp; b &lt; c</text></svg>',
  )
  ok(html.includes('a &amp; b &lt; c'), 'verbatim `&amp;` / `&lt;` inside SVG must survive')
})

test('renders block-level SVG as its own block, not wrapped in <p>', () => {
  // A line that opens with `<svg` starts a block that runs until
  // the closing tag; the surrounding paragraph collector must
  // not wrap it. Invalid `<p><div></p>` nesting would otherwise
  // appear in the output.
  const svg = [
    '<svg viewBox="0 0 10 10">',
    '  <rect width="10" height="10" fill="red"/>',
    '</svg>',
  ].join('\n')
  const html = renderMarkdown(svg)
  ok(html.includes('<div class="doc-svg">'))
  ok(html.includes('<rect width="10" height="10" fill="red"/>'))
  ok(!html.includes('<p><div class="doc-svg">'), 'block SVG must not be wrapped in <p>')
})

test('keeps surrounding paragraphs intact when an SVG block sits between them', () => {
  const html = renderMarkdown(
    'Before the diagram.\n\n<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n\nAfter the diagram.',
  )
  ok(html.includes('<p>Before the diagram.</p>'))
  ok(html.includes('<div class="doc-svg">'))
  ok(html.includes('<p>After the diagram.</p>'))
})

test('inline SVG inside a paragraph still escapes other HTML around it', () => {
  // The placeholder dance isolates SVG escaping; the surrounding
  // text must still go through the normal escape pipeline. A
  // stray <script> outside the SVG must NOT survive.
  const html = renderMarkdown(
    'safe text <svg viewBox="0 0 1 1"><rect/></svg> <script>alert(1)</script> end',
  )
  ok(html.includes('<div class="doc-svg">'))
  ok(!html.includes('<script>'), '<script> outside the SVG must still be escaped')
  ok(html.includes('&lt;script&gt;'))
})
