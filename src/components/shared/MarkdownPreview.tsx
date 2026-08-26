import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Copy } from 'lucide-react'
import { showToast } from '../../lib/toast'
import { copyImageUrlToClipboard } from '../../lib/ipc'

// Same ID generation as parseHeadings() in OutlinePanel — must match for outline navigation
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Allow the app's local schemes (attachment://, data:, file:, blob:) alongside
 * react-markdown's default safe protocols. The default urlTransform would strip
 * `attachment://id/` to an empty string, breaking inline images.
 */
function safeUrlTransform(value: string): string {
  if (/^(https?|ircs?|mailto|xmpp|attachment|data|file|blob):/i.test(value)) return value
  const colon = value.indexOf(':')
  const questionMark = value.indexOf('?')
  const numberSign = value.indexOf('#')
  const slash = value.indexOf('/')
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign)
  ) return value
  return ''
}

interface Props {
  content: string
  /** Called when a [[wiki link]] is clicked. If omitted, wiki links render as plain text. */
  onWikiLink?: (title: string) => void
  /** Called when a standard markdown link [text](href) is clicked. Default: open in browser/system. */
  onLinkClick?: (href: string) => void
  /** 已存在的页面标题集合：不在其中的 wiki 链接渲染为「空链接」虚线样式 */
  knownWikiTitles?: Set<string>
}

/** Unified markdown preview component. Links open via system handler (files → system app, URLs → browser). */
export function MarkdownPreview({ content, onWikiLink, onLinkClick, knownWikiTitles }: Props) {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault()
    if (onLinkClick) {
      onLinkClick(href)
    } else {
      // Default: use window.open → intercepted by Electron's setWindowOpenHandler
      if (/^https?:\/\//i.test(href) || /^file:\/\//i.test(href)) {
        window.open(href, '_blank')
      } else {
        // Relative/absolute file path → open with system app
        if (window.api) {
          window.api.openExternal(href)
        }
      }
    }
  }

  return (
    <div className="prose-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, [rehypeKatex, { throwOnError: false, strict: false }]]}
        urlTransform={safeUrlTransform}
        components={{
          pre({ children }) {
            return <pre>{children}</pre>
          },
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
          // Images: add a hover "copy to clipboard" affordance
          img({ src, alt, ...props }) {
            return (
              <span className="inline-block relative max-w-full align-bottom group/img">
                <img src={src} alt={alt} {...props} />
                {src && (
                  <button
                    onClick={() => {
                      void copyImageUrlToClipboard(src).then(ok => {
                        showToast({ type: ok ? 'info' : 'error', message: ok ? '图片已复制到剪贴板' : '复制失败' })
                      })
                    }}
                    className="absolute top-1.5 right-1.5 p-1 rounded bg-black/55 text-white opacity-0 group-hover/img:opacity-100 hover:bg-black/80 transition-opacity"
                    title="复制图片"
                  >
                    <Copy size={14} />
                  </button>
                )}
              </span>
            )
          },
          code({ className, children, node, ...props }) {
            // 内容包动画 fence:anim@<pluginId>:<blockId> → 沙箱 iframe 播放器
            const anim = /^language-anim@([a-z0-9][a-z0-9._-]*):([A-Za-z0-9._-]+)$/.exec(className || '')
            if (anim) return <AnimEmbed pluginId={anim[1]} animId={anim[2]} label={String(children).trim().split('\n')[0]} />
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
            return <p>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</p>
          },
          // Also handle wiki links in list items, headings, etc.
          li({ children }) {
            return <li>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</li>
          },
          h1({ children }) {
            const text = extractText(children)
            return <h1 id={headingId(text)}>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</h1>
          },
          h2({ children }) {
            const text = extractText(children)
            return <h2 id={headingId(text)}>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</h2>
          },
          h3({ children }) {
            const text = extractText(children)
            return <h3 id={headingId(text)}>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</h3>
          },
          h4({ children }) {
            const text = extractText(children)
            return <h4 id={headingId(text)}>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</h4>
          },
          h5({ children }) {
            const text = extractText(children)
            return <h5 id={headingId(text)}>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</h5>
          },
          h6({ children }) {
            const text = extractText(children)
            return <h6 id={headingId(text)}>{renderWikiLinks(children, onWikiLink, knownWikiTitles)}</h6>
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
function renderWikiLinks(children: React.ReactNode, onWikiLink?: (title: string) => void, knownWikiTitles?: Set<string>): React.ReactNode {
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
        const exists = knownWikiTitles ? knownWikiTitles.has(display) : true
        parts.push(
          <span
            key={key++}
            className={
              exists
                ? 'text-[var(--accent)] cursor-pointer hover:underline'
                : 'text-[var(--text-muted)]/70 cursor-pointer hover:text-[var(--accent)] border-b border-dashed border-[var(--text-muted)]/50'
            }
            title={exists ? display : `创建页面「${display}」`}
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
        children: renderWikiLinks((child.props as any).children, onWikiLink, knownWikiTitles),
      } as any)
    }
    return child
  })
}

/** 内容包分步动画播放器(plugin:// 沙箱 iframe,manim-web 单运行时) */
function AnimEmbed({ pluginId, animId, label }: { pluginId: string; animId: string; label: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="my-3 px-3 py-2.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[12px] text-[var(--text-muted)]">
        【交互式动画】{label || animId}(播放器加载失败,插件可能已被卸载)
      </div>
    )
  }
  return (
    <figure className="my-3">
      <iframe
        src={`plugin://${pluginId}/anims/player.html?id=${encodeURIComponent(animId)}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        title={label || animId}
        onError={() => setFailed(true)}
        style={{ width: '100%', aspectRatio: '16 / 10', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', background: '#fff' }}
      />
      <figcaption className="text-[11px] text-[var(--text-muted)] mt-1 text-center select-none">
        分步动画{label ? ` · ${label}` : ''}(使用下方控件逐步播放)
      </figcaption>
    </figure>
  )
}
