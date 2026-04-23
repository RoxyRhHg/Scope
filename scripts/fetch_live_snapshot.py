import json
import math
import re
import sys
from datetime import datetime
import contextlib
import io

import baostock as bs
import requests


HEADERS = {
    "Referer": "https://finance.sina.com.cn",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

SINA_API = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
SINA_COUNT_API = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount"
SINA_BOARD_META = "https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php"


def no_proxy_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    session.headers.update(HEADERS)
    return session


def fetch_json_list(session: requests.Session, node: str, page: int, num: int = 80):
    response = session.get(
        SINA_API,
        params={
            "page": str(page),
            "num": str(num),
            "sort": "symbol",
            "asc": "1",
            "node": node,
            "symbol": "",
            "_s_r_a": "page",
        },
        timeout=30,
    )
    response.raise_for_status()
    response.encoding = "gbk"
    text = response.text.strip()
    if not text or text == "[]":
      return []
    return json.loads(text)


def fetch_count(session: requests.Session, node: str) -> int:
    response = session.get(SINA_COUNT_API, params={"node": node}, timeout=20)
    response.raise_for_status()
    response.encoding = "gbk"
    text = response.text.strip().strip('"')
    return int(text)


def fetch_all_a_share_spot(session: requests.Session):
    total = fetch_count(session, "hs_a")
    pages = math.ceil(total / 80)
    rows = []

    for page in range(1, pages + 1):
        rows.extend(fetch_json_list(session, "hs_a", page, 80))

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
    session = no_proxy_session()

    spot = fetch_all_a_share_spot(session)
    industries = fetch_industry_map()
    concepts = fetch_top_concepts(session)

    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "note": "实时行情来自新浪分页行情接口，行业映射来自 BaoStock，概念为新浪热门概念前 24 个。",
        "spot": spot,
        "industries": industries,
        "concepts": concepts,
    }
    json.dump(payload, sys.stdout, ensure_ascii=True)


if __name__ == "__main__":
    main()
