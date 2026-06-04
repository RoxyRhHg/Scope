# Scope — AI Agent 维护指南

## 项目概述

A 股价值投资筛选系统，基于段永平投资哲学。核心功能：今日热点题材、重点关注股票、涨停预测、ETF/LOF。

## 快速上手

```bash
# 启动服务
node src/server.js
# 访问 http://127.0.0.1:4173

# 运行测试
npm test
```

## 架构要点

1. **前端单文件**：`public/start.html` 是自包含的 HTML，内嵌 CSS + JS，不依赖任何外部文件
2. **后端 API**：`src/server.js` 提供 REST API，返回已评分的数据
3. **数据流**：新浪行情 → `realDataAdapter` → `ranking` → `dashboard` → API → 前端
4. **评分体系**：段永平哲学融合版，详见 `shared/investment-philosophy.md`

## 关键 API 响应结构

`/api/dashboard` 返回的每个 stock item 包含：
- `scores`: `{ total, core, auxiliary, capitalFit }`
- `buyZoneLow`, `buyZoneHigh`: 建议买入区间
- `optimisticValue`: 理想价值（卖出参考）
- `marginOfSafety`: 安全边际百分比
- `valuationTier`: 估值档位（低估/合理偏低/合理/偏高估/高估）
- `businessBrief`: 生意模式简述
- `conclusion`: 投资结论

## 前端开发注意

- 搜索框必须用 `compositionstart/end` 处理中文 IME
- 所有股票列表必须展示买入区间和安全边际
- 点击股票必须能打开详情卡片
- 过滤规则：排除 688xxx（科创板）和 price > 90

## 文件清单

| 文件 | 用途 |
|------|------|
| `public/start.html` | 前端入口 |
| `src/server.js` | API 服务 |
| `src/core/ranking.js` | 评分排名 |
| `src/core/dashboard.js` | 数据模型 |
| `src/core/realDataAdapter.js` | 数据适配 |
| `src/core/technicalIndicators.js` | 技术分析 |
| `src/core/limitupPredictor.js` | 涨停预测 |
| `src/core/businessBrief.js` | 生意模式简述 |
| `scripts/fetch_live_snapshot.py` | 实时行情抓取 |
| `scripts/fetch_limitup_history.py` | 涨停历史采集 |
| `shared/investment-philosophy.md` | 投资逻辑文档 |
