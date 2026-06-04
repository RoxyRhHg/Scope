"""
A股历史大涨数据采集器
- 从 BaoStock 批量获取全市场日K线（近1年）
- 检测大幅拉升事件（>=8%涨幅，含涨停）
- 排除科创板 (688xxx)
- 包含 ETF、LOF 等可交易衍生品
- 分析大涨前的技术形态模式
- 输出结构化 JSON 供 Node.js 预测引擎使用
"""

SURGE_THRESHOLD = 0.08  # 8% 大幅拉升阈值

import json
import math
import os
import sys
import time
import contextlib
import io
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import baostock as bs

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache")
LIMITUP_CACHE = os.path.join(CACHE_DIR, "limitup-history.json")
PROGRESS_FILE = os.path.join(CACHE_DIR, "limitup-progress.json")


def normalize_code(raw_code):
    """将各种格式的股票代码统一为 baostock 格式 (sh.600000 / sz.000001)"""
    code = str(raw_code).strip().lower().replace("sh.", "").replace("sz.", "")
    market = "sh" if code.startswith(("6", "9")) else "sz"
    return f"{market}.{code}"


def pure_code(bs_code):
    """sh.600000 -> 600000"""
    return bs_code.split(".")[-1]


def is_star_market(code):
    """科创板 688xxx"""
    return code.startswith("688")


def is_gem(code):
    """创业板 300xxx"""
    return code.startswith("300")


def is_st(name):
    """ST / *ST 股票"""
    if not name:
        return False
    n = name.upper()
    return "ST" in n or "*ST" in n


def get_limit_pct(code, name, instrument_type="stock"):
    """获取涨跌停幅度"""
    if instrument_type in ("etf", "lof"):
        return 0.10  # ETF/LOF 通常10%涨跌停
    if is_st(name or ""):
        return 0.05
    if is_gem(code):
        return 0.20  # 创业板20%
    return 0.10  # 主板10%


def compute_limit_price(prev_close, pct, direction="up"):
    """计算涨停/跌停价格（四舍五入到分）"""
    if prev_close <= 0:
        return 0
    if direction == "up":
        return math.ceil(prev_close * (1 + pct) * 100) / 100
    else:
        return math.floor(prev_close * (1 - pct) * 100) / 100


def detect_limit_up(bars, code, name, instrument_type="stock"):
    """
    检测大幅拉升事件（>=8%涨幅，含涨停）
    返回: [{date, close, prev_close, change_pct, volume, limit_pct, is_limit_up}, ...]
    """
    events = []
    pct = get_limit_pct(code, name, instrument_type)

    for i in range(1, len(bars)):
        prev = bars[i - 1]
        curr = bars[i]

        prev_close = prev["close"]
        if prev_close <= 0:
            continue

        change_pct = (curr["close"] - prev_close) / prev_close
        limit_price = compute_limit_price(prev_close, pct, "up")
        is_limit_up = curr["close"] >= limit_price - 0.01 and change_pct >= pct - 0.005

        # 大幅拉升判定：>=8% 或 涨停
        if change_pct >= SURGE_THRESHOLD or is_limit_up:
            # 计算涨停前5天的特征
            pre_bars = bars[max(0, i - 5):i]
            events.append({
                "date": curr["date"],
                "close": round(curr["close"], 2),
                "prev_close": round(prev_close, 2),
                "change_pct": round(change_pct * 100, 2),
                "volume": curr["volume"],
                "limit_pct": pct,
                "is_limit_up": is_limit_up,
                "pre_volume_avg": round(sum(b["volume"] for b in pre_bars) / max(len(pre_bars), 1)),
                "pre_close_avg": round(sum(b["close"] for b in pre_bars) / max(len(pre_bars), 1), 2),
                "volume_ratio": round(curr["volume"] / max(sum(b["volume"] for b in pre_bars) / max(len(pre_bars), 1), 1), 2),
                "pre_5d_change": round((curr["close"] - pre_bars[0]["close"]) / max(pre_bars[0]["close"], 0.01) * 100, 2) if pre_bars else 0,
            })

    return events


def detect_limit_down(bars, code, name):
    """检测跌停事件"""
    events = []
    pct = get_limit_pct(code, name)

    for i in range(1, len(bars)):
        prev = bars[i - 1]
        curr = bars[i]

        prev_close = prev["close"]
        if prev_close <= 0:
            continue

        change_pct = (curr["close"] - prev_close) / prev_close
        limit_price = compute_limit_price(prev_close, pct, "down")

        if curr["close"] <= limit_price + 0.01 and change_pct <= -pct + 0.005:
            events.append({
                "date": curr["date"],
                "close": round(curr["close"], 2),
                "prev_close": round(prev_close, 2),
                "change_pct": round(change_pct * 100, 2),
            })

    return events


def fetch_single_stock(bs_code, start_date, end_date):
    """获取单只股票的日K线数据"""
    try:
        rs = bs.query_history_k_data_plus(
            bs_code,
            "date,open,high,low,close,volume",
            start_date=start_date,
            end_date=end_date,
            frequency="d",
            adjustflag="2",  # 前复权
        )
        if rs.error_code != "0":
            return None

        rows = []
        while rs.next():
            date, open_, high, low, close, volume = rs.get_row_data()
            if not close or float(close) <= 0:
                continue
            rows.append({
                "date": date,
                "open": float(open_),
                "high": float(high),
                "low": float(low),
                "close": float(close),
                "volume": float(volume),
            })
        return rows
    except Exception:
        return None


def get_all_stock_list():
    """获取全市场A股列表（排除科创板，包含ETF/LOF）"""
    rows = []
    # 尝试今天，如果失败或为空则依次回退前几天
    for offset in range(14):
        day = (datetime.now() - timedelta(days=offset)).strftime("%Y-%m-%d")
        rs = bs.query_all_stock(day=day)
        if rs.error_code != "0":
            continue
        while rs.next():
            rows.append(rs.get_row_data())
        if len(rows) > 0:
            break
    else:
        return []

    stocks = []
    etf_lof_count = 0
    star_excluded = 0
    for row in rows:
        code = row[0]  # sh.600000 格式
        # BaoStock query_all_stock 返回: [code, tradeStatus, code_name]
        trade_status = row[1] if len(row) > 1 else "1"
        name = row[2] if len(row) > 2 else ""

        pure = pure_code(code)

        # 排除 B 股
        if pure.startswith(("2", "9")):
            continue

        # 排除科创板 688xxx
        if pure.startswith("688"):
            star_excluded += 1
            continue

        # 排除指数
        # sh.000xxx = 上证系列指数, sz.399xxx = 深证系列指数
        is_index = "指数" in name or \
                   (code.startswith("sh.") and pure.startswith("000")) or \
                   (code.startswith("sz.") and pure.startswith("399"))
        if is_index:
            continue

        # A股主板 + 创业板
        if pure.startswith(("0", "3", "6")):
            stocks.append({"code": code, "name": name, "pure": pure, "type": "stock"})
            continue

        # ETF: 上交所 510/511/512/513/515/516/518xxx, 深交所 159xxx
        if pure.startswith(("510", "511", "512", "513", "515", "516", "518", "159")):
            stocks.append({"code": code, "name": name, "pure": pure, "type": "etf"})
            etf_lof_count += 1
            continue

        # LOF: 上交所 501xxx, 深交所 160/161/162/163/164/165/166xxx
        if pure.startswith(("501", "160", "161", "162", "163", "164", "165", "166")):
            stocks.append({"code": code, "name": name, "pure": pure, "type": "lof"})
            etf_lof_count += 1
            continue

    print(f"排除科创板: {star_excluded} 只, 包含ETF/LOF: {etf_lof_count} 只", file=sys.stderr)
    return stocks


def load_progress():
    """加载进度（断点续传）"""
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"processed": {}, "limitup_events": {}, "stats": {}}


def save_progress(progress):
    """保存进度"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False)


def fetch_all_limitups(days_back=250, max_workers=8):
    """
    主函数：获取全市场涨停数据
    - days_back: 回溯天数（250≈1年交易日）
    - max_workers: 并发线程数
    """
    os.makedirs(CACHE_DIR, exist_ok=True)

    # 检查缓存
    if os.path.exists(LIMITUP_CACHE):
        cache_age = time.time() - os.path.getmtime(LIMITUP_CACHE)
        if cache_age < 86400:  # 24小时内缓存有效
            with open(LIMITUP_CACHE, "r", encoding="utf-8") as f:
                return json.load(f)

    # 登录 BaoStock
    with contextlib.redirect_stdout(io.StringIO()):
        login_result = bs.login()
    if login_result.error_code != "0":
        print(f"BaoStock login failed: {login_result.error_msg}", file=sys.stderr)
        return None

    try:
        # 获取股票列表
        stocks = get_all_stock_list()
        print(f"获取到 {len(stocks)} 只A股", file=sys.stderr)

        start_date = (datetime.now() - timedelta(days=int(days_back * 1.5))).strftime("%Y-%m-%d")
        end_date = datetime.now().strftime("%Y-%m-%d")

        # 加载进度
        progress = load_progress()
        processed = progress.get("processed", {})
        limitup_events = progress.get("limitup_events", {})
        stats = progress.get("stats", {})

        # 过滤出未处理的股票
        pending = [s for s in stocks if s["code"] not in processed]
        print(f"已处理 {len(processed)} 只，待处理 {len(pending)} 只", file=sys.stderr)

        if not pending:
            # 全部处理完成
            result = build_analysis_result(limitup_events, stocks, stats)
            with open(LIMITUP_CACHE, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)
            return result

        # 并发获取
        completed = 0
        total_limitups = sum(len(v) for v in limitup_events.values())
        start_time = time.time()

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {}
            for stock in pending:
                future = executor.submit(fetch_single_stock, stock["code"], start_date, end_date)
                future_map[future] = stock

            for future in as_completed(future_map):
                stock = future_map[future]
                completed += 1

                try:
                    bars = future.result()
                    if bars and len(bars) >= 10:
                        # 检测涨停
                        instrument_type = stock.get("type", "stock")
                        limitups = detect_limit_up(bars, stock["pure"], stock["name"], instrument_type)
                        if limitups:
                            limitup_events[stock["code"]] = {
                                "name": stock["name"],
                                "code": stock["pure"],
                                "type": instrument_type,
                                "count": len(limitups),
                                "events": limitups,
                            }
                            total_limitups += len(limitups)

                        # 统计信息
                        stats[stock["code"]] = {
                            "name": stock["name"],
                            "type": instrument_type,
                            "bars_count": len(bars),
                            "limitup_count": len(limitups),
                        }

                    processed[stock["code"]] = True
                except Exception:
                    processed[stock["code"]] = "error"

                # 每100只保存一次进度
                if completed % 100 == 0:
                    progress["processed"] = processed
                    progress["limitup_events"] = limitup_events
                    progress["stats"] = stats
                    save_progress(progress)

                    elapsed = time.time() - start_time
                    speed = completed / elapsed if elapsed > 0 else 0
                    remaining = (len(pending) - completed) / max(speed, 0.1)
                    print(
                        f"进度: {completed}/{len(pending)} "
                        f"| 涨停: {total_limitups} 只 "
                        f"| 速度: {speed:.1f}只/秒 "
                        f"| 剩余: {remaining/60:.1f}分钟",
                        file=sys.stderr
                    )

        # 最终保存
        progress["processed"] = processed
        progress["limitup_events"] = limitup_events
        progress["stats"] = stats
        save_progress(progress)

        # 构建分析结果
        result = build_analysis_result(limitup_events, stocks, stats)
        with open(LIMITUP_CACHE, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)

        return result

    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()


def build_analysis_result(limitup_events, all_stocks, stats):
    """构建完整的分析结果"""
    # 按日期聚合涨停
    daily_limitups = {}
    for code, data in limitup_events.items():
        for event in data["events"]:
            date = event["date"]
            if date not in daily_limitups:
                daily_limitups[date] = []
            daily_limitups[date].append({
                "code": data["code"],
                "name": data["name"],
                "type": data.get("type", "stock"),
                "close": event["close"],
                "change_pct": event["change_pct"],
                "volume_ratio": event.get("volume_ratio", 0),
                "limit_pct": event["limit_pct"],
            })

    # 涨停频率排行
    freq_ranking = sorted(
        [{"code": d["code"], "name": d["name"], "type": d.get("type", "stock"), "count": d["count"], "events": d["events"]}
         for d in limitup_events.values()],
        key=lambda x: x["count"],
        reverse=True
    )

    # 按品种类型统计
    type_stats = {"stock": 0, "etf": 0, "lof": 0}
    for d in limitup_events.values():
        t = d.get("type", "stock")
        type_stats[t] = type_stats.get(t, 0) + d["count"]

    # 按行业/概念统计
    industry_stats = {}
    for code, data in limitup_events.items():
        # 后续通过 Scope API 补充行业信息
        pass

    # 涨停前特征统计
    pre_limit_features = {
        "avg_volume_ratio": 0,
        "avg_pre_5d_change": 0,
        "volume_ratio_distribution": {"<1": 0, "1-2": 0, "2-3": 0, "3-5": 0, ">5": 0},
        "pre_5d_change_distribution": {"<-10%": 0, "-10~-5%": 0, "-5~0%": 0, "0~5%": 0, "5~10%": 0, ">10%": 0},
    }

    all_events = []
    for data in limitup_events.values():
        all_events.extend(data["events"])

    if all_events:
        pre_limit_features["avg_volume_ratio"] = round(
            sum(e.get("volume_ratio", 0) for e in all_events) / len(all_events), 2
        )
        pre_limit_features["avg_pre_5d_change"] = round(
            sum(e.get("pre_5d_change", 0) for e in all_events) / len(all_events), 2
        )

        for e in all_events:
            vr = e.get("volume_ratio", 0)
            if vr < 1:
                pre_limit_features["volume_ratio_distribution"]["<1"] += 1
            elif vr < 2:
                pre_limit_features["volume_ratio_distribution"]["1-2"] += 1
            elif vr < 3:
                pre_limit_features["volume_ratio_distribution"]["2-3"] += 1
            elif vr < 5:
                pre_limit_features["volume_ratio_distribution"]["3-5"] += 1
            else:
                pre_limit_features["volume_ratio_distribution"][">5"] += 1

            pc = e.get("pre_5d_change", 0)
            if pc < -10:
                pre_limit_features["pre_5d_change_distribution"]["<-10%"] += 1
            elif pc < -5:
                pre_limit_features["pre_5d_change_distribution"]["-10~-5%"] += 1
            elif pc < 0:
                pre_limit_features["pre_5d_change_distribution"]["-5~0%"] += 1
            elif pc < 5:
                pre_limit_features["pre_5d_change_distribution"]["0~5%"] += 1
            elif pc < 10:
                pre_limit_features["pre_5d_change_distribution"]["5~10%"] += 1
            else:
                pre_limit_features["pre_5d_change_distribution"][">10%"] += 1

    # 每日涨停数量趋势
    daily_counts = sorted(
        [{"date": d, "count": len(stocks)} for d, stocks in daily_limitups.items()],
        key=lambda x: x["date"]
    )

    return {
        "generated_at": datetime.now().isoformat(),
        "total_stocks_processed": len(stats),
        "total_limitup_stocks": len(limitup_events),
        "total_limitup_events": len(all_events),
        "type_stats": type_stats,
        "daily_counts": daily_counts,
        "freq_ranking_top100": freq_ranking[:100],
        "pre_limit_features": pre_limit_features,
        "daily_limitups": daily_limitups,
        "limitup_events": limitup_events,
    }


def quick_analysis(codes=None):
    """
    快速分析模式：只分析指定股票或当前快照中的Top股票
    用于实时预测，不获取全市场历史
    """
    with contextlib.redirect_stdout(io.StringIO()):
        bs.login()

    try:
        start_date = (datetime.now() - timedelta(days=380)).strftime("%Y-%m-%d")
        end_date = datetime.now().strftime("%Y-%m-%d")

        results = {}
        for raw_code in (codes or []):
            bs_code = normalize_code(raw_code)
            bars = fetch_single_stock(bs_code, start_date, end_date)
            if bars:
                pure = pure_code(bs_code)
                # 获取股票名称（从bars无法获取，传空）
                limitups = detect_limit_up(bars, pure, "")
                results[pure] = {
                    "bars_count": len(bars),
                    "limitup_count": len(limitups),
                    "limitups": limitups,
                    "latest_close": bars[-1]["close"] if bars else 0,
                    "latest_volume": bars[-1]["volume"] if bars else 0,
                    "ma5": round(sum(b["close"] for b in bars[-5:]) / min(5, len(bars)), 2),
                    "ma20": round(sum(b["close"] for b in bars[-20:]) / min(20, len(bars)), 2),
                }

        return results
    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="A股历史涨停数据采集器")
    parser.add_argument("--days", type=int, default=250, help="回溯天数（默认250≈1年）")
    parser.add_argument("--workers", type=int, default=8, help="并发线程数")
    parser.add_argument("--quick", nargs="*", help="快速分析指定股票代码")
    parser.add_argument("--reset", action="store_true", help="清除缓存重新开始")
    args = parser.parse_args()

    if args.reset:
        for f in [LIMITUP_CACHE, PROGRESS_FILE]:
            if os.path.exists(f):
                os.remove(f)
        print("缓存已清除", file=sys.stderr)

    if args.quick is not None:
        result = quick_analysis(args.quick if args.quick else None)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result = fetch_all_limitups(days_back=args.days, max_workers=args.workers)
        if result:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print("数据获取失败", file=sys.stderr)
            sys.exit(1)
