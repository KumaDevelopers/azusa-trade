import { ema, sma } from "./indicators.mjs";

export function tradeExit(position, bar) {
  const long = position.side === "buy";
  const open = position.liveOnly ? bar.close : bar.open;
  const adverse = position.liveOnly ? bar.close : long ? bar.low : bar.high;
  const favorable = position.liveOnly ? bar.close : long ? bar.high : bar.low;
  if (position.stop !== null && (long ? adverse <= position.stop : adverse >= position.stop)) {
    return { price: position.liveOnly ? open : long ? Math.min(open, position.stop) : Math.max(open, position.stop), reason: "SL" };
  }
  if (position.target !== null && (long ? favorable >= position.target : favorable <= position.target)) {
    return { price: position.target, reason: "TP" };
  }
  return null;
}

export function pnl(position, price) {
  const direction = position.side === "buy" ? 1 : -1;
  const gross = direction * (price - position.entry) * position.quantity;
  const fees = (price + position.entry) * position.quantity * position.fee / 10000;
  return gross - fees;
}

export function backtest(rawBars, options) {
  const bars = rawBars.filter(bar => bar.closed && Number.isFinite(bar.close));
  const { fast, slow, fee, size, stopPercent, targetPercent, start, end, type } = options;
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 1 || slow <= fast || slow > 500
    || ![fee, size, stopPercent, targetPercent].every(Number.isFinite) || fee < 0 || size <= 0
    || stopPercent <= 0 || stopPercent >= 100 || targetPercent <= 0 || start >= end) throw new Error("Periksa periode, ukuran posisi, biaya, risiko, dan rentang tanggal.");
  const average = type === "sma" ? sma : ema;
  const values = bars.map(bar => bar.close);
  const quick = average(values, fast);
  const delayed = average(values, slow);
  const equity = [];
  const trades = [];
  let position = null, next = null, total = 0, high = 0, drawdown = 0, lastBar;
  const close = (bar, price, reason) => {
    const profit = pnl(position, price);
    total += profit;
    trades.push({ ...position, exit: price, exitTime: bar.time, reason, profit });
    position = null;
  };
  for (let i = slow - 1; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.time < start) continue;
    if (bar.time > end) break;
    lastBar = bar;
    if (next) {
      if (position) close(bar, bar.open, "Cross");
      const sign = next === "buy" ? 1 : -1;
      position = { side: next, entry: bar.open, quantity: size, fee, entryTime: bar.time,
        stop: bar.open * (1 - sign * stopPercent / 100), target: bar.open * (1 + sign * targetPercent / 100) };
      next = null;
    }
    if (position) {
      const exit = tradeExit(position, bar);
      if (exit) close(bar, exit.price, exit.reason);
    }
    if ([quick[i], quick[i - 1], delayed[i], delayed[i - 1]].every(Number.isFinite)) {
      if (quick[i] > delayed[i] && quick[i - 1] <= delayed[i - 1] && position?.side !== "buy") next = "buy";
      if (quick[i] < delayed[i] && quick[i - 1] >= delayed[i - 1] && position?.side !== "sell") next = "sell";
    }
    const balance = total + (position ? pnl(position, bar.close) : 0);
    equity.push({ time: bar.time, value: balance });
    high = Math.max(high, balance);
    drawdown = Math.max(drawdown, high - balance);
  }
  if (position && lastBar) close(lastBar, lastBar.close, "Akhir data");
  const wins = trades.filter(trade => trade.profit > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.profit, 0);
  const grossLoss = trades.filter(trade => trade.profit < 0).reduce((sum, trade) => sum - trade.profit, 0);
  return { trades, equity, total, drawdown, winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : null, expectancy: trades.length ? total / trades.length : 0 };
}
