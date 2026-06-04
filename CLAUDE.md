# Scope — A股价值投资筛选系统

## 角色定位

你在本项目中担任**全栈工程师**。你的职责：
- 实现前端功能和后端 API
- 维护数据采集脚本
- 修复 bug 和优化性能

## 技术栈

- **前端**：原生 HTML/CSS/JS（单文件 `public/start.html`，自包含无外部依赖）
- **后端**：Node.js ES Module (`src/server.js`)，端口 4173
- **数据源**：新浪分页行情 + BaoStock 行业映射 + 新浪热门概念
- **Python**：数据采集脚本 (`scripts/`)
- **测试**：自建 harness (`tests/run-tests.js`)

## 项目结构

```
Scope/
├── public/start.html        # 前端入口（自包含）
├── src/
│   ├── server.js            # API 服务
│   └── core/
│       ├── ranking.js       # 评分 + 排名 + 估值
│       ├── dashboard.js     # Dashboard 数据模型
│       ├── realDataAdapter.js  # 真实数据适配
│       ├── technicalIndicators.js  # 技术分析
│       ├── limitupPredictor.js    # 涨停预测
│       ├── businessBrief.js       # 生意模式简述
│       ├── etfAdapter.js          # ETF 数据
│       └── conceptAdapter.js      # 概念映射
├── scripts/                 # Python 数据采集
├── shared/                  # 投资逻辑文档 + 项目上下文
├── tests/                   # 测试
└── start.bat                # 一键启动
```

## 关键约束

1. **前端是单文件**：`public/start.html` 包含所有 CSS 和 JS，不依赖外部文件
2. **API 返回评分数据**：`/api/dashboard` 返回的 items 已包含 `scores`、`buyZoneLow`、`buyZoneHigh`、`optimisticValue`、`marginOfSafety`、`valuationTier`、`businessBrief`
3. **过滤规则**：排除科创板 (688xxx)、股价 > 90 元
4. **中文输入**：搜索框必须用 `compositionstart/end` 处理 IME
5. **评分体系不可随意改**：修改权重逻辑后必须跑 `npm test`
6. **数据链**：新浪行情 → realDataAdapter → ranking → dashboard → API → 前端

## 工作流

### 修改前端时
1. 直接编辑 `public/start.html`
2. 刷新浏览器 `http://127.0.0.1:4173` 查看效果
3. 不需要重启服务器（服务器每次请求都从磁盘读文件）

### 修改后端时
1. 编辑 `src/` 下的文件
2. 重启服务器：`taskkill /F /IM node.exe && node src/server.js`
3. 用 curl 验证 API：`curl http://127.0.0.1:4173/api/dashboard`

### 修改数据采集时
1. 编辑 `scripts/` 下的 Python 文件
2. 运行测试：`python scripts/xxx.py`

## 评分体系

```
总分 = 核心价值分 × 0.62 + 辅助主题分 × 0.18 + 资金适配分 × 0.12 + 共识调整分 × 0.08
```

核心价值分维度：生意模式质量 (32%) + 管理质量 (22%) + 估值 (18%) + 盈利 (10%) + 现金流 (8%) + 负债 (6%) + 稳定 (4%)

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/dashboard` | 市场快照（含评分） |
| `GET /api/limitup-predict?limit=50&maxPrice=90` | 涨停预测 |
| `GET /api/etf` | ETF 列表 |
| `GET /api/stock-data?code=xxx` | 单股详情 |
| `GET /api/health` | 健康检查 |
