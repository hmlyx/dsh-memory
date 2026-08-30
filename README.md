# dsh-memory — 对话记忆插件 for DeepSeek Harness

给 DeepSeek Harness 加一套「对话记忆」体系：**记忆标签页、AI 自动命名、多 AI 隐私隔离、侧栏 AI 名、经验自动归档**。

静态 profile 插件（与 beauticode-dsh / dshmarket 同机制）：**装上即永久生效，重启不消失、无需审批、任何预设/任何会话都可用**。

> 效果：会话标题行出现「对话 / 轨迹 / 记忆」标签，点「记忆」进入面板。

## 功能

- **「记忆」标签**：对话视图第 4 个标签，可查看/读取记忆文件、改名、总开关、侧栏AI名(全部)、本会话侧栏名、自动命名开关；
- **AI 自动命名**：名字库（50 个中文名）随机分配、不与现有名重复、库尽按序号回退；名字注入系统提示，AI 自称该名；
- **隐私隔离**：`全局记录`/`简要记录` 按 AI 名私有（其他 AI 不可查看）；`经验` 对其他 AI 开放只读权限（不列面板）；`共享记忆`/`重大事件` 所有 AI 共写共读；
- **`memory_record` 工具**：全局注册，任何预设可用；kind = global / brief / experience / shared / event；
- **经验自动归档义务**：系统提示注入"遇到新问题当场写经验，无需用户提醒"；
- **侧栏标题**：把会话标题改成 AI 名，关闭时还原原始标题。

## 安装

1. 把整个仓库目录放进 `~\.dsh\profiles\web\node_modules\dsh-memory\`（即：`index.mjs`、`client.js`、`cordis.patch.yml` 位于 `node_modules\dsh-memory\` 下）；
2. 编辑 `~\.dsh\profiles\web\package.json`：
   - `dependencies` 加 `"dsh-memory": "3.0.0"`；
   - `dsh.profile.bundles` 数组加 `"dsh-memory"`；
3. **重启 DeepSeek Harness**（完整退出并重启服务器进程，见下方"重启提示"）。

回滚：删掉 package.json 里那两处引用即可。

### 重启提示（重要）

`patchReload: live` 只热重载用户 `cordis.patch.yml`，**新 bundle 必须重启服务器进程才生效**。重启窗口 ≠ 重启服务器：

1. 完全退出应用窗口；
2. 杀掉占用 3080 端口的 node 进程（`netstat -ano | findstr 3080` → `taskkill /PID <pid> /F`）；
3. 重新运行你的启动脚本。

## 数据位置

记忆文件在**会话工作区下的 `对话记忆\` 目录**（如 `E:\dsHA\对话记忆\`）：

```
对话记忆/
├── 共享记忆.md            # 所有 AI 共享
├── 重大事件.md            # 所有 AI 共享
├── 全局记录-<AI名>.md     # 私有
├── 简要记录-<AI名>.md     # 私有
├── 经验-<AI名>.md         # 开放只读
└── .memory-state.json     # 插件状态（名字/开关）
```

- **目录探测**：按会话工作区 cwd 找 `对话记忆\` 子目录，**只接受真实存在的目录**；启动早期无会话时等 `agent/session-start` 事件再探测；新工作区第一次会话开始后自动创建。
- 数据是普通磁盘文件，卸载插件不丢数据；换机时把整个 `对话记忆\` 拷过去即可。

## 配置

编辑 `index.mjs` 顶部 `CONFIG`（或通过 cordis.patch.yml 的 `config` 传入）：

```js
const CONFIG = {
  memoryDirName: '对话记忆',   // 记忆目录名（位于工作区根下）
  memoryDirOverride: '',       // 绝对路径覆盖；留空自动探测
  defaultAutoName: true,       // 新 AI 默认开启自动命名
  namePool: [ /* 50 个中文名 */ ],
}
```

`namePool` 想换名字直接改数组（改完重启生效）。

## 结构

| 文件 | 作用 |
|---|---|
| `index.mjs` | Host 半：目录读写（node:fs）、命名、隐私、侧栏、`memory_record` 工具、`/__memory/*` HTTP 接口、systemPrompt 注入 |
| `client.js` | Client 半：`conversation.view` 槽注册「记忆」标签（手写 `window.__ModuleLoader__.load` bundle） |
| `cordis.patch.yml` | 把 `dsh-memory` 插件行插入 profile 组成 |

## 兼容性

- 需要宿主具备：`webServer`（HTTP 接口）、`tools`、`systemPrompt`、`sessions`、`sessionTitle`、`conversation.view` 槽位——标准 dsh web profile 均有；
- host 半服务全部惰性获取（就绪后用），缺失自动降级；
- 跨平台路径（统一 `/` 分隔）。

## License

MIT

---

## 文档 / Docs

- [CHANGELOG](CHANGELOG.md) — 版本历史
- [SECURITY](SECURITY.md) — 安全说明
