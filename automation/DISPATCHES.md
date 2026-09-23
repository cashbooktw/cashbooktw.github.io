# Newspaper presentation and live dispatches

## Presentation

`index.html` loads the existing, unchanged `assets/js/app.js` edition reader and the new `assets/js/press.js` presentation layer. `assets/css/press.css` supplies the active newspaper stylesheet. The old reader, validators, Facebook/ChatGPT channel contracts, original article text, image references and historical edition files are preserved.

The masthead retains The Daily Signal branding, with blackletter/display typography, parchment colouring, ink rules and typographic seals. The removed header phrases are not replaced with new promotional copy. Fonts are requested from Google Fonts (UnifrakturMaguntia, Pirata One and Noto Serif TC), with local serif fallbacks; font files are not stored in this repository. Paper texture is CSS, not a generated illustration.

The page uses the available desktop width. A measured CSS grid uses four columns at 1650px+, three at 1100px+, two at 700px+, and one below 700px. The first article spans two columns when space permits. ResizeObserver remeasures articles after font/image loading and opening original-text details; CSS columns provide a fallback. Photos alternate left, right and above text, retain their original aspect ratio and use a monochrome print treatment. Hovering a photo restores its original colour. Failed images remain hidden by the existing reader. Article summaries use large initial letters.

Original source links are moved into the article's top metadata after its timestamp. Repeated timestamps are compared as instants, so equivalent timezone representations are also deduplicated. A genuinely different source time is retained. Rendering uses DOM nodes/textContent, never untrusted HTML. Filtering and changing editions reapply the presentation automatically.

## Four dispatch columns

| Column | Data | Source |
| --- | --- | --- |
| Taiwan | TAIEX close, point change, percentage change, actual trading date | TWSE FMTQIK monthly historical data |
| United States | S&P 500, NASDAQ Composite and Dow Jones Industrial Average closes and percentage changes | Yahoo Finance daily chart data |
| Currency | TWD per USD, inverse USD per TWD, actual reference-rate date | Frankfurter v2 USD/TWD |
| Hsinchu | Daily weather icon, minimum/maximum Celsius temperature, expected daily precipitation in mm | Open-Meteo ECMWF IFS 0.25° |

Market selection is before today's Asia/Taipei calendar date, using the latest available completed trading session. Weekends, holidays and provider delays are not relabelled as yesterday: the actual source trading date is always displayed. US bars from the current New York day are excluded until 16:15 New York time. Quotes are reference closes, not real-time trading quotes. FX is a daily reference rate, not a bank cash/spot buy/sell quote.

Hsinchu coordinates are 24.8039, 120.9647. The weather request fixes `models=ecmwf_ifs025`, `timezone=Asia/Taipei` and `forecast_days=1`, and requests `weather_code`, `temperature_2m_min`, `temperature_2m_max` and `precipitation_sum`. Rain is a forecast accumulation, not a rain probability or an observed station total. WMO weather codes choose the icon. Forecasts must match today's Taipei date; yesterday's forecast is never shown as today's.

The dispatch board is a current-day utility independent of the selected archive edition. Each card includes its source link and data date. Missing/invalid values are not converted to zero. Fetch failures retain a dated, labelled fallback when available; otherwise the card says that data is unavailable. A failed card does not block the article reader.

## Refreshing

`.github/workflows/dispatches.yml` runs at 07:17 and 09:17 Asia/Taipei (23:17 and 01:17 UTC), on a relevant script/workflow change, and via workflow_dispatch. GitHub's scheduled delivery may be delayed. It tests the pure parsers, then runs `python scripts/update_dispatches.py` and commits only `data/dispatches.json`. No secret/API key is required. Permissions are limited to repository contents writes. Rebase/push retries protect concurrent updates to the separate article channels.

The browser reads the market snapshot from this repository's public raw master URL, so a bot-created data commit does not depend on a new Pages rebuild. Same-origin JSON and localStorage are fallbacks. FX and weather are also fetched directly in the browser. Weather is cached for 30 minutes; visible pages refresh every 30 minutes and refresh after returning from a sufficiently long background period. A failed weather refresh can use only a same-day forecast cache.

External connections are explicitly allowed in CSP only for Open-Meteo, Frankfurter, raw.githubusercontent.com and the Google Fonts CSS/font hosts, in addition to the existing HTTPS article-image policy. No public CORS proxy, credentials or tracking script is added.

## Sources and maintenance

- TWSE: https://www.twse.com.tw/zh/trading/historical/fmtqik.html
- Yahoo Finance: https://finance.yahoo.com/markets/world-indices/
- Frankfurter: https://frankfurter.dev/
- ECMWF API documentation: https://open-meteo.com/en/docs/ecmwf-api
- Daily forecast variables: https://open-meteo.com/en/docs

Public provider availability and response formats can change. `data/dispatches.json.errors` records per-source failures; the Actions log also prints warnings. Preserve source dates when handling delayed responses. The free Open-Meteo endpoint is intended for non-commercial use; review its current terms before changing the site's usage.

Run the new dependency-free checks with:

```sh
node --test tests/press.test.cjs
node --check assets/js/press.js
python -m unittest discover -s tests -p 'test_dispatches.py'
```

During this redesign, the 12 new unit tests passed. A local Chromium presentation test using representative article markup and mock API responses also checked 320, 390, 699, 768, 1024, 1440 and 1920px: no horizontal overflow or overlapping articles; one publication timestamp; source link following the timestamp; drop caps; original-text expansion; failed-image hiding; result replacement. That local visual test used font fallbacks and did not verify production network requests or replace the existing edition-contract test suite.
