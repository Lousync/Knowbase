import { useState } from 'react'
import type { TabName } from './types'
import { TitleBar, TabBar, StatusBar } from './components/shared'
import { BlogModule } from './modules/blog'
import { ScheduleModule } from './modules/schedule'
import { KnowledgeModule } from './modules/knowledge'
import { ExportModule } from './modules/export'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('blog')

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] overflow-hidden">
      {/* VS Code 风格自定义标题栏 */}
      <TitleBar />

      {/* 模块切换 Tab */}
      <TabBar activeTab={activeTab} onChange={setActiveTab} />

      {/* 模块内容区 */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'blog' && <BlogModule />}
        {activeTab === 'schedule' && <ScheduleModule />}
        {activeTab === 'knowledge' && <KnowledgeModule />}
        {activeTab === 'export' && <ExportModule />}
      </main>

      {/* VS Code 风格底部状态栏 */}
      <StatusBar />
    </div>
  )
}
