"""
Scope 数据预取脚本：一键拉取全市场快照 + 技术指标并缓存到本地。

运行方式：
  python scripts/prefetch.py           # 预取快照
  python scripts/prefetch.py --techs   # 预取快照 + 前100只股票技术指标
  python scripts/prefetch.py --all-techs  # 预取快照 + 全部股票技术指标（慢）

数据源：新浪行情 + Baostock 行业/K线（均为免费数据源）
缓存位置：.cache/
"""

import os, sys, json, time, argparse, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, ".cache")


def run_script(script_name):
    """运行同目录下的 Python 脚本。"""
    script_path = os.path.join(ROOT, "scripts", script_name)
    print(f"\n{'='*50}")
    print(f"Running: {script_name}")
    print(f"{'='*50}")
    result = subprocess.run(
        [sys.executable, script_path],
        cwd=ROOT,
        capture_output=False,
        timeout=600,
    )
    if result.returncode != 0:
        print(f"WARNING: {script_name} exited with code {result.returncode}")
    return result.returncode == 0


def fetch_technicals_for_stocks(codes, max_workers=4):
    """为指定股票列表拉取技术指标数据。"""
    import baostock as bs
    from concurrent.futures import ThreadPoolExecutor, as_completed

    lg = bs.login()
    if lg.error_code != '0':
        print(f"Baostock login failed: {lg.error_msg}")
        return {}

    results = {}
    total = len(codes)

    def fetch_one(code):
        try:
            bs_code = f"sh.{code}" if code.startswith("6") else f"sz.{code}"
            rs = bs.query_history_k_data_plus(
                bs_code,
                "date,open,high,low,close,volume",
                start_date="2025-08-01",
                end_date=time.strftime("%Y-%m-%d"),
                frequency="d",
                adjustflag="2",
            )
            if rs.error_code != '0':
                return code, None

            bars = []
            while rs.next():
                row = rs.get_row_data()
                bars.append({
                    "date": row[0],
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": float(row[5]),
                    "code": code,
                })
            return code, bars
        except Exception as e:
            print(f"  Error fetching {code}: {e}")
            return code, None

    print(f"\nFetching technicals for {total} stocks (workers={max_workers})...")
    completed = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_one, c): c for c in codes}
        for future in as_completed(futures):
            code, bars = future.result()
            if bars:
                results[code] = bars
            completed += 1
            if completed % 20 == 0:
                print(f"  Progress: {completed}/{total}")

    bs.logout()
    print(f"  Done: {len(results)}/{total} stocks with technical data")
    return results


def main():
    parser = argparse.ArgumentParser(description="Scope data prefetch")
    parser.add_argument("--techs", action="store_true", help="Also prefetch technicals for top 100 stocks")
    parser.add_argument("--all-techs", action="store_true", help="Also prefetch technicals for ALL stocks (slow)")
    parser.add_argument("--tech-codes", type=str, help="Comma-separated stock codes for technical prefetch")
    args = parser.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)

    # Step 1: Fetch live snapshot
    print("\n[1] Fetching live snapshot...")
    run_script("fetch_live_snapshot.py")

    # Step 2: Load snapshot to get stock list
    cache_file = os.path.join(CACHE_DIR, "live-snapshot.json")
    if os.path.exists(cache_file):
        with open(cache_file, "r", encoding="utf-8") as f:
            snapshot = json.load(f)
        items = snapshot.get("snapshot", {}).get("items", []) or snapshot.get("items", [])
        print(f"\nSnapshot contains {len(items)} stocks")
    else:
        print("No snapshot cache found, skipping technical prefetch")
        return

    # Step 3: Prefetch technicals if requested
    if args.tech_codes:
        codes = [c.strip() for c in args.tech_codes.split(",") if c.strip()]
    elif args.all_techs:
        codes = [s.get("code", "") for s in items if s.get("code")]
    elif args.techs:
        # Top 100 by market cap (proxy: sort by code as rough approximation)
        codes = [s.get("code", "") for s in items[:100] if s.get("code")]
    else:
        print("\nSkipping technical prefetch (use --techs or --all-techs)")
        return

    if codes:
        technicals = fetch_technicals_for_stocks(codes)

        # Save technical cache
        tech_cache_file = os.path.join(CACHE_DIR, "technicals-cache.json")

        # Load existing cache
        existing = {}
        if os.path.exists(tech_cache_file):
            with open(tech_cache_file, "r", encoding="utf-8") as f:
                existing = json.load(f)

        # Merge
        existing.update(technicals)

        with open(tech_cache_file, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False)

        print(f"\nSaved {len(existing)} technical datasets to {tech_cache_file}")

    print("\n=== Prefetch complete ===")


if __name__ == "__main__":
    main()
