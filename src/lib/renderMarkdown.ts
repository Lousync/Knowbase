import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: true,        // Allow inline HTML
  linkify: true,     // Auto-link URLs
  typographer: true, // Smart quotes, dashes, ellipses
  breaks: true,      // Convert \n to <br>
})

/**
 * Render Markdown string to HTML.
 * Uses markdown-it (same engine as VS Code's built-in markdown preview).
 */
export function renderMarkdown(content: string): string {
  if (!content) return '<p></p>'
  return md.render(content)
}
