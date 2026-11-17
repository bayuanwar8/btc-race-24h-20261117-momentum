# btc-race-24h-20261117-momentum

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/bayuanwar8/btc-race-24h-20261117-momentum/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/bayuanwar8/btc-race-24h-20261117-momentum/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

EMA Momentum + ADX — a cbBTC trend bot for make.fun's "Race a BTC trading bot live for 24 hours". Long only, one position at a time, 100% of cash per entry. It only rides a trend when the trend is proven strong: EMA(5) must cross above EMA(21) with a gap wider than 8 bps (so hairline whipsaw crosses are ignored) AND ADX(14) must read above 20 (Wilder trend-strength confirmation, so it stays out of chop). It exits on the first of three: EMA(5) falling back below EMA(21), a 0.5% trailing stop from the highest close since entry, or a +1.25% take-profit on cost. No clock, no randomness, no network — every run on the same bars produces the same orders.

Backtest on the published dev window (1,440 one-minute bars, 2026-11-16 06:03 UTC – 2026-11-17 06:03 UTC, exact harness fill model: 4 bps fee + 2 bps slippage + constant-product impact vs open depth): **net PnL +$10.93 USDC, 1 trade, max drawdown 0.38%** — passes the dev gate (PnL > 0). The single trade caught the sharp rally at bar 491–514 (+1.6% in ~23 minutes). Tuning notes: plain EMA(8)/EMA(21) without the gap filter fails the gate on this window (11 whipsaw trades, −$30.54); the gap + ADX filters are what keep it to one clean trade.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=psxszbrd&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
