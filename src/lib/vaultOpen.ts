import { workspaceOpenDir, workspaceInitPendingVault } from './ipc'
import { showGlobalConfirm } from './globalConfirm'
import { showToast } from './toast'

/**
 * 「打开本地文件夹作为仓库」统一流程（D7 / P1）。
 * 三个入口（VaultPicker 打开本地仓库 / 编辑器打开按钮 / 启动选择页）共用：
 * 系统对话框选目录 → 顶层无 .knowbase 时明确弹「初始化为仓库？」确认，
 * 取消则不建（不再静默自动初始化）。错误已 toast，调用方拿 null 即视为放弃。
 */
export interface OpenedVault {
  rootId: string
  name: string
  path: string
}

export async function openVaultWithGuide(): Promise<OpenedVault | null> {
  const res = await workspaceOpenDir()
  if (!res) return null // 对话框取消
  if ('error' in res) {
    if (res.error) showToast({ type: 'error', message: res.error })
    return null
  }
  if ('notVault' in res) {
    const ok = await showGlobalConfirm({
      title: '该文件夹不是仓库',
      message: `「${res.name}」内没有 .knowbase 数据目录，还不是 Phrontis 仓库。\n要把它初始化为仓库吗？`,
      confirmLabel: '初始化为仓库',
      cancelLabel: '取消',
      variant: 'default',
    })
    const init = await workspaceInitPendingVault(ok === true) // showGlobalConfirm 类型含 'extra'（未传 extraLabel 不会出现），收敛为 boolean
    if (!ok || !init.ok || !init.rootId) {
      if (init.error) showToast({ type: 'error', message: init.error })
      return null
    }
    return { rootId: init.rootId, name: init.name ?? res.name, path: init.path ?? res.path }
  }
  return { rootId: res.rootId, name: res.name, path: res.path }
}
