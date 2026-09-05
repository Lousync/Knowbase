import { useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { forwardRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { bindEditorTheme } from '../../../lib/editorTheme'
import { dimMarkdownText, markdownWikiHighlights, wikiTargetTitle, type DimCls } from '../../../lib/markdownDim'
import { getKnowledgePages } from '../../../lib/ipc'
import type { KnowledgePage } from '../../../types'
import type { EditorDoc } from '../types'

interface Props {
  doc: EditorDoc | null
  onChange: (relPath: string, value: string) => void
  /** Markdown 标记淡化（设置 markdownDim 透传；默认开）。关闭时仅保留 [[双链]] accent 高亮 */
  dimEnabled?: boolean
  /** 布局刷新键：变化时显式触发 editor.layout()（禅模式隐壳后容器尺寸变化，§6-3） */
  layoutKey?: number
}

export interface MonacoPaneHandle {
  /** 大纲跳转：滚动到指定行并聚焦 */
  revealLine(line: number): void
}

/** DimCls → inlineClassName（CSS 类定义见 src/styles/index.css） */
const DIM_PREFIX: Record<DimCls, string> = {
  dim: 'kb-md-dim',
  strong: 'kb-md-strong',
  em: 'kb-md-em',
  del: 'kb-md-del',
  code: 'kb-md-code',
  link: 'kb-md-link',
  wiki: 'kb-md-wiki',
}

// ---- [[ 补全数据源缓存：仓库全部知识页（title→用于匹配）----
// 30s 内复用；换文档/换仓库经 onDidChangeModel 触发失效由 installCompletion 的失效钩子处理。
let pageCache: { at: number; pages: KnowledgePage[] } | null = null
const PAGE_CACHE_TTL = 30_000

async function getPagesCached(): Promise<KnowledgePage[]> {
  const now = Date.now()
  if (pageCache && now - pageCache.at < PAGE_CACHE_TTL) return pageCache.pages
  try {
    const pages = await getKnowledgePages()
    pageCache = { at: now, pages }
    return pages
  } catch {
    return pageCache?.pages ?? []
  }
}

/** 编辑器「大纲」导航句柄透传 */
export const MonacoPane = forwardRef<MonacoPaneHandle, Props>(function MonacoPane(
  { doc, onChange, dimEnabled = true, layoutKey = 0 },
  ref,
) {
  const hostRef = useRef<MonacoPaneHandle | null>(null)
  useImperativeHandle(ref, () => ({
    revealLine: (line: number) => hostRef.current?.revealLine(line),
  }), [])

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">
        从左侧选择文件打开
      </div>
    )
  }
  if (doc.binary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-[var(--text-muted)]">
        <span>二进制文件，不支持编辑</span>
        <span className="text-[12px] text-[var(--text-tertiary)]">{doc.size.toLocaleString()} bytes</span>
      </div>
    )
  }
  if (doc.truncated) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-[var(--text-muted)]">
        <span>文件超过 50MB，拒绝打开</span>
      </div>
    )
  }
  return <MonacoHost ref={hostRef} doc={doc} onChange={onChange} dimEnabled={dimEnabled} layoutKey={layoutKey} />
})

/** 有效文档的 Monaco 宿主；hooks 集中在子组件，doc 为 null 时父组件卸载它（满足 hooks 规则） */
const MonacoHost = forwardRef<MonacoPaneHandle, { doc: EditorDoc; onChange: Props['onChange']; dimEnabled: boolean; layoutKey: number }>(
  function MonacoHost({ doc, onChange, dimEnabled, layoutKey }, ref) {
    const dimEnabledRef = useRef(dimEnabled)
    dimEnabledRef.current = dimEnabled
    /** onMount 内注册的整文重算（供 dimEnabled 开关即时触发） */
    const applyFnRef = useRef<(() => void) | null>(null)
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const lastFileRef = useRef<string>(doc.relPath)

    useImperativeHandle(ref, () => ({
      revealLine: (line: number) => {
        const editor = editorRef.current
        if (!editor) return
        const model = editor.getModel()
        if (!model) return
        const total = model.getLineCount()
        const target = Math.max(1, Math.min(line, total))
        editor.revealLineInCenter(target)
        editor.setPosition({ lineNumber: target, column: 1 })
        editor.focus()
      },
    }), [])

    const onMount = useCallback<OnMount>((editor, monaco) => {
      editorRef.current = editor
      const collection = editor.createDecorationsCollection([])
      let scheduled = false
      let alive = true

      /** 整文重算：markdown 才有淡化/高亮；开关只决定淡化是否参与（wiki 高亮常驻） */
      const realApply = (): void => {
        if (!alive) return
        const model = editor.getModel()
        const isMd = model?.getLanguageId() === 'markdown'
        if (!isMd || !model) { collection.set([]); return }
        const pos = editor.getPosition()
        const lines = model.getValue().split('\n')
        const cursorLine = pos ? pos.lineNumber : -1
        // 淡化开启：整文淡化（光标行保留原始标记，双链内容 accent）；
        // 淡化关闭：仍保留 [[双链]] accent 高亮——双链是结构信息，写作时始终可见。
        const sources = dimEnabledRef.current ? dimMarkdownText(lines, cursorLine) : markdownWikiHighlights(lines)
        const decos: Monaco.editor.IModelDeltaDecoration[] = []
        for (const d of sources) {
          if (d.startCol >= d.endCol) continue
          decos.push({
            range: new monaco.Range(d.line, d.startCol, d.line, d.endCol),
            options: { inlineClassName: DIM_PREFIX[d.cls] },
          })
        }
        collection.set(decos)
      }
      applyFnRef.current = realApply

      const schedule = (): void => {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
          scheduled = false
          realApply()
        })
      }

      // 换文档时先清掉旧 model 的 decoration，再对新 model 重算；同时失效补全缓存
      editor.onDidChangeModel(() => {
        collection.set([])
        pageCache = null
        schedule()
      })
      editor.onDidChangeModelContent(() => schedule())
      editor.onDidChangeCursorPosition(() => schedule())
      schedule()

      // ---- [[ 双链自动补全（数据源：仓库知识页索引，经缓存）----
      // Monaco language 级 provider 注册一次即可（编辑器实例单例）；重复调用会叠加，
      // 因此模块级 guard 只注册一次（schema 全局共享）。
      installWikiCompletion(monaco)

      editor.onDidDispose(() => {
        alive = false
        applyFnRef.current = null
        editorRef.current = null
        collection.clear()
      })
    }, [])

    // dimEnabled 开关：即时清空或重算（无需等下一次击键/光标移动）
    useEffect(() => {
      const apply = applyFnRef.current
      if (apply) apply()
    }, [dimEnabled])

    // 文件切换：更新 lastFileRef（大纲/跳转按当前文档解释行号）
    useEffect(() => { lastFileRef.current = doc.relPath }, [doc.relPath])

    // 禅模式档位切换：容器尺寸变化后显式 layout 一次（automaticLayout 已有 ResizeObserver，双保险 §7-1）
    useEffect(() => {
      const t = window.setTimeout(() => editorRef.current?.layout(), 60)
      return () => window.clearTimeout(t)
    }, [layoutKey])

    return (
      <Editor
        path={doc.relPath}
        language={doc.language}
        value={doc.content}
        theme="knowbase-auto"
        beforeMount={bindEditorTheme}
        onMount={onMount}
        onChange={(v) => onChange(doc.relPath, v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderLineHighlight: 'line',
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          padding: { top: 8 },
        }}
      />
    )
  },
)

let completionInstalled = false

/** 注册 [[ 补全 provider（幂等：整 app 一次；markdown 语言共享） */
function installWikiCompletion(monaco: typeof Monaco): void {
  if (completionInstalled) return
  completionInstalled = true
  monaco.languages.registerCompletionItemProvider('markdown', {
    triggerCharacters: ['['],
    provideCompletionItems: async (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
      // 取光标到行首文本，判断是否处于未闭合 [[ 内
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      // 注意：必须匹配整段 '[[' 的起点，而不是单个 '['。
      // lastIndexOf('[') 对 "[[你" 返回第二个 '[' 的位置（1），
      // 导致下方 slice(lastOpen + 2) 吃掉 query 首字符 → 过滤退化（ISS-2026-09-04-01）。
      const lastOpen = linePrefix.lastIndexOf('[[')
      const lastClose = linePrefix.lastIndexOf(']]')
      if (lastOpen === -1 || lastClose > lastOpen) return { suggestions: [] }

      const query = linePrefix.slice(lastOpen + 2).trim()
      const pages = await getPagesCached()
      const lower = query.toLowerCase()
      const matches = pages
        .filter((p) => !lower || p.title.toLowerCase().includes(lower))
        // 显式按最近更新排序，保证候选顺序稳定可预期（不依赖索引内部顺序）
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, 10)

      return {
        suggestions: matches.map((p) => ({
          label: p.title,
          kind: monaco.languages.CompletionItemKind.Reference,
          insertText: `${p.title}]]`,
          detail: p.path ? `知识页 · ${p.title}` : '知识页',
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: lastOpen + 3, // 保留 [[ 前缀，替换已输入的部分
            endColumn: position.column,
          },
        })),
      }
    },
  })
}

export type { OnMount }

/** 供外部（编辑器模块大纲/提示）判断当前文档是否处于 [[ 补全上下文 */
export function wikiContextTarget(text: string): string | null {
  const lastOpen = text.lastIndexOf('[[')
  const lastClose = text.lastIndexOf(']]')
  if (lastOpen === -1 || lastClose > lastOpen) return null
  return text.slice(lastOpen + 2).trim()
}

export { wikiTargetTitle }
