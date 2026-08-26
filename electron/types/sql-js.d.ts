/**
 * sql.js 无官方类型包；项目以宽松方式使用（见 database/connection.ts）。
 * 导出连接处引用的类型名，避免 TS2709，同时保持 any 语义不与用法冲突。
 */
declare module 'sql.js' {
  export type Database = any
  export type SqlJsStatic = any
  const initSqlJs: any
  export default initSqlJs
}
