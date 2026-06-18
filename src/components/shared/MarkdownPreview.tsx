import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface Props {
  content: string
  /** Called when a [[wiki link]] is clicked. If omitted, wiki links render as plain text. */
  onWikiLink?: (title: string) => void
}

/** Unified markdown preview component. Replaces the old markdown-it + dangerouslySetInnerHTML pipeline. */
export function MarkdownPreview({ content, onWikiLink }: Props) {
  return (
    <div className="prose-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Custom code block renderer — add language label
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
            return <h1>{renderWikiLinks(children, onWikiLink)}</h1>
          },
          h2({ children }) {
            return <h2>{renderWikiLinks(children, onWikiLink)}</h2>
          },
          h3({ children }) {
            return <h3>{renderWikiLinks(children, onWikiLink)}</h3>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

const WIKI_RE = /\[\[([^\]]+)\]\]/

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
