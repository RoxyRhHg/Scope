import contextlib
import io
import json
import sys
from datetime import datetime, timedelta

import baostock as bs


def normalize_code(raw_code: str) -> str:
    code = str(raw_code).strip().lower().replace("sh.", "").replace("sz.", "")
    market = "sh" if code.startswith(("6", "9")) or code.startswith("688") else "sz"
    return f"{market}.{code}"


def fetch_history(code: str, days: int = 120):
    full_code = normalize_code(code)
    start_date = (datetime.now() - timedelta(days=days * 2)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")

    with contextlib.redirect_stdout(io.StringIO()):
      login = bs.login()
    if login.error_code != "0":
      raise RuntimeError(f"BaoStock login failed: {login.error_msg}")

    try:
      rs = bs.query_history_k_data_plus(
          full_code,
          "date,open,high,low,close,volume",
          start_date=start_date,
          end_date=end_date,
          frequency="d",
          adjustflag="2",
      )
      if rs.error_code != "0":
        raise RuntimeError(f"BaoStock history query failed: {rs.error_msg}")

      rows = []
      while rs.next():
        date, open_, high, low, close, volume = rs.get_row_data()
        if not close:
          continue
        rows.append(
            {
                "date": date,
                "open": float(open_),
                "high": float(high),
                "low": float(low),
                "close": float(close),
                "volume": float(volume),
            }
        )

      rows = rows[-days:]
      payload = {
          "code": code,
          "bars": rows,
      }
      json.dump(payload, sys.stdout, ensure_ascii=False)
    finally:
      with contextlib.redirect_stdout(io.StringIO()):
        bs.logout()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: python fetch_stock_history.py <code> [days]")

    fetch_history(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 120)
