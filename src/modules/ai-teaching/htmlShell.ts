/**
 * 沙箱 HTML 外壳注入（docs/ai-teaching-artifacts-pane-design.md §4.3/§4.4）
 * 仅供 AI教学工件栏 HTML 页签（ArtHtmlView）使用——HTML 正文渲染逻辑只存在于 AI教学模块，
 * 其他模块不引入（2026-09-09 用户拍板）。
 * - CSP 红线：default-src 'none'，禁一切网络请求/eval；只放行内联样式脚本与 data:/blob: 图片
 * - 高度上报：ResizeObserver → parent.postMessage({__kbArtH})，宿主钳制 [120,4000]
 * - 错误上报：window.onerror → parent.postMessage({__kbArtErr})，宿主渲染兜底框
 * - 主题：宿主 CSS 变量当前值展开为 iframe 内 :root{} 内联声明（不透明源不共享宿主样式）
 */

export const ART_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:"

const THEME_VARS = ['--bg-primary', '--bg-secondary', '--bg-hover', '--text-primary', '--text-secondary', '--text-muted', '--accent', '--border-color', '--success', '--warning', '--danger'] as const

/** 读宿主当前明暗主题下的 CSS 变量值（getComputedStyle 根元素） */
export function collectThemeVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) {
    const val = cs.getPropertyValue(v).trim()
    if (val) out[v] = val
  }
  return out
}

function headBlock(theme: Record<string, string>): string {
  const rootDecls = Object.entries(theme).map(([k, v]) => `${k}:${v};`).join('')
  const script = [
    '<script>',
    '(function(){',
    'var rep=function(){try{var h=Math.ceil(document.documentElement.getBoundingClientRect().height||document.body.scrollHeight||0);parent.postMessage({__kbArtH:Math.max(1,Math.min(12000,h))},\'*\')}catch(e){}};',
    'try{new ResizeObserver(rep).observe(document.documentElement)}catch(e){}',
    'window.addEventListener(\'error\',function(e){parent.postMessage({__kbArtErr:String((e&&e.message)||\'脚本错误\').slice(0,300)},\'*\')});',
    'rep();setTimeout(rep,80);setTimeout(rep,400);',
    '})();',
    '<\/script>',
  ].join('\n')
  return [
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${ART_HTML_CSP}">`,
    `<style>:root{${rootDecls}}html,body{margin:0;padding:0;background:var(--bg-primary,#fff);color:var(--text-primary,#222);font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}</style>`,
    script,
  ].join('\n')
}

/** 把（可能不完整的）AI HTML 片段包成带 CSP/主题/高度上报的安全文档。
 *  已含 <head> 则在其后插入；含 <html> 无 head 则补 head；否则整体包裹。 */
export function injectCspShell(html: string, theme?: Record<string, string>): string {
  const head = headBlock(theme ?? collectThemeVars())
  const src = String(html ?? '')
  if (/<head[^>]*>/i.test(src)) return src.replace(/<head[^>]*>/i, m => `${m}\n${head}`)
  if (/<html[^>]*>/i.test(src)) return src.replace(/<html[^>]*>/i, m => `${m}\n<head>\n${head}\n</head>`)
  return `<!doctype html>\n<html>\n<head>\n${head}\n</head>\n<body>\n${src}\n</body>\n</html>`
}
