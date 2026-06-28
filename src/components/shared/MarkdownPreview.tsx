import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// Same ID generation as parseHeadings() in OutlinePanel — must match for outline navigation
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

interface Props {
  content: string
  /** Base directory for resolving relative image paths (e.g., data directory) */
  imageBaseDir?: string
  /** Called when a [[wiki link]] is clicked. */
  onWikiLink?: (title: string) => void
  /** Called when a standard markdown link [text](href) is clicked. */
  onLinkClick?: (href: string) => void
}

/** Convert markdown image src to file:// URL. webSecurity:false allows cross-origin file loads. */
function resolveImageSrc(src: string | undefined, imageBaseDir?: string): string {
  if (!src) return ''
  // External URLs and data URIs pass through
  if (/^https?:\/\//i.test(src) || /^data:/i.test(src) || /^file:\/\//i.test(src)) return src
  if (/^local-file:\/\//i.test(src)) return src
  // Absolute Windows path e.g. C:\Users\...
  if (/^[a-zA-Z]:[/\\]/.test(src)) {
    return 'file:///' + src.replace(/\\/g, '/')
  }
  // Relative path → resolve against imageBaseDir
  if (imageBaseDir && !src.startsWith('/')) {
    const cleaned = src.replace(/\\/g, '/').replace(/^\.\//, '')
    const base = imageBaseDir.replace(/\\/g, '/').replace(/\/$/, '')
    return 'file:///' + base + '/' + cleaned
  }
  return src
}

/** Unified markdown preview component. Links + images resolved for local filesystem. */
export function MarkdownPreview({ content, imageBaseDir, onWikiLink, onLinkClick }: Props) {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault()
    if (onLinkClick) {
      onLinkClick(href)
    } else {
      if (/^https?:\/\//i.test(href) || /^file:\/\//i.test(href)) {
        window.open(href, '_blank')
      } else {
        if (window.api) window.api.openExternal(href)
      }
    }
  }

  return (
    <div className="prose-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Override ul/ol to restore list-style killed by Tailwind reset
          ul({ children }) {
            return <ul className="list-disc pl-6 my-1.5">{children}</ul>
          },
          ol({ children }) {
            return <ol className="list-decimal pl-6 my-1.5">{children}</ol>
          },
          // Custom link handler — intercept all <a> clicks to avoid Electron navigation blocks
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                {...props}
                className="text-[var(--accent)] hover:underline cursor-pointer"
                onClick={e => href ? handleLinkClick(e, href) : undefined}
              >
                {children}
              </a>
            )
          },
          // Custom image handler — resolve local paths to local-file:// URLs
          img({ src, alt, ...props }) {
            const resolved = resolveImageSrc(src, imageBaseDir)
            console.log('[MarkdownPreview img] src:', src, '→ resolved:', resolved, 'baseDir:', imageBaseDir)
            return (
              <img
                src={resolved}
                alt={alt || ''}
                onError={(e) => console.error('[MarkdownPreview img] LOAD FAILED:', resolved, e)}
                onLoad={() => console.log('[MarkdownPreview img] LOAD OK:', resolved)}
                className="max-w-full h-auto rounded my-2"
                style={{ maxHeight: '500px', objectFit: 'contain' }}
              />
            )
          },
          code({ className, children, node, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const lang = match ? match[1] : ''
            const isBlock = node?.tagName === 'code' && className?.includes('language-')
            if (!isBlock) {
              return <code className={className} {...props}>{children}</code>
            }
            return (
              <div className="relative group">
                {lang && (
                  <span className="absolute top-1 right-2 text-[10px] text-[var(--text-muted)] opacity-40 select-none">
                    {lang}
                  </span>
                )}
                <code className={className} {...props}>{children}</code>
              </div>
            )
          },
          // Convert [[wiki links]] in paragraph text to clickable spans
          p({ children }) {
            return <p>{renderWikiLinks(children, onWikiLink)}</p>
          },
          // Also handle wiki links in list items, headings, etc.
          li({ children }) {
            return <li>{renderWikiLinks(children, onWikiLink)}</li>
          },
          h1({ children }) {
            const text = extractText(children)
            return <h1 id={headingId(text)}>{renderWikiLinks(children, onWikiLink)}</h1>
          },
          h2({ children }) {
            const text = extractText(children)
            return <h2 id={headingId(text)}>{renderWikiLinks(children, onWikiLink)}</h2>
          },
          h3({ children }) {
            const text = extractText(children)
            return <h3 id={headingId(text)}>{renderWikiLinks(children, onWikiLink)}</h3>
          },
          h4({ children }) {
            const text = extractText(children)
            return <h4 id={headingId(text)}>{renderWikiLinks(children, onWikiLink)}</h4>
          },
          h5({ children }) {
            const text = extractText(children)
            return <h5 id={headingId(text)}>{renderWikiLinks(children, onWikiLink)}</h5>
          },
          h6({ children }) {
            const text = extractText(children)
            return <h6 id={headingId(text)}>{renderWikiLinks(children, onWikiLink)}</h6>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

const WIKI_RE = /\[\[([^\]]+)\]\]/

/** Extract plain text from React children for heading ID generation */
function extractText(children: React.ReactNode): string {
  return React.Children.toArray(children).map(c => {
    if (typeof c === 'string') return c
    if (typeof c === 'number') return String(c)
    if (React.isValidElement(c)) return extractText((c.props as any)?.children)
    return ''
  }).join('')
}

/** Recursively scan React children for `[[wiki links]]` in text nodes and replace them with clickable spans. */
function renderWikiLinks(children: React.ReactNode, onWikiLink?: (title: string) => void): React.ReactNode {
  if (!onWikiLink) return children
  return React.Children.map(children, child => {
    if (typeof child === 'string') {
      const parts: React.ReactNode[] = []
      let remaining = child
      let key = 0
      while (remaining.length > 0) {
        const match = WIKI_RE.exec(remaining)
        if (!match) {
          parts.push(remaining)
          break
        }
        // Text before the match
        if (match.index > 0) {
          parts.push(remaining.slice(0, match.index))
        }
        // The wiki link
        const display = match[1].split('|')[0].trim()
        parts.push(
          <span
            key={key++}
            className="text-[var(--accent)] cursor-pointer hover:underline"
            onClick={() => onWikiLink(display)}
          >
            {display}
          </span>
        )
        remaining = remaining.slice(match.index + match[0].length)
      }
      return <>{parts}</>
    }
    if (React.isValidElement(child) && (child.props as any)?.children) {
      return React.cloneElement(child, {
        ...(child.props as any),
        children: renderWikiLinks((child.props as any).children, onWikiLink),
      } as any)
    }
    return child
  })
}
