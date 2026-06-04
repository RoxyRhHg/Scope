"""预抓取行业映射数据，写入 .cache/industry-map.json
每天开盘前运行一次即可，行业映射数据变化极慢。
"""
import json
import sys
import pathlib
import contextlib
import io

import baostock as bs

def main():
    with contextlib.redirect_stdout(io.StringIO()):
        login = bs.login()
    if login.error_code != "0":
        print(f"Login failed: {login.error_msg}", file=sys.stderr)
        sys.exit(1)

    try:
        rs = bs.query_stock_industry()
        if rs.error_code != "0":
            print(f"Query failed: {rs.error_msg}", file=sys.stderr)
            sys.exit(1)

        mapping = []
        while rs.next():
            date, code, name, industry, classification = rs.get_row_data()
            if not industry:
                continue
            market, stock_code = code.split(".")
            mapping.append({
                "board": industry,
                "stocks": [{"code": stock_code, "name": name, "market": market.upper()}],
                "count": 1,
                "classification": classification,
                "date": date,
            })

        grouped = {}
        for item in mapping:
            board = item["board"]
            grouped.setdefault(board, {
                "board": board,
                "stocks": [],
                "count": 0,
                "classification": item["classification"],
                "date": item["date"],
            })
            grouped[board]["stocks"].extend(item["stocks"])
            grouped[board]["count"] += 1

        result = list(grouped.values())

        cache_dir = pathlib.Path(__file__).resolve().parent.parent / ".cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        out_file = cache_dir / "industry-map.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)

        total_stocks = sum(g["count"] for g in result)
        print(f"OK: {len(result)} industries, {total_stocks} stocks -> {out_file}")

    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()


if __name__ == "__main__":
    main()
