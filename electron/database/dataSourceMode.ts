/**
 * 去库化数据源模式（P2）：结构化模块共用 storageData 开关。
 * 主进程注册各 repository 前 bind 一次 getter（读 settingsCache），
 * repo 每次调用 isVaultDataSource() 按当前设置动态判定（切换即时生效）。
 */
let getter: ((key: string) => unknown) | null = null

export function bindDataSourceGetter(g: (key: string) => unknown): void {
  getter = g
}

export function isVaultDataSource(): boolean {
  return getter?.('storageData') === 'vault'
}
