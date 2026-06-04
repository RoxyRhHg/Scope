# 任务计划：Top 10 推荐股票系统优化

## 目标
优化数据获取速度（20-40s → 3-5s），UI 自动展示 Top 10 推荐股票（含买入/卖出点、安全边际、生意模式简评），只推荐当前价格在买入区间内的股票。

## 设计文档
`docs/superpowers/specs/2026-06-04-top10-recommendation-design.md`

## 当前阶段
阶段 1

## 各阶段

### 阶段 1：数据管道重写（Node.js 原生）
- [x] 新建 `src/core/dataFetcher.js` — Node.js 原生并行抓取 Sina API
- [x] 新建 `scripts/prefetch_industry.py` — 行业映射预抓取脚本
- [x] 改造 `src/server.js` — 移除 Python subprocess 调用，使用新模块
- **状态：** complete

### 阶段 2：筛选逻辑增强
- [x] 改造 `src/core/ranking.js` 的 `pickFocusStocks` — 增加买入区间硬过滤
- [x] 新增 `src/core/businessBrief.js` — 生意模式简评生成
- **状态：** complete

### 阶段 3：UI 改造
- [x] 改造 `public/app.js` Focus 10 区域 — 表格+卡片双模式
- [x] 改造 `public/styles.css` — 新增表格和卡片样式
- **状态：** complete

### 阶段 4：自动刷新策略
- [x] 改造 `public/app.js` 刷新逻辑 — 仅手动刷新，移除自动定时
- **状态：** complete

## 关键问题
1. Sina API 并行 70 个请求是否触发限流？→ 加随机延迟 (50-200ms)
2. 预抓取脚本未运行时如何降级？→ 检测缓存文件缺失时回退到实时抓取
3. 买入区间过于严格导致 0 只股票？→ UI 显示空状态提示，不降低门槛

## 已做决策
| 决策 | 理由 |
|------|------|
| Node.js 原生重写数据管道 | 去掉 Python 子进程开销，并行化提升速度 |
| 分层策略：实时抓行情，预抓取行业/K线 | 行业映射和 K 线变化慢，没必要每次实时拉 |
| 价格在 MaoGuGu 买入区间内作为硬过滤 | 符合 a-share-investment-os "只买合适价格"原则 |
| 安全边际 >= 10% | 平衡数量和质量的起步门槛 |
| 表格+卡片双模式 | 表格快速扫描，卡片深度研究 |
| 仅手动刷新 | 价值投资者不需要盘中频繁刷新 |

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| （暂无） | | |

## 备注
- 随着进度更新阶段状态：pending → in_progress → complete
- 做重大决策前重新读取此计划
- 记录所有错误，避免重复
