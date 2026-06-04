# 发现与决策

## 需求
1. 优化数据获取速度（当前 20-40 秒，目标 3-5 秒）
2. UI 自动展示 Top 10 推荐股票，含当前价、买入/卖出点、安全边际、生意模式简评
3. 只推荐当前价格在买入区间内的股票

## 研究发现

### 当前数据管道瓶颈
- `fetch_live_snapshot.py` 串行分页 ~70 页 Sina API，每页 80 只股票
- 每次请求 spawn Python 子进程，BaoStock 需要 login/logout session
- 技术指标逐个股票串行获取，每次 spawn Python
- 行业映射数据几乎不变，但每次都实时拉取

### 现有估值能力
- `philosophyEngine.js` 的 `computeMaoValuation()` 已实现 MaoGuGu 估值
- 输出：intrinsicValue, buyZoneLow, buyZoneHigh, marginOfSafety, valuationTier
- `pickFocusStocks` 已有过滤条件（core >= 78, riskFlags <= 1 等）
- 缺少"价格在买入区间内"的硬过滤

### a-share-investment-os 方法论
- 四种估值方法：收益率法、股息率法、资产折价法、毛估估区间法
- 主方法：毛估估区间法（已实现）
- 安全边际要求：极高确定性 20-30%，优秀 30-40%，有不确定性 40-50%
- 筛选门槛定为 10%（平衡数量和质量）

## 技术决策
| 决策 | 理由 |
|------|------|
| Node.js 原生替代 Python subprocess | 去掉进程启动开销，并行化 |
| 行业映射 + K 线用预抓取 JSON | 数据变化慢，本地读取毫秒级 |
| MaoGuGu 估值作为过滤依据 | 已实现，不需要新建模型 |
| 10% 安全边际门槛 | A 股整体估值偏高，门槛太高会筛不出股票 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| Sina API 返回 GBK 编码 | Node.js 用 Buffer 直接读取，尝试 UTF-8 解码（大部分中文字符兼容） |
| pickFocusStocks 可能返回 0 只股票 | UI 显示"当前无符合条件的股票"空状态提示，不降低门槛 |

## 资源
- 设计文档：`docs/superpowers/specs/2026-06-04-top10-recommendation-design.md`
- Sina API：`Market_Center.getHQNodeData` 分页接口
- BaoStock：行业映射 `query_stock_industry`，K 线 `query_history_k_data_plus`
