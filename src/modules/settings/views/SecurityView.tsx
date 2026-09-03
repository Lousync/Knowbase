import { Lock, KeyRound } from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'

/** 设置 → 安全与隐私：锁屏 / 删除确认 / 插件安全 */
export function SecurityView() {
  const { s, update } = useSettings()

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">安全与隐私</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">锁屏、误删防护与插件安全策略</p>

      {/* 锁屏 */}
      <div className="mb-8 space-y-3 max-w-md" data-setting-anchor="security.lock">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">锁屏</h3>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!!s.lockOnStartup}
            onChange={(e) => update('lockOnStartup', e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
            <Lock size={13} className="text-[var(--text-muted)]" />
            启动应用后自动锁屏
          </span>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
          <KeyRound size={13} className="text-[var(--text-muted)] shrink-0" />
          锁屏密码
        </label>
        <input
          type="password"
          value={s.lockPassword ?? ''}
          onChange={(e) => update('lockPassword', e.target.value)}
          placeholder="留空 = 点击即可解锁"
          spellCheck={false}
          className="w-full px-2.5 py-1.5 text-[12px] bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
        />
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          设置密码后，锁屏界面需输入密码才能进入；忘记密码可前往数据目录的 settings.json 清空该字段。
        </p>
      </div>

      {/* 删除确认 */}
      <div className="mb-8" data-setting-anchor="advanced.deleteConfirm">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">删除确认</h3>
        <div className="space-y-2.5 max-w-sm">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过博客删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_blog}
              onChange={() => update('skipDeleteConfirm_blog', !s.skipDeleteConfirm_blog)}
              className="accent-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过知识库页面删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_knowledge}
              onChange={() => update('skipDeleteConfirm_knowledge', !s.skipDeleteConfirm_knowledge)}
              className="accent-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过目录/笔记本删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_knowledgeCategory}
              onChange={() => update('skipDeleteConfirm_knowledgeCategory', !s.skipDeleteConfirm_knowledgeCategory)}
              className="accent-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过章节删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_chapter}
              onChange={() => update('skipDeleteConfirm_chapter', !s.skipDeleteConfirm_chapter)}
              className="accent-[var(--accent)]" />
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-2 leading-relaxed">
          关闭"跳过"即恢复删除前的确认弹窗，防止误删。
        </p>
      </div>

      {/* 插件安全 */}
      <div className="space-y-3 max-w-md" data-setting-anchor="security.plugin">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">插件安全</h3>
        <div>
          <label className="block text-[12px] text-[var(--text-secondary)] mb-1">允许的插件安全等级</label>
          <input
            value={s.pluginAllowedLevels ?? 'S,A,B'}
            onChange={(e) => update('pluginAllowedLevels', e.target.value)}
            spellCheck={false}
            className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
          />
          <p className="text-[11px] text-[var(--text-muted)] mt-1">逗号分隔（S/A/B）；C 级能力插件需逐项授权</p>
        </div>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[13px] text-[var(--text-primary)]">市场插件强制签名校验</span>
          <input type="checkbox" checked={!!s.pluginRequireSignature}
            onChange={(e) => update('pluginRequireSignature', e.target.checked)}
            className="accent-[var(--accent)]" />
        </label>
        <div>
          <label className="block text-[12px] text-[var(--text-secondary)] mb-1">受信公钥 keyring</label>
          <textarea
            value={s.pluginTrustedKeys ?? ''}
            onChange={(e) => update('pluginTrustedKeys', e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder='JSON（如 {"author1":"公钥"}）或 keyId=公钥 逗号分隔'
            className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)] resize-y"
          />
        </div>
      </div>
    </div>
  )
}
