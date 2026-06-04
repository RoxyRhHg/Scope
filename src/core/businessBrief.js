/**
 * 基于代理指标生成一句话生意模式简评。
 * 用于 Focus 10 推荐卡片展示。
 */

const MOAT_RULES = [
  {
    test: (s) => s.raw?.marketCap > 2e11 && s.raw?.pe > 0 && s.raw?.pe < 35 && (s.metrics?.businessModelQuality ?? 0) >= 78,
    brief: "大市值低估值，护城河深",
  },
  {
    test: (s) => s.raw?.marketCap > 2e11 && (s.dividendYield ?? 0) > 3,
    brief: "大市值高分红，现金流稳健",
  },
  {
    test: (s) => s.raw?.marketCap > 1e11 && (s.metrics?.businessModelQuality ?? 0) >= 75,
    brief: "行业龙头，竞争地位稳固",
  },
  {
    test: (s) => (s.metrics?.businessModelQuality ?? 0) >= 80 && (s.raw?.pe ?? 0) > 0 && (s.raw?.pe ?? 0) < 25,
    brief: "高质量低估值，安全边际充足",
  },
  {
    test: (s) => (s.metrics?.profitability ?? 0) >= 80 && (s.metrics?.cashFlow ?? 0) >= 78,
    brief: "盈利能力强，现金流充沛",
  },
  {
    test: (s) => (s.metrics?.stability ?? 0) >= 82 && (s.metrics?.balanceSheet ?? 0) >= 75,
    brief: "经营稳健，财务健康",
  },
  {
    test: (s) => (s.metrics?.valuation ?? 0) >= 78 && (s.dividendYield ?? 0) > 2,
    brief: "低估值高股息，防御性强",
  },
  {
    test: (s) => (s.metrics?.businessModelQuality ?? 0) >= 70 && (s.concepts?.length ?? 0) >= 2,
    brief: "基本面扎实，概念加持",
  },
  {
    test: (s) => (s.metrics?.industryProsperity ?? 0) >= 75 && (s.metrics?.businessModelQuality ?? 0) >= 68,
    brief: "行业景气上行，基本面尚可",
  },
];

const INDUSTRY_BRIEFS = {
  银行: "高股息低估值，防御配置",
  白酒: "品牌溢价强，定价权突出",
  食品饮料: "消费刚需，现金流稳定",
  家用电器: "品牌渠道双壁垒",
  医药生物: "研发驱动，长期需求刚性",
  电力: "公用事业，现金流稳定",
  煤炭: "资源禀赋，高分红",
  交通运输: "基础设施，收益稳定",
};

/**
 * 生成一句话生意模式简评。
 */
export function generateBusinessBrief(stock) {
  // 优先匹配护城河规则
  for (const rule of MOAT_RULES) {
    if (rule.test(stock)) {
      return rule.brief;
    }
  }

  // 次选行业通用描述
  const industryBrief = INDUSTRY_BRIEFS[stock.industry];
  if (industryBrief) {
    return industryBrief;
  }

  // 兜底：基于估值档位
  const tier = stock.maoValuation?.valuationTier ?? stock.valuationCard?.valuationTier;
  if (tier === "低估") return "估值偏低，关注基本面验证";
  if (tier === "合理偏低") return "估值合理偏低，有安全边际";
  return `${stock.industry ?? "未分类"}行业候选`;
}
