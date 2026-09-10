import { useSettings } from '../../../lib/SettingsContext'
import { SettingSelect } from '../components/SettingSelect'
import { NumberField } from '../components/fields/NumberField'

/**
 * 设置 → 模块设置 → 日程任务。
 * 前四项：完成反馈强度 / 四象限图标方案 / 四象限排序 / 四象限是否显示文字。
 * 后四项：日程表（周视图）的粒度、行高、时间轴起止小时。
 * 数据层不变 —— 四象限存储值恒为 0/1/2/3，这里只影响呈现。
 */
export function ScheduleView() {
  const { s, update } = useSettings()

  return (
    <div>
      <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-1">日程任务</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-4">
        任务完成时的反馈强度、四象限选项的呈现方式，以及日程表视图的时间轴刻度、行高与显示范围。
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

        {/* ---- 日程表（周视图）---- */}
        <div data-setting-anchor="schedule.timetableGranularity">
          <SettingSelect
            title="日程表粒度"
            description="时间轴的刻度细分与拖拽时的吸附步长；粒度越细，越能排出短会。"
            value={s.scheduleTimetableGranularity}
            onChange={v => update('scheduleTimetableGranularity', v)}
            options={[
              { id: '15', label: '15 分钟', desc: '刻度最细，适合会议密集、需要排短时段' },
              { id: '30', label: '30 分钟', desc: '刻度与吸附都落在半小时上（默认）', isDefault: true },
              { id: '60', label: '1 小时', desc: '只画整点线，界面最干净；吸附也以小时为单位' },
            ]}
          />
        </div>

        <div data-setting-anchor="schedule.timetableRowHeight">
          <h3 className="text-[12.5px] font-medium text-[var(--text-primary)] mb-1">日程表行高</h3>
          <p className="text-[11.5px] text-[var(--text-muted)] mb-2.5 leading-relaxed">
            时间轴每小时占用的纵向高度。在日程表里按 <b className="text-[var(--text-secondary)]">Ctrl+滚轮</b> 或
            <b className="text-[var(--text-secondary)]"> Ctrl+加减号 </b>可随时连续缩放（会记住），
            <b className="text-[var(--text-secondary)]"> Ctrl+0 </b>复位到舒适档。
          </p>
          <NumberField
            value={s.scheduleTimetableRowHeight}
            onCommit={v => update('scheduleTimetableRowHeight', v)}
            min={24}
            max={160}
            step={2}
            unit="px"
            presets={[44, 60, 78]}
            defaultValue={60}
          />
        </div>

        <div data-setting-anchor="schedule.timetableStartHour">
          <SettingSelect
            title="日程表起始时间"
            description="时间轴每天从几点开始显示；范围之外的时段不占纵向空间，早睡早起或熬夜作息各不相同。"
            value={s.scheduleTimetableStartHour}
            onChange={v => update('scheduleTimetableStartHour', v)}
            options={HOUR_OPTIONS.slice(0, 8).map(o => ({ ...o, isDefault: o.id === '7' }))}
          />
        </div>

        <div data-setting-anchor="schedule.timetableEndHour">
          <SettingSelect
            title="日程表终止时间"
            description="时间轴每天到几点结束显示；需比起始时间至少晚 4 小时。"
            value={s.scheduleTimetableEndHour}
            onChange={v => update('scheduleTimetableEndHour', v)}
            options={HOUR_OPTIONS.slice(8).map(o => ({ ...o, isDefault: o.id === '23' }))}
          />
        </div>
      </div>
    </div>
  )
}

/** 起止小时的候选档位（起始 05–12 点，终止 16–24 点，覆盖常见作息） */
const HOUR_OPTIONS = [
  ...Array.from({ length: 8 }, (_, i) => {
    const h = i + 5
    return { id: String(h), label: `${String(h).padStart(2, '0')}:00`, desc: '' }
  }),
  ...Array.from({ length: 9 }, (_, i) => {
    const h = i + 16
    return { id: String(h), label: `${h}:00`, desc: '' }
  }),
]
