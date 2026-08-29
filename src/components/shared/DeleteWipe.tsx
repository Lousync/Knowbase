import React, { useEffect, useState } from 'react'
import type { DeleteFxSkin } from '../../types'
import { getDeleteFxSkin } from '../../lib/deleteFx'

/**
 * 删除吞噬特效：条目从右往左被红色"进度条"式吞噬（与删除进度同步）。
 * 外观可被插件替换（contributes.deleteFx）：
 *   - dragonSvg：可选装饰（龙头等 SVG，默认内置无装饰）
 *   - particleColors：可选粒子（默认无）
 *   - wipeColor / durationMs：吞噬色与推进时长
 * 内置默认 = 纯红色进度条（--danger 双主题兼容）。
 */

export function DeleteWipe() {
  const [skin, setSkin] = useState<DeleteFxSkin | null>(null)

  useEffect(() => {
    let alive = true
    void getDeleteFxSkin().then(s => { if (alive) setSkin(s) })
    return () => { alive = false }
  }, [])

  const wipeColor = skin?.wipeColor
  const durationMs = skin?.durationMs ?? 1100
  const particles = skin?.particleColors

  return (
    <div
      className="kb-delete-fx"
      aria-hidden
      style={{
        ['--kb-wipe' as string]: wipeColor ?? 'var(--danger)',
        ['--kb-dur' as string]: `${durationMs}ms`,
      }}
    >
      {/* 红色吞噬进度条（始终渲染，删除中推进到半程、完成时吞满） */}
      <div className="kb-wipe-fill" />
      {/* 可选：插件装饰（龙头等 SVG，完整 <svg> 注入，已安全校验） */}
      {skin?.dragonSvg && (
        <div className="kb-dragon kb-dragon-skin" dangerouslySetInnerHTML={{ __html: skin.dragonSvg }} />
      )}
      {/* 可选：插件粒子（未提供则不渲染） */}
      {particles && particles.length > 0 && [1, 2, 3, 4, 5, 6].map(i => {
        const color = particles[(i - 1) % particles.length]
        return <span key={i} className={`kb-particle kb-p${i}`} style={{ ['--p' as string]: color }} />
      })}
    </div>
  )
}
