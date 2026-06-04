# Top 10 推荐股票系统 — 设计文档

> 日期: 2026-06-04
> 状态: 待审批

## 目标

1. 优化数据获取速度（从 20-40 秒降到 3-5 秒）
2. UI 自动展示 Top 10 推荐股票，包含完整投资决策信息
3. 只推荐当前价格在买入区间内的股票

## 一、数据管道：分层策略 + Node.js 原生重写

### 1.1 架构变更

```
当前:
  请求 → spawn Python → Sina API (串行70页) → Python处理 → JSON → Node.js
  耗时: 20-40秒

改后:
  请求 → Node.js 原生并行请求 Sina API (70个并发) → 合并 → 本地计算
  耗时: 3-5秒

  预抓取 (每天一次):
  scripts/prefetch_industry.py → .cache/industry-map.json (行业映射)
  scripts/prefetch_technicals.py → .cache/technicals-history.json (K线历史)
```

### 1.2 新建 `src/core/dataFetcher.js`

职责：替代 `fetch_live_snapshot.py`，用 Node.js 原生 `https` 模块抓取 Sina API。

核心逻辑：
```js
async function fetchAllSpot() {
  // 1. 先发1个请求获取总页数
  const totalPages = await fetchPageCount();

  // 2. 并行请求所有页
  const pages = await Promise.all(
    Array.from({ length: totalPages }, (_, i) => fetchPage(i + 1))
  );

  // 3. 合并结果
  return pages.flat();
}
```

- 单页失败重试 2 次，不影响其他页
- 合并后返回全量 spot 数据
- 错误处理：连续 3 页失败则中断，返回已获取的部分数据 + 错误标记

### 1.3 行业映射预抓取

新建 `scripts/prefetch_industry.py`：
- 从 BaoStock 抓取全量行业映射
- 输出到 `.cache/industry-map.json`
- 每天开盘前运行一次（可通过 Windows 任务计划程序或手动触发）

Node.js 端 `src/core/industryCache.js`：
- 启动时读取 `.cache/industry-map.json`
- 提供 `getIndustry(code)` 查询接口
- 不做网络请求，纯本地读取

### 1.4 K 线历史预抓取

新建 `scripts/prefetch_technicals.py`：
- 从 BaoStock 批量抓取全量 A 股 250 天日 K 线
- 输出到 `.cache/technicals-history.json`
- 每天收盘后运行一次

Node.js 端改造 `technicalIndicators.js`：
- 启动时从 `.cache/technicals-history.json` 加载 K 线数据
- 技术指标计算全部基于本地数据，不再 spawn Python

### 1.5 缓存策略

| 层级 | 存储 | TTL | 更新方式 |
|------|------|-----|----------|
| 内存 | `server.js` liveCache 变量 | 15 分钟 | 刷新时替换 |
| 磁盘 | `.cache/live-snapshot.json` | 永久（覆盖写） | 每次成功抓取后写入 |
| 行业映射 | `.cache/industry-map.json` | 1 天 | 预抓取脚本覆盖 |
| K 线历史 | `.cache/technicals-history.json` | 1 天 | 预抓取脚本覆盖 |

启动流程：
1. 读取磁盘缓存 → 立即可用（0 秒延迟）
2. 后台发起 Sina API 并行抓取（3-5 秒）
3. 抓取完成后替换内存缓存，前端自动更新

### 1.6 移除的依赖

- `fetch_live_snapshot.py` — 被 `dataFetcher.js` 替代
- `fetch_stock_history.py` — 被 `prefetch_technicals.py` + 本地读取替代
- BaoStock Node.js 调用 — 全部改为预抓取 JSON 文件

保留：
- `scripts/prefetch_industry.py` — 每天运行一次
- `scripts/prefetch_technicals.py` — 每天运行一次

## 二、推荐筛选逻辑：价格在买入区间内

### 2.1 硬过滤条件

在 `ranking.js` 的 `pickFocusStocks` 中增加条件：

```js
function pickFocusStocks(stocks, technicals) {
  return stocks.filter(s => {
    // 现有条件
    if (s.coreValueScore < 78) return false;
    if (s.riskFlags > 1) return false;
    if (s.consensusStrength === 'low' || s.consensusStrength === 'very-low') return false;

    // 新增：价格必须在买入区间内
    const valuation = computeMaoValuation(s);
    if (s.price > valuation.buyZoneHigh) return false;

    // 新增：安全边际至少 10%
    if (valuation.marginOfSafety < 10) return false;

    // 新增：估值档位必须是低估或合理偏低
    if (valuation.valuationTier !== '低估' && valuation.valuationTier !== '合理偏低') return false;

    return true;
  });
}
```

### 2.2 排序

通过硬过滤的股票按 `totalScore` 降序排列，取前 10 只。

### 2.3 卖出区间标记

当 `currentPrice > optimisticValue` 时，在 UI 上标记"已到卖出区间"。

### 2.4 空结果处理

通过过滤的股票不足 10 只时：
- 有多少显示多少
- UI 显示"当前符合条件的股票仅 N 只，建议等待更好的买入时机"
- 不降低门槛凑数

## 三、UI 显示：表格 + 卡片双模式

### 3.1 Focus 10 区域重新设计

替换当前的 Focus 10 卡片，改为可切换的表格/卡片视图。

展示字段：

| 字段 | 来源 | 说明 |
|------|------|------|
| 名称 + 代码 | spot 数据 | 基本标识 |
| 当前价格 | spot 数据 | 实时价格 |
| 行业 | 行业映射缓存 | 所属行业 |
| 概念标签 | conceptAdapter | 热点概念 |
| 总评分 | ranking.js | 综合评分 |
| 买入区间 | MaoGuGu 估值 | buyZoneLow ~ buyZoneHigh |
| 卖出目标 | MaoGuGu 估值 | optimisticValue |
| 安全边际 | MaoGuGu 估值 | marginOfSafety% |
| 生意模式简评 | 新增函数 | 一句话商业模式描述 |
| 共识强度 | 共识引擎 | 高/中高/中/低/极低 |

### 3.2 表格视图

```
┌────────┬──────┬────────┬─────────────┬───────┬───────┬──────────────────┬──────┐
│ 名称   │ 代码 │ 现价   │ 买入区间     │ 卖出  │ 安全  │ 生意模式          │ 共识 │
│        │      │        │             │ 目标  │ 边际  │                  │      │
├────────┼──────┼────────┼─────────────┼───────┼───────┼──────────────────┼──────┤
│ 茅台   │600519│1,680.00│1520~1600    │1,950  │12.5%  │品牌护城河极深    │ 高   │
│ 腾讯   │00700 │380.00  │340~360      │450    │11.8%  │社交+游戏双引擎   │ 中高 │
└────────┴──────┴────────┴─────────────┴───────┴───────┴──────────────────┴──────┘
```

- 点击行 → 右侧详情面板展开
- 表头可点击排序（安全边际、评分、价格）
- 已到卖出区间的行用黄色高亮

### 3.3 卡片视图

```
┌─────────────────────────────────┐
│ 贵州茅台  600519    ¥1,680.00   │
│ 白酒 | 品牌消费    评分: 86.3   │
│                                 │
│ 买入区间: ¥1,520 ~ ¥1,600      │
│ 卖出目标: ¥1,950               │
│ 安全边际: 12.5%                │
│ 共识强度: 高                    │
│                                 │
│ 品牌护城河极深，提价权稳固，     │
│ 现金流充沛，高端白酒格局稳定     │
│                                 │
│ [查看详细分析 →]                │
└─────────────────────────────────┘
```

### 3.4 生意模式简评生成

新增 `src/core/businessBrief.js`：

```js
function generateBusinessBrief(stock) {
  const { marketCap, grossMargin, dividendYield, industry, pe } = stock;

  if (marketCap > 2000e8 && grossMargin > 50)
    return '大市值高毛利，品牌/技术护城河深';
  if (marketCap > 500e8 && dividendYield > 3)
    return '大市值高分红，现金流稳健';
  if (grossMargin > 60 && industry.includes('消费'))
    return '消费品牌溢价强，定价权突出';
  if (grossMargin > 40 && industry.includes('科技'))
    return '技术壁垒较高，研发投入持续';
  if (pe < 15 && dividendYield > 4)
    return '低估值高股息，防御性强';
  // ... 更多规则
  return `${industry}行业，估值${stock.valuationTier}`;
}
```

### 3.5 视图切换

- 默认：表格视图
- 切换按钮在 Focus 10 标题右侧
- 切换状态保存到 localStorage

### 3.6 无推荐状态

当通过过滤的股票为 0 时，显示：
```
当前无符合条件的股票
建议等待更好的买入时机
上次更新: 2026-06-04 15:30
```

## 四、自动刷新策略

### 4.1 刷新时机

| 触发条件 | 行为 |
|----------|------|
| 应用启动 | 加载磁盘缓存（立即显示）+ 后台拉取新数据 |
| 手动刷新按钮 | 后台拉取新数据，完成后替换显示 |

不设自动定时刷新。用户按需手动刷新。

### 4.2 加载状态指示

- 启动时：显示"正在加载数据..."
- 后台刷新中：顶部显示轻量进度提示
- 刷新完成：显示"数据已更新至 HH:MM:SS"
- 刷新失败：显示"数据更新失败，显示的是上次缓存数据"

## 五、实施计划（分步）

### Step 1: 数据管道重写
- 新建 `src/core/dataFetcher.js`（Node.js 原生 Sina API 抓取）
- 新建 `src/core/industryCache.js`（行业映射本地读取）
- 新建 `scripts/prefetch_industry.py`（行业映射预抓取）
- 新建 `scripts/prefetch_technicals.py`（K 线历史预抓取）
- 改造 `server.js`（移除 Python subprocess 调用，使用新模块）
- 改造 `technicalIndicators.js`（从本地文件读取 K 线）
- 验证：启动后 5 秒内数据可用

### Step 2: 筛选逻辑增强
- 改造 `ranking.js` 的 `pickFocusStocks`（增加买入区间硬过滤）
- 新增 `src/core/businessBrief.js`（生意模式简评生成）
- 验证：只返回价格在买入区间内的股票

### Step 3: UI 改造
- 改造 `app.js` Focus 10 区域（表格+卡片双模式）
- 改造 `styles.css`（新增表格和卡片样式）
- 验证：表格和卡片视图正确显示所有字段

### Step 4: 自动刷新策略
- 改造 `server.js` 启动流程（先加载缓存再后台刷新）
- 改造 `app.js` 手动刷新逻辑（保留，移除自动定时）
- 验证：启动立即可用，手动刷新正常工作

## 六、风险和缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Sina API 限流 | 并行 70 个请求可能触发限流 | 加入随机延迟 (50-200ms)，失败重试 |
| 预抓取脚本未运行 | 行业映射/K 线数据缺失 | 启动时检测缓存文件是否存在，缺失时降级到实时抓取 |
| 买入区间过于严格 | 可能 0 只股票通过过滤 | UI 显示空状态提示，不降低门槛 |
| MaoGuGu 估值精度不足 | proxy 估算可能偏差较大 | 后续可引入更精确估值模型，当前版本先跑起来看效果 |
