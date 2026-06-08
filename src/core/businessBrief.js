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

  // 基于行业和概念生成描述
  const industry = stock.industry || "";
  const concepts = stock.concepts || [];

  // 提取行业关键词
  const industryKeywords = {
    "半导体": "半导体芯片",
    "芯片": "半导体芯片",
    "存储": "存储芯片",
    "光学": "光学光电子",
    "光电子": "光学光电子",
    "显示": "显示屏",
    "面板": "显示屏",
    "通信设备": "通信设备",
    "光通信": "光通信",
    "CPO": "CPO光模块",
    "AI": "人工智能",
    "人工智能": "人工智能",
    "算力": "算力服务器",
    "数据": "数据服务",
    "机器人": "机器人",
    "具身智能": "具身智能",
    "智能驾驶": "智能驾驶",
    "物理AI": "物理AI",
    "电子": "电子元器件",
    "消费电子": "消费电子",
    "传感器": "传感器",
    "封测": "封测",
    "计算机": "计算机",
    "软件": "软件服务",
    "信息技术": "信息技术",
    "新能源": "新能源",
    "电池": "电池",
    "储能": "储能",
    "光伏": "光伏",
    "风电": "风电",
    "电力": "电力",
    "有色金属": "有色金属",
    "医药": "医药",
    "生物": "生物",
    "化工": "化工",
    "机械": "机械设备",
    "汽车": "汽车",
    "房地产": "房地产",
    "建筑": "建筑工程",
    "食品": "食品饮料",
    "酒": "酒类",
    "家电": "家电",
    "纺织": "纺织服装",
    "钢铁": "钢铁",
    "煤炭": "煤炭",
    "石油": "石油",
    "天然气": "天然气",
  };

  // 从行业字段提取关键词
  let industryName = "";
  for (const [keyword, name] of Object.entries(industryKeywords)) {
    if (industry.includes(keyword)) {
      industryName = name;
      break;
    }
  }

  // 从概念中提取
  let conceptName = "";
  for (const concept of concepts) {
    for (const [keyword, name] of Object.entries(industryKeywords)) {
      if (concept.includes(keyword)) {
        conceptName = name;
        break;
      }
    }
    if (conceptName) break;
  }

  // 生成描述
  if (industryName && conceptName && industryName !== conceptName) {
    return `${industryName}+${conceptName}`;
  } else if (industryName) {
    return industryName;
  } else if (conceptName) {
    return conceptName;
  }

  // 兜底：基于估值档位
  const tier = stock.maoValuation?.valuationTier ?? stock.valuationCard?.valuationTier;
  if (tier === "低估") return "估值偏低，关注基本面验证";
  if (tier === "合理偏低") return "估值合理偏低，有安全边际";
  return `${stock.industry ?? "未分类"}行业`;
}
