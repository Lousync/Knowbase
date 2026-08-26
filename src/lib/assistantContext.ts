/**
 * 全局 AI 助手上下文注册器 —— 各模块注册「当前正在查看什么」的提供器，
 * AssistantPanel 发送消息时自动附带，实现"边看边问"。
 * 同一时刻只保留最后注册者（模块卸载时注销即可回退）。
 */

export interface AssistantContext {
  type: string
  label: string
  data?: Record<string, unknown>
}

type Provider = () => AssistantContext | null

let provider: Provider | null = null

export function registerAssistantContext(p: Provider): () => void {
  provider = p
  return () => { if (provider === p) provider = null }
}

export function getAssistantContext(): AssistantContext | null {
  try { return provider?.() ?? null } catch { return null }
}
