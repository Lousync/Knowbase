import { useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { forwardRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { bindEditorTheme, applyEditorTheme, setEditorThemeVariant } from '../../../lib/editorTheme'
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
  /** 禅模式：非光标行整行淡化（iA Writer 式聚焦）+ 隐藏行号/大留白 */
  zen?: boolean
  /** 打字机滚动：光标行始终垂直居中（独立开关，默认关） */
  typewriter?: boolean
  /** 纸感氛围：编辑器底透明，容器承载暖纸白/墨夜色（设置 zenPaper） */
  zenPaper?: boolean
  /** P3 插图：粘贴图片拦截（返回要插入的 md 文本；null = 放弃）。仅 markdown 文档传入 */
  onPasteImage?: (file: File) => Promise<string | null>
}

export interface MonacoPaneHandle {
  /** 大纲跳转：滚动到指定行并聚焦 */
  revealLine(line: number): void
  /** P3 插图：在光标处插入文本（多张图依次调用），插入后聚焦 */
  insertAtCursor(text: string): void
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
  { doc, onChange, dimEnabled = true, layoutKey = 0, zen = false, typewriter = false, zenPaper = true, onPasteImage },
  ref,
) {
  const hostRef = useRef<MonacoPaneHandle | null>(null)
  useImperativeHandle(ref, () => ({
    revealLine: (line: number) => hostRef.current?.revealLine(line),
    insertAtCursor: (text: string) => hostRef.current?.insertAtCursor(text),
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
  return <MonacoHost ref={hostRef} doc={doc} onChange={onChange} dimEnabled={dimEnabled} layoutKey={layoutKey} zen={zen} typewriter={typewriter} zenPaper={zenPaper} onPasteImage={onPasteImage} />
})

/** 有效文档的 Monaco 宿主；hooks 集中在子组件，doc 为 null 时父组件卸载它（满足 hooks 规则） */
const MonacoHost = forwardRef<MonacoPaneHandle, { doc: EditorDoc; onChange: Props['onChange']; dimEnabled: boolean; layoutKey: number; zen: boolean; typewriter: boolean; zenPaper: boolean; onPasteImage?: Props['onPasteImage'] }>(
  function MonacoHost({ doc, onChange, dimEnabled, layoutKey, zen, typewriter, zenPaper = true, onPasteImage }, ref) {
    const dimEnabledRef = useRef(dimEnabled)
    dimEnabledRef.current = dimEnabled
    /** P3 粘贴拦截回调透传（paste 监听器只挂一次，不随 prop 变化重挂） */
    const pasteImageRef = useRef<Props['onPasteImage']>(onPasteImage)
    pasteImageRef.current = onPasteImage
    /** 禅聚焦淡化 + 打字机（ref 透传进 onMount 闭包） */
    const zenDimRef = useRef(zen)
    zenDimRef.current = zen
    const typewriterRef = useRef(typewriter)
    typewriterRef.current = typewriter
    /** onMount 内注册的整文重算（供 dimEnabled/zen 开关即时触发） */
    const applyFnRef = useRef<(() => void) | null>(null)
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const lastFileRef = useRef<string>(doc.relPath)
    /** 打字机留白去重（同一 pad 不重复 updateOptions，防 layout 事件循环） */
    const padRef = useRef(0)
    /** 平滑滚动动画句柄（光标移动时重启） */
    const smoothRafRef = useRef(0)

    /** 打字机留白：上下各 ~40% 视口高 → 文首/文尾行也能真正居中（iA Writer/Typora 式） */
    const applyZenPadding = useCallback((ed: Monaco.editor.IStandaloneCodeEditor): void => {
      const pad = Math.max(140, Math.round(ed.getLayoutInfo().height * 0.4))
      if (Math.abs(pad - padRef.current) < 8) return
      padRef.current = pad
      ed.updateOptions({ padding: { top: pad, bottom: pad } })
    }, [])

    /** 平滑滚动至光标行垂直居中：瞬跳读目标 scrollTop → 回滚 → rAF 缓动（easeOutCubic 180ms） */
    const smoothCenterLine = useCallback((ed: Monaco.editor.IStandaloneCodeEditor, line: number): void => {
      const s0 = ed.getScrollTop()
      ed.revealLineInCenter(line)
      const s1 = ed.getScrollTop()
      ed.setScrollTop(s0)
      if (Math.abs(s1 - s0) < 2) return
      cancelAnimationFrame(smoothRafRef.current)
      const t0 = performance.now()
      const step = (t: number): void => {
        const p = Math.min(1, (t - t0) / 180)
        ed.setScrollTop(Math.round(s0 + (s1 - s0) * (1 - Math.pow(1 - p, 3))))
        if (p < 1) smoothRafRef.current = requestAnimationFrame(step)
      }
      smoothRafRef.current = requestAnimationFrame(step)
    }, [])

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
      insertAtCursor: (text: string) => {
        const editor = editorRef.current
        if (!editor) return
        const pos = editor.getPosition()
        if (!pos) return
        const range = { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }
        editor.executeEdits('kb-insert', [{ range, text, forceMoveMarkers: true }])
        editor.focus()
      },
    }), [])

    const onMount = useCallback<OnMount>((editor, monaco) => {
      editorRef.current = editor
      // 禅模式在挂载时即生效（[zen] effect 跑在 Monaco 异步挂载完成前，editorRef 尚为 null）
      if (zenDimRef.current) {
        editor.updateOptions({ lineNumbers: 'off', fontSize: 14 })
        if (typewriterRef.current) applyZenPadding(editor)
        else editor.updateOptions({ padding: { top: 28, bottom: 180 } })
      }
      // @monaco-editor/react 的 theme prop 重挂载时会强制 knowbase-auto；
      // 若主题变体已被切到 knowbase-zen（纸感透明底），按当前 variant 恢复
      applyEditorTheme()
      // 窗口/容器尺寸变化时重算打字机留白（padRef 去重防循环）
      editor.onDidLayoutChange(() => {
        if (typewriterRef.current) applyZenPadding(editor)
      })
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
        // 禅聚焦淡化（iA Writer 式渐进）：按与光标行的距离分 3 档降透明——
        // 近处保留上下文可读，远处退场，视线自然锚定当前行
        if (zenDimRef.current && isMd && cursorLine > 0) {
          for (let ln = 1; ln <= lines.length; ln++) {
            const d = Math.abs(ln - cursorLine)
            if (d === 0) continue
            const cls = d <= 1 ? 'zen-dim-1' : d <= 4 ? 'zen-dim-2' : 'zen-dim-3'
            decos.push({
              range: new monaco.Range(ln, 1, ln, 1),
              options: { className: cls, isWholeLine: true },
            })
          }
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
      editor.onDidChangeCursorPosition((e) => {
        schedule()
        // 打字机滚动（iA Writer/Typora 式）：平滑滚动至光标行垂直居中
        if (typewriterRef.current) {
          const line = e.position?.lineNumber ?? 0
          if (line > 0) smoothCenterLine(editor, line)
        }
      })
      schedule()

      // ---- [[ 双链自动补全（数据源：仓库知识页索引，经缓存）----
      // Monaco language 级 provider 注册一次即可（编辑器实例单例）；重复调用会叠加，
      // 因此模块级 guard 只注册一次（schema 全局共享）。
      installWikiCompletion(monaco)

      // P3 插图：容器捕获阶段拦截 paste——剪贴板含图片文件时走 onPasteImage 落附件区并插入
      // md 链接（Monaco 隐藏 textarea 收不到被吞的事件）；纯文本粘贴不受影响。
      const domNode = editor.getDomNode()
      if (domNode) {
        const onPasteCapture = (ev: Event): void => {
          const e = ev as ClipboardEvent
          const cb = pasteImageRef.current
          if (!cb) return
          const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
          if (files.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          void (async () => {
            const parts: string[] = []
            for (const f of files) {
              const snippet = await cb(f)
              if (snippet) parts.push(snippet)
            }
            if (parts.length === 0) return
            const pos = editor.getPosition()
            if (!pos) return
            const range = { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }
            editor.executeEdits('kb-paste-image', [{ range, text: parts.join('\n') + '\n', forceMoveMarkers: true }])
            editor.focus()
          })().catch(() => { /* 失败提示由调用方 toast */ })
        }
        domNode.addEventListener('paste', onPasteCapture, true)
        editor.onDidDispose(() => domNode.removeEventListener('paste', onPasteCapture, true))
      }

      editor.onDidDispose(() => {
        alive = false
        applyFnRef.current = null
        editorRef.current = null
        collection.clear()
        cancelAnimationFrame(smoothRafRef.current)
      })
    }, [applyZenPadding, smoothCenterLine])

    // dimEnabled/zen 开关：即时清空或重算（无需等下一次击键/光标移动）。
    // zen 退出必须重算，否则禅淡化装饰残留（markdownDim 常开时 dimEnabled 不变，不重跑）
    useEffect(() => {
      const apply = applyFnRef.current
      if (apply) apply()
    }, [dimEnabled, zen])

    // 禅模式开关：隐藏行号 + 字号微增；打字机开 → 动态大留白（首尾行可居中），关 → 固定大留白
    useEffect(() => {
      const ed = editorRef.current
      if (!ed) return
      ed.updateOptions(zen
        ? { lineNumbers: 'off', fontSize: 14 }
        : { lineNumbers: 'on', padding: { top: 8, bottom: 16 }, fontSize: 13 })
      if (zen) {
        if (typewriter) applyZenPadding(ed)
        else {
          padRef.current = 0
          ed.updateOptions({ padding: { top: 28, bottom: 180 } })
        }
      } else {
        padRef.current = 0
      }
      ed.layout()
    }, [zen, typewriter, applyZenPadding])

    // 纸感氛围：zen+zenPaper → knowbase-zen（编辑器底透明，容器 .zen-paper-bg 承载纸色，
    // CSS 300ms 过渡）；退出时延迟恢复 knowbase-auto，等容器底色过渡完再换回不透明底，避免闪跳
    useEffect(() => {
      if (zen && zenPaper) {
        setEditorThemeVariant('zen')
        return undefined
      }
      const t = window.setTimeout(() => setEditorThemeVariant('auto'), 340)
      return () => window.clearTimeout(t)
    }, [zen, zenPaper])

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
