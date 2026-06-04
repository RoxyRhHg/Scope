# Scope 本地数据服务规范

## 架构

```
Scope 预取程序（npm run prefetch）
  ├── 新浪 API → 全市场快照（价格/PE/PB/市值/换手率）
  ├── Baostock → 行业分类 + K线数据（MACD/BOLL/KDJ/均线/52周）
  └── 本地推断 → 概念板块（硬编码 + 行业+名称关键词）
         │
         ▼  .cache/*.json (磁盘缓存)
         │
Scope API Server（npm start）
  └── http://127.0.0.1:4173/api/*
         │
         ▼  只读本地缓存，零外部请求
Agent（Obsidian / Scope UI）
```

**核心原则：Agent 永远不触发外部爬取。所有数据由 Scope 预取程序统一拉取并缓存到磁盘。**

## API 端点

### `GET /api/stock-data?code=<code>`

返回单只股票全字段数据（基本面 + 评分 + 估值 + 技术指标 + 风险）。

**技术指标字段（预取后才有）：**

```json
"technicals": {
  "snapshot": {
    "macd": {"diff": -0.15, "dea": -0.07, "histogram": "-0.08"},
    "boll": {"upper": 55.2, "middle": 52.0, "lower": 48.8, "position": "lower-half"},
    "kdj": {"k": 33.5, "d": 52.0, "j": -3.3},
    "movingAverages": {"ma5": 48.1, "ma10": 48.9, "ma20": 50.2, "ma60": 51.6},
    "high52Week": 72.5,
    "low52Week": 38.2,
    "pct5d": -2.3,
    "pct20d": -5.1,
    "volume": {"ratio": 0.91, "trend": "flat"},
    "weekly60": {"ma60": 51.6, "position": "below", "slope": "flat"},
    "trend": {"bias": "bearish"}
  },
  "analysis": ["MACD ...", "均线：MA5 48.1 / MA10 48.9 ...", "52周范围：38.2 - 72.5 ..."]
}
```

**基本面指标：**
```json
"metrics": {
  "pe": 134.9,           // 市盈率（动态）✓ 模板需要
  "pb": 6.19,            // 市净率 ✓ 模板需要
  "dividendYield": 0,    // 股息率% ✓ 模板需要
  "changePct": 3.03,     // 涨跌幅%
  "turnover": 1.92,      // 换手率%
  "marketCap": 1.17e11,  // 总市值
  "flowMarketCap": 1.06e11, // 流通市值
  "roeProxy": 4.59,      // ROE代理值% [待接入真实财报]
  "freeCashFlowYieldProxy": 0.71  // FCF收益率代理% [待接入真实财报]
}
```

### A股每日分析模板 字段覆盖

| 模板字段 | Scope 覆盖 | 说明 |
|---------|-----------|------|
| PE(TTM) | ✓ metrics.pe | 来自新浪行情 |
| PB | ✓ metrics.pb | 来自新浪行情 |
| 股息率 | ✓ metrics.dividendYield | 来自新浪行情 |
| MACD | ✓ technicals.snapshot.macd | Baostock K线计算 |
| KDJ | ✓ technicals.snapshot.kdj | Baostock K线计算 |
| BOLL | ✓ technicals.snapshot.boll | Baostock K线计算 |
| M5/M10/M20/M60 | ✓ technicals.snapshot.movingAverages | Baostock K线计算 |
| 52周高低点 | ✓ technicals.snapshot.high52Week/low52Week | Baostock K线计算 |
| 换手率 | ✓ metrics.turnover | 来自新浪行情 |
| ROE | △ metrics.roeProxy | 代理值，待接入Baostock财报 |
| ROIC | ✗ | 需要真实财报数据 |
| 营收/净利润/现金流 | ✗ | 需要真实财报数据 |
| PS/EV/EBITDA | ✗ | 需要真实财报数据 |

> **已覆盖**：所有技术指标（MACD/BOLL/KDJ/均线/52周）+ 核心估值指标（PE/PB/股息率）
> **待接入**：深度财务数据（ROE/ROIC/营收/利润/现金流），Baostock 有免费接口

### `POST /api/ensure-fresh`

Agent 用此端点确保数据新鲜。如果缓存超过1小时，自动触发快照刷新。

```
POST /api/ensure-fresh
→ { refreshed: true, source: "live", stocks: 5256 }
或
→ { alreadyFresh: true, age: 120000 }  // 数据已新鲜，不重复拉
```

**Agent 工作流**：
```
1. POST /api/ensure-fresh     ← 确保数据新鲜（自动判断是否需要刷新）
2. GET /api/stock-data?code=X ← 拿数据（纯缓存，零延迟）
3. GET /api/market-summary    ← 拿全市场概况
```

### `POST /api/prefetch`

触发全量预取（Agent 也可以调用）。

```
POST /api/prefetch  {"mode": "top100"}
→ { ok: true, technicalCached: 100, totalStocks: 5256 }
```

## 缓存策略

| 缓存文件 | 大小 | 刷新策略 |
|---------|------|---------|
| `.cache/live-snapshot.json` | ~5.5MB（5256只股票） | 每小时自动 / 手动 `POST /api/ensure-fresh` |
| `.cache/technicals-cache.json` | ~50MB（100只）= ~500MB（全部） | `npm run prefetch` 预取Top100 |

**缓存不会无限增长**：
- 快照每次覆盖写入（固定5.5MB）
- 技术指标按需缓存（只缓存查询过的股票），建议预取Top100（~10MB）
- 全部5256只的技术指标约50-150MB，远小于典型Obsidian vault

## 概念和行业

**当前方案（已生效）**：
- 11个核心概念：硬编码映射 + 行业关键词 + 名称关键词（`src/core/conceptAdapter.js`）
- 行业：Baostock 证监会行业分类（90个行业）
- 新浪175个概念板块：已拉取元数据，待接入（`scripts/build_concept_map.py` 可扩展）

**网络限制**：东方财富概念板块（AKShare/Tushare）在本地网络被墙。网络恢复后可接入 `akshare.stock_board_concept_cons_em()` 获取460+概念。

## Agent 使用示例

在 Obsidian 中与 agent 对话：

```
请分析贵州茅台的技术面：
1. POST http://127.0.0.1:4173/api/ensure-fresh
2. GET http://127.0.0.1:4173/api/stock-data?code=600519
3. 从返回的 technicals.snapshot 提取 MACD/BOLL/KDJ/均线数据
```

Agent 不需要安装任何 Python 库，不需要知道数据源细节。
