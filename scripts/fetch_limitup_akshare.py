"""
A股涨停数据采集器 (AKShare 版)
- 使用东方财富数据源（通过 AKShare）
- 直接获取每日涨停板数据，含连板数、涨停统计
- 比 BaoStock 快 10x，数据更准确
- 输出格式兼容 limitup-history.json
"""

import json
import os
import sys
import time
from datetime import datetime, timedelta

import akshare as ak

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache")
LIMITUP_CACHE = os.path.join(CACHE_DIR, "limitup-history.json")


def get_trading_dates(days_back=250):
    """获取近 N 个交易日列表（跳过非交易日）"""
    # 生成日期范围，逐日尝试获取数据
    end = datetime.now()
    start = end - timedelta(days=int(days_back * 1.6))
    dates = []
    current = start
    while current <= end:
        if current.weekday() < 5:  # 跳过周末
            dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates[-days_back:]


def fetch_limitup_for_date(date_str):
    """获取某日涨停板数据"""
    # date_str: "2026-06-08" -> "20260608"
    em_date = date_str.replace("-", "")
    try:
        df = ak.stock_zt_pool_em(date=em_date)
        if df is None or df.empty:
            return []
        results = []
        for _, row in df.iterrows():
            code = str(row.get("代码", "")).zfill(6)
            name = str(row.get("名称", ""))
            change_pct = float(row.get("涨跌幅", 0))
            close = float(row.get("最新价", 0))
            turnover = float(row.get("换手率", 0))
            industry = str(row.get("所属行业", ""))
            consecutive = int(row.get("连板数", 1))
            zt_stats = str(row.get("涨停统计", ""))
            seal_money = float(row.get("封板资金", 0))
            broken_count = int(row.get("炸板次数", 0))

            # 排除科创板 688
            if code.startswith("688"):
                continue
            # 排除北交所
            if code.startswith("8") or code.startswith("9"):
                if not code.startswith("6") and not code.startswith("0") and not code.startswith("3"):
                    continue

            results.append({
                "code": code,
                "name": name,
                "type": "stock",
                "close": close,
                "change_pct": round(change_pct, 2),
                "volume_ratio": 0,  # 东方财富不直接给量比
                "limit_pct": 0.20 if code.startswith("300") or code.startswith("301") else 0.10,
                "is_limit_up": True,  # 涨停池里的都是涨停
                "turnover": turnover,
                "industry": industry,
                "consecutive": consecutive,
                "zt_stats": zt_stats,
                "seal_money": seal_money,
                "broken_count": broken_count,
            })
        return results
    except Exception as e:
        # 某些日期可能没有数据（非交易日）
        return []


def build_result(daily_data, all_dates):
    """构建最终结果（兼容 limitup-history.json 格式）"""
    # daily_limitups: {date: [stocks]}
    daily_limitups = {}
    # limitup_events: {code: {name, code, type, count, events, ...}}
    limitup_events = {}
    # daily_counts
    daily_counts = []

    for date, stocks in daily_data.items():
        if not stocks:
            continue
        daily_limitups[date] = []
        for s in stocks:
            daily_limitups[date].append({
                "code": s["code"],
                "name": s["name"],
                "type": s["type"],
                "close": s["close"],
                "change_pct": s["change_pct"],
                "volume_ratio": s["volume_ratio"],
                "limit_pct": s["limit_pct"],
                "turnover": s.get("turnover", 0),
                "industry": s.get("industry", ""),
                "consecutive": s.get("consecutive", 1),
                "zt_stats": s.get("zt_stats", ""),
                "seal_money": s.get("seal_money", 0),
                "broken_count": s.get("broken_count", 0),
            })

            code = s["code"]
            if code not in limitup_events:
                limitup_events[code] = {
                    "name": s["name"],
                    "code": code,
                    "type": s["type"],
                    "count": 0,
                    "events": [],
                    "max_consecutive": 0,
                    "industry": s.get("industry", ""),
                }
            limitup_events[code]["count"] += 1
            limitup_events[code]["events"].append({
                "date": date,
                "close": s["close"],
                "prev_close": round(s["close"] / (1 + s["change_pct"] / 100), 2),
                "change_pct": s["change_pct"],
                "volume": 0,
                "limit_pct": s["limit_pct"],
                "is_limit_up": True,
                "pre_volume_avg": 0,
                "pre_close_avg": 0,
                "volume_ratio": s["volume_ratio"],
                "pre_5d_change": 0,
                "consecutive": s.get("consecutive", 1),
                "industry": s.get("industry", ""),
            })
            # 更新最大连板数
            if s.get("consecutive", 1) > limitup_events[code]["max_consecutive"]:
                limitup_events[code]["max_consecutive"] = s["consecutive"]

        daily_counts.append({"date": date, "count": len(stocks)})

    # 涨停频率排行
    freq_ranking = sorted(
        [{"code": d["code"], "name": d["name"], "type": d.get("type", "stock"),
          "count": d["count"], "events": d["events"]}
         for d in limitup_events.values()],
        key=lambda x: x["count"],
        reverse=True
    )

    # 按品种类型统计
    type_stats = {"stock": 0, "etf": 0, "lof": 0}
    for d in limitup_events.values():
        t = d.get("type", "stock")
        type_stats[t] = type_stats.get(t, 0) + d["count"]

    # 涨停前特征统计
    all_events = []
    for data in limitup_events.values():
        all_events.extend(data["events"])

    pre_limit_features = {
        "avg_volume_ratio": 0,
        "avg_pre_5d_change": 0,
        "volume_ratio_distribution": {"<1": 0, "1-2": 0, "2-3": 0, "3-5": 0, ">5": 0},
        "pre_5d_change_distribution": {"<-10%": 0, "-10~-5%": 0, "-5~0%": 0, "0~5%": 0, "5~10%": 0, ">10%": 0},
    }

    return {
        "generated_at": datetime.now().isoformat(),
        "total_stocks_processed": len(limitup_events),
        "total_limitup_stocks": len(limitup_events),
        "total_limitup_events": len(all_events),
        "type_stats": type_stats,
        "daily_counts": daily_counts,
        "freq_ranking_top100": freq_ranking[:100],
        "pre_limit_features": pre_limit_features,
        "daily_limitups": daily_limitups,
        "limitup_events": limitup_events,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="A股涨停数据采集器 (AKShare/东方财富)")
    parser.add_argument("--days", type=int, default=250, help="回溯天数（默认250≈1年）")
    parser.add_argument("--reset", action="store_true", help="清除缓存重新开始")
    args = parser.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)

    if args.reset:
        for f in [LIMITUP_CACHE]:
            if os.path.exists(f):
                os.remove(f)
                print(f"已删除: {f}", file=sys.stderr)

    # 获取交易日列表
    print(f"获取近 {args.days} 个交易日列表...", file=sys.stderr)
    dates = get_trading_dates(args.days)
    if not dates:
        print("无法获取交易日列表", file=sys.stderr)
        sys.exit(1)
    print(f"共 {len(dates)} 个交易日: {dates[0]} ~ {dates[-1]}", file=sys.stderr)

    # 检查已有进度
    existing_data = {}
    if os.path.exists(LIMITUP_CACHE) and not args.reset:
        try:
            with open(LIMITUP_CACHE, "r", encoding="utf-8") as f:
                existing = json.load(f)
            existing_data = existing.get("daily_limitups", {})
            print(f"已有缓存: {len(existing_data)} 个交易日", file=sys.stderr)
        except:
            pass

    # 过滤出需要采集的日期
    dates_to_fetch = [d for d in dates if d not in existing_data]
    print(f"需要采集: {len(dates_to_fetch)} 个交易日", file=sys.stderr)

    if not dates_to_fetch:
        print("所有日期已有缓存", file=sys.stderr)
        # 输出已有数据
        with open(LIMITUP_CACHE, "r", encoding="utf-8") as f:
            print(f.read())
        return

    # 逐日采集
    new_data = dict(existing_data)
    for i, date in enumerate(dates_to_fetch):
        stocks = fetch_limitup_for_date(date)
        new_data[date] = stocks
        count = len(stocks)
        print(f"[{i+1}/{len(dates_to_fetch)}] {date}: {count} 只涨停", file=sys.stderr)

        # 每 10 天保存一次进度
        if (i + 1) % 10 == 0:
            result = build_result(new_data, dates)
            with open(LIMITUP_CACHE, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)
            print(f"  -> 进度已保存 ({len(new_data)} 天)", file=sys.stderr)

        # 限速：避免被封
        time.sleep(0.3)

    # 最终保存
    result = build_result(new_data, dates)
    with open(LIMITUP_CACHE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"\n完成！共 {len(new_data)} 个交易日，{result['total_limitup_stocks']} 只涨停股，{result['total_limitup_events']} 次涨停事件", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
