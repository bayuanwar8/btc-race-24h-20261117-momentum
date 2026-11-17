// BOT C — EMA Momentum + ADX (cbBTC, 1 menit, long only).
//
// Idenya: ikut tren hanya kalau trennya BENAR-BENAR kuat, lalu keluar cepat
// sebelum tren berbalik. Tiga saringan sebelum masuk, supaya tidak termakan
// chop/sideways yang menghabiskan fee di tiap round trip (~37 bps sekali jalan
// penuh di window ini):
//   1. EMA(5) cross ke atas EMA(21) — momentum jangka pendek berbalik naik.
//   2. Gap EMA saat cross harus > 8 bps dari harga — cross yang cuma
//      bersentuhan tipis (whipsaw) ditolak; cuma cross yang tegas yang dihitung.
//   3. ADX(14) > 20 — trennya terkonfirmasi kuat (Wilder). Tanpa ini, bot masuk
//      di tiap pantulan kecil saat market datar.
// Keluar (jual seluruh posisi) kalau salah satu terjadi:
//   - EMA(5) jatuh lagi di bawah EMA(21) (tren selesai), ATAU
//   - Trailing stop: close turun 0,5% dari high tertinggi sejak entry, ATAU
//   - Take profit: nilai posisi >= 1,25% di atas cost (termasuk fee).
// Satu posisi terbuka saja, 100% cash per entry. Semua hitungan float64 murni
// dari bar yang masuk — tanpa jam, tanpa environment, tanpa Math.random —
// jadi dua run di data yang sama menghasilkan order yang sama persis.
//
// Parameter di atas hasil tuning backtest di dev window (1.440 bar):
// EMA(8)/EMA(21) tanpa saringan gap GAGAL gate (11 trade whipsaw, -$30,54,
// atau 0 trade kalau gap disaring); EMA(5)/EMA(21) + gap 8 bps + ADX>20
// lolos dengan 1 trade bersih. Lihat README untuk angka lengkapnya.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// --- Parameter strategi (hasil tuning backtest) ---
const FAST_SPAN = 5;
const SLOW_SPAN = 21;
const ADX_PERIOD = 14;
const ADX_MIN = 20;
const GAP_MIN_BPS = 8;
const TAKE_PROFIT_NUM = 10125n; // nilai posisi >= cost * 10125 / 10000 (+1,25%)
const TAKE_PROFIT_DEN = 10000n;
const TRAIL_BPS = 50; // 0,5% di bawah high sejak entry
const MAX_SLIPPAGE_BPS = 100;

// --- EMA: seed = rata-rata span close pertama, lalu k = 2 / (span + 1) ---
class Ema {
  readonly span: number;
  private warm: number[] = [];
  value: number | null = null;

  constructor(span: number) {
    this.span = span;
  }

  push(close: number): void {
    if (this.value !== null) {
      this.value += (2 / (this.span + 1)) * (close - this.value);
      return;
    }
    this.warm.push(close);
    if (this.warm.length === this.span) {
      this.value = this.warm.reduce((a, x) => a + x, 0) / this.span;
    }
  }
}

// --- ADX Wilder: TR / +DM / -DM di-smoothing Wilder, lalu DX di-smoothing ---
class Adx {
  readonly period: number;
  private diffs = 0;
  private sumTr = 0;
  private sumPlus = 0;
  private sumMinus = 0;
  private str: number | null = null;
  private splus: number | null = null;
  private sminus: number | null = null;
  private dxWarm: number[] = [];
  value: number | null = null;

  constructor(period: number) {
    this.period = period;
  }

  push(high: number, low: number, prevHigh: number | null, prevLow: number | null, prevClose: number | null): void {
    if (prevHigh === null || prevLow === null || prevClose === null) return;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    const up = high - prevHigh;
    const down = prevLow - low;
    const plus = up > down && up > 0 ? up : 0;
    const minus = down > up && down > 0 ? down : 0;
    this.diffs += 1;
    if (this.str === null) {
      this.sumTr += tr;
      this.sumPlus += plus;
      this.sumMinus += minus;
      if (this.diffs === this.period) {
        this.str = this.sumTr;
        this.splus = this.sumPlus;
        this.sminus = this.sumMinus;
      }
      return;
    }
    this.str = this.str - this.str / this.period + tr;
    this.splus = this.splus! - this.splus! / this.period + plus;
    this.sminus = this.sminus! - this.sminus! / this.period + minus;
    const trS = this.str;
    if (trS === 0) {
      this.noteDx(0);
      return;
    }
    const pdi = (100 * this.splus!) / trS;
    const mdi = (100 * this.sminus!) / trS;
    const denom = pdi + mdi;
    this.noteDx(denom > 0 ? (100 * Math.abs(pdi - mdi)) / denom : 0);
  }

  private noteDx(dx: number): void {
    if (this.value !== null) {
      this.value = (this.value * (this.period - 1) + dx) / this.period;
      return;
    }
    this.dxWarm.push(dx);
    if (this.dxWarm.length === this.period) {
      this.value = this.dxWarm.reduce((a, x) => a + x, 0) / this.period;
    }
  }
}

// --- State tren per simbol: EMA cepat/lambat, ADX, gap sebelumnya, high entry ---
class Trend {
  fast = new Ema(FAST_SPAN);
  slow = new Ema(SLOW_SPAN);
  adx = new Adx(ADX_PERIOD);
  /** EMA(cepat) - EMA(lambat) di bar sebelumnya, null kalau belum ada. */
  prevGap: number | null = null;
  /** High (close) tertinggi sejak posisi dibuka; null kalau belum pegang. */
  entryHigh: number | null = null;
  private prevBar: Bar | null = null;

  push(bar: Bar): number | null {
    const close = Number(bar.c);
    this.fast.push(close);
    this.slow.push(close);
    const p = this.prevBar;
    this.adx.push(Number(bar.h), Number(bar.l), p === null ? null : Number(p.h), p === null ? null : Number(p.l), p === null ? null : Number(p.c));
    this.prevBar = bar;
    const gap = this.fast.value !== null && this.slow.value !== null ? this.fast.value - this.slow.value : null;
    const prev = this.prevGap;
    this.prevGap = gap;
    return prev;
  }
}

const trends = new Map<string, Trend>();

function trendOf(symbol: string): Trend {
  let t = trends.get(symbol);
  if (t === undefined) {
    t = new Trend();
    trends.set(symbol, t);
  }
  return t;
}

await runBars({
  onBatch(state, batch) {
    const seen = new Set<string>();
    const prevGaps = new Map<string, number | null>();
    for (const bar of batch.bars) {
      seen.add(bar.symbol);
      prevGaps.set(bar.symbol, trendOf(bar.symbol).push(bar));
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const orders: (SellInput | BuyInput)[] = [];

    for (const { symbol } of state.hello.symbols) {
      if (!seen.has(symbol)) continue;
      const t = trendOf(symbol);
      const close = Number(state.close(symbol));
      const held = state.positions.get(symbol);
      if (held === undefined) {
        // Posisi sudah tidak ada (terjual / flatten): high entry direset.
        t.entryHigh = null;
      }
      const fast = t.fast.value;
      const slow = t.slow.value;
      if (fast === null || slow === null) continue;
      const gapNow = fast - slow;
      const gapPrev = prevGaps.get(symbol) ?? null;

      if (held !== undefined) {
        // Lacak high sejak entry dari close (diisi saat posisi pertama terlihat).
        t.entryHigh = t.entryHigh === null ? close : Math.max(t.entryHigh, close);
        const value = state.value(symbol, held.qty);
        const trendOver = gapNow < 0;
        const trailHit = close <= t.entryHigh * (1 - TRAIL_BPS / 10000);
        const tpHit = value * TAKE_PROFIT_DEN >= held.cost * TAKE_PROFIT_NUM;
        if (trendOver || trailHit || tpHit) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else {
        const crossUp = gapPrev !== null && gapNow > 0 && gapPrev <= 0;
        const gapStrong = gapNow > (close * GAP_MIN_BPS) / 10000;
        const adxStrong = t.adx.value !== null && t.adx.value > ADX_MIN;
        if (crossUp && gapStrong && adxStrong) {
          const room = state.weightRoom(symbol);
          let notional = state.cash < room ? state.cash : room;
          if (notional >= BigInt(fees.min_notional_quote_units)) {
            orders.push({ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS });
          }
        }
      }
    }

    return orders.slice(0, caps.max_orders_per_bar);
  },
});
