import { BlogView } from './BlogView'
import { ReminderView } from './ReminderView'
import { AiTeachingView } from './AiTeachingView'

/** 设置 → 模块设置：业务模块专属偏好（博客 / AI教学 / 打卡提醒），二期随自动表单细化分域 */
export function ModulesView() {
  return (
    <div>
      <div className="mb-8">
        <BlogView />
      </div>
      <div className="mb-8">
        <AiTeachingView />
      </div>
      <ReminderView />
    </div>
  )
}
