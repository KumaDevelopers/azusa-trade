"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Download, FlaskConical, Play, Trash2 } from "lucide-react";
import { pnl } from "../lib/trading.mjs";
import type { Alert, Bar, Market } from "../lib/types";
import { direction, number, signed, stamp } from "./market-panels";
import { download } from "./use-persisted";

export type Position = { id: string; market: string; side: "buy" | "sell"; entry: number; quantity: number; fee: number; stop: number | null; target: number | null; entryTime: number; liveOnly: true; exit?: number; exitTime?: number; reason?: string; profit?: number };
type Closed = Pick<Position, "side" | "entry" | "quantity" | "entryTime"> & { exit: number; exitTime: number; reason: string; profit: number };
type Report = { trades: Closed[]; total: number; winRate: number; drawdown: number; profitFactor: number | null; expectancy: number; equity: { time: number; value: number }[] };

export function AlertsPanel({ alerts, market, current, timeframe, plots, timezone, onAdd, onRemove }: {
  alerts: Alert[]; market: Market; current?: number; timeframe: string; plots: { uid: string; plot: string; name: string }[]; timezone: string; onAdd: (alert: Alert) => void; onRemove: (id: string) => void;
}) {
  const [price, setPrice] = useState(current?.toFixed(market.precision) ?? "");
  const [side, setSide] = useState<Alert["direction"]>("above");
  const [series, setSeries] = useState("");
  const plotKey = (item: { uid: string; plot: string }) => JSON.stringify([item.uid, item.plot]);
  const seriesPlot = plots.find(plot => plotKey(plot) === series);
  return <div className="alerts-panel">
    <div className="panel-intro"><span className="limit-pill">{market.id} · {timeframe}</span></div>
    <form className="form-grid" onSubmit={event => {
      event.preventDefault();
      if (!price.trim() || !Number.isFinite(Number(price)) || (series && !seriesPlot) || (!seriesPlot && Number(price) <= 0)) return;
      onAdd({ id: crypto.randomUUID(), symbol: market.id, direction: side, value: +price,
        ...(seriesPlot ? { indicator: { ...seriesPlot, frame: timeframe } } : {}) });
    }}>
      <label>Sumber<select value={series} onChange={event => { setSeries(event.target.value); setPrice(""); }}>
        <option value="">Harga</option>{plots.map(item => <option key={plotKey(item)} value={plotKey(item)}>{item.name}</option>)}
      </select></label>
      <label>Kondisi<select value={side} onChange={event => setSide(event.target.value as Alert["direction"])}><option value="above">Mencapai / di atas</option><option value="below">Mencapai / di bawah</option></select></label>
      <label>Ambang<input required type="number" step={seriesPlot ? "any" : 10 ** -market.precision} min={seriesPlot ? undefined : 10 ** -market.precision} value={price} onChange={event => setPrice(event.target.value)}/></label>
      <button className="accent-button"><Bell size={15}/>Buat alert</button>
    </form>
    <p className="secondary">Aktif selama chart ini terbuka.</p>
    {!alerts.length && <div className="empty-inline">Belum ada alert.</div>}
    {alerts.map(alert => <div className="alert-row" key={alert.id}>
      <Bell size={16}/><div><strong>{alert.indicator ? alert.indicator.name + " · " + alert.indicator.frame : alert.symbol} {alert.direction === "above" ? "≥" : "≤"} {number(alert.value, 4).replace(/0+$/, "").replace(/\.$/, "")}</strong><small>{alert.fired ? "Terpicu · " + stamp(alert.fired, timezone) : "Menunggu"}</small></div>
      <button className="icon-btn danger" aria-label={"Hapus alert " + alert.symbol} onClick={() => onRemove(alert.id)}><Trash2 size={15}/></button>
    </div>)}
  </div>;
}

export function PaperPanel({ market, last, live, positions, timezone, onOpen, onClose }: {
  market: Market; last?: Bar; live: boolean; positions: Position[]; timezone: string;
  onOpen: (position: Position) => void; onClose: (id: string) => void;
}) {
  const [side, setSide] = useState<Position["side"]>("buy");
  const [size, setSize] = useState("0.01");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [fee, setFee] = useState("10");
  const [error, setError] = useState("");
  function add() {
    setError("");
    if (!last || !live) { setError("Harga streaming diperlukan untuk membuka posisi."); return; }
    const risk = stop === "" ? null : Number(stop), reward = target === "" ? null : Number(target);
    const sign = side === "buy" ? 1 : -1;
    if (!(+size > 0) || !Number.isFinite(+size) || !Number.isFinite(+fee) || +fee < 0) { setError("Ukuran atau biaya tidak valid."); return; }
    if (risk !== null && (!Number.isFinite(risk) || risk <= 0 || sign * (risk - last.close) >= 0)
      || reward !== null && (!Number.isFinite(reward) || reward <= 0 || sign * (reward - last.close) <= 0)) { setError("Periksa posisi SL dan TP terhadap harga masuk."); return; }
    onOpen({ id: crypto.randomUUID(), market: market.id, side, entry: last.close, quantity: +size, fee: +fee, stop: risk, target: reward, entryTime: Date.now() / 1000, liveOnly: true });
    setStop(""); setTarget("");
  }
  const list = positions.filter(item => item.exit === undefined);
  const realized = positions.filter(item => item.market === market.id).reduce((sum, item) => sum + (item.profit ?? 0), 0);
  return <div className="paper-panel">
    <div className="panel-intro"><h3>Paper Trading</h3><span className="limit-pill">Simulasi · {market.id}</span></div>
    <div className="action-row"><div className="segmented"><button className={side === "buy" ? "selected positive" : ""} onClick={() => setSide("buy")}>Buy</button><button className={side === "sell" ? "selected negative" : ""} onClick={() => setSide("sell")}>Sell</button></div><span className="secondary">Harga {number(last?.close, market.precision)} · P/L terealisasi <strong className={direction(realized)}>{signed(realized, " " + market.quote)}</strong></span></div>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); add(); }}>
      <label>Jumlah ({market.asset})<input type="number" min="0.00000001" step="any" required value={size} onChange={event => setSize(event.target.value)}/></label>
      <label>Stop loss<input type="number" min="0" step="any" value={stop} onChange={event => setStop(event.target.value)}/></label>
      <label>Take profit<input type="number" min="0" step="any" value={target} onChange={event => setTarget(event.target.value)}/></label>
      <label>Fee / sisi (bps)<input type="number" min="0" step="any" required value={fee} onChange={event => setFee(event.target.value)}/></label>
      <button className="accent-button" disabled={!live}>Buka posisi</button>
    </form>
    <p className="secondary">Fill mengikuti harga streaming yang terlihat. Risiko dan penutupan otomatis dipantau untuk instrumen chart aktif.</p>
    {error && <p className="runtime-error">{error}</p>}
    <h4>Posisi terbuka</h4>
    {!list.length && <p className="empty-inline">Belum ada posisi terbuka.</p>}
    {list.map(item => {
      const price = item.market === market.id ? last?.close : undefined;
      const profit = price == null ? undefined : pnl(item, price);
      return <div className="trade-row" key={item.id}><span className={item.side === "buy" ? "positive" : "negative"}>{item.side.toUpperCase()}</span><div><strong>{item.market} · {item.quantity}</strong><small>{number(item.entry)} · {stamp(item.entryTime * 1000, timezone)}</small></div><strong className={direction(profit)}>{signed(profit, "")}</strong><button disabled={!live || price == null} className="subtle-button" onClick={() => onClose(item.id)}>Tutup</button></div>;
    })}
  </div>;
}

const isoDate = (time: number) => new Date(time * 1000).toISOString().slice(0,10);
export function BacktestPanel({ bars, market, frame, timezone }: { bars: Bar[]; market: Market; frame: string; timezone: string }) {
  const [options, setOptions] = useState({ type: "ema", fast: 20, slow: 50, fee: 10, size: .01, stopPercent: 1, targetPercent: 2 });
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { if (bars.length) { setStart(value => value || isoDate(bars[0].time)); setEnd(value => value || isoDate(bars.at(-1)!.time)); } }, [bars]);
  useEffect(() => () => { worker.current?.terminate(); clearTimeout(timer.current); }, []);
  function run() {
    const first = Date.parse(start + "T00:00:00Z") / 1000, last = Date.parse(end + "T23:59:59Z") / 1000;
    if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last || !bars.length) { setError("Pilih rentang tanggal dengan riwayat candle."); return; }
    setReport(null); setError(""); setRunning(true);
    const thread = new Worker(new URL("../lib/backtest.worker.mjs", import.meta.url));
    worker.current = thread;
    const finish = (issue?: string, result?: Report) => { clearTimeout(timer.current); thread.terminate(); worker.current = null; setRunning(false); setError(issue || ""); if (result) setReport(result); };
    thread.onmessage = ({ data }) => finish(data.error, data.result);
    thread.onerror = () => finish("Worker backtest tidak dapat dijalankan.");
    timer.current = setTimeout(() => finish("Backtest melampaui batas waktu."), 3000);
    thread.postMessage({ bars, options: { ...options, start: first, end: last } });
  }
  const fields = { fast: "Periode cepat", slow: "Periode lambat", size: "Ukuran posisi", fee: "Fee / sisi (bps)", stopPercent: "SL (%)", targetPercent: "TP (%)" } as const;
  return <div className="backtest-panel">
    <div className="panel-intro"><h3>Backtesting</h3><span className="limit-pill">{market.id} · {frame}</span></div>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); run(); }}>
      <label>Strategi<select value={options.type} onChange={event => setOptions({ ...options, type: event.target.value })}><option value="ema">EMA crossover</option><option value="sma">SMA crossover</option></select></label>
      {Object.entries(fields).map(([name, label]) => <label key={name}>{label}<input type="number" required min="0" step="any" value={options[name as keyof typeof fields]} onChange={event => setOptions({ ...options, [name]: Number(event.target.value) })}/></label>)}
      <label>Dari (UTC)<input type="date" required value={start} onChange={event => setStart(event.target.value)}/></label>
      <label>Sampai (UTC)<input type="date" required value={end} onChange={event => setEnd(event.target.value)}/></label>
      <button className="accent-button" disabled={running || !bars.length}><Play size={14}/>{running ? "Menghitung…" : "Jalankan"}</button>
    </form>
    <p className="secondary">Candle terkonfirmasi · Fill pada open berikutnya · SL diprioritaskan bila SL dan TP tersentuh pada candle yang sama.</p>
    {error && <p className="runtime-error">{error}</p>}
    {report ? <>
      <div className="result-stats">
        {[["Net P/L", signed(report.total, "")], ["Win rate", number(report.winRate * 100) + "%"], ["Profit factor", report.profitFactor === Infinity ? "∞" : number(report.profitFactor)], ["Max drawdown", number(report.drawdown)], ["Expectancy", signed(report.expectancy, "")], ["Trade", String(report.trades.length)]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}
      </div>
      {report.equity.length > 1 && <EquityCurve values={report.equity}/>}
      <div className="action-row"><h4>Trade terakhir</h4><button className="subtle-button" onClick={() => {
        const csv = ["Side,Entry time,Entry,Exit time,Exit,Quantity,Reason,Net P/L", ...report.trades.map(item => [item.side, new Date(item.entryTime * 1000).toISOString(), item.entry, new Date(item.exitTime * 1000).toISOString(), item.exit, item.quantity, item.reason, item.profit].join(","))].join("\n");
        download("AzusaTrade-backtest-" + market.id + ".csv", csv, "text/csv");
      }}><Download size={15}/>CSV</button></div>
      {report.trades.slice(-15).reverse().map((item, index) => <div className="trade-row" key={index}><span className={item.side === "buy" ? "positive" : "negative"}>{item.side.toUpperCase()}</span><div><strong>{number(item.entry)} · {number(item.exit)}</strong><small>{stamp(item.exitTime * 1000, timezone)} · {item.reason}</small></div><strong className={direction(item.profit)}>{signed(item.profit, "")}</strong></div>)}
      {!report.trades.length && <p className="empty-inline">Tidak ada persilangan yang tereksekusi dalam rentang ini.</p>}
    </> : <div className="empty-inline"><FlaskConical size={16}/>Hasil simulasi akan muncul setelah strategi dijalankan.</div>}
  </div>;
}

function EquityCurve({ values }: { values: Report["equity"] }) {
  const high = Math.max(0, ...values.map(point => point.value));
  const low = Math.min(0, ...values.map(point => point.value));
  const y = (value: number) => 108 - (value - low) / (high - low || 1) * 96;
  const points = values.map((point, i) => (8 + i / (values.length - 1) * 624).toFixed(1) + "," + y(point.value).toFixed(1)).join(" ");
  return <div className="equity"><div className="action-row"><strong>Equity curve</strong><small>{number(low)} / {number(high)}</small></div><svg viewBox="0 0 640 120" preserveAspectRatio="none" role="img" aria-label="Kurva ekuitas backtest"><line x1="8" x2="632" y1={y(0)} y2={y(0)} stroke="var(--border)"/><polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg></div>;
}

export function JournalPanel({ positions, note, onNote, timezone }: { positions: Position[]; note: string; onNote: (note: string) => void; timezone: string }) {
  const closed = positions.filter(item => item.exit !== undefined).slice().reverse();
  return <div className="journal-panel"><div className="panel-intro"><h3>Trading Journal</h3></div>
    <label>Catatan<textarea rows={5} value={note} onChange={event => onNote(event.target.value)} placeholder="Tulis catatan trading di sini…"/></label>
    <h4>Riwayat simulasi</h4>
    {closed.map(item => <div className="trade-row" key={item.id}><span className={item.side === "buy" ? "positive" : "negative"}>{item.side.toUpperCase()}</span><div><strong>{item.market} · {item.reason}</strong><small>{stamp((item.exitTime || 0) * 1000, timezone)} · {number(item.entry)} → {number(item.exit)}</small></div><strong className={direction(item.profit)}>{signed(item.profit, "")}</strong></div>)}
    {!closed.length && <p className="empty-inline">Belum ada posisi yang ditutup.</p>}
  </div>;
}
