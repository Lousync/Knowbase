import { useSettings } from '../../../lib/SettingsContext'
import { SettingSelect } from '../components/SettingSelect'

/**
 * 设置 → 模块设置 → 日程任务。
 * 四项：完成反馈强度 / 四象限图标方案 / 四象限排序 / 四象限是否显示文字。
 * 数据层不变 —— 四象限存储值恒为 0/1/2/3，这里只影响呈现。
 */
export function ScheduleView() {
  const { s, update } = useSettings()

  return (
    <div>
      <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-1">日程任务</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-4">
        任务完成时的反馈强度，以及四象限选项的图标、排序与文字呈现。
      </p>

      <div className="space-y-7 max-w-xl">
        <div data-setting-anchor="schedule.feedback">
          <SettingSelect
            title="任务完成反馈"
            description="勾选任务时的反馈动效强度；档位越高，完成时的仪式感越强。"
            value={s.scheduleFeedbackLevel}
            onChange={v => update('scheduleFeedbackLevel', v)}
            options={[
              { id: 'light', label: '轻 · 微交互', desc: '勾选框回弹 + 勾号描边 + 涟漪 + 删除线划出' },
              { id: 'medium', label: '中 · 行内动效', desc: '轻档全部 + 粒子飞散 + 整行泛绿闪 + 条目退场位移', isDefault: true },
              { id: 'heavy', label: '重 · 庆祝 + 音效', desc: '中档全部 + 完成音效（合成「叮」）；待办清空时彩纸庆祝' },
            ]}
          />
        </div>

        <div data-setting-anchor="schedule.quadrantIcon">
          <SettingSelect
            title="四象限图标"
            description="编辑任务与任务卡片上四象限标记的图标样式；四种方案都按紧迫度点亮。"
            value={s.scheduleQuadrantIcon}
            onChange={v => update('scheduleQuadrantIcon', v)}
            options={[
              { id: 'bars', label: '信号格（强度条）', desc: '四根递增柱体，亮起的根数代表紧迫度', isDefault: true },
              { id: 'flame', label: '火焰', desc: '1~3 团火焰，数量越多越紧迫' },
              { id: 'step', label: '上升阶梯', desc: '四级台阶，圆点标出所在档位' },
              { id: 'grid', label: '迷你象限', desc: '2×2 微缩网格，点亮所在象限（右=紧急、上=重要）' },
            ]}
          />
        </div>

        <div data-setting-anchor="schedule.quadrantOrder">
          <SettingSelect
            title="四象限排序"
            description="四象限选项的排列顺序（编辑弹窗与四象限视图同步生效）。"
            value={s.scheduleQuadrantOrder}
            onChange={v => update('scheduleQuadrantOrder', v)}
            options={[
              { id: 'ladder', label: '紧迫阶梯（从左到右递增）', desc: '不紧急不重要 → 重要不紧急 → 紧急不重要 → 紧急重要', isDefault: true },
              { id: 'legacy', label: '保持原顺序', desc: '紧急重要 · 重要不紧急 · 紧急不重要 · 不紧急不重要' },
            ]}
          />
        </div>

        <div data-setting-anchor="schedule.quadrantText">
          <SettingSelect
            title="四象限文字"
            description="是否在四象限图标旁显示文字标签（任务卡片与编辑弹窗同时生效）。"
            value={s.scheduleQuadrantText}
            onChange={v => update('scheduleQuadrantText', v)}
            options={[
              { id: 'show', label: '图标 + 文字', desc: '最直观，占用空间略大', isDefault: true },
              { id: 'hide', label: '纯图标', desc: '更紧凑；鼠标悬停可查看含义' },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
