"use client";
import { X } from "lucide-react";
import Chart, { type ViewMode } from "./chart";
import { byId, frames, markets } from "../lib/instruments.mjs";
import type { Drawing, RenderedIndicator } from "../lib/types";
import { useMarket } from "./use-market";
import { number } from "./market-panels";

const drawings: Drawing[] = [];
const indicators: RenderedIndicator[] = [];
const noop = () => {};
const comparisons = markets.filter(market => market.category === "Crypto");
const intervals = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
const statuses = { live: "LIVE", polling: "POLLING", historical: "RIWAYAT", connecting: "MEMUAT", reconnecting: "MENYAMBUNG", disconnected: "TERPUTUS", delayed: "DELAYED", closed: "TUTUP", setup: "KONFIGURASI" };

export default function ComparisonChart({ symbol, frame, theme, timezone, provider, type, bull, bear, onChange, onClose }: {
  symbol: string; frame: string; theme: string; timezone: string; provider: string; type: ViewMode;
  bull: string; bear: string; onChange: (symbol: string, frame: string) => void; onClose: () => void;
}) {
  const market = comparisons.find(item => item.id === symbol) ?? byId.ETHUSDT;
  const interval = intervals.find(item => item === frame) ?? "1h";
  const feed = useMarket(market, interval, provider, true);
  return <aside className="comparison-chart" aria-label="Chart pembanding">
    <div className="comparison-toolbar">
      <select aria-label="Pasar pembanding" value={market.id} onChange={event => onChange(event.target.value, interval)}>
        {comparisons.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
      </select>
      <select aria-label="Timeframe pembanding" value={interval} onChange={event => onChange(market.id, event.target.value)}>
        {intervals.map(item => <option key={item}>{item}</option>)}
      </select>
      <span className={"feed-badge feed-" + feed.status}>{statuses[feed.status]}</span>
      <strong>{number(feed.bars.at(-1)?.close, market.precision)}</strong>
      <button className="icon-btn tiny" title="Tutup chart pembanding" aria-label="Tutup chart pembanding" onClick={onClose}><X size={16}/></button>
    </div>
    <div className="plot-wrap">
      <Chart market={market} period={frames[interval]} scene={feed.key + ":" + feed.source} bars={feed.bars} theme={theme} timezone={timezone} type={type} bull={bull} bear={bear} indicators={indicators} drawings={drawings} tool="cursor" onDraw={noop} onChangeDrawing={noop} onHover={noop}/>
      {!feed.bars.length && <div className="chart-blank"><p>{feed.message || "Memuat chart pembanding"}</p></div>}
    </div>
  </aside>;
}
