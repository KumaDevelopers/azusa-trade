/** @type {[string, string, string, string, boolean, number][]} */
const indicatorRows = [
  ["sma", "Moving Average", "SMA", "Tren", true, 20],
  ["ema", "Exponential Moving Average", "EMA", "Tren", true, 20],
  ["wma", "Weighted Moving Average", "WMA", "Tren", true, 20],
  ["bb", "Bollinger Bands", "BB", "Volatilitas", true, 20],
  ["rsi", "Relative Strength Index", "RSI", "Momentum", false, 14],
  ["stoch", "Stochastic Oscillator", "STOCH", "Momentum", false, 14],
  ["stochrsi", "Stochastic RSI", "STOCH RSI", "Momentum", false, 14],
  ["macd", "Moving Average Convergence Divergence", "MACD", "Momentum", false, 12],
  ["atr", "Average True Range", "ATR", "Volatilitas", false, 14],
  ["adx", "Average Directional Index", "ADX", "Tren", false, 14],
  ["dmi", "Directional Movement Index", "DMI", "Tren", false, 14],
  ["volume", "Volume", "VOL", "Volume", false, 1],
  ["vwap", "Volume Weighted Average Price", "VWAP", "Volume", true, 1],
  ["obv", "On-Balance Volume", "OBV", "Volume", false, 1],
  ["ichimoku", "Ichimoku Cloud", "ICHIMOKU", "Tren", true, 9],
  ["supertrend", "Supertrend", "SUPERTREND", "Tren", true, 10],
  ["sar", "Parabolic SAR", "SAR", "Tren", true, 2],
  ["donchian", "Donchian Channels", "DONCHIAN", "Volatilitas", true, 20],
  ["keltner", "Keltner Channels", "KELTNER", "Volatilitas", true, 20],
  ["pivot", "Pivot Points", "PIVOT", "Tren", true, 1],
  ["fib", "Fibonacci Retracement Levels", "FIB", "Tren", true, 50],
];
export const catalog = indicatorRows.map(([id, name, short, category, overlay, length]) => ({ id, name, short, category, overlay, length }));

export const byIndicator = Object.fromEntries(catalog.map(item => [item.id, item]));
export const MAX_ACTIVE = 10;
export const PALETTE = ["#f2ba6e", "#8ca8ff", "#bf9df1", "#53dfc7", "#ec91a7", "#dce78d"];
export const DEFAULT_INDICATORS = [
  { uid: "ema-20", kind: "ema", length: 20, multiplier: 2, color: "#f3b66e", width: 1, opacity: 100, visible: true, frame: "" },
  { uid: "ema-50", kind: "ema", length: 50, multiplier: 2, color: "#839afb", width: 1, opacity: 100, visible: true, frame: "" },
  { uid: "volume", kind: "volume", length: 1, multiplier: 2, color: "#6fc9a8", width: 1, opacity: 75, visible: true, frame: "" },
];

const finite = value => typeof value === "number" && Number.isFinite(value);
const nulls = count => Array(count).fill(null);

export function sma(values, length) {
  let sum = 0;
  let count = 0;
  return values.map((value, index) => {
    if (finite(value)) { sum += value; count++; }
    const expired = values[index - length];
    if (finite(expired)) { sum -= expired; count--; }
    return count === length ? sum / length : null;
  });
}
export function ema(values, length) {
  const alpha = 2 / (length + 1);
  let state = null;
  return values.map(value => {
    if (!finite(value)) return null;
    state = state === null ? value : state + alpha * (value - state);
    return state;
  });
}
export function wma(values, length) {
  let weighted = 0;
  let sum = 0;
  let invalid = 0;
  const denominator = length * (length + 1) / 2;
  return values.map((value, index) => {
    const expired = values[index - length];
    weighted = weighted - sum + (finite(value) ? value : 0) * length;
    sum += (finite(value) ? value : 0) - (finite(expired) ? expired : 0);
    if (!finite(value)) invalid++;
    if (index >= length && !finite(expired)) invalid--;
    return index + 1 >= length && !invalid ? weighted / denominator : null;
  });
}
export function rma(values, length) {
  let state = null;
  let count = 0;
  let total = 0;
  return values.map(value => {
    if (!finite(value)) return null;
    if (state !== null) return state += (value - state) / length;
    count++;
    total += value;
    if (count === length) state = total / length;
    return state;
  });
}
export function rsi(values, length) {
  const change = values.map((value, index) => index && finite(value) && finite(values[index - 1])
    ? value - values[index - 1] : null);
  const gains = rma(change.map(value => value === null ? null : Math.max(value, 0)), length);
  const losses = rma(change.map(value => value === null ? null : Math.max(-value, 0)), length);
  return gains.map((value, index) => value === null ? null
    : losses[index] === 0 ? 100 : 100 - 100 / (1 + value / losses[index]));
}
function limits(values, length, high) {
  const output = nulls(values.length);
  const queue = [];
  let start = 0;
  let invalid = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!finite(value)) invalid++;
    if (i >= length && !finite(values[i - length])) invalid--;
    while (start < queue.length && queue[start] <= i - length) start++;
    if (finite(value)) {
      while (queue.length > start && (high ? values[queue.at(-1)] <= value : values[queue.at(-1)] >= value)) queue.pop();
      queue.push(i);
    }
    if (i + 1 >= length && !invalid && queue.length > start) output[i] = values[queue[start]];
    if (start > 1024) { queue.splice(0, start); start = 0; }
  }
  return output;
}
export const highest = (values, length) => limits(values, length, true);
export const lowest = (values, length) => limits(values, length, false);
const add = (a, b, factor = 1) => a.map((value, index) => finite(value) && finite(b[index]) ? value + b[index] * factor : null);
const midpoint = (a, b) => add(a, b).map(value => value === null ? null : value / 2);
const trueRange = bars => bars.map((bar, i) => i ? Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i - 1].close), Math.abs(bar.low - bars[i - 1].close)) : bar.high - bar.low);
const oscillator = (values, highs, lows) => values.map((value, i) => finite(value) && finite(highs[i]) && finite(lows[i])
  ? highs[i] === lows[i] ? 50 : 100 * (value - lows[i]) / (highs[i] - lows[i]) : null);

function directional(bars, length) {
  const atr = rma(trueRange(bars), length);
  const p = [null];
  const n = [null];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    p.push(up > down && up > 0 ? up : 0);
    n.push(down > up && down > 0 ? down : 0);
  }
  const normalize = values => rma(values, length).map((value, i) => finite(value) && finite(atr[i]) ? (atr[i] ? value / atr[i] * 100 : 0) : null);
  const positive = normalize(p);
  const negative = normalize(n);
  const dx = positive.map((value, i) => value === null ? null : value + negative[i]
    ? Math.abs(value - negative[i]) / (value + negative[i]) * 100 : 0);
  return { positive, negative, adx: rma(dx, length) };
}

export function computeBuiltin(config, bars) {
  if (!bars.length) return [];
  const { kind, color } = config;
  const length = Math.min(500, Math.max(1, Math.round(Number(config.length) || 14)));
  const multiplier = Math.min(20, Math.max(0.01, Number(config.multiplier) || 2));
  const closes = bars.map(bar => bar.close);
  const highs = bars.map(bar => bar.high);
  const lows = bars.map(bar => bar.low);
  const line = (name, values, tone = color, extra = {}) => ({ name, values, color: tone, type: "line", ...extra });
  const neutral = "#8b9af0";
  switch (kind) {
    case "sma": return [line("SMA", sma(closes, length))];
    case "ema": return [line("EMA", ema(closes, length))];
    case "wma": return [line("WMA", wma(closes, length))];
    case "rsi": return [line("RSI", rsi(closes, length))];
    case "atr": return [line("ATR", rma(trueRange(bars), length))];
    case "bb": {
      const basis = sma(closes, length);
      const square = sma(closes.map(value => value * value), length);
      const deviation = basis.map((value, index) => value === null ? null : Math.sqrt(Math.max(0, square[index] - value * value)));
      return [line("Basis", basis, neutral), line("Upper", add(basis, deviation, multiplier)), line("Lower", add(basis, deviation, -multiplier))];
    }
    case "stoch":
    case "stochrsi": {
      const values = kind === "stochrsi" ? rsi(closes, length) : closes;
      const top = highest(kind === "stochrsi" ? values : highs, length);
      const bottom = lowest(kind === "stochrsi" ? values : lows, length);
      const k = sma(oscillator(values, top, bottom), 3);
      return [line("%K", k), line("%D", sma(k, 3), neutral)];
    }
    case "macd": {
      const base = add(ema(closes, length), ema(closes, Math.round(length * 26 / 12)), -1);
      const signal = ema(base, 9);
      return [line("Histogram", add(base, signal, -1), "#73c7a6", { type: "histogram" }), line("MACD", base), line("Signal", signal, neutral)];
    }
    case "adx":
    case "dmi": {
      const { positive, negative, adx } = directional(bars, length);
      return kind === "adx" ? [line("ADX", adx)] : [line("+DI", positive), line("−DI", negative, "#f1899b"), line("ADX", adx, neutral)];
    }
    case "volume": return [line("Volume", bars.map(bar => bar.volume ?? null), color, { type: "histogram", directionColor: true })];
    case "vwap": {
      let day, total = 0, size = 0;
      return [line("VWAP", bars.map(bar => {
        const current = Math.floor(bar.time / 86400);
        if (day !== current) { day = current; total = 0; size = 0; }
        if (!finite(bar.volume)) return null;
        total += (bar.high + bar.low + bar.close) / 3 * bar.volume;
        size += bar.volume;
        return size ? total / size : null;
      }))];
    }
    case "obv": {
      let total = 0;
      return [line("OBV", bars.map((bar, i) => {
        if (!finite(bar.volume)) return null;
        if (i) total += Math.sign(bar.close - bars[i - 1].close) * bar.volume;
        return total;
      }))];
    }
    case "ichimoku": {
      const baseLength = Math.round(length * 26 / 9);
      const spanLength = Math.round(length * 52 / 9);
      const midpointAt = size => midpoint(highest(highs, size), lowest(lows, size));
      const conversion = midpointAt(length);
      const base = midpointAt(baseLength);
      return [line("Tenkan", conversion), line("Kijun", base, neutral),
        line("Senkou A", midpoint(conversion, base), "#70c3a0", { offset: baseLength }),
        line("Senkou B", midpointAt(spanLength), "#d78d94", { offset: baseLength }), line("Chikou", closes, "#abb598", { offset: -baseLength })];
    }
    case "supertrend": {
      const atr = rma(trueRange(bars), length);
      let top = null, bottom = null, upward = false;
      return [line("Supertrend", atr.map((value, i) => {
        if (value === null) return null;
        const mid = (highs[i] + lows[i]) / 2;
        const rawTop = mid + multiplier * value;
        const rawBottom = mid - multiplier * value;
        top = top === null || rawTop < top || closes[i - 1] > top ? rawTop : top;
        bottom = bottom === null || rawBottom > bottom || closes[i - 1] < bottom ? rawBottom : bottom;
        if (upward ? closes[i] < bottom : closes[i] > top) upward = !upward;
        return upward ? bottom : top;
      }))];
    }
    case "sar": {
      const initial = Math.min(0.2, Math.max(0.001, length / 100));
      let rising = closes[1] >= closes[0], pivot = rising ? highs[0] : lows[0], rate = initial, sar = rising ? lows[0] : highs[0];
      return [line("SAR", closes.map((_, index) => {
        if (!index) return null;
        sar += rate * (pivot - sar);
        if (rising) {
          sar = Math.min(sar, lows[index - 1], lows[Math.max(0, index - 2)]);
          if (lows[index] < sar) { rising = false; sar = pivot; pivot = lows[index]; rate = initial; }
          else if (highs[index] > pivot) { pivot = highs[index]; rate = Math.min(0.2, rate + initial); }
        } else {
          sar = Math.max(sar, highs[index - 1], highs[Math.max(0, index - 2)]);
          if (highs[index] > sar) { rising = true; sar = pivot; pivot = highs[index]; rate = initial; }
          else if (lows[index] < pivot) { pivot = lows[index]; rate = Math.min(0.2, rate + initial); }
        }
        return sar;
      }))];
    }
    case "donchian": {
      const top = highest(highs, length);
      const bottom = lowest(lows, length);
      return [line("Upper", top), line("Middle", midpoint(top, bottom), neutral), line("Lower", bottom)];
    }
    case "keltner": {
      const middle = ema(closes, length);
      const range = ema(trueRange(bars), length);
      return [line("Upper", add(middle, range, multiplier)), line("Middle", middle, neutral), line("Lower", add(middle, range, -multiplier))];
    }
    case "pivot": {
      const central = bars.map((_, i) => i ? (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3 : null);
      return [line("P", central), line("R1", central.map((value, i) => value === null ? null : value * 2 - lows[i - 1]), "#ee8d9a"),
        line("S1", central.map((value, i) => value === null ? null : value * 2 - highs[i - 1]), "#74cba2")];
    }
    case "fib": {
      const top = highest(highs, length);
      const bottom = lowest(lows, length);
      return [0.236, 0.382, 0.5, 0.618, 0.786].map((level, i) =>
        line(String(level), top.map((value, j) => value === null ? null : value - (value - bottom[j]) * level), PALETTE[i]));
    }
    default: return [];
  }
}

export function alignPlots(plots, source, target, closeTime) {
  return plots.map(plot => {
    let cursor = -1;
    return { ...plot, offset: 0, values: target.map((bar, index) => {
      const cutoff = bar.end ?? (target[index + 1]?.time || closeTime(bar.time));
      while (cursor + 1 < source.length && source[cursor + 1].closed
        && (source[cursor + 1].end ?? closeTime(source[cursor + 1].time)) <= cutoff) cursor++;
      return cursor >= 0 ? plot.values[cursor - (plot.offset || 0)] ?? null : null;
    }) };
  });
}
