# trading# Valuatio — Stock Valuation Engine
#
#
# RUN npx serve IN TERMINAL TO START

# finhub API key - d81s03pr01qrojfcvpk0d81s03pr01qrojfcvpkg
# Twelvedata API key - 18d6c9a83f2b468b8a1ebfa35bfd415c
# Financial modeling prep API key - e5Nh6Nn6JpHxCLwsJ0FNxSqzdhm8IMUI
# Alpha Vantage API key - PY1T9VFQ9IHDYZVN
# Polygon.io/massive.com API - NrBO5YBcpFABm3z1fhXIZpsE3wbtip3p
# FCS API Key (global coverage + logos) - YNwTPgvkb9JRtGMtFgLLgsvnam

# For docs sheet make sure to add /pubhtml to end of url

# Github data  
# https://raw.githubusercontent.com/GoodGlobeLLC/TRAPP2/main/data/master.csv
# https://raw.githubusercontent.com/GoodGlobeLLC/TRAPP2/main/data/history_manifest.json
# Fred API - 34ced78df6314449696c7b991978bdef

# Equities Data
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 



# ETFs 
# published sheets link -



# Leveraged ETFs
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 
# published sheets link - 














# Valuatio

Browser-based stock valuation + macro regime tool. Two tabs: **Valuation** (DCF / CAPM / Multiples / Monte Carlo) and **Macro Quad** (Hedgeye-style GIP from FRED).

## Run it

Drop `index.html` and `app.js` in a folder. Open `index.html` (or `npx serve` for a local URL).

## Data sources

Click **Data Sources** in the toolbar. You have three options:

- **Google Sheet** (paste a published-CSV URL) — your sheet's GOOGLEFINANCE values become live data
- **Alpha Vantage key** (free, 25 calls/day) — for full financial statements
- **Stooq + Yahoo only** (no setup) — works out of the box for prices

Source preference: **Auto** uses sheet if present else AV. **Sheet First** always prefers the sheet. **Alpha Vantage** ignores the sheet.

### Setting up the Google Sheet

In Sheets: **File → Share → Publish to web → pick the sheet → CSV → Publish**. Paste that URL into Data Sources → Test Connection.

Sheet columns are looked up by header name (case-insensitive). Recognized: `Ticker`, `Price`, `Market Cap`, `Shares`, `EPS`, `Beta`, `P/E`, `Revenue`, `FCF`, `EBITDA`, `Debt`, `Cash`, `EV/EBITDA`, `Operating Margin`, `Dividend Yield`, `Sector`, `Name`. Values can use `$1.5B`, `(2.5M)` for negatives, `31.5%`, etc.

## Macro tab

Pulls Real GDP and CPI from FRED — no key, no rate limit. Computes Quad from rate-of-change, shows ETF performance, lists representative stocks per sector (click → values them).

## Disclaimer

Educational tool, not financial advice.
