// sql.js 类型声明：R6 后仅供 ccSwitchImport 读取外部 ~/.cc-switch/cc-switch.db（外部 SQLite 格式解析），
// Knowbase 自身主库已彻底退役。
// 导出连接处引用的类型名，避免 TS2709，同时保持 any 语义不与用法冲突。
declare module 'sql.js' {
  export type Database = any
  export type SqlJsStatic = any
  const initSqlJs: any
  export default initSqlJs
}
