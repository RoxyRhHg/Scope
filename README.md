# Scope — A股价值投资筛选系统

基于段永平投资哲学的 A 股实时筛选工具。核心逻辑：**基本面决定拥有权，技术面决定执行权**。

## 快速启动

```bash
# 双击 start.bat，或手动：
node src/server.js
# 浏览器打开 http://127.0.0.1:4173
```

## 功能

| 功能 | 说明 |
|------|------|
| 今日热点 | 主力资金流入题材/概念/行业，含候选股的买入区间和安全边际 |
| 重点关注 | 价格在买入区间内、安全边际≥10%、估值低估的股票 |
| 总榜 Top50 | 全市场排名（Buffett 核心价值分优先） |
| 涨停预测 | 十日内最可能涨停的股票（技术+动量+行业热度评分） |
| ETF/LOF | 场内可交易基金列表 |

每只股票/基金都展示：**现价、建议买入区间、理想价值（卖出参考）、安全边际、上涨空间、生意模式**。

点击任意股票可展开详情卡片。

## 技术栈

- **前端**：原生 HTML/CSS/JS（单文件 `public/start.html`）
- **后端**：Node.js (`src/server.js`)，端口 4173
- **数据源**：新浪行情 + BaoStock 行业映射 + 新浪热门概念
- **评分**：段永平哲学融合版（生意模式 32% + 管理 22% + 估值 18% + 盈利/现金流/负债/稳定）

## 目录结构

```
Scope/
├── public/start.html        # 前端入口（自包含，无外部依赖）
├── src/
│   ├── server.js            # API 服务（端口 4173）
│   └── core/
│       ├── ranking.js       # 评分 + 排名 + 估值
│       ├── dashboard.js     # Dashboard 数据模型
│       ├── realDataAdapter.js  # 真实数据适配
│       ├── technicalIndicators.js  # MACD/BOLL/KDJ 技术分析
│       ├── limitupPredictor.js    # 涨停预测引擎
│       ├── businessBrief.js       # 生意模式简述生成
│       ├── etfAdapter.js          # ETF 数据
│       └── conceptAdapter.js      # 概念映射
├── scripts/                 # Python 数据采集脚本
│   ├── fetch_live_snapshot.py     # 实时行情抓取
│   ├── fetch_limitup_history.py   # 涨停历史采集
│   ├── daily_predict.py           # 每日预测
│   └── prefetch.py                # 预取缓存
├── shared/
│   ├── investment-philosophy.md   # 底层投资逻辑文档
│   └── project-context.md         # 项目上下文（给 AI agent）
├── tests/                   # 测试
├── start.bat                # Windows 一键启动
└── package.json
```

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/dashboard` | 市场快照（含评分、买入区间、安全边际） |
| `GET /api/limitup-predict` | 涨停预测 |
| `GET /api/etf` | ETF 列表 |
| `GET /api/stock-data?code=xxx` | 单股详情 |
| `GET /api/health` | 健康检查 |

## 注意事项

- 首次加载需 20-40 秒（拉取全市场快照）
- 数据每小时自动刷新，也可手动刷新
- 过滤规则：排除科创板 (688xxx)、股价 > 90 元
- 评分仅供参考，不构成投资建议
