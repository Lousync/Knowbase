import { Bot, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useSettings } from '../../../lib/SettingsContext'

export function AIView() {
  const { s, update } = useSettings()
  const [showKey, setShowKey] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-medium text-[var(--text-primary)] flex items-center gap-2">
          <Bot size={18} className="text-[var(--accent)]" />
          AI 服务
        </h2>
        <p className="text-[12px] text-[var(--text-muted)] mt-1">
          兼容 OpenAI / DeepSeek / 自定义 API，填入密钥即可使用
        </p>
      </div>

      {/* API Key */}
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-[var(--text-secondary)]">API 密钥</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={s.aiApiKey}
            onChange={e => update('aiApiKey', e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 pr-10 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)] font-mono"
          />
          <button
            onClick={() => setShowKey(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      {/* Base URL */}
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Base URL</label>
        <input
          value={s.aiBaseUrl}
          onChange={e => update('aiBaseUrl', e.target.value)}
          placeholder="https://api.deepseek.com/v1"
          className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)] font-mono"
        />
        <p className="text-[11px] text-[var(--text-muted)]">OpenAI: https://api.openai.com/v1 · DeepSeek: https://api.deepseek.com/v1</p>
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-[var(--text-secondary)]">模型名称</label>
        <input
          value={s.aiModel}
          onChange={e => update('aiModel', e.target.value)}
          placeholder="deepseek-chat"
          className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
        />
        <p className="text-[11px] text-[var(--text-muted)]">deepseek-chat / gpt-4o-mini / 或其他兼容模型名</p>
      </div>
    </div>
  )
}
