"""
每日涨停预测 - 一键运行脚本

用法:
  python scripts/daily_predict.py                    # 默认模式（30只）
  python scripts/daily_predict.py --pick             # 精选模式（10只，有安全边际+生意模式）
  python scripts/daily_predict.py --pick --priority  # 精选模式 + 仅优先行业
  python scripts/daily_predict.py --save             # 默认模式 + 保存报告

自动完成:
1. 确保 Scope 服务运行
2. 拉取最新快照
3. 加载涨停历史
4. 运行预测
5. 输出格式化结果

精选模式(--pick): 从预测池中智能筛选生意模式好+安全边际足+价格合理的 Top 10
"""

import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

BASE = "http://127.0.0.1:4173"


def api_get(path, timeout=120):
    url = f"{BASE}{path}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        return None
    except Exception as e:
        return None


def api_post(path, data=None, timeout=120):
    url = f"{BASE}{path}"
    try:
        body = json.dumps(data or {}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def ensure_server():
    """确保 Scope 服务运行"""
    health = api_get("/api/health", timeout=5)
    if health and health.get("ok"):
        return True

    print("Scope 服务未运行，正在启动...")
    subprocess.Popen(
        ["node", "src/server.js"],
        cwd=sys.path[0] + "/..",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(10):
        time.sleep(2)
        health = api_get("/api/health", timeout=5)
        if health and health.get("ok"):
            print("服务已启动")
            return True
    print("服务启动失败")
    return False


def check_history():
    """检查涨停历史数据"""
    result = api_get("/api/limitup-history")
    if not result or not result.get("ok"):
        print("涨停历史数据未采集")
        print("首次运行请执行: python scripts/fetch_limitup_history.py --days 250 --workers 8")
        print("（约需 15-30 分钟，支持断点续传）")
        return False
    s = result.get("summary", {})
    print(f"历史数据: {s.get('total_limitup_stocks', 0)} 只涨停股, "
          f"{s.get('total_limitup_events', 0)} 次事件, "
          f"更新于 {s.get('generated_at', '?')[:10]}")
    return True


def run_prediction(priority=False, max_price=70, min_score=35, limit=30, force=False):
    """运行预测"""
    params = f"?maxPrice={max_price}&minScore={min_score}&limit={limit}"
    if priority:
        params += "&priorityOnly=1"
    if force:
        params += "&force=1"

    print(f"\n正在运行预测...")
    start = time.time()
    result = api_get(f"/api/daily-predict{params}", timeout=180)
    elapsed = time.time() - start

    if not result or not result.get("ok"):
        print(f"预测失败: {result}")
        return None

    print(f"预测完成 ({elapsed:.1f}秒)")
    return result


def pick_top_stocks(result, top_n=10, min_bm=60, min_mgmt=60, min_sm=5, max_pvi=20):
    """
    精选推荐股票：过滤条件 + 综合质量排序。

    过滤条件：
      - 生意模式分 >= min_bm
      - 管理质量分 >= min_mgmt
      - 安全边际 >= min_sm (%)
      - 现价不高于理想买入价超过 max_pvi (%)
      - 排除 ST / *ST / 退市 股

    综合排序权重：
      生意模式 30% | 安全边际 25% | 价格合理性 20% | 涨停技术分 25%
    """
    candidates = []
    stocks = result.get("stocks", [])

    for s in stocks:
        name = s.get("name", "")
        if name.startswith("*ST") or name.startswith("ST") or "退" in name:
            continue

        sc = s.get("scope", {})
        if not sc:
            continue

        bm = sc.get("businessModel")
        mgmt = sc.get("management")
        sm = sc.get("safetyMargin")
        pvi = sc.get("priceVsIdeal")
        ideal = sc.get("idealBuyPrice")

        if any(v is None for v in [bm, mgmt, sm, pvi, ideal]):
            continue
        if bm < min_bm or mgmt < min_mgmt or sm < min_sm or pvi > max_pvi:
            continue

        # 价格合理性分：偏离理想买入价越少越好，越低越好
        price_score = max(0, 100 - max(pvi, 0) * 3)

        # 综合质量分
        quality_score = (
            bm * 0.30 +
            sm * 0.25 +
            price_score * 0.20 +
            s["totalScore"] * 0.25
        )
        candidates.append((quality_score, s))

    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[:top_n]


def format_results(result):
    """格式化输出（含生意模式 + 安全边际 + 买卖点）"""
    print(f"\n{'='*80}")
    print(f"  涨停预测报告 {result['date']}")
    print(f"  快照: {result['snapshotSource']} | 历史: {result.get('historyDate', '?')}")
    print(f"{'='*80}")

    s = result.get("summary", {})
    print(f"\n  股票: {s.get('stockCount', 0)} 只 | ETF: {s.get('etfCount', 0)} 只")
    print(f"  强烈关注: {s.get('strongBuy', 0)} | 纳入观察: {s.get('watch', 0)} | 价值底仓: {s.get('valueBase', 0)}")

    stocks = result.get("stocks", [])
    if stocks:
        for i, s in enumerate(stocks):
            d = s.get("dimensions", {})
            sc = s.get("scope", {})
            verdict = s.get("verdict", "")

            print(f"\n{'─'*80}")
            print(f"  #{i+1} {s['code']} {s.get('name','')} | {s['price']:.2f}元 | 涨停分={s['totalScore']:.0f} | {s['probability']}")
            print(f"  综合判断: {verdict}")

            # 五维评分
            print(f"  评分: 技术={d.get('technicals',0):.0f} 基因={d.get('limitupGene',0):.0f} "
                  f"动量={d.get('momentum',0):.0f} 行业={d.get('industryHeat',0):.0f} 安全={d.get('safety',0):.0f}")

            # 基本面（如果有）
            if sc:
                print(f"  基本面: 核心分={sc.get('coreScore',0)} 生意模式={sc.get('businessModel',0)} "
                      f"管理={sc.get('management',0)} 估值={sc.get('valuation',0)}")
                print(f"  估值: {sc.get('valuationTier','?')} | 安全边际={sc.get('safetyMargin','?')}% | "
                      f"结论={sc.get('conclusion','?')}")

                # 买卖点
                ideal = sc.get('idealBuyPrice')
                stop = sc.get('stopLossPrice')
                target = sc.get('targetPrice')
                vsIdeal = sc.get('priceVsIdeal')
                if ideal:
                    vs = f"(高于理想价{vsIdeal}%)" if vsIdeal and vsIdeal > 0 else f"(低于理想价{abs(vsIdeal)}%)"
                    print(f"  >>> 理想买入={ideal}元 {vs} | 止损={stop}元 | 目标={target}元")

                if sc.get('stopDoingBlocked'):
                    print(f"  *** 不为清单拦截 ***")
                risks = sc.get('riskFlags', [])
                if risks:
                    print(f"  风险: {', '.join(risks[:3])}")

            # 信号
            sigs = s.get("signals", [])
            if sigs:
                print(f"  信号: {', '.join(sigs[:5])}")

    etfs = result.get("etfs", [])
    if etfs:
        print(f"\n{'─'*80}")
        print(f"  ETF/LOF 涨停标的")
        print(f"{'─'*80}")
        for i, e in enumerate(etfs):
            d = e.get("dimensions", {})
            sigs = ", ".join(e.get("signals", [])[:2])
            print(
                f"  {i+1:>3} [ETF] {e['code']:>8} {e['name']:>10} {e['price']:>8.2f} "
                f"{e['totalScore']:>5.0f} 基因={d.get('limitupGene',0):>3.0f}  "
                f"{e['probability']:<6} {e['action']:<8}  {sigs}"
            )

    print(f"\n{'='*80}")
    print(f"  API: GET /api/daily-predict?maxPrice=70&minScore=35&limit=30")
    print(f"  CLI: python scripts/daily_predict.py --save")
    print(f"{'='*80}\n")


def format_pick_results(result, picks):
    """格式化精选推荐输出"""
    print(f"\n{'═'*80}")
    print(f"  ★ 今日精选 Top {len(picks)}  —  {result['date']}")
    print(f"  条件: 生意模式>=60 | 安全边际>=5% | 价格不超理想买价20%")
    print(f"  快照: {result['snapshotSource']} | 历史: {result.get('historyDate', '?')}")
    print(f"{'═'*80}")

    for i, (_, s) in enumerate(picks):
        sc = s.get("scope", {})
        ideal = sc.get("idealBuyPrice", "?")
        pvi = sc.get("priceVsIdeal", "?")
        sm = sc.get("safetyMargin", "?")
        bm = sc.get("businessModel", "?")

        price_info = ""
        if isinstance(pvi, (int, float)):
            price_info = f"低于理想价{abs(pvi)}% (优)" if pvi <= 0 else f"高于理想价{pvi}%"

        print(f"\n{'─'*60}")
        print(f"  #{i+1} {s['code']} {s.get('name','')} ")
        print(f"  现价: {s['price']:.2f}元 | 涨停分: {s['totalScore']:.0f} | {s['probability']}")

        d = s.get("dimensions", {})
        print(f"  评分: 技术={d.get('technicals',0):.0f} 基因={d.get('limitupGene',0):.0f} "
              f"动量={d.get('momentum',0):.0f} 行业={d.get('industryHeat',0):.0f}")

        print(f"  生意模式: {bm}/100 | 安全边际: {sm}% | {price_info}")

        if isinstance(ideal, (int, float)):
            stop = sc.get('stopLossPrice', '?')
            target = sc.get('targetPrice', '?')
            print(f"  理想买入: {ideal}元 | 止损: {stop}元 | 目标: {target}元")

        print(f"  估值: {sc.get('valuationTier','?')} | 核心分: {sc.get('coreScore','?')} | {s.get('verdict','')}")

        sigs = s.get("signals", [])
        if sigs:
            print(f"  信号: {', '.join(sigs[:4])}")

    # 统计
    total_with_data = sum(1 for s in result.get("stocks", []) if s.get("scope"))
    print(f"\n{'═'*80}")
    print(f"  从 {total_with_data} 只有基本面数据的股票中精选 {len(picks)} 只")
    print(f"  排序逻辑: 生意模式×30% + 安全边际×25% + 价格合理性×20% + 涨停分×25%")
    print(f"  CLI: python scripts/daily_predict.py --pick [--priority] [--max-price 70]")
    print(f"{'═'*80}\n")


def save_report(result, path=None):
    """保存报告到文件"""
    if not path:
        date = result.get("date", datetime.now().strftime("%Y-%m-%d"))
        path = f".cache/daily-predict-{date}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"报告已保存: {path}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="每日涨停预测")
    parser.add_argument("--priority", action="store_true", help="仅优先行业")
    parser.add_argument("--max-price", type=float, default=70, help="最高股价（默认70）")
    parser.add_argument("--min-score", type=float, default=35, help="最低分数（默认35）")
    parser.add_argument("--limit", type=int, default=30, help="返回数量（默认30）")
    parser.add_argument("--force", action="store_true", help="强制刷新快照")
    parser.add_argument("--save", action="store_true", help="保存报告到文件")
    parser.add_argument("--pick", action="store_true", help="精选模式：筛选生意模式好+安全边际足的 Top 10")
    args = parser.parse_args()

    print(f"涨停预测系统 v1.0 — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    if not ensure_server():
        sys.exit(1)

    if not check_history():
        sys.exit(1)

    if args.pick:
        # 精选模式：扩大候选池，再做智能筛选
        result = run_prediction(
            priority=args.priority,
            max_price=args.max_price,
            min_score=20,       # 降低门槛获取更多候选
            limit=100,           # 扩大候选池
            force=args.force,
        )
    else:
        result = run_prediction(
            priority=args.priority,
            max_price=args.max_price,
            min_score=args.min_score,
            limit=args.limit,
            force=args.force,
        )

    if not result:
        sys.exit(1)

    if args.pick:
        picks = pick_top_stocks(result)
        format_pick_results(result, picks)
    else:
        format_results(result)

    if args.save:
        save_report(result)
