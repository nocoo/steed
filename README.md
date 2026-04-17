# steed

> AI Hub — 多 Agent 时代的资产可见性与关系管理平台

## 项目阶段与部署取态

- 目前处于**开发阶段**，尚未有外部用户，所以**不用把部署当作严肃事件**来排程。
- 这是个人工具。**Worker 有 git 更新就随时 `wrangler deploy` 部署**，先上再说 —— 坏了再修。
- 如果真因为某次部署出问题，那也说明**我们测试没覆盖到**；记一下、事后把缺的测试补上即可，不必回避发布节奏。

## 开发环境

**前置要求：**

- [Bun](https://bun.sh/) >= 1.0
- [osv-scanner](https://github.com/google/osv-scanner) — 依赖漏洞扫描
- [gitleaks](https://github.com/gitleaks/gitleaks) — 密钥泄漏检测

```bash
# macOS (Homebrew)
brew install osv-scanner gitleaks

# 或使用 Go 安装
go install github.com/google/osv-scanner/cmd/osv-scanner@latest
go install github.com/gitleaks/gitleaks/v8@latest
```

**安装依赖并启用 Git Hooks：**

```bash
bun install
```

## 文档

| 文档 | 说明 |
|------|------|
| [文档目录](./docs/README.md) | 所有设计文档索引 |
| [项目概述](./docs/01-overview.md) | 要解决的问题、核心概念 |
| [系统架构](./docs/architecture/01-system-overview.md) | 部署架构、技术选型 |
| [D1 Schema](./docs/architecture/02-d1-schema.md) | 数据库表结构 |
| [Worker API](./docs/architecture/03-worker-api.md) | API 端点设计 |
