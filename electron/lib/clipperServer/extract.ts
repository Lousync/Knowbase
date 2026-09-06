/**
 * Web 剪藏正文提取（docs/plugin-web-clipper-design.md §3.4 的引擎层）。
 *
 * 管线：stripDangerous(输入) → Defuddle 主内容提取 + Markdown 转换 → stripDangerous(输出) 兜底。
 *
 * 依赖引入口径（defuddle 0.19.3 实测，勿再改动）：
 *  - 必须用 `defuddle/node`（内部链 './markdown' 直连 npm turndown，自带 HTML parser，Node 零 globals）。
 *    ⚠ 不用 'defuddle/full'：其内嵌 markdown 转换器要求真实 document.implementation.createHTMLDocument，
 *    linkedom 环境会 "Partial conversion completed with errors" 降级透传原始 HTML（实测踩过）。
 *  - 'defuddle/node' exports 只有 import 条件——electron-vite 主进程构建按 import 条件解析后打进
 *    bundle（产物内不再是包引用），运行时安全；但任何「externalize 后运行时 require('defuddle/node')」
 *    的路径都会 ERR_PACKAGE_PATH_NOT_EXPORTED，故本模块不可被 externalize（见 electron.vite.config.ts）。
 *  - DOMPurify 在 linkedom 环境为静默 no-op（实测），消毒自实现 stripDangerous，输入输出各一遍。
 */
import { Defuddle } from 'defuddle/node'
import { stripDangerous } from './sanitize'

export { stripDangerous }

export interface ClipExtraction {
  title: string
  description: string
  site: string
  domain: string
  favicon: string
  language: string
  published: string
  author: string
  wordCount: number
  /** 提取并净化后的正文 Markdown；页面无可提取正文时为 ''（调用方走「仅存链接」fallback） */
  markdown: string
}

export async function extractArticle(html: string, url: string): Promise<ClipExtraction> {
  const res = await Defuddle(stripDangerous(html), url, { markdown: true })
  return {
    title: String(res.title ?? '').trim(),
    description: String(res.description ?? ''),
    site: String(res.site ?? ''),
    domain: String(res.domain ?? ''),
    favicon: String(res.favicon ?? ''),
    language: String(res.language ?? ''),
    published: typeof res.published === 'string' ? res.published : res.published ? String(res.published) : '',
    author: String(res.author ?? ''),
    wordCount: Number(res.wordCount) || 0,
    // 出口再过一遍：defuddle 会把白名单外容器（iframe/svg 壳等）原样透传进 md
    markdown: stripDangerous(String(res.content ?? '')).trim(),
  }
}
