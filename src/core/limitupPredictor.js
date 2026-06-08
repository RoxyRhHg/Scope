/**
 * 涨停预测评分引擎 v2 — 基于真实数据的预测
 *
 * 核心发现（基于2026年5-6月真实数据回测）：
 * - 连板数是最强预测因子：2连板33%概率继续，3连板41%，5连板50%
 * - 行业有预测价值：铁路公路75%，轨交设备75%，广告营销57%
 * - 炸板次数影响不大（15-25%区间）
 * - 封板资金越大，次日继续概率越高
 *
 * 预测目标：次日涨停/大涨（7%+）概率
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const limitupCachePath = path.join(root, ".cache", "limitup-history.json");

// ── 基于真实数据的行业连续涨停概率 ──
const INDUSTRY_CONTINUATION_RATE = {
  "铁路公路": 0.75, "轨交设备": 0.75, "非白酒": 0.67,
  "广告营销": 0.57, "橡胶": 0.50, "化学纤维": 0.50,
  "基础建设": 0.46, "生物制品": 0.43, "装修装饰": 0.43,
  "互联网电": 0.40, "电力": 0.35, "半导体": 0.30,
  "电子": 0.30, "通信设备": 0.30, "计算机设": 0.28,
};

// 排除行业
const EXCLUDE_INDUSTRIES = ["煤炭", "石油", "天然气"];

// ── 工具函数 ──
function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── 核心评分函数 ──

/**
 * 基于连板数的评分（最强预测因子）
 * 真实数据：
 * - 1连板: 16.3% 连续涨停概率
 * - 2连板: 33.3%
 * - 3连板: 40.6%
 * - 5连板: 50.0%
 * - 6连板: 100.0%
 */
function scoreConsecutive(consecutive) {
  if (consecutive >= 6) return 100;
  if (consecutive >= 5) return 85;
  if (consecutive >= 4) return 70;
  if (consecutive >= 3) return 60;
  if (consecutive >= 2) return 45;
  return 15; // 1连板基础分
}

/**
 * 基于行业连续涨停概率的评分
 */
function scoreIndustry(industry) {
  if (!industry) return 20;
  const rate = INDUSTRY_CONTINUATION_RATE[industry] || 0.20;
  return clamp(Math.round(rate * 100), 10, 90);
}

/**
 * 基于封板资金的评分
 * 封板资金越大，说明买盘越强
 */
function scoreSealMoney(sealMoney) {
  if (sealMoney >= 5e8) return 90;  // 5亿以上
  if (sealMoney >= 3e8) return 75;  // 3-5亿
  if (sealMoney >= 1e8) return 60;  // 1-3亿
  if (sealMoney >= 5e7) return 45;  // 5000万-1亿
  return 25; // 5000万以下
}

/**
 * 基于换手率的评分
 * 中等换手率最健康（5-15%）
 */
function scoreTurnover(turnover) {
  if (turnover >= 5 && turnover <= 15) return 70;  // 健康区间
  if (turnover >= 3 && turnover < 5) return 55;    // 偏低
  if (turnover > 15 && turnover <= 25) return 50;  // 偏高
  if (turnover > 25) return 30;                     // 过高风险
  return 40; // 过低
}

/**
 * 基于炸板次数的评分
 * 炸板越少越好，但影响不大
 */
function scoreBrokenCount(brokenCount) {
  if (brokenCount === 0) return 60;
  if (brokenCount <= 2) return 50;
  if (brokenCount <= 5) return 40;
  return 30;
}

/**
 * 基于涨停统计的评分
 * X/Y格式：X是涨停天数，Y是统计天数
 * X/Y越高说明涨停频率越高
 */
function scoreZtStats(ztStats) {
  if (!ztStats) return 20;
  const parts = ztStats.split("/");
  if (parts.length !== 2) return 20;
  const x = parseInt(parts[0]) || 0;
  const y = parseInt(parts[1]) || 1;
  const ratio = x / y;
  if (ratio >= 0.8) return 80;
  if (ratio >= 0.6) return 65;
  if (ratio >= 0.4) return 50;
  return 35;
}

// ── 综合预测评分 ──

/**
 * 计算单只股票的涨停预测分
 * @param {Object} stock - 涨停池中的股票数据（来自AKShare）
 * @returns {Object} 预测结果
 */
export function predictLimitup(stock, technicals, bars, limitupHistory) {
  const code = stock.code;

  // 硬性排除
  if (code.startsWith("688")) return null; // 科创板
  if (stock.stopDoingBlocked) return null;  // 不为清单
  const stockName = stock.name || "";
  if (stockName.includes("*ST") || stockName.includes("*st")) return null;

  // 从涨停历史中获取最新数据
  const stockLimitup = limitupHistory?.limitup_events?.[code] ||
    limitupHistory?.limitup_events?.[`sh.${code}`] ||
    limitupHistory?.limitup_events?.[`sz.${code}`];

  // 获取最新一天的涨停数据（包含连板数、封板资金等）
  let latestEvent = null;
  if (stockLimitup?.events?.length > 0) {
    latestEvent = stockLimitup.events[stockLimitup.events.length - 1];
  }

  const consecutive = latestEvent?.consecutive || stock.consecutive || 1;
  const sealMoney = latestEvent?.seal_money || stock.seal_money || 0;
  const turnover = latestEvent?.turnover || stock.turnover || 0;
  const brokenCount = latestEvent?.broken_count || stock.broken_count || 0;
  const ztStats = latestEvent?.zt_stats || stock.zt_stats || "";
  const industry = latestEvent?.industry || stock.industry || "";

  // 五维评分
  const consecutiveScore = scoreConsecutive(consecutive);
  const industryScore = scoreIndustry(industry);
  const sealScore = scoreSealMoney(sealMoney);
  const turnoverScore = scoreTurnover(turnover);
  const brokenScore = scoreBrokenCount(brokenCount);
  const ztStatsScore = scoreZtStats(ztStats);

  // 加权总分（连板数权重最高）
  const totalScore = round(
    consecutiveScore * 0.35 +  // 连板数：最强预测因子
    industryScore * 0.20 +     // 行业：次强因子
    sealScore * 0.20 +         // 封板资金：买盘强度
    turnoverScore * 0.10 +     // 换手率：健康度
    ztStatsScore * 0.10 +      // 涨停统计：频率
    brokenScore * 0.05         // 炸板次数：稳定性
  );

  // 涨停概率（基于真实数据）
  let probability;
  if (consecutive >= 5) probability = "极高";
  else if (consecutive >= 3) probability = "高";
  else if (consecutive >= 2) probability = "中等";
  else probability = "低";

  // 建议动作
  let action;
  if (consecutive >= 4 && sealMoney >= 1e8) action = "强烈关注";
  else if (consecutive >= 3) action = "积极关注";
  else if (consecutive >= 2 && industryScore >= 50) action = "纳入观察";
  else if (consecutive >= 2) action = "谨慎观望";
  else action = "暂不考虑";

  // 信号
  const signals = [];
  if (consecutive >= 3) signals.push(`${consecutive}连板(超强信号)`);
  else if (consecutive >= 2) signals.push(`${consecutive}连板(强信号)`);
  if (industryScore >= 50) signals.push(`${industry}(热门行业)`);
  if (sealMoney >= 3e8) signals.push(`封板${(sealMoney/1e8).toFixed(1)}亿(强)`);
  if (turnover >= 5 && turnover <= 15) signals.push(`换手${turnover.toFixed(1)}%(健康)`);
  if (brokenCount === 0) signals.push("零炸板(强势)");
  if (ztStats) signals.push(`涨停统计${ztStats}`);

  return {
    code: stock.code,
    name: stock.name,
    type: stock.type || "stock",
    industry,
    concepts: (stock.concepts || []).slice(0, 3),
    price: stock.price || latestEvent?.close || 0,
    // 五维子分
    dimensions: {
      consecutive: consecutiveScore,
      industry: industryScore,
      sealMoney: sealScore,
      turnover: turnoverScore,
      broken: brokenScore,
      ztStats: ztStatsScore,
    },
    // 总分与预测
    totalScore,
    probability,
    action,
    // 信号
    signals,
    // 涨停数据
    consecutive,
    sealMoney,
    turnover,
    brokenCount,
    ztStats,
    limitupCount: stockLimitup?.count || 0,
    recentLimitup: stockLimitup?.events?.slice(-3) || [],
  };
}

/**
 * 批量预测：对涨停池中的股票评分并排序
 */
export function batchPredict(snapshot, technicalCache, limitupHistory, filters = {}) {
  const {
    maxPrice = 999,
    excludeStar = true,
    priorityOnly = false,
    minScore = 30,
    limit = 50,
  } = filters;

  const results = [];

  // 从涨停历史中获取最新一天的涨停池
  if (limitupHistory?.daily_limitups) {
    const dates = Object.keys(limitupHistory.daily_limitups).sort();
    const latestDate = dates[dates.length - 1];
    const latestStocks = limitupHistory.daily_limitups[latestDate] || [];

    for (const stock of latestStocks) {
      // 过滤
      if (excludeStar && stock.code?.startsWith("688")) continue;
      if (stock.price > maxPrice) continue;
      if (stock.price <= 0) continue;

      // 排除 *ST
      const name = stock.name || "";
      if (name.includes("*ST") || name.includes("*st")) continue;

      // 优先行业过滤
      if (priorityOnly) {
        const industry = stock.industry || "";
        const isPriority = Object.keys(INDUSTRY_CONTINUATION_RATE).some(kw =>
          industry.includes(kw)
        );
        if (!isPriority) continue;
      }

      const prediction = predictLimitup(stock, null, null, limitupHistory);
      if (prediction && prediction.totalScore >= minScore) {
        results.push(prediction);
      }
    }
  }

  // 按总分排序
  results.sort((a, b) => b.totalScore - a.totalScore);

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
