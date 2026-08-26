/**
 * 本地 MCP stdio 测试服务器 —— 仅用于 M2 全链路验收。
 * 提供三个工具：echo（回显文本）、add(加法)、bigOutput（生成超大响应验证 256KB 截断）。
 * 用法：node scripts/dev-mcp-test-server.cjs
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

const server = new McpServer({ name: 'knowbase-test-server', version: '1.0.0' })

server.registerTool('echo', {
  description: '回显输入的文本',
  inputSchema: { text: z.string().describe('要回显的文本') },
}, async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }))

server.registerTool('add', {
  description: '两个整数相加',
  inputSchema: { a: z.number(), b: z.number() },
}, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }))

server.registerTool('bigOutput', {
  description: '返回超大响应（约600KB），用于验证客户端体积截断',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text', text: 'x'.repeat(600 * 1024) }],
}))

// 环境变量透传验证：启动时读取 TEST_ENV 并暴露为只读工具
server.registerTool('readTestEnv', {
  description: '返回环境变量 TEST_ENV 的值（验证 env 加密传递链路）',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text', text: process.env.TEST_ENV ?? '(unset)' }],
}))

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => { console.error(err); process.exit(1) })
