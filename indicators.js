/**
 * indicators.js
 * -----------------------------------------------------------------------
 * Standard, publicly-documented technical analysis methods only.
 * Every number/pattern this file produces is shown to the user with the
 * reasoning behind it - nothing hidden, no invented confidence score,
 * and no method here claims a guaranteed outcome.
 *
 * Works in both the browser (extension) and Node (backend server) since
 * it has no external dependencies.
 * -----------------------------------------------------------------------
 * candles format expected everywhere below:
 *   [{ time, open, high, low, close }, ...]  oldest -> newest
 */

function closes(candles) {
  return candles.map((c) => c.close);
}

// Simple Moving Average
function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// Exponential Moving Average (returns full array aligned to input)
function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prevEma = sma(values.slice(0, period), period);
  out[period - 1] = prevEma;
  for (let i = period; i < values.length; i++) {
    prevEma = values[i] * k + prevEma * (1 - k);
    out[i] = prevEma;
  }
  return out;
}

function ema(values, period) {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

// RSI (Wilder's smoothing, standard 14-period default)
function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// MACD (12, 26, 9 standard settings)
function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (values.length < slow + signalPeriod) return null;

  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);

  const macdLine = [];
  for (let i = 0; i < values.length; i++) {
    if (fastSeries[i] !== undefined && slowSeries[i] !== undefined) {
      macdLine[i] = fastSeries[i] - slowSeries[i];
    }
  }

  const macdValues = macdLine.filter((v) => v !== undefined);
  const signalSeries = emaSeries(macdValues, signalPeriod);
  const signalLine = signalSeries[signalSeries.length - 1];
  const macdVal = macdValues[macdValues.length - 1];
  const prevMacdVal = macdValues[macdValues.length - 2];
  const prevSignalSeries = signalSeries[signalSeries.length - 2];

  return {
    macd: macdVal,
    signal: signalLine,
    histogram: macdVal - signalLine,
    prevMacd: prevMacdVal,
    prevSignal: prevSignalSeries,
  };
}

// Bollinger Bands (20-period, 2 standard deviations - standard defaults)
function bollingerBands(values, period = 20, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + mult * stdDev,
    middle: mean,
    lower: mean - mult * stdDev,
  };
}

// ---------------------------------------------------------------------
// Trend Following: EMA 20 vs EMA 50
// ---------------------------------------------------------------------
function trendFollowing(values) {
  const ema20 = ema(values, 20);
  const ema50 = ema(values, 50);
  if (ema20 === null || ema50 === null) return null;
  const bias = ema20 > ema50 ? "bullish" : ema20 < ema50 ? "bearish" : null;
  return { ema20, ema50, bias };
}

// ---------------------------------------------------------------------
// Support & Resistance: find recent swing highs/lows (simple pivot
// method) and check whether price is currently sitting near one.
// ---------------------------------------------------------------------
function findPivots(candles, wing = 3) {
  const highs = [];
  const lows = [];
  for (let i = wing; i < candles.length - wing; i++) {
    const windowSlice = candles.slice(i - wing, i + wing + 1);
    const isHigh = windowSlice.every((c) => candles[i].high >= c.high);
    const isLow = windowSlice.every((c) => candles[i].low <= c.low);
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

function supportResistance(candles, lookback = 40, wing = 3, proximityPct = 0.05) {
  if (candles.length < lookback) return null;
  const recent = candles.slice(candles.length - lookback);
  const { highs, lows } = findPivots(recent, wing);
  const lastClose = recent[recent.length - 1].close;
  if (highs.length === 0 && lows.length === 0) return null;

  const nearestResistance = highs.length
    ? highs.reduce((a, b) => (Math.abs(b - lastClose) < Math.abs(a - lastClose) ? b : a))
    : null;
  const nearestSupport = lows.length
    ? lows.reduce((a, b) => (Math.abs(b - lastClose) < Math.abs(a - lastClose) ? b : a))
    : null;

  const pctDiffResistance =
    nearestResistance !== null ? (Math.abs(nearestResistance - lastClose) / lastClose) * 100 : null;
  const pctDiffSupport =
    nearestSupport !== null ? (Math.abs(nearestSupport - lastClose) / lastClose) * 100 : null;

  let bias = null;
  let level = null;
  let zone = null;

  if (pctDiffSupport !== null && pctDiffSupport <= proximityPct &&
      (pctDiffResistance === null || pctDiffSupport <= pctDiffResistance)) {
    bias = "bullish"; // price sitting near support -> possible bounce up
    level = nearestSupport;
    zone = "support";
  } else if (pctDiffResistance !== null && pctDiffResistance <= proximityPct) {
    bias = "bearish"; // price sitting near resistance -> possible rejection down
    level = nearestResistance;
    zone = "resistance";
  }

  return { nearestSupport, nearestResistance, bias, level, zone };
}

// ---------------------------------------------------------------------
// Candlestick patterns: engulfing, doji, hammer, shooting star
// (last 2 candles only - standard textbook definitions)
// ---------------------------------------------------------------------
function detectCandlestickPattern(candles) {
  if (candles.length < 3) return null;
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];

  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  const currRange = curr.high - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;

  // Bullish engulfing
  if (
    prev.close < prev.open &&
    curr.close > curr.open &&
    curr.close >= prev.open &&
    curr.open <= prev.close
  ) {
    return { pattern: "Bullish Engulfing", bias: "bullish" };
  }

  // Bearish engulfing
  if (
    prev.close > prev.open &&
    curr.close < curr.open &&
    curr.open >= prev.close &&
    curr.close <= prev.open
  ) {
    return { pattern: "Bearish Engulfing", bias: "bearish" };
  }

  // Doji - body is a tiny fraction of the full range -> indecision, no bias
  if (currRange > 0 && currBody / currRange < 0.1) {
    return { pattern: "Doji", bias: null };
  }

  // Hammer - small body near the top, long lower wick, little/no upper wick
  if (
    currRange > 0 &&
    lowerWick > currBody * 2 &&
    upperWick < currBody &&
    curr.close < candles[candles.length - 3].close // came after a decline
  ) {
    return { pattern: "Hammer", bias: "bullish" };
  }

  // Shooting star - small body near the bottom, long upper wick
  if (
    currRange > 0 &&
    upperWick > currBody * 2 &&
    lowerWick < currBody &&
    curr.close > candles[candles.length - 3].close // came after a rise
  ) {
    return { pattern: "Shooting Star", bias: "bearish" };
  }

  return { pattern: "None", bias: null };
}

// ---------------------------------------------------------------------
// Pin Bar / Price Action - pure wick-vs-body rejection read, no indicator
// ---------------------------------------------------------------------
function pinBarSignal(candles) {
  if (candles.length < 1) return null;
  const curr = candles[candles.length - 1];
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  if (range === 0) return null;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;

  if (lowerWick >= range * 0.6 && body <= range * 0.3) {
    return { pattern: "Bullish Pin Bar", bias: "bullish" };
  }
  if (upperWick >= range * 0.6 && body <= range * 0.3) {
    return { pattern: "Bearish Pin Bar", bias: "bearish" };
  }
  return { pattern: "No pin bar", bias: null };
}

// ---------------------------------------------------------------------
// Volatility spike (simplified ATR) - informational only, used to flag
// a possible Straddle setup. Straddle means betting BOTH directions, so
// it deliberately does NOT get folded into the CALL/PUT vote below.
// ---------------------------------------------------------------------
function volatilitySpike(candles, period = 14, spikeMultiple = 1.6) {
  if (candles.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trueRanges.push(tr);
  }
  const recentTR = trueRanges.slice(-period);
  const atr = recentTR.reduce((a, b) => a + b, 0) / period;
  const lastTR = trueRanges[trueRanges.length - 1];
  const isSpike = atr > 0 && lastTR > atr * spikeMultiple;
  return { atr, lastTR, isSpike };
}

/**
 * Combine every method above into a transparent, rule-based bias.
 * Every signal that fired is listed in `reasons` with its real value -
 * no hidden weighting, no fabricated confidence score. Straddle is
 * reported separately as an advisory, since it is a both-directions
 * approach and can't honestly be folded into a single CALL/PUT vote.
 */

// ---------------------------------------------------------------------
// Additional confluence methods: Stochastic, CCI, Momentum, ADX and
// simple breakout/retest. These are transparent confirmation methods;
// none claims to predict the next candle with certainty.
// ---------------------------------------------------------------------
function stochastic(candles, kPeriod = 14, smooth = 3) {
  if (candles.length < kPeriod + smooth - 1) return null;
  const ks = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const win = candles.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...win.map(c => c.high));
    const lo = Math.min(...win.map(c => c.low));
    const range = hi - lo;
    ks.push(range === 0 ? 50 : ((candles[i].close - lo) / range) * 100);
  }
  const k = ks[ks.length - 1];
  const d = ks.slice(-smooth).reduce((a,b)=>a+b,0) / Math.min(smooth, ks.length);
  const prevK = ks.length > 1 ? ks[ks.length - 2] : k;
  return { k, d, prevK };
}

function cci(candles, period = 20) {
  if (candles.length < period) return null;
  const tp = candles.map(c => (c.high + c.low + c.close) / 3);
  const slice = tp.slice(-period);
  const mean = slice.reduce((a,b)=>a+b,0) / period;
  const md = slice.reduce((a,b)=>a+Math.abs(b-mean),0) / period;
  if (md === 0) return { value: 0 };
  return { value: (tp[tp.length-1] - mean) / (0.015 * md) };
}

function momentum(values, period = 10) {
  if (values.length <= period) return null;
  const last = values[values.length - 1];
  const prev = values[values.length - 1 - period];
  return { value: last - prev, bullish: last > prev, bearish: last < prev };
}

function adx(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;
  const trs = [], plusDM = [], minusDM = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i-1];
    const up = c.high - p.high;
    const down = p.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    trs.push(Math.max(c.high-c.low, Math.abs(c.high-p.close), Math.abs(c.low-p.close)));
  }
  let atr = trs.slice(0, period).reduce((a,b)=>a+b,0) / period;
  let pDM = plusDM.slice(0, period).reduce((a,b)=>a+b,0) / period;
  let mDM = minusDM.slice(0, period).reduce((a,b)=>a+b,0) / period;
  const dx = [];
  for (let i=period; i<trs.length; i++) {
    atr = (atr*(period-1)+trs[i]) / period;
    pDM = (pDM*(period-1)+plusDM[i]) / period;
    mDM = (mDM*(period-1)+minusDM[i]) / period;
    const pdi = atr ? 100*pDM/atr : 0;
    const mdi = atr ? 100*mDM/atr : 0;
    const sum = pdi+mdi;
    dx.push(sum ? 100*Math.abs(pdi-mdi)/sum : 0);
  }
  if (dx.length < period) return null;
  let value = dx.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i=period; i<dx.length; i++) value = (value*(period-1)+dx[i])/period;
  const lastTR = trs[trs.length-1] || 0;
  const lastUp = plusDM[plusDM.length-1] || 0;
  const lastDown = minusDM[minusDM.length-1] || 0;
  return { value, bullish: lastUp > lastDown, bearish: lastDown > lastUp, atr };
}

function breakout(candles, lookback = 20) {
  if (candles.length < lookback + 1) return null;
  const prior = candles.slice(-lookback - 1, -1);
  const last = candles[candles.length - 1];
  const high = Math.max(...prior.map(c=>c.high));
  const low = Math.min(...prior.map(c=>c.low));
  if (last.close > high) return { bias: 'bullish', level: high, type: 'upside breakout' };
  if (last.close < low) return { bias: 'bearish', level: low, type: 'downside breakout' };
  return { bias: null, level: null, type: 'inside range' };
}

function evaluateSignal(candles, options = {}) {
  const defaultConfig = require("./strategy-config");
  const cfg = {
    ...defaultConfig,
    ...options,
    enabledStrategies: {
      ...defaultConfig.enabledStrategies,
      ...(options.enabledStrategies || {}),
    },
  };
  const strategyEnabled = (name) => cfg.enabledStrategies[name] !== false;
  const closeValues = closes(candles);
  const lastClose = closeValues[closeValues.length - 1];

  const rsiVal = rsi(closeValues, 14);
  const macdVal = macd(closeValues, 12, 26, 9);
  const maFast = sma(closeValues, 10);
  const maSlow = sma(closeValues, 30);
  const bb = bollingerBands(closeValues, 20, 2);
  const trend = trendFollowing(closeValues);
  const sr = supportResistance(candles);
  const pattern = detectCandlestickPattern(candles);
  const pinBar = pinBarSignal(candles);
  const vol = volatilitySpike(candles);
  const stoch = stochastic(candles);
  const cciVal = cci(candles);
  const mom = momentum(closeValues, 10);
  const adxVal = adx(candles);
  const bo = breakout(candles, 20);

  const coreReady =
    rsiVal !== null && macdVal !== null && maFast !== null &&
    maSlow !== null && bb !== null && lastClose !== undefined;

  if (!coreReady) {
    return {
      status: "DATA_UNAVAILABLE",
      decision: "WAIT",
      reasons: ["Not enough candle history yet to compute the core indicators."],
    };
  }

  const signals = []; // { name, bias: 'bullish'|'bearish'|null, detail }

  if (strategyEnabled("RSI") && rsiVal < 30) signals.push({ name: "RSI", bias: "bullish", detail: `RSI ${rsiVal.toFixed(1)} is oversold (< 30)` });
  else if (strategyEnabled("RSI") && rsiVal > 70) signals.push({ name: "RSI", bias: "bearish", detail: `RSI ${rsiVal.toFixed(1)} is overbought (> 70)` });

  const macdCrossedUp =
    macdVal.prevMacd !== undefined && macdVal.prevSignal !== undefined &&
    macdVal.prevMacd <= macdVal.prevSignal && macdVal.macd > macdVal.signal;
  const macdCrossedDown =
    macdVal.prevMacd !== undefined && macdVal.prevSignal !== undefined &&
    macdVal.prevMacd >= macdVal.prevSignal && macdVal.macd < macdVal.signal;
  if (strategyEnabled("MACD") && macdCrossedUp) signals.push({ name: "MACD", bias: "bullish", detail: "MACD line crossed above signal line" });
  else if (strategyEnabled("MACD") && macdCrossedDown) signals.push({ name: "MACD", bias: "bearish", detail: "MACD line crossed below signal line" });

  if (strategyEnabled("MA10/30") && maFast > maSlow) signals.push({ name: "MA10/30", bias: "bullish", detail: `MA(10) ${maFast.toFixed(4)} above MA(30) ${maSlow.toFixed(4)}` });
  else if (strategyEnabled("MA10/30") && maFast < maSlow) signals.push({ name: "MA10/30", bias: "bearish", detail: `MA(10) ${maFast.toFixed(4)} below MA(30) ${maSlow.toFixed(4)}` });

  if (strategyEnabled("Bollinger") && lastClose < bb.lower) signals.push({ name: "Bollinger", bias: "bullish", detail: `Price ${lastClose.toFixed(4)} below lower Bollinger Band ${bb.lower.toFixed(4)}` });
  else if (strategyEnabled("Bollinger") && lastClose > bb.upper) signals.push({ name: "Bollinger", bias: "bearish", detail: `Price ${lastClose.toFixed(4)} above upper Bollinger Band ${bb.upper.toFixed(4)}` });

  if (strategyEnabled("Trend (EMA 20/50)") && trend && trend.bias) {
    signals.push({
      name: "Trend (EMA 20/50)",
      bias: trend.bias,
      detail: `EMA20 ${trend.ema20.toFixed(4)} ${trend.bias === "bullish" ? "above" : "below"} EMA50 ${trend.ema50.toFixed(4)}`,
    });
  }

  if (strategyEnabled("Support/Resistance") && sr && sr.bias) {
    signals.push({
      name: "Support/Resistance",
      bias: sr.bias,
      detail: `Price near ${sr.zone} level ${sr.level.toFixed(4)} - possible ${sr.bias === "bullish" ? "bounce up" : "rejection down"}`,
    });
  }

  if (strategyEnabled("Candlestick") && pattern && pattern.bias) {
    signals.push({ name: "Candlestick", bias: pattern.bias, detail: `${pattern.pattern} pattern detected` });
  }

  if (strategyEnabled("Price Action") && pinBar && pinBar.bias) {
    signals.push({ name: "Price Action", bias: pinBar.bias, detail: `${pinBar.pattern} on last candle` });
  }

  // Additional strategy confirmations. These are intentionally independent
  // of the original set so a single indicator cannot dominate the result.
  if (strategyEnabled("Stochastic") && stoch) {
    if (stoch.k < 20 && stoch.k > stoch.prevK) signals.push({ name: "Stochastic", bias: "bullish", detail: `Stochastic %K ${stoch.k.toFixed(1)} rising from oversold` });
    else if (stoch.k > 80 && stoch.k < stoch.prevK) signals.push({ name: "Stochastic", bias: "bearish", detail: `Stochastic %K ${stoch.k.toFixed(1)} falling from overbought` });
  }
  if (strategyEnabled("CCI") && cciVal) {
    if (cciVal.value > 100) signals.push({ name: "CCI", bias: "bullish", detail: `CCI ${cciVal.value.toFixed(0)} above +100` });
    else if (cciVal.value < -100) signals.push({ name: "CCI", bias: "bearish", detail: `CCI ${cciVal.value.toFixed(0)} below -100` });
  }
  if (strategyEnabled("Momentum") && mom && Math.abs(mom.value) > 0) {
    signals.push({ name: "Momentum", bias: mom.bullish ? "bullish" : "bearish", detail: `10-candle momentum is ${mom.bullish ? "positive" : "negative"}` });
  }
  if (strategyEnabled("ADX") && adxVal && adxVal.value >= 20) {
    signals.push({ name: "ADX", bias: adxVal.bullish ? "bullish" : adxVal.bearish ? "bearish" : null, detail: `ADX ${adxVal.value.toFixed(1)} confirms ${adxVal.bullish ? "bullish" : adxVal.bearish ? "bearish" : "mixed"} directional pressure` });
  }
  if (strategyEnabled("Breakout") && bo && bo.bias) {
    signals.push({ name: "Breakout", bias: bo.bias, detail: `${bo.type} above/below the previous 20-candle range` });
  }

  const bullish = signals.filter((s) => s.bias === "bullish");
  const bearish = signals.filter((s) => s.bias === "bearish");
  const totalVotes = bullish.length + bearish.length;

  // Balanced signal mode: avoid staying in WAIT for long periods while still requiring
  // multiple independent confirmations. This is not a win-rate guarantee.
  const MIN_VOTES = Math.max(1, Number(cfg.minVotes) || 2);
  const MIN_MAJORITY = Math.min(0.99, Math.max(0.5, Number(cfg.minMajority) || 0.55));
  let decision = "WAIT";
  if (totalVotes >= MIN_VOTES) {
    if (bullish.length > bearish.length && bullish.length / totalVotes >= MIN_MAJORITY) decision = "CALL";
    else if (bearish.length > bullish.length && bearish.length / totalVotes >= MIN_MAJORITY) decision = "PUT";
  }

  const activeReasons =
    decision === "CALL" ? bullish : decision === "PUT" ? bearish : [...bullish, ...bearish];

  return {
    status: "OK",
    decision,
    indicators: {
      rsi: rsiVal,
      macd: macdVal,
      ma10: maFast,
      ma30: maSlow,
      bollinger: bb,
      trend,
      supportResistance: sr,
      candlestickPattern: pattern,
      pinBar,
      stochastic: stoch,
      cci: cciVal,
      momentum: mom,
      adx: adxVal,
      breakout: bo,
      lastClose,
    },
    volatility: vol
      ? {
          isSpike: vol.isSpike,
          note: vol.isSpike
            ? "Volatility spike detected - some traders use a Straddle (CALL + PUT together) here instead of picking one direction. This is a manual, higher-cost approach - not something this tool auto-executes."
            : null,
        }
      : null,
    reasons: activeReasons.length
      ? activeReasons.map((s) => s.detail)
      : ["No sufficient multi-strategy majority yet - waiting for stronger agreement."],
    agreeingSignals: decision === "CALL" ? bullish.length : decision === "PUT" ? bearish.length : 0,
    totalSignals: totalVotes,
    voteCount: {
      bullish: bullish.length,
      bearish: bearish.length,
      total: totalVotes,
      required: MIN_VOTES,
      majorityRequired: MIN_MAJORITY,
    },
    strategyConfig: {
      minVotes: MIN_VOTES,
      minMajority: MIN_MAJORITY,
      enabledStrategies: cfg.enabledStrategies,
    },
  };
}

// Support both browser (window) and Node (module.exports)
const IndicatorLib = {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  trendFollowing,
  supportResistance,
  detectCandlestickPattern,
  pinBarSignal,
  volatilitySpike,
  stochastic,
  cci,
  momentum,
  adx,
  breakout,
  evaluateSignal,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = IndicatorLib;
}
if (typeof window !== "undefined") {
  window.IndicatorLib = IndicatorLib;
}
