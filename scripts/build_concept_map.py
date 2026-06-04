"""
概念板块→成分股映射生成器。

基于 Baostock 行业分类 + 股票名称关键词 + 硬编码映射，
为每只A股分配东方财富风格的概念板块标签。

不依赖外部API（除 Baostock），可离线运行。
输出: .cache/concept-map.json
"""

import json, os, sys, time, re
from collections import defaultdict

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache")
CACHE_FILE = os.path.join(CACHE_DIR, "concept-map.json")

# ─── 核心概念定义 ─────────────────────────────────────────

# 概念 → 行业关键词（匹配 Baostock 行业名称）
CONCEPT_INDUSTRY_KEYWORDS = {
    "AI": ["软件", "信息技术", "互联网", "人工智能", "计算机"],
    "半导体": ["半导体", "集成电路", "电子元器件", "芯片"],
    "光通信": ["光通信", "光模块", "光纤", "通信设备"],
    "芯片": ["芯片", "集成电路", "半导体", "微电子"],
    "数据": ["数据", "云计算", "大数据", "IDC", "软件服务"],
    "算力": ["算力", "服务器", "数据中心", "云计算", "超算"],
    "存储": ["存储", "内存", "闪存", "存储器"],
    "能源": ["新能源", "光伏", "风电", "储能", "锂电", "电池", "电力"],
    "银行": ["银行", "金融", "货币"],
    "具身智能": ["机器人", "自动化", "智能制造", "工业控制"],
    "ARVR": ["虚拟现实", "增强现实", "混合现实", "光学", "消费电子"],
}

# 概念 → 股票名称关键词
CONCEPT_NAME_KEYWORDS = {
    "AI": ["智能", "AI", "人工智能", "数据", "软件", "信息"],
    "半导体": ["微", "电子", "半导", "集成", "晶圆", "硅", "导"],
    "光通信": ["光", "通信", "光纤", "光迅"],
    "芯片": ["芯片", "微", "集成", "半导", "芯"],
    "数据": ["数据", "云", "信息", "数字", "软件"],
    "算力": ["算力", "计算", "云", "服务器"],
    "存储": ["存储", "内存", "闪存"],
    "能源": ["能源", "电力", "电", "光伏", "风电", "储能", "新能源", "绿电", "电池", "锂"],
    "银行": ["银行"],
    "具身智能": ["机器人", "智能", "自动化", "机电", "传动"],
    "ARVR": ["虚拟", "增强", "VR", "AR", "光学", "光电", "镜头", "显示"],
}

# 硬编码映射：特定股票 → 概念（高置信度补充）
HARDCODED_STOCKS = {
    # AI 龙头
    "002230": ["AI", "数据"],          # 科大讯飞
    "688256": ["AI", "芯片"],          # 寒武纪
    "002415": ["AI", "ARVR"],          # 海康威视
    "688111": ["AI", "数据"],          # 金山办公
    "300624": ["AI"],                  # 万兴科技
    "688088": ["AI"],                  # 虹软科技
    # 半导体
    "688981": ["半导体", "芯片"],      # 中芯国际
    "002371": ["半导体", "芯片"],      # 北方华创
    "603501": ["半导体", "芯片"],      # 韦尔股份
    "300782": ["半导体", "芯片"],      # 卓胜微
    "688012": ["半导体", "芯片"],      # 中微公司
    "688008": ["半导体", "芯片"],      # 澜起科技
    # 光通信
    "300308": ["光通信"],              # 中际旭创
    "300502": ["光通信"],              # 新易盛
    "300394": ["光通信"],              # 天孚通信
    "002281": ["光通信"],              # 光迅科技
    # 芯片
    "002049": ["芯片", "半导体"],      # 紫光国微
    "603986": ["芯片", "存储"],        # 兆易创新
    "300223": ["芯片"],                # 北京君正
    "300661": ["芯片", "半导体"],      # 圣邦股份
    # 算力
    "000977": ["算力", "AI"],          # 浪潮信息
    "603019": ["算力", "AI"],          # 中科曙光
    "601138": ["算力", "AI"],          # 工业富联
    # 数据
    "603881": ["数据"],                # 数据港
    "300212": ["数据"],                # 易华录
    "300383": ["数据"],                # 光环新网
    # 存储
    "301308": ["存储", "芯片"],        # 江波龙
    # 能源
    "300750": ["能源"],                # 宁德时代
    "601012": ["能源"],                # 隆基绿能
    "600438": ["能源"],                # 通威股份
    "300274": ["能源"],                # 阳光电源
    # 银行
    "601398": ["银行"],                # 工商银行
    "601939": ["银行"],                # 建设银行
    "600036": ["银行"],                # 招商银行
    "601166": ["银行"],                # 兴业银行
    "600000": ["银行"],                # 浦发银行
    "000001": ["银行"],                # 平安银行
    "601288": ["银行"],                # 农业银行
    "601328": ["银行"],                # 交通银行
    "600016": ["银行"],                # 民生银行
    "002142": ["银行"],                # 宁波银行
    # 具身智能/机器人
    "688017": ["具身智能"],            # 绿的谐波
    "300124": ["具身智能"],            # 汇川技术
    "002747": ["具身智能"],            # 埃斯顿
    "300024": ["具身智能"],            # 机器人
    "688160": ["具身智能"],            # 步科股份
    # ARVR
    "002241": ["ARVR"],                # 歌尔股份
    "002475": ["ARVR"],                # 立讯精密
    "300624": ["ARVR"],                # 万兴科技 (已有)
    "002273": ["ARVR"],                # 水晶光电
    "300691": ["ARVR"],                # 联合光电
}

# 所有概念列表
ALL_CONCEPTS = list(CONCEPT_INDUSTRY_KEYWORDS.keys())


def load_baostock_industries(batch_size=100):
    """从 Baostock 加载全市场行业分类。"""
    try:
        import baostock as bs
        lg = bs.login()
        if lg.error_code != '0':
            print(f"Baostock login failed: {lg.error_msg}")
            return {}

        # 获取全A股列表
        rs = bs.query_stock_basic()
        if rs.error_code != '0':
            print(f"Baostock query failed: {rs.error_msg}")
            bs.logout()
            return {}

        industries = {}
        while rs.next():
            row = rs.get_row_data()
            code = row[0].replace("sh.", "").replace("sz.", "")
            name = row[2]
            industries[code] = {"code": code, "name": name}

        bs.logout()

        # 分批获取行业分类
        codes = list(industries.keys())
        for i in range(0, len(codes), batch_size):
            batch = codes[i:i+batch_size]
            for code in batch:
                try:
                    # 获取行业分类
                    bs_code = f"sh.{code}" if code.startswith("6") else f"sz.{code}"
                    rs_ind = bs.query_stock_industry(bs_code)
                    if rs_ind.error_code == '0':
                        while rs_ind.next():
                            row = rs_ind.get_row_data()
                            if code in industries:
                                industries[code]["industry"] = row[2] if len(row) > 2 else ""
                                industries[code]["industry_type"] = row[3] if len(row) > 3 else ""
                except:
                    pass

            print(f"  Baostock progress: {min(i+batch_size, len(codes))}/{len(codes)}")
            time.sleep(0.3)  # rate limit

        return industries

    except ImportError:
        print("Baostock not installed, using empty industry data")
        return {}
    except Exception as e:
        print(f"Baostock error: {e}")
        return {}


def assign_concepts_by_industry(industry_name):
    """根据行业名称关键词分配概念。"""
    concepts = []
    for concept, keywords in CONCEPT_INDUSTRY_KEYWORDS.items():
        for kw in keywords:
            if kw in (industry_name or ""):
                concepts.append(concept)
                break
    return concepts


def assign_concepts_by_name(stock_name):
    """根据股票名称关键词分配概念。"""
    concepts = []
    for concept, keywords in CONCEPT_NAME_KEYWORDS.items():
        for kw in keywords:
            if kw in (stock_name or ""):
                concepts.append(concept)
                break
    return concepts


def build_concept_map(industries=None):
    """构建完整的 concept → stocks 映射。"""
    if industries is None:
        industries = {}

    # 概念 → 股票代码集合
    concept_stocks = defaultdict(set)

    # 1. 硬编码映射
    for code, concepts in HARDCODED_STOCKS.items():
        for c in concepts:
            concept_stocks[c].add(code)

    # 2. 行业+名称推断
    for code, info in industries.items():
        name = info.get("name", "")
        industry = info.get("industry", "")

        industry_concepts = assign_concepts_by_industry(industry)
        name_concepts = assign_concepts_by_name(name)

        for c in industry_concepts:
            concept_stocks[c].add(code)
        for c in name_concepts:
            concept_stocks[c].add(code)

    # 3. 构造输出格式
    concepts_output = []
    for concept_name in ALL_CONCEPTS:
        stock_codes = sorted(concept_stocks.get(concept_name, []))
        if stock_codes:
            stock_info = []
            for code in stock_codes:
                info = industries.get(code, {})
                stock_info.append({
                    "code": code,
                    "name": info.get("name", ""),
                })
            concepts_output.append({
                "concept": concept_name,
                "count": len(stock_info),
                "stocks": stock_info,
            })

    return {
        "concepts": concepts_output,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "baostock+hardcoded",
        "totalConcepts": len(concepts_output),
    }


def save(cache_data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache_data, f, ensure_ascii=False, indent=2)
    print(f"Saved to {CACHE_FILE}")


def main():
    print("=== Building concept map ===")

    # Try to load industries from Baostock
    print("\n[1/3] Loading Baostock industry data...")
    industries = load_baostock_industries()
    print(f"  Loaded {len(industries)} stocks with industry data")

    # Build map
    print("\n[2/3] Building concept mappings...")
    data = build_concept_map(industries)

    # Print stats
    for c in data["concepts"]:
        print(f"  {c['concept']}: {c['count']} stocks")

    # Save
    print(f"\n[3/3] Saving to cache...")
    save(data)
    print("Done.")


if __name__ == "__main__":
    main()
