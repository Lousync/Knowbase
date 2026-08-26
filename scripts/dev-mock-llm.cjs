/**
 * 本地 mock OpenAI 兼容服务 —— 供模型网关 / Agent 循环离线全链路验收。
 * 行为（脚本化两轮）：
 *   第 1 轮 chat/completions → 返回 tool_calls: builtin.habits.list
 *   第 2 轮（messages 里已带 tool 结果）→ 返回最终文本，引用工具结果中的关键词
 * 另提供 GET /models。
 * 用法：node scripts/dev-mock-llm.cjs [port]
 */
const http = require('http')

const port = Number(process.argv[2] || 8971)

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', d => { body += d })
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/models') {
      // 鉴权与 chat 同标准：错误 Key 一律 401
      if (String(req.headers.authorization ?? '') !== 'Bearer mock-key') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-mini' }, { id: 'mock-pro' }] }))
      return
    }
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let parsed = {}
      try { parsed = JSON.parse(body) } catch { /* ignore */ }
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
      const hasToolResult = messages.some(m => m.role === 'tool')
      const auth = String(req.headers.authorization ?? '')
      // Key 校验：仅接受 Bearer mock-key（验证网关鉴权链路）
      if (auth !== 'Bearer mock-key') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
        return
      }
      const usage = { prompt_tokens: 120, completion_tokens: 40 }
      if (!hasToolResult) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'chatcmpl-mock-1', object: 'chat.completion',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_mock_1', type: 'function',
                function: { name: 'builtin.habits.list', arguments: '{}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage,
        }))
        return
      }
      // 第二轮：从 tool 消息里提取一个习惯名，证明真实数据回流
      const toolMsg = messages.find(m => m.role === 'tool')
      let habitName = '未知习惯'
      try {
        const d = JSON.parse(toolMsg.content)
        const habit = (d.data || []).find(h => !h.archived)
        if (habit) habitName = habit.name
      } catch { /* keep default */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-mock-2', object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: `你的习惯「${habitName}」数据已查到，本周继续保持！` }, finish_reason: 'stop' }],
        usage,
      }))
      return
    }
    res.writeHead(404).end()
  })
})

server.listen(port, '127.0.0.1', () => console.log(`mock llm listening on http://127.0.0.1:${port}`))
