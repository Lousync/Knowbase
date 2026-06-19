import { ipcMain } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/** Read current settings from disk for API key resolution. */
function loadSettings(): Record<string, unknown> {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  try { return existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : {} }
  catch { return {} }
}

export function registerAIHandlers(): void {

  ipcMain.handle('ai:chat', async (_e, opts: {
    messages: { role: string; content: string }[]
  }): Promise<{ content: string; error?: string }> => {
    const settings = loadSettings()
    const key = (settings.aiApiKey as string) || ''
    const baseUrl = (settings.aiBaseUrl as string) || 'https://api.deepseek.com/v1'
    const model = (settings.aiModel as string) || 'deepseek-chat'

    if (!key) {
      return { content: '', error: '请先在设置中配置 AI API 密钥 (aiApiKey)' }
    }

    try {
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        return { content: '', error: `API 错误 ${res.status}: ${text.slice(0, 300)}` }
      }

      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      const content = data.choices?.[0]?.message?.content || ''
      return { content }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: '', error: `网络错误: ${msg}` }
    }
  })
}
