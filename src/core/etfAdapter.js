/**
 * ETF 数据适配器：提供主要场内 ETF 列表和分类。
 *
 * 当前使用硬编码列表（覆盖主要行业/宽基/跨境/债券/商品ETF）。
 * 后续可接入 AKShare fund_etf_spot_em() 获取全量实时数据。
 */

// ─── ETF 类型分类关键词 ──────────────────────────────────────

const ETF_TYPE_RULES = [
  {
    type: "行业ETF",
    keywords: ["半导体", "芯片", "AI", "人工智能", "光伏", "新能源", "军工", "医药", "医疗",
      "消费", "食品饮料", "酒", "银行", "证券", "券商", "煤炭", "电力", "有色",
      "汽车", "通信", "5G", "计算机", "软件", "传媒", "游戏", "农业",
      "房地产", "基建", "钢铁", "化工", "环保", "碳中和"],
  },
  {
    type: "宽基ETF",
    keywords: ["沪深300", "中证500", "中证1000", "创业板", "科创50", "科创100",
      "上证50", "上证180", "深证100", "中证100", "中证2000", "A50", "A500"],
  },
  {
    type: "跨境ETF",
    keywords: ["纳斯达克", "纳指", "标普", "道琼斯", "恒生", "恒生科技", "日经", "德国",
      "法国", "H股", "中概", "海外", "全球"],
  },
  {
    type: "债券ETF",
    keywords: ["国债", "转债", "债券", "城投债", "信用债", "利率债", "短融"],
  },
  {
    type: "商品ETF",
    keywords: ["黄金", "白银", "原油", "豆粕", "有色", "能源化工"],
  },
];

// ─── 主要 ETF 列表 ───────────────────────────────────────────

const MAJOR_ETFS = [
  // 宽基
  { code: "510300", name: "沪深300ETF", type: "宽基ETF", index: "沪深300" },
  { code: "510500", name: "中证500ETF", type: "宽基ETF", index: "中证500" },
  { code: "512100", name: "中证1000ETF", type: "宽基ETF", index: "中证1000" },
  { code: "159915", name: "创业板ETF", type: "宽基ETF", index: "创业板指" },
  { code: "588000", name: "科创50ETF", type: "宽基ETF", index: "科创50" },
  { code: "510050", name: "上证50ETF", type: "宽基ETF", index: "上证50" },
  { code: "159919", name: "沪深300ETF联接", type: "宽基ETF", index: "沪深300" },
  { code: "563000", name: "A500ETF", type: "宽基ETF", index: "中证A500" },

  // 行业 — 科技
  { code: "512480", name: "半导体ETF", type: "行业ETF", index: "半导体" },
  { code: "159995", name: "芯片ETF", type: "行业ETF", index: "国证芯片" },
  { code: "512760", name: "半导体设备ETF", type: "行业ETF", index: "半导体设备" },
  { code: "159869", name: "游戏ETF", type: "行业ETF", index: "动漫游戏" },
  { code: "516510", name: "云计算ETF", type: "行业ETF", index: "云计算" },
  { code: "515230", name: "软件ETF", type: "行业ETF", index: "软件" },
  { code: "159819", name: "AI智能ETF", type: "行业ETF", index: "人工智能" },
  { code: "515050", name: "5GETF", type: "行业ETF", index: "5G通信" },
  { code: "515880", name: "通信ETF", type: "行业ETF", index: "通信设备" },
  { code: "516160", name: "新能源ETF", type: "行业ETF", index: "新能源" },
  { code: "159790", name: "光伏ETF", type: "行业ETF", index: "光伏产业" },
  { code: "159766", name: "储能ETF", type: "行业ETF", index: "储能" },
  { code: "561910", name: "电池ETF", type: "行业ETF", index: "新能源电池" },

  // 行业 — 军工/制造
  { code: "512660", name: "军工ETF", type: "行业ETF", index: "军工" },
  { code: "512670", name: "国防ETF", type: "行业ETF", index: "国防" },
  { code: "562500", name: "机器人ETF", type: "行业ETF", index: "机器人" },
  { code: "516520", name: "智能驾驶ETF", type: "行业ETF", index: "智能驾驶" },

  // 行业 — 消费/医药
  { code: "159928", name: "消费ETF", type: "行业ETF", index: "中证消费" },
  { code: "512690", name: "酒ETF", type: "行业ETF", index: "中证白酒" },
  { code: "512010", name: "医药ETF", type: "行业ETF", index: "医药" },
  { code: "159883", name: "医疗器械ETF", type: "行业ETF", index: "医疗器械" },
  { code: "513060", name: "创新药ETF", type: "行业ETF", index: "创新药" },

  // 行业 — 金融/周期
  { code: "512880", name: "证券ETF", type: "行业ETF", index: "证券公司" },
  { code: "512800", name: "银行ETF", type: "行业ETF", index: "中证银行" },
  { code: "510880", name: "红利ETF", type: "行业ETF", index: "中证红利" },
  { code: "515220", name: "煤炭ETF", type: "行业ETF", index: "煤炭" },
  { code: "159611", name: "电力ETF", type: "行业ETF", index: "电力" },

  // 跨境
  { code: "513100", name: "纳指ETF", type: "跨境ETF", index: "纳斯达克100" },
  { code: "513500", name: "标普500ETF", type: "跨境ETF", index: "标普500" },
  { code: "159866", name: "日经ETF", type: "跨境ETF", index: "日经225" },
  { code: "513050", name: "中概互联ETF", type: "跨境ETF", index: "中概互联" },
  { code: "159605", name: "中概互联网ETF", type: "跨境ETF", index: "中概互联" },
  { code: "159920", name: "恒生ETF", type: "跨境ETF", index: "恒生指数" },
  { code: "513180", name: "恒生科技ETF", type: "跨境ETF", index: "恒生科技" },

  // 债券
  { code: "511010", name: "国债ETF", type: "债券ETF", index: "国债" },
  { code: "511260", name: "十年国债ETF", type: "债券ETF", index: "10年国债" },
  { code: "511380", name: "转债ETF", type: "债券ETF", index: "可转债" },

  // 商品
  { code: "518880", name: "黄金ETF", type: "商品ETF", index: "黄金" },
  { code: "159937", name: "黄金ETF联接", type: "商品ETF", index: "黄金" },
];

// ─── 公开API ─────────────────────────────────────────────────

/**
 * 获取全部 ETF 列表。
 * @returns {Object[]}
 */
export function getEtfList() {
  return MAJOR_ETFS;
}

/**
 * 按类型筛选 ETF。
 * @param {string} typeFilter - 类型名或"全部"
 * @returns {Object[]}
 */
export function getEtfsByType(typeFilter) {
  if (!typeFilter || typeFilter === "全部") return MAJOR_ETFS;
  return MAJOR_ETFS.filter((etf) => etf.type === typeFilter);
}

/**
 * 获取 ETF 类型列表。
 * @returns {string[]}
 */
export function getEtfTypes() {
  const types = new Set(MAJOR_ETFS.map((e) => e.type));
  return ["全部", ...Array.from(types)];
}

/**
 * 根据名称推断 ETF 类型。
 * @param {string} name
 * @returns {string}
 */
export function classifyEtf(name) {
  for (const rule of ETF_TYPE_RULES) {
    for (const kw of rule.keywords) {
      if ((name ?? "").includes(kw)) return rule.type;
    }
  }
  return "其他";
}
