/**
 * Obsidian 适配器：将 Scope 股票分析数据映射为 Obsidian 财经模板格式。
 *
 * 职责：
 * - 构建标的主档案结构化数据（对齐 标的主档案模板.md）
 * - 构建每日复盘结构化数据（对齐 单标的每日复盘模板.md）
 * - 生成 Obsidian 兼容的 markdown 字符串
 * - 生成维基链接
 *
 * 不负责：评分/估值计算（那是 ranking.js 和 philosophyEngine.js 的职责）
 */

// ─── 辅助函数 ─────────────────────────────────────────────────

function nvl(value, fallback) {
  return value !== null && value !== undefined ? value : fallback;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function describeScore(score) {
  if (score >= 80) return "优秀";
  if (score >= 65) return "良好";
  if (score >= 50) return "一般";
  return "偏弱";
}

// ─── 字段映射：Scope → 标的主档案模板 ──────────────────────────

/**
 * 映射当前定位（stock_type）。
 */
function mapStockType(stock) {
  const conclusion = stock.conclusion ?? "";
  if (conclusion === "重点关注") return "核心";
  if (conclusion === "值得观察") return "卫星";
  if (conclusion === "估值偏贵") return "交易型";
  return "卫星";
}

/**
 * 映射当前阶段（status）。
 */
function mapStatus(stock) {
  const conclusion = stock.conclusion ?? "";
  if (conclusion === "重点关注") return "持有";
  if (conclusion === "值得观察") return "候选";
  if (conclusion === "明确回避") return "放弃";
  return "观察";
}

/**
 * 映射基本面结论。
 */
function mapFundamentalConclusion(stock) {
  const core = stock.scores?.core ?? 0;
  if (core >= 78) return "值得拥有";
  if (core >= 65) return "值得跟踪";
  if (core >= 55) return "只适合交易";
  return "放弃";
}

/**
 * 映射估值状态。
 */
function mapValuationStatus(stock) {
  return stock.maoValuation?.valuationTier ?? "合理";
}

/**
 * 映射技术状态。
 */
function mapTechnicalStatus(technicals) {
  if (!technicals?.snapshot?.trend) return "震荡";
  const bias = technicals.snapshot.trend.bias;
  if (bias === "bullish") return "强势";
  if (bias === "bearish") return "转弱";
  return "震荡";
}

/**
 * 映射安全边际判断。
 */
function mapSafetyMargin(stock) {
  const margin = stock.maoValuation?.marginOfSafety ?? 0;
  if (margin >= 20) return "强";
  if (margin >= 5) return "中";
  return "弱";
}

/**
 * 推断资产模式。
 */
function inferAssetMode(stock) {
  const industry = stock.industry ?? "";
  const heavyAssets = ["银行", "电力", "煤炭", "交通运输", "机械设备"];
  const highTurnover = ["食品饮料", "家用电器", "电子", "通信设备"];
  if (heavyAssets.includes(industry)) return "重资产";
  if (highTurnover.includes(industry)) return "高周转";
  return "轻资产";
}

/**
 * 推断企业属性。
 */
function inferEnterpriseNature(stock) {
  const industry = stock.industry ?? "";
  const soeIndustries = ["银行", "电力", "煤炭", "公用事业", "交通运输"];
  if (soeIndustries.includes(industry)) return "国企";
  return "民企";
}

/**
 * 映射商业模式复杂度。
 */
function mapBusinessComplexity(stock) {
  const map = {
    银行: "中等", 保险: "复杂", 证券: "复杂",
    医药生物: "复杂", 电子: "中等", 计算机: "复杂",
    通信设备: "中等", 食品饮料: "简单", 家用电器: "简单",
    电力: "简单", 煤炭: "简单", 公用事业: "简单",
    交通运输: "简单", 机械设备: "中等",
  };
  return map[stock.industry] ?? "中等";
}

/**
 * 检测护城河类型。
 */
function detectMoatType(stock) {
  const bq = stock.metrics?.businessModelQuality ?? stock.metrics?.businessQuality ?? 0;
  const mgmt = stock.metrics?.managementQuality ?? 0;
  const industry = stock.industry ?? "";

  if (bq >= 75) {
    if (["食品饮料", "家用电器"].includes(industry)) return "品牌";
    if (["银行", "电力", "煤炭"].includes(industry)) return "牌照";
    if (["计算机", "通信设备", "电子"].includes(industry)) return "平台效应";
    return "品牌";
  }
  if (bq >= 55) {
    return mgmt >= 60 ? "成本+管理" : "成本";
  }
  return "暂无明确护城河";
}

// ─── 公开 API ─────────────────────────────────────────────────

/**
 * 构建标的主档案结构化数据。
 *
 * @param {Object} stock - 评分后的股票对象（来自 ranking.js computeStockScores 输出）
 * @param {Object} technicals - 技术指标数据（可选，来自 /api/technicals）
 * @param {Object} options - 可选配置
 * @param {string} options.wikiStockPath - 维基链接中股票的前缀路径，默认 "财经/选股/"
 * @returns {Object} 包含所有模板字段的结构化数据
 */
export function buildMasterProfileData(stock, technicals, options = {}) {
  const wikiPath = options.wikiStockPath ?? "财经/选股/";
  const wikiStock = `[[${wikiPath}${stock.name}]]`;
  const today = new Date().toISOString().slice(0, 10);

  const mao = stock.maoValuation ?? {};
  const card = stock.valuationCard ?? {};
  const consensus = stock.consensus ?? {};
  const techSnapshot = technicals?.snapshot ?? {};

  return {
    // ── 顶部动态摘要 ──
    currentPosition: mapStockType(stock),
    currentStage: mapStatus(stock),
    coreLogic: stock.description ?? "",
    fundamentalConclusion: mapFundamentalConclusion(stock),
    valuationStatus: mapValuationStatus(stock),
    technicalStatus: mapTechnicalStatus(technicals),
    suggestedBuyZone: mao.buyZoneLow && mao.buyZoneHigh
      ? `${mao.buyZoneLow.toFixed(2)} - ${mao.buyZoneHigh.toFixed(2)}`
      : "",
    suggestedSellZone: mao.optimisticValue ? `${mao.optimisticValue.toFixed(2)} 附近` : "",
    safetyMargin: mapSafetyMargin(stock),
    nextCheckpoint: "",

    // ── 标的基础信息 ──
    name: stock.name ?? "",
    code: stock.code ?? "",
    type: "个股",
    industry: stock.industry ?? "",
    assetMode: inferAssetMode(stock),
    enterpriseNature: inferEnterpriseNature(stock),
    classificationTags: [stock.industry, mapStockType(stock)].filter(Boolean),

    // ── 长期投资逻辑 ──
    whatIsThis: stock.description ?? "",
    whyTrack: consensus.note ?? `核心分 ${stock.scores?.core ?? "?"}，总分 ${stock.scores?.total ?? "?"}`,
    tenYearView: "",
    tenYearPremise: "",
    tenYearFailureRisk: "",

    // ── 企业与商业模式 ──
    businessModel: {
      revenueSource: "",
      profitSource: "",
      repeatability: "",
      moatType: detectMoatType(stock),
      moatDetail: `商业质量评分为 ${nvl(stock.metrics?.businessModelQuality, stock.metrics?.businessQuality) ?? "?"}/100`,
      managementComment: `管理质量代理评分 ${nvl(stock.metrics?.managementQuality, "?")}/100`,
      governanceNote: "",
      dividendHistory: stock.dividendYield ? `${stock.dividendYield}%` : "",
    },

    // ── 财务框架 ──
    financials: {
      capex: "",
      opex: "",
      interestExpense: "",
      spendingConclusion: "",
      debtStructure: `有息负债率代理 ${nvl(stock.metrics?.interestDebtRatio, "?")}`,
      shortTermDebtPressure: "",
      financingDependency: "",
      debtConclusion: `资产负债安全得分 ${nvl(stock.metrics?.balanceSheet, "?")}/100`,
      operatingCashFlow: "",
      freeCashFlow: stock.financials?.freeCashFlowYieldProxy
        ? `${stock.financials.freeCashFlowYieldProxy}% [代理]`
        : "",
      collectionQuality: "",
      cashFlowConclusion: `现金流质量得分 ${nvl(stock.metrics?.cashFlow, "?")}/100`,
      grossMargin: "",
      netMargin: "",
      expenseRatio: "",
      roe: stock.financials?.roeProxy ? `${stock.financials.roeProxy}% [代理]` : "",
      roic: "",
      profitabilityConclusion: `盈利质量得分 ${nvl(stock.metrics?.profitability, "?")}/100`,
      assetMode: inferAssetMode(stock),
      assetDetail: "",
      assetConclusion: "",
      cycleType: "",
      volatilitySource: "",
      stabilityConclusion: `经营稳定性得分 ${nvl(stock.metrics?.stability, "?")}/100`,
    },

    // ── 估值框架 ──
    valuation: {
      method: "毛估估估值（基于估值分位 + PE/PB 代理）",
      undervaluedCondition: `价格低于 ${mao.buyZoneHigh?.toFixed(2) ?? "?"}`,
      fairCondition: "",
      overvaluedCondition: `价格高于 ${mao.optimisticValue?.toFixed(2) ?? "?"}`,
      safetyMarginSource: `内在价值中枢 ${mao.intrinsicValue?.toFixed(2) ?? "?"}，保守估值 ${mao.conservativeValue?.toFixed(2) ?? "?"}`,
      distortionVariable: "PE/PB 为代理值，未接入完整财报",
      earningsYield: mao.earningsYield,
      opportunityNote: mao.opportunityNote,
    },

    // ── 风险与失效条件 ──
    risks: (stock.riskFlags ?? []).map((f) => ({ flag: f })),
    stopDoingBlocked: stock.stopDoingBlocked ?? false,
    stopDoingReasons: stock.stopDoingReasons ?? [],
    failureConditions: (stock.stopDoingReasons ?? []).map((r) => `不为清单触发：${r}`),
    abandonTriggers: stock.stopDoingBlocked ? ["不为清单已触发"] : [],

    // ── 跟踪清单（手动填空） ──
    tracking: {
      keyFinancialMetrics: "",
      keyEvents: "",
      keyPriceZones: mao.buyZoneLow
        ? `${mao.buyZoneLow.toFixed(2)} - ${mao.buyZoneHigh.toFixed(2)}`
        : "",
      keyIndustryVariables: "",
      nextUpdateFocus: "",
    },

    // ── 执行附录 ──
    execution: {
      grid: {
        suitable: inferAssetMode(stock) !== "重资产" ? "是" : "视情况",
        premise: "波动适中，流动性充足",
        unsuitable: "单边急跌/急涨行情",
      },
      scalp: {
        suitable: stock.metrics?.volatilityFit > 60 ? "是" : "视情况",
        scenario: "震荡市，日内波动 > 2%",
        unsuitable: "趋势明确时不逆势",
      },
      trend: {
        suitable: techSnapshot?.trend ? "是" : "待评估",
        trigger: techSnapshot?.trend?.bias === "bullish" ? "周线 60 均线上方 + MACD 金叉" : "",
        failure: "跌破周线 60 均线",
      },
      batchEntry: "分 3 批建仓，每批间隔 3-5 个交易日",
      batchAdd: "仅在盈利且估值仍合理时加仓",
      batchReduce: "估值偏高或基本面恶化时减仓",
      batchExit: "不为清单触发或估值明显高估时卖出",
    },

    // ── 关联笔记（手动填空） ──
    relatedNotes: {
      recentDailyReviews: "",
      dayReviews: "",
      weeklyReview: "",
      monthlyReview: "",
    },

    // ── 更新记录 ──
    updateDate: today,
    wikiStock,

    // ── 原始数据引用（供前端渲染使用） ──
    _raw: { stock, technicals },
  };
}

/**
 * 构建每日复盘结构化数据。
 *
 * @param {Object} stock - 评分后的股票对象
 * @param {Object} technicals - 技术指标数据（可选）
 * @param {Object} options - 可选配置
 * @returns {Object}
 */
export function buildDailyReviewData(stock, technicals, options = {}) {
  const wikiPath = options.wikiStockPath ?? "财经/选股/";
  const wikiStock = `[[${wikiPath}${stock.name}]]`;
  const today = new Date().toISOString().slice(0, 10);

  const consensus = stock.consensus ?? {};
  const mao = stock.maoValuation ?? {};

  return {
    date: today,
    stock: wikiStock,
    stance: mapStatusToStance(stock),
    todayChange: inferTodayChange(stock, technicals),
    todayPlannedAction: "",
    todayActualAction: "",
    oneLineReason: "",

    todayCoreChange: {
      whatHappened: "",
      signalOrNoise: "",
      impactOnMainLogic: "",
    },

    fundamentalChange: {
      newInfo: "",
      changesLongTermJudgment: "否",
    },

    valuationChange: {
      currentFeeling: mapValuationStatus(stock),
      moreOrLessMargin: "",
    },

    ownershipJudgment: {
      conclusion: mapFundamentalConclusion(stock),
      reason: consensus.note ?? "",
    },

    technicalState: {
      trendPosition: "",
      volumePrice: "",
      strengthJudgment: mapTechnicalStatus(technicals),
    },

    keyPriceChanges: {
      supportZone: "",
      pressureZone: "",
      suggestedBuyZone: mao.buyZoneLow
        ? `${mao.buyZoneLow.toFixed(2)} - ${mao.buyZoneHigh.toFixed(2)}`
        : "",
      suggestedSellZone: "",
      failureCondition: "",
    },

    todaySuitable: {
      action: "不动",
      reason: "",
    },

    actualExecution: {
      didExecute: "",
      actualBuySell: "",
      actualPositionChange: "",
      deviation: "",
    },

    deviationReflection: {
      judgmentOrExecution: "",
      todayKeyLesson: "",
      tomorrowFocus: "",
    },

    relatedNotes: {
      masterProfile: wikiStock,
      todaySummary: "",
      lastReview: "",
    },

    _raw: { stock, technicals },
  };
}

function mapStatusToStance(stock) {
  const conclusion = stock.conclusion ?? "";
  if (conclusion === "重点关注") return "持有";
  if (conclusion === "值得观察") return "观望";
  if (conclusion === "估值偏贵") return "等买点";
  if (conclusion === "明确回避") return "放弃";
  return "观望";
}

function inferTodayChange(stock, technicals) {
  const techBias = technicals?.snapshot?.trend?.bias;
  if (techBias === "bullish" || techBias === "bearish") return "技术面";
  const consensus = stock.consensus?.confidence;
  if (consensus === "低" || consensus === "极低") return "基本面";
  return "无实质变化";
}

// ─── Markdown 生成 ────────────────────────────────────────────

/**
 * 生成标的主档案 Obsidian markdown。
 *
 * @param {Object} data - buildMasterProfileData 的输出
 * @returns {string} Obsidian 格式的 markdown 字符串
 */
export function renderMasterProfileMarkdown(data) {
  const f = data.financials ?? {};
  const v = data.valuation ?? {};
  const e = data.execution ?? {};
  const t = data.tracking ?? {};
  const r = data.relatedNotes ?? {};

  return `---
tags:
  - 财经/选股
  - Scope导入
template_type: stock_profile
stock_type: ${data.currentPosition}
status: ${data.currentStage}
scope_core_score: ${data._raw?.stock?.scores?.core ?? ""}
scope_total_score: ${data._raw?.stock?.scores?.total ?? ""}
scope_updated: ${data.updateDate}
---

> [!summary] 顶部动态摘要
> - **当前定位**：${data.currentPosition}（${data.currentStage}）
> - **一句话核心逻辑**：${data.coreLogic}
> - **当前基本面结论**：${data.fundamentalConclusion}
> - **当前估值状态**：${data.valuationStatus}
> - **当前技术状态**：${data.technicalStatus}
> - **建议买入区**：${data.suggestedBuyZone || "待定"}
> - **建议卖出区**：${data.suggestedSellZone || "待定"}
> - **安全边际**：${data.safetyMargin}
> - **下一观察点**：${data.nextCheckpoint || "待定"}

## 标的基础信息

| 字段 | 值 |
|------|-----|
| 名称 | ${data.name} |
| 代码 | ${data.code} |
| 类型 | ${data.type} |
| 行业/主题 | ${data.industry} |
| 资产模式 | ${data.assetMode} |
| 企业属性 | ${data.enterpriseNature} |
| 分类标签 | ${data.classificationTags.join(" / ")} |

## 长期投资逻辑

### 这是什么标的
${data.whatIsThis || "待补充"}

### 为什么值得长期跟踪
${data.whyTrack}

### 10 年视角核心判断
- **10 年后预期**：${data.tenYearView || "待补充"}
- **前提**：${data.tenYearPremise || "待补充"}
- **错误风险**：${data.tenYearFailureRisk || "待补充"}

## 企业与商业模式

### 怎么赚钱
- 收入来源：${data.businessModel.revenueSource || "待补充"}
- 利润来源：${data.businessModel.profitSource || "待补充"}
- 重复性/一次性：${data.businessModel.repeatability || "待补充"}

### 护城河 / 配置逻辑
- **护城河类型**：${data.businessModel.moatType}
- **详细说明**：${data.businessModel.moatDetail}

### 管理层与治理
- **管理层评价**：${data.businessModel.managementComment}
- **治理记录**：${data.businessModel.governanceNote || "待补充"}
- **分红记录**：${data.businessModel.dividendHistory || "待补充"}

## 财务与商业模式框架

### 看花钱
- 资本支出：${f.capex || "待补充"}
- 运营支出：${f.opex || "待补充"}
- 利息支出：${f.interestExpense || "待补充"}
- **结论**：${f.spendingConclusion || "待补充"}

### 看借钱
- 负债结构：${f.debtStructure}
- 短债压力：${f.shortTermDebtPressure || "待补充"}
- 融资依赖：${f.financingDependency || "待补充"}
- **结论**：${f.debtConclusion}

### 看收钱
- 经营现金流：${f.operatingCashFlow || "待补充"}
- 自由现金流：${f.freeCashFlow || "待补充"}
- 回款质量：${f.collectionQuality || "待补充"}
- **结论**：${f.cashFlowConclusion}

### 看赚钱难度
- 毛利率/净利率：${f.grossMargin || "待补充"} / ${f.netMargin || "待补充"}
- 费用率：${f.expenseRatio || "待补充"}
- ROE/ROIC：${f.roe || "待补充"} / ${f.roic || "待补充"}
- **结论**：${f.profitabilityConclusion}

### 看资产模式
- 轻重资产判断：${f.assetMode}
- 需要持续投入的地方：${f.assetDetail || "待补充"}
- **结论**：${f.assetConclusion || "待补充"}

### 看稳定性
- 周期类型：${f.cycleType || "待补充"}
- 业绩波动来源：${f.volatilitySource || "待补充"}
- **结论**：${f.stabilityConclusion}

## 估值框架

- **估值方法**：${v.method}
- **低估条件**：${v.undervaluedCondition}
- **合理条件**：${v.fairCondition || "待补充"}
- **高估条件**：${v.overvaluedCondition}
- **安全边际来源**：${v.safetyMarginSource}
- **失真变量**：${v.distortionVariable}
${v.opportunityNote ? `- **机会成本**：${v.opportunityNote}` : ""}

## 风险与失效条件

${data.risks.length > 0 ? data.risks.map((r) => `- **风险**：${r.flag}`).join("\n") : "- 暂无明确风险标记"}

${data.failureConditions.length > 0 ? data.failureConditions.map((f) => `- **失效条件**：${f}`).join("\n") : ""}

${data.abandonTriggers.length > 0 ? data.abandonTriggers.map((a) => `- **放弃触发**：${a}`).join("\n") : ""}

## 跟踪清单

| 项目 | 内容 |
|------|------|
| 关键财报指标 | ${t.keyFinancialMetrics || "待补充"} |
| 关键事件 | ${t.keyEvents || "待补充"} |
| 关键价格区间 | ${t.keyPriceZones || "待补充"} |
| 关键行业变量 | ${t.keyIndustryVariables || "待补充"} |
| 下次更新重点 | ${t.nextUpdateFocus || "待补充"} |

## 执行附录

### 网格
- 是否适合：${e.grid.suitable}
- 适用前提：${e.grid.premise}
- 不适用场景：${e.grid.unsuitable}

### 做 T
- 是否适合：${e.scalp.suitable}
- 适用场景：${e.scalp.scenario}
- 不适用场景：${e.scalp.unsuitable}

### 趋势
- 是否适合：${e.trend.suitable}
- 触发条件：${e.trend.trigger || "待评估"}
- 失效条件：${e.trend.failure}

### 分批建仓/减仓原则
- 建仓原则：${e.batchEntry}
- 加仓原则：${e.batchAdd}
- 减仓原则：${e.batchReduce}
- 卖出原则：${e.batchExit}

## 关联笔记

- 最近重要单票复盘：${r.recentDailyReviews || "待补充"}
- 相关总复盘：${r.dayReviews || "待补充"}
- 周复盘：${r.weeklyReview || "待补充"}
- 月复盘：${r.monthlyReview || "待补充"}

## 更新记录

- ${data.updateDate}：Scope 自动导入
`;
}

/**
 * 生成每日复盘 Obsidian markdown。
 *
 * @param {Object} data - buildDailyReviewData 的输出
 * @returns {string}
 */
export function renderDailyReviewMarkdown(data) {
  const c = data.todayCoreChange ?? {};
  const fc = data.fundamentalChange ?? {};
  const vc = data.valuationChange ?? {};
  const oj = data.ownershipJudgment ?? {};
  const ts = data.technicalState ?? {};
  const kp = data.keyPriceChanges ?? {};
  const suit = data.todaySuitable ?? {};
  const ae = data.actualExecution ?? {};
  const dr = data.deviationReflection ?? {};
  const rn = data.relatedNotes ?? {};

  return `---
tags:
  - 财经/复盘
  - Scope导入
template_type: stock_daily_review
date: ${data.date}
stock: "${data.stock}"
stance: ${data.stance}
---

> [!note] 今日结论框
> - **日期**：${data.date}
> - **标的**：${data.stock}
> - **今日立场**：${data.stance}
> - **今日变化**：${data.todayChange}
> - **今日计划动作**：${data.todayPlannedAction || "待定"}
> - **今日实际动作**：${data.todayActualAction || "待定"}
> - **一句话原因**：${data.oneLineReason || "待补充"}

## 今日核心变化

- **今天发生了什么**：${c.whatHappened || "待补充"}
- **这是噪音/信号/逻辑变化**：${c.signalOrNoise || "待判断"}
- **对主逻辑有没有影响**：${c.impactOnMainLogic || "待判断"}

## 基本面今天有无变化

- **新信息**：${fc.newInfo || "无"}
- **是否改变长期判断**：${fc.changesLongTermJudgment}

## 估值今天有无变化

- **当前估值感受**：${vc.currentFeeling}
- **是否更有/更少安全边际**：${vc.moreOrLessMargin || "待判断"}

## 是否改变"值不值得拥有"的判断

- **我的结论**：${oj.conclusion}
- **原因**：${oj.reason || "待补充"}

## 技术面状态

- **趋势位置**：${ts.trendPosition || "待补充"}
- **量价关系**：${ts.volumePrice || "待补充"}
- **强弱判断**：${ts.strengthJudgment}

## 关键价位变化

- **支撑区**：${kp.supportZone || "待补充"}
- **压力区**：${kp.pressureZone || "待补充"}
- **建议买入区**：${kp.suggestedBuyZone || "待补充"}
- **建议卖出区**：${kp.suggestedSellZone || "待补充"}
- **失效条件**：${kp.failureCondition || "待补充"}

## 今天适合做什么

- **动作**：${suit.action}
- **原因**：${suit.reason || "待补充"}

## 实际有没有按计划做

- **我是否执行**：${ae.didExecute || "待记录"}
- **实际买点/卖点**：${ae.actualBuySell || "待记录"}
- **实际仓位变化**：${ae.actualPositionChange || "待记录"}
- **偏离计划的地方**：${ae.deviation || "无"}

## 偏差与反思

- **是判断错了还是执行错了**：${dr.judgmentOrExecution || "待复盘"}
- **今天最重要的一条经验**：${dr.todayKeyLesson || "待复盘"}
- **明天最该盯的一件事**：${dr.tomorrowFocus || "待定"}

## 关联笔记

- 标的主档案：${rn.masterProfile || data.stock}
- 当日总复盘：${rn.todaySummary || "待补充"}
- 上一次复盘：${rn.lastReview || "待补充"}
`;
}

/**
 * 对单只股票生成完整的导出 payload（供 API 使用）。
 *
 * @param {Object} stock
 * @param {Object} technicals
 * @param {Object} options
 * @returns {{ masterProfile: string, dailyReview: string, fileName: string }}
 */
export function buildExportPayload(stock, technicals, options = {}) {
  const masterData = buildMasterProfileData(stock, technicals, options);
  const dailyData = buildDailyReviewData(stock, technicals, options);

  return {
    masterProfile: renderMasterProfileMarkdown(masterData),
    dailyReview: renderDailyReviewMarkdown(dailyData),
    masterData,
    dailyData,
    fileName: stock.name,
    safeFileName: stock.name.replace(/[<>:"/\\|?*]/g, "_"),
  };
}
