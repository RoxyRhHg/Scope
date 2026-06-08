/**
 * 涨停预测评分引擎 v3 — 安全边际 + 涨停概率
 *
 * 策略：找到安全边际足够（10-20%）且有涨停潜力的好公司
 * 不是追涨停，而是在低估股票中找即将爆发的标的
 *
 * 核心逻辑：
 * 1. 安全边际 10-20% → 确保不亏钱
 * 2. 涨停基因/技术形态 → 确保有上涨动力
 * 3. 优先科技/新兴产业 → 高成长性
 * 4. 大资金流入 → 机构认可
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const limitupCachePath = path.join(root, ".cache", "limitup-history.json");

// ── 优先行业（科技/新兴产业）──
const PRIORITY_INDUSTRIES = [
  "半导体", "芯片", "存储", "光学", "光电子", "显示", "面板",
  "通信设备", "光通信", "CPO", "AI", "人工智能", "算力", "数据",
  "机器人", "具身智能", "智能驾驶", "物理AI",
  "电子", "消费电子", "传感器", "封测",
  "计算机", "软件", "信息技术",
];

// 排除行业
const EXCLUDE_INDUSTRIES = ["煤炭", "石油", "天然气", "传统能源"];

// ── 工具函数 ──
function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── 安全边际评分（40%权重）──
function scoreSafety(stock) {
  const margin = stock.marginOfSafety || 0;
  const core = stock.scores?.core || 0;
  const valuationTier = stock.valuationTier || "";

  let score = 0;

  // 安全边际评分
  if (margin >= 15 && margin <= 25) score += 50;  // 最佳区间
  else if (margin >= 10 && margin < 15) score += 40;
  else if (margin >= 20 && margin <= 30) score += 35;
  else if (margin >= 5 && margin < 10) score += 20;
  else score += 5;

  // 估值等级加分
  if (valuationTier === "低估") score += 30;
  else if (valuationTier === "合理偏低") score += 20;
  else if (valuationTier === "合理") score += 10;

  // 核心分加分
  if (core >= 75) score += 20;
  else if (core >= 65) score += 10;

  return clamp(score, 0, 100);
}

// ── 涨停潜力评分（35%权重）──
function scoreLimitupPotential(stock, limitupHistory) {
  const code = stock.code;
  let score = 0;

  // 从涨停历史中查找
  const stockLimitup = limitupHistory?.limitup_events?.[code];
  if (!stockLimitup) return 20; // 无历史数据，基础分

  const events = stockLimitup.events || [];
  const count = stockLimitup.count || 0;
  const maxConsecutive = stockLimitup.max_consecutive || 0;

  // 涨停频率
  if (count >= 5) score += 40;
  else if (count >= 3) score += 30;
  else if (count >= 2) score += 20;
  else if (count >= 1) score += 10;

  // 连板能力
  if (maxConsecutive >= 3) score += 30;
  else if (maxConsecutive >= 2) score += 20;
  else if (maxConsecutive >= 1) score += 10;

  // 近期活跃度
  const now = new Date();
  const recent7 = events.filter(e => {
    const d = new Date(e.date);
    return (now - d) < 7 * 86400000;
  });
  if (recent7.length >= 2) score += 20;
  else if (recent7.length >= 1) score += 10;

  // 最近一次涨停距今天数
  if (events.length > 0) {
    const latest = events[events.length - 1];
    const daysSince = Math.floor((now - new Date(latest.date)) / 86400000);
    if (daysSince <= 3) score += 10;
    else if (daysSince <= 7) score += 5;
  }

  return clamp(score, 0, 100);
}

// ── 行业评分（15%权重）──
function scoreIndustry(stock) {
  const industry = stock.industry || "";
  const concepts = stock.concepts || [];

  // 优先行业匹配
  const isPriority = PRIORITY_INDUSTRIES.some(kw =>
    industry.includes(kw) || concepts.some(c => c.includes(kw))
  );
  if (isPriority) return 80;

  // 排除行业
  const isExcluded = EXCLUDE_INDUSTRIES.some(kw => industry.includes(kw));
  if (isExcluded) return 10;

  return 40; // 其他行业
}

// ── 资金流入评分（10%权重）──
function scoreCapitalFlow(stock, limitupHistory) {
  const code = stock.code;
  let score = 40; // 基础分

  const stockLimitup = limitupHistory?.limitup_events?.[code];
  if (stockLimitup?.events?.length > 0) {
    const latest = stockLimitup.events[stockLimitup.events.length - 1];
    const sealMoney = latest.seal_money || 0;
    const turnover = latest.turnover || 0;

    // 封板资金
    if (sealMoney >= 3e8) score += 30;  // 3亿以上
    else if (sealMoney >= 1e8) score += 20;  // 1-3亿
    else if (sealMoney >= 5e7) score += 10;  // 5000万-1亿

    // 换手率（适中最好）
    if (turnover >= 5 && turnover <= 15) score += 20;
    else if (turnover >= 3 && turnover < 5) score += 10;
  }

  return clamp(score, 0, 100);
}

// ── 综合预测评分 ──

export function predictLimitup(stock, technicals, bars, limitupHistory) {
  const code = stock.code;

  // 硬性排除
  if (code.startsWith("688")) return null;
  if (stock.stopDoingBlocked) return null;
  const stockName = stock.name || "";
  if (stockName.includes("*ST") || stockName.includes("*st")) return null;

  // 安全边际检查：必须 10-25%（百分比格式）
  const margin = stock.marginOfSafety || 0;
  if (margin < 10 || margin > 25) return null;

  // 价格检查：必须 < 70
  if (stock.price > 70 || stock.price <= 0) return null;

  // 四维评分
  const safetyScore = scoreSafety(stock);
  const limitupScore = scoreLimitupPotential(stock, limitupHistory);
  const industryScore = scoreIndustry(stock);
  const capitalScore = scoreCapitalFlow(stock, limitupHistory);

  // 加权总分
  const totalScore = round(
    safetyScore * 0.40 +     // 安全边际：最重要
    limitupScore * 0.35 +    // 涨停潜力：次重要
    industryScore * 0.15 +   // 行业：加分项
    capitalScore * 0.10      // 资金流入：加分项
  );

  // 涨停概率等级
  let probability;
  if (limitupScore >= 70) probability = "高";
  else if (limitupScore >= 50) probability = "中等";
  else if (limitupScore >= 30) probability = "低";
  else probability = "极低";

  // 建议动作
  let action;
  if (totalScore >= 70 && safetyScore >= 60) action = "强烈关注";
  else if (totalScore >= 60 && safetyScore >= 50) action = "积极关注";
  else if (totalScore >= 50) action = "纳入观察";
  else action = "谨慎观望";

  // 涨停历史
  const stockLimitup = limitupHistory?.limitup_events?.[code];
  const limitupCount = stockLimitup?.count || 0;
  const maxConsecutive = stockLimitup?.max_consecutive || 0;

  // 行业类型（简化显示）
  const industryType = stock.industry || "未知行业";

  // 公司业务概述
  const businessBrief = stock.businessBrief || "暂无概述";

  // 当日涨幅
  const changePercent = stock.changePercent || 0;

  return {
    code: stock.code,
    name: stock.name,
    type: stock.type || "stock",
    price: stock.price,
    // 显示字段
    industryType,
    businessBrief,
    changePercent,
    // 评分
    totalScore,
    probability,
    action,
    // 安全边际
    marginOfSafety: margin,
    valuationTier: stock.valuationTier,
    coreScore: stock.scores?.core || 0,
    // 涨停数据
    limitupCount,
    maxConsecutive,
    recentLimitup: stockLimitup?.events?.slice(-3) || [],
  };
}

/**
 * 批量预测：从 Scope 快照中筛选符合条件的股票
 */
export function batchPredict(snapshot, technicalCache, limitupHistory, filters = {}) {
  const {
    maxPrice = 70,
    excludeStar = true,
    priorityOnly = true,
    minScore = 40,
    limit = 10,
  } = filters;

  const results = [];

  for (const stock of snapshot) {
    // 基础过滤
    if (excludeStar && stock.code?.startsWith("688")) continue;
    if (stock.price > maxPrice || stock.price <= 0) continue;
    if (stock.stopDoingBlocked) continue;

    // 排除 *ST
    const name = stock.name || "";
    if (name.includes("*ST") || name.includes("*st")) continue;

    // 安全边际过滤：必须 10-20%
    const margin = stock.marginOfSafety || 0;
    if (margin < 10 || margin > 25) continue;

    // 优先行业过滤
    if (priorityOnly) {
      const industry = stock.industry || "";
      const concepts = stock.concepts || [];
      const isPriority = PRIORITY_INDUSTRIES.some(kw =>
        industry.includes(kw) || concepts.some(c => c.includes(kw))
      );
      if (!isPriority) continue;
    }

    const prediction = predictLimitup(stock, null, null, limitupHistory);
    if (prediction && prediction.totalScore >= minScore) {
      results.push(prediction);
    }
  }

  // 按总分排序
  results.sort((a, b) => b.totalScore - a.totalScore);

  // ETF/LOF 补充
  if (limitupHistory?.limitup_events) {
    const snapshotCodes = new Set(snapshot.map(s => s.code));
    for (const [fullCode, data] of Object.entries(limitupHistory.limitup_events)) {
      const instType = data.type || "stock";
      if (instType !== "etf" && instType !== "lof") continue;
      const pureCode = data.code || fullCode.split(".").pop();
      if (snapshotCodes.has(pureCode)) continue;

      const etfStock = {
        code: pureCode,
        name: data.name,
        type: instType,
        price: data.events?.at(-1)?.close || 0,
        industry: "",
        concepts: [],
        stopDoingBlocked: false,
        marginOfSafety: 0, // ETF 无安全边际
        scores: {},
      };

      if (etfStock.price > maxPrice || etfStock.price <= 0) continue;

      const prediction = predictLimitup(etfStock, null, null, limitupHistory);
      if (prediction && prediction.totalScore >= minScore) {
        results.push(prediction);
      }
    }
  }

  return results.slice(0, limit);
}

/**
 * 加载涨停历史缓存
 */
export function loadLimitupHistory() {
  try {
    if (fs.existsSync(limitupCachePath)) {
      const raw = fs.readFileSync(limitupCachePath, "utf8");
      return JSON.parse(raw);
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 获取涨停统计摘要
 */
export function getLimitupSummary(limitupHistory) {
  if (!limitupHistory) return null;

  return {
    total_stocks_processed: limitupHistory.total_stocks_processed,
    total_limitup_stocks: limitupHistory.total_limitup_stocks,
    total_limitup_events: limitupHistory.total_limitup_events,
    type_stats: limitupHistory.type_stats || {},
    generated_at: limitupHistory.generated_at,
    top20_freq: (limitupHistory.freq_ranking_top100 || []).slice(0, 20).map(s => ({
      code: s.code, name: s.name, type: s.type || "stock", count: s.count,
    })),
    pre_limit_features: limitupHistory.pre_limit_features,
    recent_daily_counts: (limitupHistory.daily_counts || []).slice(-20),
  };
}
