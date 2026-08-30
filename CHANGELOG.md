# Changelog

All notable changes to this project are documented in this file.

## [3.0.0] - 2026-08-29

### Changed

- 从动态 Cordis 插件升级为**静态 profile 插件**：任何预设可用，重启不消失，无需审批
- Host 半改用 node:fs 直接读写记忆目录（无沙箱策略限制）
- Client 半改用手写 `window.__ModuleLoader__.load` bundle（document 注入样式）
- host↔client 通信改为 HTTP 接口（`/__memory/*`），client fetch 调用
- 记忆目录探测修复：只接受真实存在的目录，等 `agent/session-start` 事件兜底，绝不 fallback 相对路径

### Added

- 欢迎泡泡、记忆标签页（对话视图第 4 个标签）
- `memory_record` 工具（global/brief/experience/shared/event 五类记录）
- AI 自动命名（名字库 50 个中文名，无重复，库尽按序号）
- 隐私隔离：全局/简要按 AI 私有，经验开放只读，共享/重大事件共享
- 侧栏 AI 名 + 总开关 + 侧栏AI名(全部) 开关

## [2.0.x] - 2026-08-28

### Added

- 初始动态插件版本：记忆面板、自动命名、隐私隔离、侧栏 AI 名
