/**
 * dsh-memory — 对话记忆静态 profile 插件（client 半）
 *
 * 手写 client bundle（与 dshmarket / ui-trajectory 的构建产物同构）：
 *   window.__ModuleLoader__.load({ id, factory })
 * factory 用 require() 取 react 等 seed 模块，导出 apply/inject。
 * apply 通过 ctx.slots.inject('conversation.view') 注册「记忆」标签，
 * 组件用 fetch 调用 host 半挂载的 /__memory/* HTTP 接口。
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const inject = ['slots']

    /* ---------- 组件 ---------- */

    function MemoryView(props) {
      const [state, setState] = React.useState({
        masterOn: true, sidebarAll: false, name: '', enabled: true,
        autoName: true, sidebarName: false, files: [], dir: '',
        loading: true, error: '',
      })
      const [active, setActive] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const sessionId = props.sessionId

      const refresh = () => {
        fetch('/__memory/state?session=' + encodeURIComponent(sessionId || ''), { cache: 'no-store' })
          .then((res) => res.json())
          .then((res) => {
            if (res && res.ok) {
              setState((s) => ({
                ...s,
                masterOn: res.masterOn !== false,
                sidebarAll: res.sidebarAll === true,
                name: res.name,
                enabled: res.enabled,
                autoName: res.autoName !== false,
                sidebarName: res.sidebarName === true,
                files: res.files,
                dir: res.dir || '',
                loading: false,
                error: '',
              }))
            } else {
              setState((s) => ({ ...s, loading: false, error: '记忆服务无响应' }))
            }
          })
          .catch((e) => {
            setState((s) => ({ ...s, loading: false, error: String((e && e.message) || e) }))
          })
      }
      React.useEffect(() => { refresh() }, [sessionId])

      const openFile = (name) => {
        fetch('/__memory/read?session=' + encodeURIComponent(sessionId || '') + '&name=' + encodeURIComponent(name), { cache: 'no-store' })
          .then((res) => res.json())
          .then((res) => {
            setActive(res && res.ok ? { name: res.name, content: res.content }
              : (res && res.error ? { name: name, content: '⚠️ ' + res.error } : null))
          })
      }
      const call = (path, body) => {
        return fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sessionId, ...body }),
        }).then((res) => res.json())
      }
      const saveName = () => {
        const name = draft.trim()
        if (!name || busy) return
        setBusy(true)
        call('/__memory/set-name', { name }).then((res) => {
          if (res && res.ok) { setState((s) => ({ ...s, name: res.name })); setDraft(''); refresh() }
        }).finally(() => setBusy(false))
      }
      const toggleMaster = () => {
        call('/__memory/set-master', { enabled: !state.masterOn }).then((res) => {
          if (res && res.ok) { setState((s) => ({ ...s, masterOn: res.masterOn })); refresh() }
        })
      }
      const toggleSidebarAll = () => {
        call('/__memory/set-sidebar-all', { enabled: !state.sidebarAll }).then((res) => {
          if (res && res.ok) { setState((s) => ({ ...s, sidebarAll: res.sidebarAll })); refresh() }
        })
      }
      const toggleEnabled = () => {
        call('/__memory/set-enabled', { enabled: !state.enabled }).then((res) => {
          if (res && res.ok) setState((s) => ({ ...s, enabled: res.enabled }))
        })
      }
      const toggleAutoName = () => {
        call('/__memory/set-autoname', { enabled: !state.autoName }).then((res) => {
          if (res && res.ok) setState((s) => ({ ...s, autoName: res.autoName }))
        })
      }
      const toggleSidebarName = () => {
        call('/__memory/set-sidebar-name', { enabled: !state.sidebarName }).then((res) => {
          if (res && res.ok) setState((s) => ({ ...s, sidebarName: res.sidebarName }))
        })
      }
      const goChat = () => { if (props.openView) props.openView('chat', '') }

      const base = { fontFamily: 'inherit', boxSizing: 'border-box' }
      const rootStyle = { ...base, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: '12px 20px', gap: '10px', overflow: 'hidden' }
      const rowStyle = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
      const btnStyle = { ...base, padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #444)', background: 'transparent', color: 'inherit', cursor: 'pointer' }
      const inputStyle = { ...base, padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #444)', background: 'transparent', color: 'inherit', width: '180px' }
      const bodyStyle = { display: 'flex', flex: 1, minHeight: 0, gap: '10px' }
      const listStyle = { width: '200px', flex: 'none', overflowY: 'auto', borderRight: '1px solid var(--dsw-alias-border-l1, #333)', paddingRight: '10px' }
      const itemStyle = { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }
      const contentStyle = { flex: 1, minWidth: 0, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.6 }
      const hintStyle = { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '12px' }

      const files = state.files || []
      const children = [
        React.createElement('div', { key: 'master', style: { ...rowStyle, paddingBottom: '8px', borderBottom: '1px solid var(--dsw-alias-border-l1, #333)' } }, [
          React.createElement('button', { key: 'b', style: { ...btnStyle, fontWeight: 600 }, onClick: toggleMaster }, state.masterOn ? '记忆总开关：开' : '记忆总开关：关'),
          React.createElement('span', { key: 'h', style: hintStyle }, state.masterOn ? '整套记忆功能运行中' : '已停用：记录/自动命名/侧栏AI名全部暂停'),
        ]),
        React.createElement('div', { key: 'sidebarAll', style: rowStyle }, [
          React.createElement('button', { key: 'b', style: { ...btnStyle, fontWeight: 600 }, onClick: toggleSidebarAll }, state.sidebarAll ? '侧栏AI名(全部)：开' : '侧栏AI名(全部)：关'),
          React.createElement('span', { key: 'h', style: hintStyle }, '一键让所有会话侧栏显示各自的 AI 名字'),
        ]),
        React.createElement('div', { key: 'head', style: rowStyle }, [
          React.createElement('strong', { key: 't' }, '记忆'),
          React.createElement('span', { key: 'st', style: hintStyle }, state.enabled ? '● 记录中' : '○ 已停用'),
          React.createElement('button', { key: 'toggle', style: btnStyle, onClick: toggleEnabled }, state.enabled ? '停用记录' : '开启记录'),
          React.createElement('button', { key: 'back', style: btnStyle, onClick: goChat }, '返回对话'),
          React.createElement('button', { key: 'refresh', style: btnStyle, onClick: refresh }, '刷新'),
        ]),
        React.createElement('div', { key: 'name', style: rowStyle }, [
          React.createElement('span', { key: 'l', style: hintStyle }, '本 AI 名字：'),
          React.createElement('input', { key: 'i', style: inputStyle, value: draft || state.name, placeholder: state.name, onChange: (e) => setDraft(e.target.value) }),
          React.createElement('button', { key: 's', style: btnStyle, onClick: saveName, disabled: busy }, '保存'),
        ]),
        React.createElement('div', { key: 'autoname', style: rowStyle }, [
          React.createElement('button', { key: 'a', style: btnStyle, onClick: toggleAutoName }, state.autoName ? '自动命名：开' : '自动命名：关'),
          React.createElement('span', { key: 'h', style: hintStyle }, '开启后 AI 自动用名字库名字自称，无需手动告知'),
        ]),
        React.createElement('div', { key: 'sidebar', style: rowStyle }, [
          React.createElement('button', { key: 'b', style: btnStyle, onClick: toggleSidebarName }, state.sidebarName ? '本会话侧栏AI名：开' : '本会话侧栏AI名：关'),
          React.createElement('span', { key: 'h', style: hintStyle }, '只控制当前会话的侧栏标题'),
        ]),
        React.createElement('div', { key: 'priv', style: rowStyle }, [
          React.createElement('span', { key: 'h', style: hintStyle }, '仅显示本 AI 私有记忆 + 共享记忆；经验只开放读取权限，不列在面板'),
        ]),
        React.createElement('div', { key: 'body', style: bodyStyle }, [
          React.createElement('div', { key: 'list', style: listStyle }, files.map((name) =>
            React.createElement('button', {
              key: name,
              style: { ...itemStyle, background: active && active.name === name ? 'var(--dsw-alias-interactive-bg-hover, #333)' : 'transparent' },
              onClick: () => openFile(name),
            }, name))),
          React.createElement('div', { key: 'content', style: contentStyle },
            active ? (active.content === '' ? '（空文件）' : active.content) : (state.loading ? '加载中…' : (state.error || '选择左侧文件查看内容'))),
        ]),
        React.createElement('div', { key: 'foot', style: rowStyle }, [
          React.createElement('span', { key: 'h', style: hintStyle }, '记忆目录：' + (state.dir || '（自动探测）')),
        ]),
      ]
      return React.createElement('div', { 'data-memory-view': '', style: rootStyle }, children)
    }

    /* ---------- 插件主体 ---------- */

    function apply(ctx) {
      if (!ctx.slots) return
      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: 'memory', order: 20, label: '记忆' },
        (props) => React.createElement(MemoryView, { sessionId: props.sessionId, openView: props.openView }),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
