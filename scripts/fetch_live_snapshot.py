import json
import math
import re
import sys
import time
import warnings
from datetime import datetime
import contextlib
import io

warnings.filterwarnings("ignore")

import baostock as bs
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


HEADERS = {
    "Referer": "https://finance.sina.com.cn",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

SINA_API = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
SINA_COUNT_API = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount"
SINA_BOARD_META = "https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php"


def no_proxy_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    session.headers.update(HEADERS)
    session.verify = False
    return session


def retry_get(session, url, params, timeout=30, retries=3, delay=2.0):
    last_err = None
    for attempt in range(retries):
        try:
            resp = session.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(delay * (attempt + 1))
    raise last_err


def fetch_json_list(session: requests.Session, node: str, page: int, num: int = 80):
    response = retry_get(session, SINA_API, {
        "page": str(page), "num": str(num), "sort": "symbol",
        "asc": "1", "node": node, "symbol": "", "_s_r_a": "page",
    }, timeout=30)
    response.encoding = "gbk"
    text = response.text.strip()
    if not text or text == "[]":
        return []
    return json.loads(text)


def fetch_count(session: requests.Session, node: str) -> int:
    try:
        response = retry_get(session, SINA_COUNT_API, {"node": node}, timeout=20)
        response.encoding = "gbk"
        text = response.text.strip().strip('"')
        return int(text)
    except Exception:
        return 5600


def fetch_all_a_share_spot(session: requests.Session):
    total = fetch_count(session, "hs_a")
    pages = math.ceil(total / 80)
    rows = []
    consecutive_failures = 0

    for page in range(1, pages + 1):
        try:
            rows.extend(fetch_json_list(session, "hs_a", page, 80))
            consecutive_failures = 0
            if page % 10 == 0:
                time.sleep(0.3)
        except Exception as e:
            consecutive_failures += 1
            print(f"[warn] page {page}/{pages} failed: {e}", file=sys.stderr)
            if consecutive_failures >= 3:
                print(f"[warn] too many failures, stopping at {len(rows)} rows", file=sys.stderr)
                break
            time.sleep(2.0)

    return rows


def fetch_industry_map():
    with contextlib.redirect_stdout(io.StringIO()):
        login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(f"BaoStock login failed: {login.error_msg}")

    try:
        rs = bs.query_stock_industry()
        if rs.error_code != "0":
            raise RuntimeError(f"BaoStock query_stock_industry failed: {rs.error_msg}")

        mapping = []
        while rs.next():
            date, code, name, industry, classification = rs.get_row_data()
            if not industry:
                continue
            market, stock_code = code.split(".")
            mapping.append(
                {
                    "board": industry,
                    "stocks": [{"code": stock_code, "name": name, "market": market.upper()}],
                    "count": 1,
                    "classification": classification,
                    "date": date,
                }
            )

        grouped = {}
        for item in mapping:
            board = item["board"]
            grouped.setdefault(
                board,
                {
                    "board": board,
                    "stocks": [],
                    "count": 0,
                    "classification": item["classification"],
                    "date": item["date"],
                },
            )
            grouped[board]["stocks"].extend(item["stocks"])
            grouped[board]["count"] += 1

        return list(grouped.values())
    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()


def fetch_concept_meta(session: requests.Session):
    response = session.get(SINA_BOARD_META, params={"param": "class"}, timeout=20)
    response.raise_for_status()
    response.encoding = "gbk"
    text = response.text.strip()
    match = re.search(r"=\s*(\{.*\})\s*;?$", text)
    if not match:
        return []

    payload = json.loads(match.group(1))
    concepts = []
    for node, raw in payload.items():
        parts = raw.split(",")
        if len(parts) < 3:
            continue
        concepts.append(
            {
                "node": node,
                "concept": parts[1],
                "count": int(float(parts[2] or 0)),
                "avg_price": float(parts[3] or 0) if len(parts) > 3 else 0,
                "change_percent": float(parts[4] or 0) if len(parts) > 4 else 0,
                "lead_code": parts[8] if len(parts) > 8 else "",
                "lead_name": parts[12] if len(parts) > 12 else "",
            }
        )

    concepts.sort(key=lambda item: (item["count"], abs(item["change_percent"])), reverse=True)
    return concepts


def fetch_top_concepts(session: requests.Session, top_n: int = 24, max_members: int = 180):
    concepts = fetch_concept_meta(session)[:top_n]
    result = []

    for item in concepts:
        count = max(1, min(item["count"], max_members))
        pages = math.ceil(count / 80)
        stocks = []
        for page in range(1, pages + 1):
            for row in fetch_json_list(session, item["node"], page, 80):
                stocks.append({"code": row["code"], "name": row["name"]})

        result.append(
            {
                "concept": item["concept"],
                "node": item["node"],
                "count": len(stocks),
                "change_percent": item["change_percent"],
                "stocks": stocks,
            }
        )

    return result


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=str, default=None, help="write snapshot to disk cache file")
    args = parser.parse_args()

    session = no_proxy_session()

    spot = fetch_all_a_share_spot(session)
    industries = fetch_industry_map()

    concepts = []
    try:
        concepts = fetch_top_concepts(session)
    except Exception as exc:
        concepts = []
        print(f"[warn] concept fetch skipped: {exc}", file=sys.stderr)

    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "note": "实时行情来自新浪分页行情接口，行业映射来自 BaoStock，概念为新浪热门概念前 24 个。",
        "spot": spot,
        "industries": industries,
        "concepts": concepts,
    }

    if args.cache:
        import os, pathlib
        cache_path = pathlib.Path(args.cache)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        raw = buildRealSnapshot(payload)
        cache_data = {
            "fetchedAt": int(datetime.now().timestamp() * 1000),
            "snapshot": raw,
            "source": "live",
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, ensure_ascii=False)
        print(f"[ok] cached {len(spot)} stocks to {cache_path}", file=sys.stderr)

    json.dump(payload, sys.stdout, ensure_ascii=True)


def buildRealSnapshot(raw_payload):
    """Minimal build matching Node.js realDataAdapter.buildRealSnapshot"""
    industry_lookup = {}
    for board in raw_payload.get("industries", []):
        for stock in board.get("stocks", []):
            industry_lookup[stock["code"]] = board["board"]

    items = []
    for row in raw_payload.get("spot", []):
        code = str(row.get("code", row.get("代码", "")))
        name = row.get("name", row.get("名称", code))
        price = float(row.get("trade", row.get("最新价", 0)) or 0)
        change_pct = float(row.get("changepercent", row.get("涨跌幅", 0)) or 0)
        turnover = float(row.get("turnoverratio", row.get("换手率", 0)) or 0)
        pe = float(row.get("per", row.get("市盈率", 0)) or 0)
        pb = float(row.get("pb", row.get("市净率", 0)) or 0)
        market_cap = float(row.get("mktcap", row.get("总市值", 0)) or 0) * 10000
        flow_cap = float(row.get("nmc", row.get("流通市值", 0)) or 0) * 10000

        industry = industry_lookup.get(code, "未分类")
        concepts = _assign_builtin_concepts(code, name, industry)

        if pe <= 0:
            pe = 0
        if pb <= 0:
            pb = 0
        roe = round((pb / pe) * 100, 1) if pe > 0 and pb > 0 else 0

        items.append({
            "code": code, "name": name,
            "market": "SH" if code.startswith("6") else "SZ",
            "industry": industry,
            "concepts": concepts,
            "isST": "ST" in name,
            "isSuspended": False,
            "listingYears": 8,
            "recentProfitYears": 5,
            "hasCompleteFinancials": True,
            "liquidityScore": 58,
            "price": price,
            "lotCost": int(price * 100),
            "dividendYield": 0,
            "summary": f"{industry} 板块候选股",
            "riskNote": "快照数据，以轻量财务代理评分为主。",
            "riskFlags": [],
            "metrics": {
                "businessModelQuality": 68, "managementQuality": 66,
                "businessQuality": 68, "profitability": 73,
                "cashFlow": 79, "balanceSheet": 70, "valuation": 58,
                "stability": 82, "industryProsperity": 62,
                "conceptHeat": min(24 + len(concepts) * 14, 82),
                "catalyst": 50, "liquidity": 58,
                "concentrationFit": 84, "volatilityFit": 81,
            },
            "raw": {
                "pe": pe, "pb": pb,
                "changePct": round(change_pct, 2),
                "turnover": round(turnover, 4),
                "marketCap": market_cap,
                "flowMarketCap": flow_cap,
            },
            "financials": {
                "roeProxy": roe,
                "freeCashFlowYieldProxy": round((100 / pe) * 0.85, 2) if pe > 0 else 0,
            },
        })

    return {
        "mode": "live",
        "generatedAt": raw_payload.get("generatedAt", datetime.now().astimezone().isoformat()),
        "note": raw_payload.get("note", ""),
        "items": items,
    }


BUILTIN_CONCEPT_RULES = [
    (["半导体"], lambda c, n, i: "半导体" in n or "半导" in i),
    (["芯片"], lambda c, n, i: "芯片" in n or "芯片" in i or "集成" in n),
    (["AI"], lambda c, n, i: "C39" in i[:3] or "I65" in i[:3] or "软件" in i or "智能" in n),
    (["算力"], lambda c, n, i: "C39" in i[:3] or "数据" in n or "算力" in n),
    (["数据"], lambda c, n, i: "数据" in n or "信息" in i or "I64" in i[:3] or "I65" in i[:3]),
    (["存储"], lambda c, n, i: "存储" in n or "C39" in i[:3]),
    (["ARVR"], lambda c, n, i: "VR" in n or "AR" in n or "眼镜" in n or "头显" in n),
    (["具身智能"], lambda c, n, i: "机器人" in n or "具身" in n or "C34" in i[:3]),
    (["光通信"], lambda c, n, i: "光" in n and ("通信" in n or "模块" in n or "器件" in n)),
    (["能源"], lambda c, n, i: "D44" in i[:3] or "C38" in i[:3] or "电力" in i or "能源" in i or "电池" in n or "光伏" in n or "风电" in n),
    (["银行"], lambda c, n, i: "银行" in i),
]


def _assign_builtin_concepts(code, name, industry):
    result = []
    for tags, rule in BUILTIN_CONCEPT_RULES:
        if len(result) >= 5:
            break
        try:
            if rule(code, name, industry):
                result.append(tags[0])
        except Exception:
            continue
    return result[:5]


if __name__ == "__main__":
    main()
