# Scope — Buffett A 股筛选桌面工具

基于 Buffett 价值投资框架的 A 股实时筛选和评分桌面应用。

## 技术栈

| 层 | 技术 |
|----|------|
| 语言 | JavaScript (Node.js ES Module) + Python 3.9 + Rust |
| 前端 | 原生 HTML/CSS/JS (`public/`) |
| 后端 | Node.js 本地静态服务 (`src/server.js`) |
| 桌面壳 | Tauri 2.x (`src-tauri/`) |
| 测试 | 自建 harness (`tests/run-tests.js`) |
| 数据源 | 新浪分页行情 + BaoStock 行业映射 + 新浪热门概念 |

## 目录结构

```
Scope/
├── public/                  # 前端页面 (app.js 33KB, styles.css, index.html)
│   └── app.js               # 核心前端逻辑
├── src/
│   ├── server.js            # 本地 API 服务 (端口4173)
│   └── core/
│       ├── ranking.js       # Buffett 主评分 + 主题辅助排序 + 资金适配修正
│       ├── dashboard.js     # Dashboard 页面模型
│       ├── realDataAdapter.js  # 真实数据 → 内部模型适配
│       ├── sampleData.js    # 样例数据 (离线回退用)
│       ├── technicalIndicators.js  # MACD/BOLL/KDJ/成交量技术分析
│       └── textEncoding.js  # 文本编码处理
├── scripts/
│   ├── fetch_live_snapshot.py    # 真实 A 股快照抓取
│   └── fetch_stock_history.py    # 个股历史 K 线抓取
├── src-tauri/               # Tauri 桌面壳 (Cargo.toml + Rust 入口)
├── tests/                   # 测试文件
└── shared/                  # Claude+Codex 协作文件
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm test` | 运行全部测试 |
| `npm start` | 启动本地服务 → http://127.0.0.1:4173/ |
| `npm run tauri:dev` | Tauri 桌面开发模式 |
| `npm run tauri:build` | Tauri 桌面打包 |
| `npx tauri info` | 环境自检 |

## 关键约束

- 真实数据优先：`/api/dashboard` 默认返回 live 模式快照，抓取失败自动回退 sample 模式
- 评分体系不可随意改：Buffett 主评分 + 主题辅助排序 + 资金适配修正，修改权重逻辑后必须跑 `npm test`
- 数据源链：新浪分页行情 → BaoStock 行业映射 → 新浪热门概念 Top 24
- 首次 live 数据拉取需 20-40 秒
- Tauri 骨架已建立但未完成首次桌面打包验证

## 当前状态

### 已完成
- MVP 全部功能（Buffett 评分、全市场 Top 50、行业 Top 20、重点关注 1-2 只）
- 技术指标分析（MACD/BOLL/KDJ/成交量/综合多空判断）
- 手动刷新 + 每小时自动刷新 + 权重/资金量调节
- 真实数据通路（新浪 + BaoStock）
- 本地 API 缓存 + live/sample 自动回退
- 基础测试通过
- Tauri 桌面壳骨架

### 已知限制
- 财务评分以轻量代理指标为主，未接入完整财报字段
- 未完成首次 Tauri 桌面打包验证

## 下一步建议

1. 补完整财报字段，增强 Buffett 核心价值分真实性
2. 优化 live 数据抓取速度和缓存策略
3. 完成首次 Tauri 桌面打包验证
4. 增加本地刷新日志和错误面板
5. 优化概念来源与行业摘要质量

## 当前任务队列

| 序号 | 任务 | 状态 | 负责人 |
|------|------|------|--------|
| T1 | 补完整财报字段 | ⬜ 待开始 | Codex |
| T2 | 优化 live 数据抓取速度 | ⬜ 待开始 | Codex |
| T3 | Tauri 桌面打包验证 | ⬜ 待开始 | Codex |
