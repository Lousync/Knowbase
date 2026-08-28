/**
 * 由 electron.vite.config.ts 的 define 注入。
 * 生产构建时为 false，配合动态 import 使整个 devbridge chunk 被 tree-shake 掉。
 */
declare const __DEV_BRIDGE__: boolean
