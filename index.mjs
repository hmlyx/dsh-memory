/**
 * dsh-memory — 对话记忆静态 profile 插件（host 半）
 *
 * 与 beauticode-dsh / dshmarket 同构的 profile 静态插件：
 *  - webServer 挂 /__memory/* HTTP 接口（client 半 fetch 调用）
 *  - tools.register 注册 memory_record 工具（全局，任何预设可用）
 *  - systemPrompt.context 注入名字
 *  - sessions / sessionTitle 服务操作侧栏标题
 *  - agent/session-start 事件自动命名
 *  - 直接用 node:fs 读写记忆目录（静态插件跑在 host 进程，无沙箱）
 *
 * 生命周期与进程一致：装上即永久生效，重启不消失，无需审批。
 *
 * ══════════════════════════════════════════════════════════════
 * 接口与功能目录（写给其他 AI：改这里前先看本目录，改完同步更新）
 * ══════════════════════════════════════════════════════════════
 * ── HTTP 接口（webServer.register，全部 /__memory/*）──
 *   GET  /__memory/state?session=           返回开关状态/名字/文件列表/记忆目录
 *   GET  /__memory/read?session=&name=      读取某个记忆文件内容
 *   POST /__memory/set-name {session,name}  设置本 AI 名字
 *   POST /__memory/set-master {enabled}     记忆总开关
 *   POST /__memory/set-enabled {enabled}    记录开关
 *   POST /__memory/set-autoname {enabled}   自动命名开关
 *   POST /__memory/set-sidebar-name {enabled} 本会话侧栏 AI 名
 *   POST /__memory/set-sidebar-all {enabled}  所有会话侧栏 AI 名
 * ── 注册的对外能力 ──
 *   工具 memory_record(kind=global/shared/brief/event/experience)，全局可用
 *   systemPrompt 注入 AI 名字（assembleCtx 取 agent.session）
 *   事件 agent/session-start → 自动分配名字 + 同步侧栏标题
 * ── 数据/目录 ──
 *   记忆目录：按会话工作区 cwd 探测「对话记忆/」子目录，只接受真实存在的目录，
 *   启动早期探测失败等 agent/session-start 重试（绝不 fallback 相对路径）。
 *   MEM_DIR 未探测时 readFile 返回 null、writeFile 抛错（防污染）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-memory'
export const inject = ['webServer']

const CONFIG = {
  memoryDirName: '对话记忆',
  memoryDirOverride: '',
  defaultAutoName: true,
  namePool: [
    '星野', '云舒', '南屿', '北冥', '白露', '青梧', '望舒', '扶摇', '知微', '见山',
    '若水', '栖迟', '听澜', '亦安', '初霁', '慕秋', '惊蛰', '白泽', '玄鸟', '青鸾',
    '灵犀', '鹿鸣', '花信', '拾光', '远岫', '松风', '竹影', '弦月', '逐光', '含章',
    '明昭', '既白', '疏影', '寻梅', '听雨', '观澜', '枕流', '洗砚', '弈秋', '观棋',
    '折桂', '揽月', '衔山', '渡云', '听泉', '问竹', '拾萤', '映雪', '流萤', '织雨',
  ],
}

const VERSION = '3.0.0'
const SHARED_FILES = ['共享记忆.md', '重大事件.md']
const STATE_FILE = '.memory-state.json'
const SHARED_HEADERS = {
  '共享记忆.md': '# 共享记忆\n\n> 可复用客观事实：目录结构、关键路径、工具用法、机制。所有 AI 可读写。\n\n',
  '重大事件.md': '# 重大事件\n\n> 事故、约定、关键决策。所有 AI 可读写。\n\n',
}

const MAX_BODY_BYTES = 64 * 1024

export function apply(ctx, config = {}) {
  const memoryDirName = config.memoryDirName || CONFIG.memoryDirName
  const memoryDirOverride = config.memoryDirOverride || CONFIG.memoryDirOverride
  const namePool = Array.isArray(config.namePool) && config.namePool.length > 0 ? config.namePool : CONFIG.namePool
  const defaultAutoName = typeof config.defaultAutoName === 'boolean' ? config.defaultAutoName : CONFIG.defaultAutoName

  let MEM_DIR = memoryDirOverride
  let dirCache = null
  const nameCache = new Map()
  const ensureInflight = new Map()
  let masterOn = true
  let sidebarAllOn = false

  /* 惰性获取 host 服务：apply 时未必全部就绪，用到时再取 */
  const sessionsSvc = () => ctx.get('sessions')
  const titleSvc = () => ctx.get('sessionTitle')

  /* ---------------- 目录与文件 ---------------- */

  async function detectDir(sessionId) {
    if (dirCache) return dirCache
    let dir = memoryDirOverride
    if (!dir) {
      const candidates = []
      try {
        const s = sessionsSvc() && sessionId ? sessionsSvc().get(sessionId) : undefined
        const cwd = s && s.header && s.header.cwd ? String(s.header.cwd).replace(/\\/g, '/') : ''
        if (cwd) candidates.push(path.join(cwd, memoryDirName).replace(/\\/g, '/'))
      } catch { /* 无会话信息 */ }
      // 只接受真实存在的目录；绝不用相对路径 fallback（服务器 cwd 会污染）
      for (const c of candidates) {
        try {
          const st = await fs.stat(c)
          if (st && st.isDirectory()) { dir = c; break }
        } catch { /* 不存在，尝试下一个 */ }
      }
      if (!dir) return { dir: null }  // 探测失败：等 agent/session-start 拿到会话 cwd 再试
    }
    MEM_DIR = String(dir).replace(/\\/g, '/').replace(/\/+$/, '')
    dirCache = { dir: MEM_DIR }
    return dirCache
  }
  async function ensureDir(sessionId) {
    if (!MEM_DIR) {
      const r = await detectDir(sessionId)
      if (!r.dir) return null
    }
    return MEM_DIR
  }

  async function readFile(name) {
    if (!MEM_DIR) return null
    try { return await fs.readFile(path.join(MEM_DIR, name), 'utf8') } catch { return null }
  }
  async function writeFile(name, content) {
    if (!MEM_DIR) throw new Error('记忆目录尚未探测')
    await fs.mkdir(MEM_DIR, { recursive: true })
    await fs.writeFile(path.join(MEM_DIR, name), content, 'utf8')
  }
  async function appendEntry(name, entry) {
    const before = (await readFile(name)) ?? ''
    const sep = before === '' || before.endsWith('\n') ? '' : '\n'
    await writeFile(name, before + sep + entry + '\n')
  }
  async function listFiles() {
    if (!MEM_DIR) return []
    try {
      const entries = await fs.readdir(MEM_DIR, { withFileTypes: true })
      return entries.filter((e) => e.isFile()).map((e) => e.name)
    } catch { return [] }
  }

  /* ---------------- 命名与隐私 ---------------- */

  const sanitizeName = (value) => {
    const s = String(value ?? '').replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 40)
    return s === '' ? '未命名AI' : s
  }
  const privateFile = (prefix, name) => prefix + '-' + sanitizeName(name) + '.md'
  const globalFile = (name) => privateFile('全局记录', name)
  const briefFile = (name) => privateFile('简要记录', name)
  const experienceFile = (name) => privateFile('经验', name)
  const listableFile = (name, ownName) => SHARED_FILES.indexOf(name) >= 0
    || name === globalFile(ownName)
    || name === briefFile(ownName)
    || name === experienceFile(ownName)
  const readableFile = (name, ownName) => listableFile(name, ownName) || /^经验-.+\.md$/.test(name)
  const kindFile = (kind, ownName) => {
    if (kind === 'shared') return '共享记忆.md'
    if (kind === 'event') return '重大事件.md'
    if (kind === 'global') return globalFile(ownName)
    if (kind === 'brief') return briefFile(ownName)
    if (kind === 'experience') return experienceFile(ownName)
    return null
  }

  async function ensureBaseFiles() {
    for (const name of SHARED_FILES) {
      if ((await readFile(name)) === null) await writeFile(name, SHARED_HEADERS[name])
    }
  }
  async function ensurePrivateFiles(name) {
    const targets = [
      [globalFile(name), '# 全局记录 - ' + name + '（本 AI 私有）\n\n> 仅 AI「' + name + '」可读写；其他 AI 不可查看（需询问）。\n\n'],
      [briefFile(name), '# 简要记录 - ' + name + '（本 AI 私有）\n\n> 仅 AI「' + name + '」可读写；其他 AI 不可查看（需询问）。\n\n'],
      [experienceFile(name), '# 经验 - ' + name + '\n\n> 本 AI 的经验：问题解决、使用技巧。经验对其他 AI 开放只读权限，仅 ' + name + ' 可写入。\n\n'],
    ]
    for (const [file, header] of targets) {
      if ((await readFile(file)) === null) await writeFile(file, header)
    }
  }

  async function readState() {
    try {
      const raw = await readFile(STATE_FILE)
      if (raw === null) return { ais: {}, masterOn: true, sidebarAll: false }
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* 回退默认 */ }
    return { ais: {}, masterOn: true, sidebarAll: false }
  }
  async function persistState(state) {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
  }

  function assignName(state) {
    const used = new Set()
    for (const key of Object.keys(state.ais || {})) used.add(state.ais[key].name)
    const available = namePool.filter((name) => !used.has(name))
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)]
    }
    let n = 1
    while (used.has(String(n))) n += 1
    return String(n)
  }

  async function syncCache() {
    const state = await readState()
    masterOn = state.masterOn !== false
    sidebarAllOn = state.sidebarAll === true
    nameCache.clear()
    for (const key of Object.keys(state.ais || {})) nameCache.set(key, state.ais[key])
  }

  async function ensureAiEntry(sessionId) {
    const key = String(sessionId ?? '')
    if (!MEM_DIR) {
      // 目录尚未探测成功（可能 apply 时无会话）：用当前会话 id 重试
      const r = await detectDir(sessionId)
      if (!r.dir) return { state: { ais: {}, masterOn: true, sidebarAll: false }, entry: { name: '', enabled: true, autoName: true, sidebarName: false, originalTitle: null } }
    }
    const state = await readState()
    if (!state.ais || typeof state.ais !== 'object') state.ais = {}
    if (state.masterOn === undefined) state.masterOn = true
    if (state.sidebarAll === undefined) state.sidebarAll = false
    if (!state.ais[key]) {
      state.ais[key] = { name: assignName(state), enabled: true, autoName: defaultAutoName, sidebarName: false, originalTitle: null }
      await persistState(state)
    }
    if (state.ais[key].autoName === undefined) state.ais[key].autoName = defaultAutoName
    if (state.ais[key].sidebarName === undefined) state.ais[key].sidebarName = false
    if (state.ais[key].originalTitle === undefined) state.ais[key].originalTitle = null
    await ensureBaseFiles()
    await ensurePrivateFiles(state.ais[key].name)
    masterOn = state.masterOn !== false
    sidebarAllOn = state.sidebarAll === true
    nameCache.set(key, state.ais[key])
    return { state, entry: state.ais[key] }
  }
  function ensureAiEntryOnce(sessionId) {
    const key = String(sessionId ?? '')
    let p = ensureInflight.get(key)
    if (!p) {
      p = Promise.resolve(ensureAiEntry(key)).catch(() => {}).finally(() => { ensureInflight.delete(key) })
      ensureInflight.set(key, p)
    }
    return p
  }

  /* ---------------- 侧栏标题 ---------------- */

  async function syncSidebarTitle(sessionId, entry) {
    if (masterOn !== true) return
    const svc = sessionsSvc()
    const session = svc && svc.get(sessionId)
    const title = titleSvc()
    if (!session || !title) return
    try {
      if (!entry.originalTitle) {
        const cur = title.get(session)
        entry.originalTitle = cur && cur.title ? cur.title : null
      }
      title.rename(session, entry.name)
    } catch { /* 保持现状 */ }
  }

  async function applySidebarAll(enabled) {
    const svc = sessionsSvc()
    const live = svc ? svc.list() : []
    for (const s of live) if (s && s.id) await ensureAiEntryOnce(s.id)
    const state = await readState()
    state.sidebarAll = !!enabled
    const ais = state.ais || {}
    for (const key of Object.keys(ais)) {
      const entry = ais[key]
      if (!entry) continue
      if (enabled) {
        if (entry.sidebarName !== true) {
          await syncSidebarTitle(key, entry)
          entry.sidebarName = true
        }
      } else {
        if (entry.sidebarName === true) {
          const session = svc && svc.get(key)
          const title = titleSvc()
          if (session && title) {
            if (entry.originalTitle) {
              try { title.rename(session, entry.originalTitle) } catch { /* 保持 */ }
            } else {
              try { await title.refresh(session) } catch { /* 保持 */ }
            }
          }
          entry.sidebarName = false
          entry.originalTitle = null
        }
      }
      nameCache.set(key, entry)
    }
    await persistState(state)
    sidebarAllOn = !!enabled
    await syncCache()
    return { ok: true, sidebarAll: !!enabled }
  }

  async function applySidebarName(sessionId, entry, state, enabled) {
    if (masterOn !== true) return { ok: false, error: '记忆总开关已关闭' }
    const svc = sessionsSvc()
    const session = svc && svc.get(sessionId)
    if (!session) return { ok: false, error: '找不到该会话' }
    const title = titleSvc()
    if (!title) return { ok: false, error: '会话标题服务不可用' }
    try {
      if (enabled) {
        if (!entry.originalTitle) {
          const current = title.get(session)
          entry.originalTitle = current && current.title ? current.title : null
        }
        title.rename(session, entry.name)
      } else {
        if (entry.originalTitle) {
          try { title.rename(session, entry.originalTitle) } catch { /* 保持名字 */ }
          entry.originalTitle = null
        } else {
          try { await title.refresh(session) } catch { /* 保持名字 */ }
        }
      }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
    entry.sidebarName = !!enabled
    await persistState(state)
    nameCache.set(String(sessionId ?? ''), entry)
    return { ok: true, sidebarName: entry.sidebarName }
  }

  async function restoreSidebarTitles(state) {
    const svc = sessionsSvc()
    const title = titleSvc()
    if (!svc || !title) return
    const ais = state.ais || {}
    for (const key of Object.keys(ais)) {
      const entry = ais[key]
      if (!entry || entry.sidebarName !== true) continue
      try {
        const session = svc.get(key)
        if (session) {
          if (entry.originalTitle) title.rename(session, entry.originalTitle)
          else await title.refresh(session)
        }
      } catch { /* 跳过 */ }
      entry.sidebarName = false
      entry.originalTitle = null
      nameCache.set(key, entry)
    }
  }

  /* ---------------- 事件与启动 ---------------- */

  ctx.on('agent/session-start', (payload) => {
    const agent = payload && payload.agent
    if (!agent || !agent.id) return
    // 事件时会话已注册：用它拿真实 cwd 探测目录（apply 时可能失败）
    detectDir(agent.id).then((r) => {
      if (!r.dir) return
      return ensureAiEntryOnce(agent.id).then(async () => {
        if (masterOn !== true) return
        const key = String(agent.id)
        const state = await readState()
        const entry = state.ais && state.ais[key]
        if (!entry) return
        // 无条件同步侧栏名（幂等）：覆盖历史上任何错误改名
        if (entry.sidebarName === true) {
          await syncSidebarTitle(key, entry)
        } else if (sidebarAllOn === true) {
          await syncSidebarTitle(key, entry)
          entry.sidebarName = true
          await persistState(state)
        }
        nameCache.set(key, entry)
      })
    }).catch(() => {})
  })

  const startupSessions = (() => {
    try { const svc = sessionsSvc(); return svc ? svc.list() : [] } catch { return [] }
  })()
  const firstId = startupSessions[0] && startupSessions[0].id ? startupSessions[0].id : undefined
  detectDir(firstId).then((r) => {
    if (!r.dir) return  // 探测失败：等 agent/session-start 拿到真实 cwd
    for (const s of startupSessions) if (s && s.id) ensureAiEntryOnce(s.id)
    return syncCache()
  }).catch(() => {})

  /* ---------------- systemPrompt 注入（服务就绪后） ---------------- */

  ctx.inject(['systemPrompt'], (inner) => {
    inner.systemPrompt.context({
      name: 'memory:identity',
      order: 105,
      text: (assembleCtx) => {
        if (masterOn !== true) return ''
        const agent = assembleCtx && assembleCtx.agent ? assembleCtx.agent : undefined
        const session = agent && agent.session ? agent.session : undefined
        if (!session) return ''
        const key = String(session.id ?? '')
        const cached = nameCache.get(key)
        if (cached && cached.autoName !== false && cached.name) {
          return '你的名字是「' + cached.name + '」（由对话记忆名字库分配）。当用户问你的名字或身份时，用这个名字自称；你的记忆记录也以这个名字归档。你的全局记录/简要记录是私有的，其他 AI 不能查看；你的经验对其他 AI 开放只读权限；共享记忆与重大事件是所有 AI 共享的。遇到新问题的解决办法或软件使用技巧，请当场写入你的经验文件（经验-' + cached.name + '.md），无需用户提醒。'
        }
        if (!cached) ensureAiEntryOnce(key)
        return ''
      },
    })
  })

  /* ---------------- HTTP 工具函数 ---------------- */

  function sendJson(res, status, body) {
    const encoded = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(encoded),
    })
    res.end(encoded)
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          const error = new Error('请求内容过大。')
          error.statusCode = 413
          reject(error)
          req.removeAllListeners('data')
          req.resume()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            const error = new Error('请求内容必须是 JSON 对象。')
            error.statusCode = 400
            reject(error)
            return
          }
          resolve(parsed)
        } catch (error) {
          error.statusCode = 400
          reject(error)
        }
      })
      req.on('error', reject)
    })
  }
  function queryOf(req) {
    try {
      const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'))
      return url.searchParams
    } catch { return new URLSearchParams() }
  }

  const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'

  /* ---------------- HTTP 路由（client 半调用） ---------------- */

  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/state',
      handler: async (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405).end(); return }
        const sessionId = queryOf(req).get('session')
        const dir = await ensureDir(sessionId)
        const { state, entry } = await ensureAiEntryOnce(sessionId)
        const own = sanitizeName(entry.name)
        const files = (await listFiles()).filter((name) => listableFile(name, own)).sort()
        sendJson(res, 200, { ok: true, version: VERSION, dir, masterOn: state.masterOn !== false, sidebarAll: state.sidebarAll === true, name: entry.name, enabled: entry.enabled === true, autoName: entry.autoName !== false, sidebarName: entry.sidebarName === true, files })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/read',
      handler: async (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405).end(); return }
        const params = queryOf(req)
        const sessionId = params.get('session')
        const name = String(params.get('name') || '')
        await ensureDir(sessionId)
        const { entry } = await ensureAiEntryOnce(sessionId)
        const own = sanitizeName(entry.name)
        if (!readableFile(name, own)) {
          sendJson(res, 200, { ok: false, error: '无权查看该 AI 的记忆（全局/简要互相隔离，查看需询问）' })
          return
        }
        const content = (await readFile(name)) ?? ''
        sendJson(res, 200, { ok: true, name, content })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/set-master',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const body = await readJson(req)
        const sessionId = body.session
        await ensureDir(sessionId)
        const enabled = !!body.enabled
        const state = await readState()
        state.masterOn = enabled
        if (!enabled) await restoreSidebarTitles(state)
        await persistState(state)
        masterOn = enabled
        await syncCache()
        sendJson(res, 200, { ok: true, masterOn: enabled })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/set-sidebar-all',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const body = await readJson(req)
        const sessionId = body.session
        await ensureDir(sessionId)
        sendJson(res, 200, await applySidebarAll(!!body.enabled))
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/set-name',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const body = await readJson(req)
        const sessionId = body.session
        await ensureDir(sessionId)
        const name = sanitizeName(body.name)
        const { state, entry } = await ensureAiEntryOnce(sessionId)
        entry.name = name
        if (masterOn === true && entry.sidebarName === true) {
          await syncSidebarTitle(sessionId, entry)
        }
        await persistState(state)
        nameCache.set(String(sessionId ?? ''), entry)
        await ensurePrivateFiles(name)
        sendJson(res, 200, { ok: true, name })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/set-enabled',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const body = await readJson(req)
        const sessionId = body.session
        await ensureDir(sessionId)
        const { state, entry } = await ensureAiEntryOnce(sessionId)
        entry.enabled = !!body.enabled
        await persistState(state)
        nameCache.set(String(sessionId ?? ''), entry)
        sendJson(res, 200, { ok: true, enabled: entry.enabled })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/set-autoname',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const body = await readJson(req)
        const sessionId = body.session
        await ensureDir(sessionId)
        const { state, entry } = await ensureAiEntryOnce(sessionId)
        entry.autoName = !!body.enabled
        await persistState(state)
        nameCache.set(String(sessionId ?? ''), entry)
        sendJson(res, 200, { ok: true, autoName: entry.autoName })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/set-sidebar-name',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const body = await readJson(req)
        const sessionId = body.session
        await ensureDir(sessionId)
        const enabled = !!body.enabled
        const { state, entry } = await ensureAiEntryOnce(sessionId)
        sendJson(res, 200, await applySidebarName(sessionId, entry, state, enabled))
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/__memory/append',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        if (masterOn !== true) { sendJson(res, 200, { ok: false, error: '记忆功能已停用（总开关关闭）' }); return }
        const body = await readJson(req)
        const sessionId = body.session
        await ensureDir(sessionId)
        const kind = String(body.kind || '')
        const content = String(body.content || '').trim()
        const { entry } = await ensureAiEntryOnce(sessionId)
        if (entry.enabled !== true) { sendJson(res, 200, { ok: false, error: '记忆记录已停用' }); return }
        if (content === '') { sendJson(res, 200, { ok: false, error: '内容为空' }); return }
        const name = kindFile(kind, entry.name)
        if (!name) { sendJson(res, 200, { ok: false, error: '未知记录类型: ' + kind }); return }
        await appendEntry(name, '- **' + stamp() + '** [' + entry.name + '] ' + content)
        sendJson(res, 200, { ok: true, file: name })
      },
    }),
  ]

  ctx.effect(() => {
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* 忽略 */ }
      }
    }
  }, 'dsh-memory: routes')

  /* ---------------- 工具注册（全局，任何预设可用） ---------------- */

  ctx.inject(['tools'], (inner) => {
    const tool = {
      name: 'memory_record',
      description: '把内容写入用户的对话记忆。kind=global 本 AI 私有全局记录（对话+决策）；brief 本 AI 私有简要记录（会话摘要）；experience 本 AI 的经验（对其他 AI 开放只读权限，仅本人可写）；shared 共享记忆（所有 AI 可见）；event 重大事件（共享）。全局/简要私有，其他 AI 不可查看。内容需简洁客观，AI 名自动使用本会话已设置的名字。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['global', 'shared', 'brief', 'event', 'experience'], description: '记录类型' },
          content: { type: 'string', description: '要记录的内容' },
        },
        required: ['kind', 'content'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          return [{ type: 'text', text: JSON.stringify(value) }]
        },
      },
      async execute(args, exec) {
        if (masterOn !== true) return { ok: false, error: '记忆功能已停用（总开关关闭，可在「记忆」面板开启）' }
        const agent = exec && exec.agent ? exec.agent : undefined
        const sessionId = agent && agent.id ? agent.id : undefined
        await ensureDir(sessionId)
        const kind = String((args && args.kind) || '')
        const content = String((args && args.content) || '').trim()
        const { entry } = await ensureAiEntryOnce(sessionId)
        if (entry.enabled !== true) return { ok: false, error: '记忆记录已停用（可在界面「记忆」标签里开启）' }
        if (content === '') return { ok: false, error: '内容为空' }
        const name = kindFile(kind, entry.name)
        if (!name) return { ok: false, error: '未知记录类型: ' + kind }
        await appendEntry(name, '- **' + stamp() + '** [' + entry.name + '] ' + content)
        return { ok: true, file: name, by: entry.name }
      },
    }
    try {
      inner.tools.register(tool)
    } catch { /* 重复注册等，忽略 */ }
  })
}
