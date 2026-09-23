"""Refresh public daily market data; never replace missing values with invented quotes.

Only data/dispatches.json is written. Article channels and historical editions are
not touched. All prices retain their actual exchange-local trading date.
"""
from __future__ import annotations
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TAIPEI = ZoneInfo('Asia/Taipei')
NEW_YORK = ZoneInfo('America/New_York')


def get_json(url: str):
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; DailySignal/1.0)', 'Accept': 'application/json'})
    with urlopen(request, timeout=25) as response:
        return json.load(response)


def numeric(value) -> float:
    if isinstance(value, bool) or value is None:
        raise ValueError('missing numeric value')
    result = float(str(value).replace(',', '').replace('−', '-').replace('＋', '+').strip())
    if not math.isfinite(result):
        raise ValueError('non-finite value')
    return result


def market_quote(value: float, previous: float, trading_date: date) -> dict:
    if value <= 0 or previous <= 0:
        raise ValueError('invalid index level')
    return {'date': trading_date.isoformat(), 'close': round(value, 4),
            'change': round(value - previous, 4), 'change_pct': round((value / previous - 1) * 100, 4)}


def twse_quote(payload: dict, cutoff: date) -> dict:
    rows = []
    for row in payload.get('data', []):
        try:
            y, m, d = map(int, row[0].split('/'))
            trading_date = date(y + 1911 if y < 1911 else y, m, d)
            close, change = numeric(row[4]), numeric(row[5])
            if trading_date < cutoff:
                rows.append(market_quote(close, close - change, trading_date))
        except (ValueError, TypeError, IndexError):
            continue
    if not rows:
        raise ValueError('no completed TWSE trading day before cutoff')
    return max(rows, key=lambda row: row['date'])


def get_taiwan(now: datetime) -> dict:
    cutoff = now.astimezone(TAIPEI).date()
    month = (cutoff - timedelta(days=1)).replace(day=1)
    for _ in range(3):
        url = 'https://www.twse.com.tw/exchangeReport/FMTQIK?' + urlencode({'response': 'json', 'date': month.strftime('%Y%m%d')})
        payload = get_json(url)
        try:
            result = twse_quote(payload, cutoff)
            result['source'] = 'TWSE'
            return result
        except ValueError:
            month = (month - timedelta(days=1)).replace(day=1)
    raise ValueError('no available TWSE close in the last three months')


def yahoo_quote(payload: dict, now: datetime) -> dict:
    chart = payload.get('chart', {})
    if chart.get('error') or not chart.get('result'):
        raise ValueError('Yahoo Finance returned no chart')
    result = chart['result'][0]
    values = result.get('indicators', {}).get('quote', [{}])[0].get('close', [])
    cutoff = now.astimezone(TAIPEI).date()
    ny_now = now.astimezone(NEW_YORK)
    rows = {}
    for stamp, value in zip(result.get('timestamp', []), values):
        if value is None:
            continue
        trading_date = datetime.fromtimestamp(stamp, NEW_YORK).date()
        # Daily chart responses can contain a still-trading bar. Never call it a close.
        if trading_date >= cutoff or trading_date > ny_now.date():
            continue
        if trading_date == ny_now.date() and ny_now.time() < time(16, 15):
            continue
        close = numeric(value)
        if close > 0:
            rows[trading_date] = close
    dates = sorted(rows)
    if len(dates) < 2:
        raise ValueError('fewer than two completed US trading days')
    result = market_quote(rows[dates[-1]], rows[dates[-2]], dates[-1])
    result['source'] = 'Yahoo Finance'
    return result


def get_us(symbol: str, now: datetime) -> dict:
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + quote(symbol, safe='')
    return yahoo_quote(get_json(url + '?' + urlencode({'range': '3mo', 'interval': '1d', 'includePrePost': 'false'})), now)


def fx_quote(payload: dict, cutoff: date) -> dict:
    if payload.get('base', '').upper() != 'USD' or payload.get('quote', '').upper() != 'TWD':
        raise ValueError('unexpected currency pair')
    rate = numeric(payload.get('rate'))
    published = date.fromisoformat(payload['date'])
    if rate <= 0 or published > cutoff:
        raise ValueError('invalid FX rate or date')
    return {'base': 'USD', 'quote': 'TWD', 'date': published.isoformat(), 'rate': rate, 'source': 'Frankfurter'}


def refresh(now: datetime, previous: dict | None = None) -> dict:
    previous = previous or {}
    result = {'schema_version': 1, 'date': now.astimezone(TAIPEI).date().isoformat(),
              'generated_at': now.astimezone(timezone.utc).isoformat(),
              'quotes': dict(previous.get('quotes', {})), 'fx': previous.get('fx'), 'errors': {}}
    jobs = {'tw': lambda: get_taiwan(now), 'sp500': lambda: get_us('^GSPC', now),
            'nasdaq': lambda: get_us('^IXIC', now), 'dow': lambda: get_us('^DJI', now),
            'fx': lambda: fx_quote(get_json('https://api.frankfurter.dev/v2/rate/USD/TWD'), now.astimezone(TAIPEI).date())}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {key: pool.submit(fn) for key, fn in jobs.items()}
        for key, future in futures.items():
            try:
                value = future.result()
                if key == 'fx':
                    result['fx'] = value
                else:
                    result['quotes'][key] = value
            except Exception as exc:
                result['errors'][key] = f'{type(exc).__name__}: {exc}'[:240]
                print(f'::warning title=Dispatch {key}::{result["errors"][key]}')
    return result


def main() -> None:
    path = ROOT / 'data' / 'dispatches.json'
    try:
        previous = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        previous = {}
    data = refresh(datetime.now(timezone.utc), previous)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    os.replace(temporary, path)
    print(f'Dispatch date {data["date"]}; {len(data["quotes"])} retained/updated indices; {len(data["errors"])} source errors')


if __name__ == '__main__':
    main()
