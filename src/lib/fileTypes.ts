// 文件类型 → 展示信息
export interface FileTypeInfo {
  ext: string
  label: string      // "C++"
  badge: string      // "CPP"
  icon: string       // "code" | "file" | "text" — which lucide icon to use
  color: string      // tailwind-like "var(--accent)"
  placeholder: string // Monaco placeholder
  monacoLang: string  // Monaco language ID
}

const INFO: Record<string, FileTypeInfo> = {
  '':   { ext: '',   label: 'Markdown',  badge: 'MD',   icon: 'file',     color: 'var(--accent)',        placeholder: '开始写 Markdown... 使用 [[页面名]] 创建链接', monacoLang: 'markdown' },
  'md': { ext: 'md', label: 'Markdown',  badge: 'MD',   icon: 'file',     color: 'var(--accent)',        placeholder: '开始写 Markdown... 使用 [[页面名]] 创建链接', monacoLang: 'markdown' },
  'txt':{ ext: 'txt',label: '纯文本',     badge: 'TXT',  icon: 'text',     color: 'var(--text-muted)',     placeholder: '开始编写...',                       monacoLang: 'plaintext' },
  'pdf':{ ext: 'pdf',label: 'PDF',        badge: 'PDF',  icon: 'file',     color: '#e74c3c',               placeholder: 'PDF 阅读器',                      monacoLang: 'plaintext' },
  'cpp':{ ext: 'cpp',label: 'C++',        badge: 'CPP',  icon: 'code',     color: 'var(--warning)',        placeholder: '开始写 C++ 代码...',               monacoLang: 'cpp' },
  'c':  { ext: 'c',  label: 'C',          badge: 'C',    icon: 'code',     color: 'var(--warning)',        placeholder: '开始写 C 代码...',                 monacoLang: 'c' },
  'h':  { ext: 'h',  label: 'C Header',   badge: 'H',    icon: 'code',     color: 'var(--warning)',        placeholder: '开始写 C 头文件...',               monacoLang: 'c' },
  'hpp':{ ext: 'hpp',label: 'C++ Header', badge: 'HPP',  icon: 'code',     color: 'var(--warning)',        placeholder: '开始写 C++ 头文件...',             monacoLang: 'cpp' },
  'py': { ext: 'py', label: 'Python',     badge: 'PY',   icon: 'code',     color: 'var(--success)',        placeholder: '开始写 Python 代码...',            monacoLang: 'python' },
  'js': { ext: 'js', label: 'JavaScript', badge: 'JS',   icon: 'code',     color: '#f0db4f',              placeholder: '开始写 JavaScript 代码...',       monacoLang: 'javascript' },
  'jsx':{ ext: 'jsx',label: 'React JSX',  badge: 'JSX',  icon: 'code',     color: '#61dafb',              placeholder: '开始写 React JSX...',              monacoLang: 'javascript' },
  'ts': { ext: 'ts', label: 'TypeScript', badge: 'TS',   icon: 'code',     color: '#3178c6',              placeholder: '开始写 TypeScript 代码...',        monacoLang: 'typescript' },
  'tsx':{ ext: 'tsx',label: 'React TSX',  badge: 'TSX',  icon: 'code',     color: '#3178c6',              placeholder: '开始写 React TSX...',              monacoLang: 'typescript' },
  'json':{ext: 'json',label: 'JSON',      badge: 'JSON', icon: 'data',     color: 'var(--warning)',        placeholder: '开始编辑 JSON...',                 monacoLang: 'json' },
  'html':{ext: 'html',label: 'HTML',      badge: 'HTML', icon: 'web',      color: '#e34c26',              placeholder: '开始写 HTML...',                  monacoLang: 'html' },
  'css':{ ext: 'css', label: 'CSS',       badge: 'CSS',  icon: 'web',      color: '#264de4',              placeholder: '开始写 CSS...',                   monacoLang: 'css' },
  'java':{ext: 'java',label: 'Java',      badge: 'JAVA', icon: 'code',     color: '#b07219',              placeholder: '开始写 Java 代码...',             monacoLang: 'java' },
  'rs': { ext: 'rs', label: 'Rust',       badge: 'RS',   icon: 'code',     color: '#dea584',              placeholder: '开始写 Rust 代码...',             monacoLang: 'rust' },
  'go': { ext: 'go', label: 'Go',         badge: 'GO',   icon: 'code',     color: '#00add8',              placeholder: '开始写 Go 代码...',               monacoLang: 'go' },
  'sh': { ext: 'sh', label: 'Shell',      badge: 'SH',   icon: 'terminal', color: 'var(--text-secondary)', placeholder: '开始写 Shell 脚本...',            monacoLang: 'shell' },
  'bat':{ ext: 'bat',label: 'Batch',      badge: 'BAT',  icon: 'terminal', color: 'var(--text-secondary)', placeholder: '开始写 Batch 脚本...',            monacoLang: 'bat' },
  'sql':{ ext: 'sql', label: 'SQL',       badge: 'SQL',  icon: 'data',     color: 'var(--accent)',        placeholder: '开始写 SQL...',                   monacoLang: 'sql' },
  'xml':{ ext: 'xml', label: 'XML',       badge: 'XML',  icon: 'data',     color: 'var(--warning)',        placeholder: '开始编辑 XML...',                  monacoLang: 'xml' },
  'yaml':{ext: 'yaml',label: 'YAML',      badge: 'YAML', icon: 'data',     color: 'var(--danger)',         placeholder: '开始编辑 YAML...',                 monacoLang: 'yaml' },
  'yml':{ ext: 'yml', label: 'YAML',      badge: 'YML',  icon: 'data',     color: 'var(--danger)',         placeholder: '开始编辑 YAML...',                 monacoLang: 'yaml' },
  'r':  { ext: 'r',  label: 'R',          badge: 'R',    icon: 'code',     color: '#276dc3',              placeholder: '开始写 R 代码...',                monacoLang: 'r' },
  'rb': { ext: 'rb', label: 'Ruby',       badge: 'RB',   icon: 'code',     color: '#cc342d',              placeholder: '开始写 Ruby 代码...',             monacoLang: 'ruby' },
  'php':{ ext: 'php',label: 'PHP',        badge: 'PHP',  icon: 'code',     color: '#777bb3',              placeholder: '开始写 PHP 代码...',              monacoLang: 'php' },
  'lua':{ ext: 'lua',label: 'Lua',        badge: 'LUA',  icon: 'code',     color: '#000080',              placeholder: '开始写 Lua 代码...',              monacoLang: 'lua' },
}

export function getFileTypeInfo(ext: string): FileTypeInfo {
  const key = ext.replace(/^\./, '').toLowerCase()
  return INFO[key] || { ext: key, label: key || 'Markdown', badge: (key || 'MD').toUpperCase(), icon: 'file', color: 'var(--text-muted)', placeholder: '开始编辑...', monacoLang: 'markdown' }
}

export const FILE_LANG_OPTIONS = [
  { ext: '',  label: 'Markdown' },
  { ext: 'txt', label: '纯文本' },
  { ext: 'cpp', label: 'C++' },
  { ext: 'c',   label: 'C' },
  { ext: 'py',  label: 'Python' },
  { ext: 'js',  label: 'JavaScript' },
  { ext: 'ts',  label: 'TypeScript' },
  { ext: 'json', label: 'JSON' },
  { ext: 'html', label: 'HTML' },
  { ext: 'css',  label: 'CSS' },
  { ext: 'java', label: 'Java' },
  { ext: 'rs',   label: 'Rust' },
  { ext: 'go',   label: 'Go' },
  { ext: 'sh',   label: 'Shell' },
  { ext: 'sql',  label: 'SQL' },
  { ext: 'xml',  label: 'XML' },
  { ext: 'yaml', label: 'YAML' },
]
