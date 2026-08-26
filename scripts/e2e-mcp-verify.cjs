/* eslint-disable */
/**
 * M2 全链路验收驱动：拉起构建产物(带 CDP 端口) → 通过 CDP 在页面上下文执行验收步骤 → 输出结果 → 清理。
 * 用法: node .e2e-mcp.cjs
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe')
const MAIN = path.join(ROOT, 'out/main/index.js')
const TEST_SERVER = path.join(ROOT, 'scripts/dev-mcp-test-server.cjs')
const MOCK_LLM = path.join(ROOT, 'scripts/dev-mock-llm.cjs')
const PORT = 9333
const MOCK_PORT = 8971

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function getPageWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* not ready */ }
    await sleep(1000)
  }
  throw new Error('CDP endpoint 未就绪')
}

let msgId = 0
const pending = new Map()

function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时: ${method}`)) }
    }, 60000)
  })
}

async function evaluate(ws, label, expression) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (r.exceptionDetails) {
    const desc = r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)
    return { label, ok: false, error: String(desc).slice(0, 300) }
  }
  return { label, ok: true, value: r.result?.value ?? null }
}

async function main() {
  console.log('[e2e] 启动应用...')
  const mock = spawn(process.execPath, [MOCK_LLM, String(MOCK_PORT)], { stdio: 'ignore' })
  await sleep(800)
  // 以工程根(含 package.json)为应用入口启动 → getAppPath()=根目录,与 dev 模式语义一致
  const child = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`, ROOT], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderrTail = ''
  child.stderr.on('data', d => { stderrTail += d; if (stderrTail.length > 8000) stderrTail = stderrTail.slice(-4000) })
  child.stdout.on('data', () => { /* drain */ })

  const results = []
  let ws = null
  try {
    const wsUrl = await getPageWsUrl()
    const ws = new WebSocket(wsUrl)
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id); pending.delete(msg.id)
          p.resolve(msg.result || {})
        }
      } catch { /* ignore malformed */ }
    }
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

    // 等渲染层 api 就绪
    for (let i = 0; i < 20; i++) {
      const ready = await evaluate(ws, 'ready', 'return typeof window.api !== "undefined" && typeof window.api.mcpListServers === "function"')
      if (ready.value === true) break
      await sleep(500)
    }

    const run = (label, expr) => evaluate(ws, label, expr).then(r => { results.push(r); console.log(JSON.stringify(r)); return r })

    // ===== M1: 内置工具全量冒烟（先于 MCP，避免限额计数干扰） =====

    // 知识库搜索：只断言链路 ok（库可能为空）
    await run('b1-knowledge-search', `
      return window.api.aiToolsInvoke('builtin.knowledge.search', {query:'e'}).then(r => ({ ok:r.ok, hits:Array.isArray(r.data)?r.data.length:0 }))
    `)
    // 读不存在页面 → 明确报错而非挂死
    await run('b2-read-missing', `
      return window.api.aiToolsInvoke('builtin.knowledge.read', {id:'no-such-page'}).then(r=>r.code).catch(()=>EXEC_ERROR)
    `)
    // 入参校验
    await run('b3-invalid-args', `
      return window.api.aiToolsInvoke('builtin.knowledge.search', {}).then(r => r.code)
    `)
    // 习惯列表/统计
    const h = await run('b4-habits', `
      return window.api.createHabit({name:'M1冒烟习惯'}).then(hab =>
        window.api.toggleHabitCheck(hab.id, new Date().toISOString().slice(0,10)).then(() =>
          window.api.aiToolsInvoke('builtin.habits.list', {}).then(r => {
            const mine = (r.data||[]).find(x => x.name==='M1冒烟习惯')
            return window.api.aiToolsInvoke('builtin.habits.stats', {}).then(s => ({
              listed: !!mine, checkedToday: !!mine && mine.checkedToday === true,
              statsHasMine: (s.data||[]).some(x => x.name==='M1冒烟习惯' && x.currentStreak >= 1),
              habitId: hab.id,
            }))
          })
        )
      )
    `)
    if (!(h.value || {}).listed) throw new Error('habits.list 未返回新建习惯')
    if (!(h.value || {}).checkedToday) throw new Error('今日打卡状态未同步到 habits.list')
    // 书签搜索（无数据时也应 ok 空数组）
    await run('b5-bookmarks', `
      return window.api.aiToolsInvoke('builtin.bookmarks.search', {query:'a'}).then(r => ({ ok:r.ok, arr:Array.isArray(r.data) }))
    `)
    // 番茄统计结构
    await run('b6-pomodoro', `
      return window.api.aiToolsInvoke('builtin.pomodoro.summary', {days:7}).then(r => ({ ok:r.ok, days:(r.data.days||[]).length, hasTotal: typeof r.data.totalMinutes==='number' }))
    `)
    // 上限拦截：把上限设为当前用量 → 再调必被拒 → 恢复不限
    await run('b7-limit-exceeded', `
      return window.api.aiToolsGetUsage().then(u =>
        window.api.setSetting('aiToolMonthlyLimit', Math.max(1, u.used)).then(async () => {
          const r = await window.api.aiToolsInvoke('builtin.pomodoro.summary', {})
          await window.api.setSetting('aiToolMonthlyLimit', 0)
          return { code:r.code }
        })
      )
    `)
    // 清理种子习惯
    await run('b8-cleanup-habit', `
      return window.api.habitGetAll().then(async all => {
        for (const x of all.habits.filter(x => x.name==='M1冒烟习惯')) await window.api.deleteHabit(x.id)
        return { done:true }
      })
    `)

    // ===== M1.5: 模块权限 =====

    const DEFAULT_PERMS = '{"knowledge":"read","blog":"read","schedule":"read","checkin":"read","bookmarks":"read","pomodoro":"read"}'

    // p1 默认只读：blog 写工具应被拒（MODULE_READONLY）
    await run('perm-write-denied-default', `
      return window.api.aiToolsInvoke('builtin.blog.create-entry', { title:'x', contentMd:'y' }).then(r => r.code)
    `)

    // p2 读工具默认可用（schedule.listTodos）
    await run('perm-schedule-read-ok', `
      return window.api.aiToolsInvoke('builtin.schedule.list-todos', {}).then(r => ({ ok:r.ok, arr:Array.isArray(r.data) }))
    `)

    // p3 放行 blog 写 → 真实创建 → 全文搜索验证落库
    await run('perm-write-allowed', `
      return window.api.getSetting('aiModulePermissions').then(raw => {
        const obj = raw ? JSON.parse(raw) : {}
        obj.blog = 'write'
        return window.api.setSetting('aiModulePermissions', JSON.stringify(obj))
      }).then(() =>
        window.api.aiToolsInvoke('builtin.blog.create-entry', { title:'E2E AI日记', contentMd:'由 AI 权限测试创建' })
      ).then(r => ({ ok:r.ok, id:r.data&&r.data.id, err:r.message }))
    `)
    const w = await run('perm-write-verify-db', `
      return window.api.searchEntries('E2E AI日记').then(list => ({ hits:list.length }))
    `)
    if (!((w.value || {}).hits > 0)) throw new Error('放行后的 AI 写入未在数据库中找到')

    // p4 模块设为 off → 连读都被拒
    await run('perm-off-blocks-read', `
      return window.api.getSetting('aiModulePermissions').then(raw => {
        const obj = raw ? JSON.parse(raw) : {}
        obj.knowledge = 'off'
        return window.api.setSetting('aiModulePermissions', JSON.stringify(obj))
      }).then(() => window.api.aiToolsInvoke('builtin.knowledge.search', {query:'e'}).then(r => ({code:r.code})))
    `)

    // p5 恢复默认权限 + 清理测试日记（走回收站接口，避免残留）
    await run('perm-restore-and-clean', `
      return window.api.setSetting('aiModulePermissions', '${DEFAULT_PERMS}').then(async () => {
        const entries = await window.api.searchEntries('E2E AI日记')
        for (const e of entries) await window.api.deleteEntry(e.id)
        const check = await window.api.aiToolsInvoke('builtin.knowledge.search', {query:'e'})
        return { restored: check.ok }
      })
    `)

    // ===== M2: MCP 全链路 =====

    // 0. 清理上次运行残留
    await run('cleanup-leftovers', `
      return window.api.mcpListServers().then(async list => {
        const removed = []
        for (const sv of list.filter(s => s.name === 'e2e-echo')) {
          await window.api.mcpRemoveServer(sv.id)
          removed.push(sv.id)
        }
        return { removed }
      })
    `)

    // 1. 初始列表
    const s0 = await run('list-initial', 'return window.api.mcpListServers().then(l => ({count:l.length}))')

    // 2. 添加 stdio server（带确认+env）
    const added = await run('add-server', `
      return window.api.mcpAddServer({
        name: 'e2e-echo', transport: 'stdio',
        command: ${JSON.stringify(process.execPath)}, commandArgs: [${JSON.stringify(TEST_SERVER)}],
        env: { TEST_ENV: 'secret-value' }, confirmCommand: true,
      }).then(sv => ({ id: sv.id, enabled: sv.enabled, status: sv.status, envKeys: sv.envKeys, preview: sv.endpointPreview.slice(0, 60) }))
    `)
    const serverId = added.value?.id
    if (!serverId) throw new Error('添加服务器失败: ' + JSON.stringify(added))

    // 3. stdio 未确认必须被拒
    await run('unconfirmed-rejected', `
      return window.api.mcpAddServer({ name:'bad', transport:'stdio', command:'calc', confirmCommand:false })
        .then(() => ({ rejected:false }))
        .catch(e => ({ rejected:true, msg:String(e).slice(0,80) }))
    `)

    // 4. 启用 → 连接 + 工具发现 + 注册表可见 mcp.* 工具
    await run('enable', `
      return window.api.mcpToggleServer(${JSON.stringify(serverId)}, true)
        .then(r => ({ok:r.ok, status:r.status, toolCount:r.toolCount, error:r.error||'', lastError:r.lastError||''}))
    `)
    const listed = await run('registry-has-tools', `
      return window.api.aiToolsList().then(r => ({
        total: r.tools.length,
        mcpTools: r.tools.filter(t => t.source==='mcp').map(t=>t.name),
      }))
    `)

    // 5. 经注册表调用 echo（走完整校验/审计/上限链路）
    await run('invoke-echo', `
      return window.api.aiToolsInvoke('mcp.${serverId}.echo', { text: 'hello-knowbase' }).then(r => r.data.content[0].text)
    `)

    // 6. env 加密传递验证（工具名已按注册表规则小写化）
    await run('invoke-env', `
      return window.api.aiToolsInvoke('mcp.${serverId}.readtestenv', {}).then(r => {
        if (!r.ok) throw new Error('invoke failed: ' + (r.message||r.code))
        return r.data.content[0].text
      })
    `)

    // 7. 大响应截断
    await run('big-truncated', `
      return window.api.aiToolsInvoke('mcp.${serverId}.bigoutput', {}).then(r => {
        if (!r.ok) throw new Error('invoke failed: ' + (r.message||r.code))
        return { truncated: !!r.data.__truncated, len: (r.data.data||'').length }
      })
    `)

    // 8. 入参校验（缺 required 参数）
    await run('invalid-args', `
      return window.api.aiToolsInvoke('mcp.${serverId}.echo', {}).then(r => r.code)
    `)

    // 9. 审计含 mcp.invoke 且无明文 secret
    await run('audit', `
      return window.api.aiToolsGetRecentAudit(20).then(list => ({
        hasMcpInvoke: list.some(e => e.action==='mcp.invoke' && e.detail.includes('echo')),
        noPlaintextSecret: !list.some(e => e.detail.includes('secret-value')),
        count: list.length,
        actions: [...new Set(list.map(e => e.action))],
      }))
    `)

    // 10. 月度用量已计入 mcp.invoke
    await run('usage-counts-mcp', `
      return window.api.aiToolsGetUsage().then(u => ({ used: u.used, limit: u.limit }))
    `)

    // ===== M3: Skill 包体系 =====

    // 11. 内置官方技能包已被聚合（builtin 落位发生在启动阶段）
    const skills0 = await run('skills-builtin-present', `
      return window.api.aiToolsListSkills().then(r => ({
        ids: r.skills.map(s => s.registryName),
      }))
    `)
    const hasWeekly = JSON.stringify(skills0.value || {}).includes('skill.knowbase.skill-pack.weekly-review')
    if (!hasWeekly) throw new Error('内置技能包未出现在 Skill 列表')

    // 12. 注册表可见 skill.* 条目
    await run('registry-has-skill', `
      return window.api.aiToolsList().then(r => ({
        skills: r.tools.filter(t => t.source==='skill').map(t => t.name),
      }))
    `)

    // 13. 调用 Skill = 返回变量替换后的提示词
    await run('invoke-skill-render', `
      return window.api.aiToolsInvoke('skill.knowbase.skill-pack.weekly-review', { context: '测试上下文ABC' }).then(r => {
        const p = r.data && r.data.prompt
        return { ok:r.ok, substituted: p ? p.includes('测试上下文ABC') : false, noPlaceholder: p ? !p.includes('{{context}}') : false }
      })
    `)

    // 14. 缺少必填变量 → INVALID_ARGS
    await run('skill-invalid-args', `
      return window.api.aiToolsInvoke('skill.knowbase.skill-pack.weekly-review', {}).then(r => r.code)
    `)

    // 15. 复制提示词
    await run('copy-prompt', `
      return window.api.aiToolsCopySkillPrompt('knowbase.skill-pack', 'weekly-review').then(ok => ({ copied: ok === true }))
    `)

    // 16. 禁用插件 → Skill 即时下线；再启用恢复
    await run('plugin-disable-skill-gone', `
      return window.api.pluginSetEnabled('knowbase.skill-pack', false).then(async s1 => {
        const list = await window.api.aiToolsListSkills()
        const reg = await window.api.aiToolsList()
        await window.api.pluginSetEnabled('knowbase.skill-pack', true)
        const list2 = await window.api.aiToolsListSkills()
        return {
          disableOk: s1.success,
          goneAfterDisable: !list.skills.some(s => s.pluginId==='knowbase.skill-pack'),
          registryGone: !reg.tools.some(t => t.name.startsWith('skill.knowbase.skill-pack')),
          backAfterEnable: list2.skills.some(s => s.pluginId==='knowbase.skill-pack'),
        }
      })
    `)

    // ===== Model Gateway + 最小 Agent =====

    // 17. 错误 Key 必须被拒（验证鉴权链路）
    const wrongKey = await run('llm-wrong-key-rejected', `
      return window.api.llmTestConnection({ type:'openai-compatible', baseUrl:'http://127.0.0.1:${MOCK_PORT}', apiKey:'wrong-key' })
        .then(r => ({ ok:r.ok, error:(r.error||'').slice(0,60) }))
    `)
    if ((wrongKey.value || {}).ok !== false) throw new Error('错误 Key 未被拒绝: ' + JSON.stringify(wrongKey.value))

    // 18. 正确保存供应商 + 连通性测试发现 2 个模型
    await run('llm-save-and-test', `
      return window.api.llmSaveProvider({ name:'mock', type:'openai-compatible', baseUrl:'http://127.0.0.1:${MOCK_PORT}', apiKey:'mock-key' })
        .then(async s => {
          const list = await window.api.llmListProviders()
          const p = list.providers.find(x => x.id === s.id)
          const test = await window.api.llmTestConnection({ type:'openai-compatible', baseUrl:'http://127.0.0.1:${MOCK_PORT}', apiKey:'mock-key' })
          return { saved:s.ok, hasKey:p.hasKey, models:p.models.length, testOk:test.ok, testModels:(test.models||[]).length }
        })
    `)
    const provList = await run('llm-provider-id', 'return window.api.llmListProviders().then(r => r.providers.map(p=>p.id))')
    const providerId = (provList.value || [])[0]
    if (!providerId) throw new Error('provider id missing')

    // 19. 设默认模型
    await run('llm-set-default', `
      return window.api.llmSetDefaultModel('${providerId}:mock-mini').then(async s => {
        const l = await window.api.llmListProviders()
        return { ok:s.ok, default:l.defaultChatModel }
      })
    `)

    // 19b. CC Switch 扫描（只读）：应发现本机供应商，且 Key 全程打码无明文
    await run('ccswitch-scan', `
      return window.api.llmCcSwitchList().then(r => ({
        found: r.found,
        count: r.items.length,
        masked: r.items.every(i => i.keyPreview.includes('***')),
        noPlaintext: !/sk-[A-Za-z0-9]{16,}/.test(JSON.stringify(r.items)),
      }))
    `)

    // 20. 预算拦截：预算设为 1 → agent 立即 BUDGET_EXCEEDED → 恢复 0
    await run('budget-blocked', `
      return window.api.setSetting('monthlyTokenBudget', 1).then(async () => {
        const r = await window.api.agentChat({ messages:[{role:'user',content:'hi'}] })
        await window.api.setSetting('monthlyTokenBudget', 0)
        return { code: r.code, ok: r.ok }
      })
    `)

    // 21. 种子习惯 + Agent 全链路：LLM 决策调 builtin.habits.list → 数据回喂 → 最终回复引用真实习惯名
    await run('seed-habit', `
      return window.api.createHabit({ name:'E2E打卡习惯' }).then(h => ({ id:h.id, name:h.name }))
    `)
    const habitSeed = await run('agent-chat-full', `
      return window.api.agentChat({ messages:[{ role:'user', content:'看看我的打卡情况，不要编造' }] }).then(r => ({
        ok: r.ok,
        replyHit: (r.reply||'').includes('E2E打卡习惯'),
        llmSteps: r.trace.filter(t=>t.kind==='llm').length,
        toolSteps: r.trace.filter(t=>t.kind==='tool' && t.name==='builtin.habits.list' && t.ok).length,
        error: r.error,
      }))
    `)
    if (!(habitSeed.value || {}).replyHit) throw new Error('Agent 回复未引用工具返回的真实数据: ' + JSON.stringify(habitSeed))

    // 22. token 记账 + 审计不含消息正文/明文
    await run('llm-audit-clean', `
      return window.api.llmGetUsage().then(u =>
        window.api.aiToolsGetRecentAudit(30).then(list => ({
          monthTokensAtLeast300: u.monthTokens >= 300,
          hasLlmInvoke: list.some(e => e.action==='llm.invoke' && e.detail.includes('"tokens"')),
          noUserTextLeak: !list.some(e => e.detail.includes('不要编造') || e.detail.includes('打卡情况')),
        }))
      )
    `)

    // 23. 清理：删习惯 / 删供应商 / 清默认模型
    await run('gateway-cleanup', `
      return (async () => {
        for (const h of (await window.api.habitGetAll()).habits.filter(h => h.name==='E2E打卡习惯')) {
          await window.api.deleteHabit(h.id)
        }
        for (const p of (await window.api.llmListProviders()).providers) await window.api.llmRemoveProvider(p.id)
        await window.api.llmSetDefaultModel('')
        return { cleaned:true }
      })()
    `)

    // 11. 禁用 → 工具下线
    await run('disable', `return window.api.mcpToggleServer(${JSON.stringify(serverId)}, false).then(r => ({ok:r.ok, toolCount:r.toolCount}))`)
    await run('tool-gone', `
      return window.api.aiToolsInvoke('mcp.${serverId}.echo', {text:'x'}).then(r => r.code)
    `)

    // 12. 删除
    await run('remove', `return window.api.mcpRemoveServer(${JSON.stringify(serverId)}).then(ok => ({removed:ok}))`)

    ws.close()
  } catch (err) {
    results.push({ label: 'FATAL', ok: false, error: String(err && err.message || err) })
    console.log(JSON.stringify(results[results.length - 1]))
  } finally {
    try { child.kill() } catch {}
    await sleep(1500)
    try { process.kill(child.pid, 'SIGKILL') } catch {}
    try { mock.kill() } catch {}

    // 数据文件明文检查（应用退出后读库，确保 env 密文落盘、审计无敏感值）
    try {
      const devDirName = `knowbase (dev ${path.basename(ROOT)})`
      const dbPath = path.join(process.env.APPDATA, devDirName, 'data', 'knowledge.db')
      if (!fs.existsSync(dbPath)) throw new Error(`验收库不存在: ${dbPath}`)
      {
        const initSqlJs = require('sql.js')
        const SQL = await initSqlJs()
        const db = new SQL.Database(fs.readFileSync(dbPath))
        let leakFound = false
        for (const table of ['mcp_servers', 'plugin_audit_log']) {
          const res = db.exec(`SELECT * FROM ${table}`)
          for (const t of res) {
            for (const row of t.values) {
              for (const cell of row) {
                if (typeof cell === 'string' && cell.includes('secret-value')) { leakFound = true; console.log(`[e2e] 明文泄露于 ${table}`) }
              }
            }
          }
        }
        results.push({ label: 'db-no-secret', ok: !leakFound, value: { leakFound } })
        console.log(JSON.stringify(results[results.length - 1]))
      }
    } catch (e) {
      results.push({ label: 'db-no-secret', ok: false, error: String(e).slice(0, 200) })
      console.log(JSON.stringify(results[results.length - 1]))
    }
  }

  const fatal = results.find(r => !r.ok)
  if (fatal) {
    console.log('[e2e] 存在失败步骤, 主进程 stderr 尾部:\n' + stderrTail.slice(-2000))
    process.exit(1)
  }
  console.log('[e2e] ALL PASS')
}

main()
