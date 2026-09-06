/**
 * 设置模块通用开关（iOS 风格胶囊滑块）。
 * 规格见 docs/settings-switch-toggle-redesign.md §2：
 * - 关：浅灰轨道 + 1px 描边（内阴影实现，不占布局，杜绝状态间 1px 跳动）；开：主题色填充
 * - 滑块纯白圆点，位移走 translate，transition-all 过渡（Tailwind v4 translate 属性历史坑，勿用 transition-transform）
 * - role=switch + aria-checked；button 为 labelable 元素，外层 <label> 点文字可转发切换
 * - size=sm 用于紧凑面板（齿轮下拉等）
 */
export function SettingSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  size?: 'md' | 'sm'
  'aria-label'?: string
}) {
  const md = size === 'md'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 ${
        md ? 'w-9 h-5' : 'w-8 h-[18px]'
      } ${
        checked
          ? 'bg-[var(--accent)]'
          : 'bg-[var(--bg-tertiary)] shadow-[inset_0_0_0_1px_var(--border-color)]'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute rounded-full bg-white shadow-sm transition-all duration-200 ${
          md ? 'top-[2px] left-[2px] w-4 h-4' : 'top-[2px] left-[3px] w-3.5 h-3.5'
        } ${checked ? (md ? 'translate-x-4' : 'translate-x-3') : 'translate-x-0'}`}
      />
    </button>
  )
}
