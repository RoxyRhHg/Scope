/**
 * 概念板块适配器：为股票分配东方财富风格的概念板块标签。
 *
 * 数据来源优先级：
 * 1. 硬编码映射（高置信度知名股票）
 * 2. 行业→概念推断规则
 * 3. 股票名称关键词匹配
 *
 * 不依赖外部 API，纯本地推断。
 */

// ─── 核心概念列表 ─────────────────────────────────────────────

const CORE_CONCEPTS = [
  "AI",
  "半导体",
  "光通信",
  "芯片",
  "数据",
  "算力",
  "存储",
  "能源",
  "银行",
  "具身智能",
  "ARVR",
];

// ─── 硬编码映射：知名股票 → 概念 ──────────────────────────────

const HARDCODED = {
  // AI
  "002230": ["AI", "数据"],
  "688256": ["AI", "芯片"],
  "002415": ["AI", "ARVR"],
  "688111": ["AI", "数据"],
  "300624": ["AI"],
  "688088": ["AI"],
  "603019": ["AI", "算力"],
  "000977": ["AI", "算力"],
  "688981": ["AI"],
  // 半导体
  "688981": ["半导体", "芯片"],
  "002371": ["半导体", "芯片"],
  "603501": ["半导体", "芯片", "ARVR"],
  "300782": ["半导体", "芯片"],
  "688012": ["半导体", "芯片"],
  "688008": ["半导体", "芯片", "存储"],
  "688396": ["半导体", "芯片"],
  "600703": ["半导体", "芯片"],
  "002049": ["芯片", "半导体"],
  "603986": ["芯片", "存储"],
  "300223": ["芯片", "半导体"],
  "300661": ["芯片", "半导体"],
  "688536": ["芯片", "半导体"],
  // 光通信
  "300308": ["光通信", "AI"],
  "300502": ["光通信"],
  "300394": ["光通信"],
  "002281": ["光通信"],
  "300570": ["光通信"],
  // 算力
  "601138": ["算力", "AI"],
  "000938": ["算力", "AI"],
  "688041": ["算力", "芯片"],
  // 数据
  "603881": ["数据"],
  "300212": ["数据"],
  "300383": ["数据", "算力"],
  "300738": ["数据", "算力"],
  // 存储
  "301308": ["存储", "芯片"],
  "688525": ["存储", "芯片"],
  // 能源
  "300750": ["能源"],
  "601012": ["能源"],
  "600438": ["能源"],
  "300274": ["能源"],
  "002459": ["能源"],
  "688599": ["能源"],
  "601985": ["能源"],
  "600900": ["能源"],
  "600905": ["能源"],
  "601615": ["能源"],
  // 银行
  "601398": ["银行"],
  "601939": ["银行"],
  "600036": ["银行"],
  "601166": ["银行"],
  "600000": ["银行"],
  "000001": ["银行"],
  "601288": ["银行"],
  "601328": ["银行"],
  "600016": ["银行"],
  "002142": ["银行"],
  "601818": ["银行"],
  "600919": ["银行"],
  "601229": ["银行"],
  // 具身智能/机器人
  "688017": ["具身智能"],
  "300124": ["具身智能"],
  "002747": ["具身智能"],
  "300024": ["具身智能"],
  "688160": ["具身智能"],
  "002527": ["具身智能"],
  "688165": ["具身智能"],
  "603666": ["具身智能"],
  // ARVR
  "002241": ["ARVR", "具身智能"],
  "002475": ["ARVR"],
  "002273": ["ARVR"],
  "300691": ["ARVR"],
  "002036": ["ARVR"],
  "688007": ["ARVR"],
  "002841": ["ARVR"],
};

// ─── 行业→概念推断规则 ──────────────────────────────────────

const INDUSTRY_CONCEPT_RULES = [
  { industry: /软件|互联网|信息技术服务|计算机/, concept: "AI" },
  { industry: /半导体|集成电路|电子元器件/, concept: "半导体" },
  { industry: /半导体|集成电路|电子元器件/, concept: "芯片" },
  { industry: /通信设备|通信服务|光通信|光纤/, concept: "光通信" },
  { industry: /计算|信息/, concept: "算力" },
  { industry: /软件|信息技术|数据|云计算/, concept: "数据" },
  { industry: /电子|半导体|存储/, concept: "存储" },
  { industry: /新能源|光伏|风电|储能|锂电|电池|电力|能源/, concept: "能源" },
  { industry: /银行|货币金融|金融/, concept: "银行" },
  { industry: /机器人|自动|智能/, concept: "具身智能" },
  { industry: /消费电子|显示|光学|光电|虚拟现实/, concept: "ARVR" },
];

// ─── 名称→概念推断规则 ──────────────────────────────────────

const NAME_CONCEPT_RULES = [
  { pattern: /智能|软件|信息/, concept: "AI" },
  { pattern: /微$|半导|集成|晶|硅/, concept: "半导体" },
  { pattern: /光[通信讯模块纤]|通信/, concept: "光通信" },
  { pattern: /芯片|芯科|微$|半导/, concept: "芯片" },
  { pattern: /数据|云|数字/, concept: "数据" },
  { pattern: /算力|计算|服务/, concept: "算力" },
  { pattern: /存储|内存/, concept: "存储" },
  { pattern: /能源|电力|电[力源池]|光伏|风电|新能|绿电|锂|电池|光伏|太阳/, concept: "能源" },
  { pattern: /银行|商行/, concept: "银行" },
  { pattern: /机器人|传动|电机/, concept: "具身智能" },
  { pattern: /光[学电网]|虚拟|增强|现实|VR|AR|显示|镜头|视觉/, concept: "ARVR" },
];

// ─── 公开API ─────────────────────────────────────────────────

/**
 * 为单个 stock 分配概念板块。
 *
 * @param {Object} stock - 原始股票对象（含 code, name, industry）
 * @param {number} maxConcepts - 最多分配的概念数
 * @returns {string[]} 概念名称列表
 */
export function assignConcepts(stock, maxConcepts = 5) {
  const code = (stock.code ?? "").replace(/[^0-9]/g, "");
  const name = stock.name ?? "";
  const industry = stock.industry ?? "";

  const assigned = new Set();

  // 1. 硬编码映射（最高优先级）
  if (HARDCODED[code]) {
    for (const c of HARDCODED[code]) {
      assigned.add(c);
    }
  }

  // 2. 行业推断
  for (const rule of INDUSTRY_CONCEPT_RULES) {
    if (assigned.size >= maxConcepts) break;
    if (rule.industry.test(industry)) {
      assigned.add(rule.concept);
    }
  }

  // 3. 名称关键词
  for (const rule of NAME_CONCEPT_RULES) {
    if (assigned.size >= maxConcepts) break;
    if (rule.pattern.test(name)) {
      assigned.add(rule.concept);
    }
  }

  return Array.from(assigned).slice(0, maxConcepts);
}

/**
 * 获取所有可用概念列表（固定顺序）。
 * @returns {string[]}
 */
export function getAvailableConcepts() {
  return CORE_CONCEPTS;
}

/**
 * 批量分配概念。
 * @param {Object[]} stocks
 * @returns {Map<string, string[]>} code → concepts
 */
export function batchAssignConcepts(stocks) {
  const map = new Map();
  for (const stock of stocks) {
    const code = (stock.code ?? "").replace(/[^0-9]/g, "");
    map.set(code, assignConcepts(stock));
  }
  return map;
}
