"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Activity, Bell, CandlestickChart, Camera, ChevronDown, CircleHelp, Code2, Crosshair, Eye, EyeOff, Trash2, FlaskConical, Globe2, GripHorizontal, Layers3, LayoutPanelLeft, List, Maximize, Minus, MoveHorizontal, MoveUpRight, Newspaper, PanelBottom, PanelRight, Plus, RectangleHorizontal, RotateCcw, Ruler, ScanLine, Search, Settings2, SlidersHorizontal, Star, Terminal as TerminalIcon, TrendingUp, Undo2, Wifi, X } from "lucide-react";
import Chart from "./chart";
import WorkspaceBackup from "./workspace-backup";
import type { ChartApi, ViewMode } from "./chart";
import { AssetIcon, CalendarPanel, MarketDataSetup, MarketPicker, NewsPanel, Watchlist, direction, number, signed, stamp } from "./market-panels";
import { useMarket, useQuotes } from "./use-market";
import { useIndicators } from "./use-indicators";
import { download, usePersisted, useScripts } from "./use-persisted";
import { catalog, byIndicator, DEFAULT_INDICATORS, MAX_ACTIVE, PALETTE } from "../lib/indicators.mjs";
import { byId, frames, markets, primaryFrames, yieldFrames } from "../lib/instruments.mjs";
import { pnl, tradeExit } from "../lib/trading.mjs";
import type { Alert, Bar, Drawing, FeedState, Indicator, Market, Script, Tool } from "../lib/types";
import type { EditorLog } from "./indicator-panels";
import type { Position } from "./trading-panels";

const ComparisonChart = dynamic(() => import("./comparison-chart"));
const IndicatorLibrary = dynamic(() => import("./indicator-panels").then(module => module.IndicatorLibrary));
const IndicatorManager = dynamic(() => import("./indicator-panels").then(module => module.IndicatorManager));
const ScriptEditor = dynamic(() => import("./indicator-panels").then(module => module.ScriptEditor));
const AlertsPanel = dynamic(() => import("./trading-panels").then(module => module.AlertsPanel));
const PaperPanel = dynamic(() => import("./trading-panels").then(module => module.PaperPanel));
const BacktestPanel = dynamic(() => import("./trading-panels").then(module => module.BacktestPanel));
const JournalPanel = dynamic(() => import("./trading-panels").then(module => module.JournalPanel));

const chartViews = { candles: "Candlestick", line: "Line", area: "Area", bars: "OHLC Bar", hollow: "Hollow Candle" };
const labels: Record<FeedState, string> = { connecting: "MENGHUBUNGKAN", live: "LIVE", polling: "POLLING", delayed: "DELAYED", historical: "RIWAYAT", reconnecting: "RECONNECTING", disconnected: "DISCONNECTED", closed: "MARKET CLOSED", setup: "PERLU KONFIGURASI" };
const toolList = [
  ["cursor", Crosshair, "Kursor"], ["trend", MoveUpRight, "Trendline"], ["horizontal", Minus, "Garis horizontal"],
  ["vertical", GripHorizontal, "Garis vertikal"], ["rectangle", RectangleHorizontal, "Zona persegi"],
  ["fibonacci", List, "Fibonacci retracement"], ["measure", Ruler, "Ukur perubahan"], ["risk", MoveHorizontal, "Risk / Reward"],
] as const;
const lowerTabs = [
  ["editor", Code2, "Code Editor"], ["manager", Layers3, "Indikator"], ["paper", Activity, "Paper Trading"],
  ["test", FlaskConical, "Backtest"], ["journal", List, "Jurnal"], ["console", TerminalIcon, "Console"],
] as const;
const timezones = [ ["Asia/Jakarta", "WIB"], ["UTC", "UTC"], ["America/New_York", "New York"], ["Europe/London", "London"], ["Asia/Singapore", "Singapura"] ];
const frameNames = Object.keys(frames);
const marketIds = markets.map(market => market.id);
type Lower = typeof lowerTabs[number][0];
type Dialog = "markets" | "indicators" | "alerts" | "settings" | "news" | "data" | null;
type Preferences = { compare?: { symbol: string; frame: string }; bull?: string; bear?: string; symbol: string; frame: string; theme: string; tz: string; view: ViewMode; side: boolean; width: number; bottomHeight: number; provider: "auto" | "binance" | "okx" };
const noDrawings: Drawing[] = [];
const initial: Preferences = { symbol: "BTCUSDT", frame: "15m", theme: "dark", tz: "Asia/Jakarta", view: "candles", side: true, width: 324, bottomHeight: 335, provider: "auto" };

function availableFrames(market: Market) {
  if (market.id === "US10Y") return Object.keys(yieldFrames);
  if (market.category !== "Crypto") return ["1m", "3m", "5m", "15m", "30m", "45m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M"];
  return frameNames;
}

function IconButton({ title, children, onClick, active = false, danger = false, disabled = false }: { title: string; children: ReactNode; onClick: () => void; active?: boolean; danger?: boolean; disabled?: boolean }) {
  return <button className={"icon-btn" + (active ? " active" : "") + (danger ? " danger" : "")} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function Terminal() {
  const [prefs, setPrefs, ready, stateError] = usePersisted("workspace-v1", initial);
  const [savedLayouts, setSavedLayouts] = usePersisted<Record<string, { preferences: Preferences; indicators: Indicator[] }>>("layouts-v1", {});
  const [savedIndicators, setIndicators] = usePersisted<Indicator[]>("indicator-config-v1", DEFAULT_INDICATORS);
  const [scripts, setScripts, scriptsReady, scriptError] = useScripts<Script[]>("scripts-v1", []);
  const [favorites, setFavorites] = usePersisted<string[]>("favorites-v1", ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSD"]);
  const [recent, setRecent] = usePersisted<string[]>("recent-v1", []);
  const [drawings, setDrawings] = usePersisted<Record<string, Drawing[]>>("drawings-v1", {});
  const [hideAllIndicators, setHideAllIndicators] = usePersisted("hide-all-indicators-v1", false);
  const [hideAllDrawings, setHideAllDrawings] = usePersisted("hide-all-drawings-v1", false);
  const [showDrawingsManager, setShowDrawingsManager] = useState(false);
  const [focusIndicator, setFocusIndicator] = useState("");
  const [alerts, setAlerts] = usePersisted<Alert[]>("alerts-v1", []);
  const [positions, setPositions] = usePersisted<Position[]>("simulations-v1", []);
  const [note, setNote] = usePersisted("journal-v1", "");
  const [lower, setLower] = useState<Lower | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [right, setRight] = useState<"watchlist" | "news" | "calendar">("watchlist");
  const [mobileEditorial, setMobileEditorial] = useState<"news" | "calendar">("news");
  const [requested, setRequested] = useState<Script | null>(null);
  const [tool, setTool] = useState<Tool>("cursor");
  const [hover, setHover] = useState<Bar | null>(null);
  const [toast, setToast] = useState("");
  const [runnerKey, setRunnerKey] = useState("");
  const [logs, setLogs] = useState<EditorLog[]>([]);
  const [wide, setWide] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const [layoutChoice, setLayoutChoice] = useState("");
  const chart = useRef<ChartApi>(null);
  const modal = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const market = byId[prefs.symbol] ?? byId.BTCUSDT;
  const usesBiquote = market.category !== "Crypto" && market.id !== "US10Y";
  const supportedFrames = availableFrames(market);
  const frame = supportedFrames.includes(prefs.frame) ? prefs.frame : supportedFrames[0];
  const indicators = savedIndicators;
  const activeCount = indicators.filter(config => config.visible).length;
  const marketState = useMarket(market, frame, prefs.provider, ready);
  const rawQuotes = useQuotes(marketIds, ready);
  const quotes = prefs.provider === "okx" || marketState.source === "OKX Spot"
    ? Object.fromEntries(Object.entries(rawQuotes).filter(([symbol]) => byId[symbol]?.category !== "Crypto"))
    : rawQuotes;
  const indicatorState = useIndicators(indicators, scripts, marketState.bars, market, frame, marketState.source, ready && scriptsReady, runnerKey);
  const last = marketState.bars.at(-1);
  const previous = marketState.bars.at(-2);
  const observed = hover ?? last;
  const quote = quotes[market.id];
  const marketPreset = marketState.source || (market.category === "Crypto" ? prefs.provider === "okx" ? "OKX Spot" : "Binance / OKX Spot" : market.id === "US10Y" ? "FRED" : "biquote MT5");
  const live = marketState.status === "live";
  const chartKey = market.id + ":" + frame + ":" + marketState.source;
  const listed = drawings[market.id] ?? noDrawings;
  const currentChange = last && previous && previous.close ? (last.close - previous.close) / previous.close * 100 : null;
  const trailingStatus = stateError || scriptError || marketState.historyMessage;
  const setHoverBar = useCallback((value: Bar | null) => setHover(value), []);
  const onLog = useCallback((entry: EditorLog) => setLogs(previous => [...previous.slice(-59),entry]), []);
  const tell = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const set = (patch: Partial<Preferences>) => setPrefs(previous => ({ ...previous, ...patch }));

  const snapshot = () => ({ version: 1, prefs, savedLayouts, indicators, scripts, favorites, recent, drawings, alerts, positions, note });
  function restoreWorkspace(data: ReturnType<typeof snapshot>) {
    if (!data || data.version !== 1 || !data.prefs || !byId[data.prefs.symbol]
      || !Number.isFinite(data.prefs.width) || !Number.isFinite(data.prefs.bottomHeight)
      || !timezones.some(zone => zone[0] === data.prefs.tz) || !Object.hasOwn(chartViews, data.prefs.view)
      || !["binance", "okx", "auto"].includes(data.prefs.provider) || !data.savedLayouts || !data.drawings
      || ![data.indicators, data.scripts, data.favorites, data.recent, data.alerts, data.positions].every(Array.isArray)
      || typeof data.note !== "string" || data.indicators.filter(item => item?.visible).length > MAX_ACTIVE) {
      throw Error("Backup workspace tidak kompatibel.");
    }
    setPrefs({ ...initial, ...data.prefs });
    setSavedLayouts(data.savedLayouts);
    setIndicators(data.indicators);
    setScripts(data.scripts);
    setFavorites(data.favorites);
    setRecent(data.recent);
    setDrawings(data.drawings);
    setAlerts(data.alerts);
    setPositions(data.positions);
    setNote(data.note);
  }

  const selectMarket = (item: Market, close = false) => {
    if (market.id !== item.id) {
      set({ symbol: item.id, frame: availableFrames(item).includes(frame) ? frame : item.id === "US10Y" ? "1d" : "15m" });
      setRecent(values => [item.id, ...values.filter(value => value !== item.id)].slice(0,7));
      setHover(null);
    }
    if (close) setDialog(null);
  };
  const switchFrame = (value: string) => { set({ frame: value }); setHover(null); };
  const favorite = (id: string) => setFavorites(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  const toggleLower = (value: Lower) => setLower(current => current === value ? null : value);
  const addIndicator = (kind: string) => {
    if (activeCount >= MAX_ACTIVE) { tell("Gunakan maksimal 10 slot indikator per chart."); return; }
    if (!byIndicator[kind] && !scripts.some(item => item.id === kind)) return;
    const next = { uid: crypto.randomUUID(), kind, length: byIndicator[kind]?.length ?? 20, multiplier: 2, width: 1, opacity: 100, visible: true, color: PALETTE[indicators.length % PALETTE.length], frame: "" };
    setIndicators(values => values.filter(config => config.visible).length < MAX_ACTIVE ? [...values, next] : values);
    setHideAllIndicators(false);
    tell((byIndicator[kind]?.short ?? "Script") + " ditambahkan ke chart.");
  };
  const updateIndicator = (uid: string, patch: Partial<Indicator>) => {
    if (patch.visible === true && activeCount >= MAX_ACTIVE) { tell("Jeda indikator lain untuk membuka slot aktif."); return; }
    setIndicators(items => items.map(item => item.uid === uid ? { ...item, ...patch } : item));
  };
  const showScript = (script: Script) => {
    setRequested(script);
    setDialog(null);
    setLower("editor");
  };
  const saveScript = (script: Script) => setScripts(values => values.some(value => value.id === script.id) ? values.map(value => value.id === script.id ? script : value) : [...values, script]);
  const runScript = (script: Script) => {
    const existing = indicators.find(item => item.kind === script.id);
    if (existing?.visible) { tell("Script dijalankan pada chart."); return; }
    if (activeCount >= MAX_ACTIVE) { tell("Gunakan maksimal 10 slot indikator per chart."); return; }
    setIndicators(values => {
      if (values.filter(config => config.visible).length >= MAX_ACTIVE) return values;
      if (existing) return values.map(item => item.uid === existing.uid ? { ...item, visible: true } : item);
      return [...values, { uid: crypto.randomUUID(), kind: script.id, length: 20, multiplier: 2, color: PALETTE[values.length % PALETTE.length], visible: true, width: 2, opacity: 100, frame: "" }];
    });
    setHideAllIndicators(false);
    tell("Script dijalankan pada chart.");
  };
  const addDrawing = useCallback((drawing: Drawing) => {
    setDrawings(values => ({ ...values, [market.id]: [...(values[market.id] ?? []), drawing] }));
    setHideAllDrawings(false);
    setTool("cursor");
  }, [market.id, setDrawings, setHideAllDrawings]);
  const undoDrawing = () => setDrawings(value => ({ ...value, [market.id]: listed.slice(0,-1) }));
  const changeDrawing = useCallback((id: string, patch: Partial<Drawing> | null) => {
    setDrawings(value => ({ ...value, [market.id]: patch === null
      ? (value[market.id] ?? []).filter(item => item.id !== id)
      : (value[market.id] ?? []).map(item => item.id === id ? { ...item, ...patch } : item) }));
  }, [market.id, setDrawings]);
  const settingsForIndicator = (uid: string) => { setFocusIndicator(uid); setLower("manager"); };
  const closePosition = (id: string) => {
    if (!live || !last) return;
    setPositions(items => items.map(item => item.id === id && item.exit === undefined && item.market === market.id
      ? { ...item, exit: last.close, exitTime: Date.now() / 1000, reason: "Manual", profit: pnl(item, last.close) } : item));
  };

  useEffect(() => {
    function globalKeys(event: KeyboardEvent) {
      if (event.key === "Escape") { setDialog(null); setWide(false); setTool("cursor"); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setDialog("markets"); }
    }
    window.addEventListener("keydown", globalKeys);
    return () => { window.removeEventListener("keydown", globalKeys); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog !== "markets") modal.current?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = Array.from(modal.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']") ?? []);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [dialog]);
  useEffect(() => {
    if (!live || !last) return;
    const matching = alerts.filter(alert => alert.symbol === market.id && !alert.fired && !alert.indicator
      && (alert.direction === "above" ? last.close >= alert.value : last.close <= alert.value));
    if (matching.length) {
      const ids = new Set(matching.map(alert => alert.id));
      setAlerts(items => items.map(alert => ids.has(alert.id) ? { ...alert, fired: Date.now() } : alert));
      tell("Alert " + market.id + " terpicu pada " + number(last.close, market.precision) + ".");
    }
    const exits = new Map(positions.filter(item => item.market === market.id && item.exit === undefined).map(item => [item.id, tradeExit(item, last)]));
    if (Array.from(exits.values()).some(Boolean)) {
      setPositions(items => items.map(item => {
        const close = exits.get(item.id);
        return item.exit === undefined && close ? { ...item, exit: close.price, exitTime: Date.now() / 1000, reason: close.reason, profit: pnl(item, close.price) } : item;
      }));
    }
  }, [alerts, last, live, market.id, market.precision, positions, setAlerts, setPositions, tell]);

  useEffect(() => {
    if (!live) return;
    const matching = alerts.filter(alert => {
      const source = alert.indicator;
      if (!source || alert.fired || alert.symbol !== market.id || source.frame !== frame) return false;
      const result = indicatorState.rendered.find(item => item.config.uid === source.uid && item.config.visible);
      if (!result) return false;
      const lastConfirmed = result.bars.at(-1)?.closed ? result.bars.length - 1 : result.bars.length - 2;
      const value = result.plots.find(plot => plot.name === source.plot)?.values[lastConfirmed];
      return typeof value === "number" && Number.isFinite(value)
        && (alert.direction === "above" ? value >= alert.value : value <= alert.value);
    });
    if (!matching.length) return;
    const keys = new Set(matching.map(item => item.id));
    setAlerts(items => items.map(item => keys.has(item.id) ? { ...item, fired: Date.now() } : item));
    tell("Alert indikator " + (matching[0].indicator?.name ?? "") + " terpicu.");
  }, [alerts, frame, indicatorState.rendered, live, market.id, setAlerts, tell]);
  const alertPlots = useMemo(() => indicatorState.rendered.flatMap(item => item.plots.filter(plot => !plot.offset).map(plot => ({
    uid: item.config.uid, plot: plot.name, name: (byIndicator[item.config.kind]?.short ?? "Script") + " · " + plot.name,
  }))), [indicatorState.rendered]);

  const rememberedLogs = useRef(new Map<string, string>());
  useEffect(() => {
    for (const [id, stat] of Object.entries(indicatorState.stats)) {
      const message = stat.error || stat.log;
      if (!message || rememberedLogs.current.get(id) === message) continue;
      rememberedLogs.current.set(id, message);
      if (rememberedLogs.current.size > 40) rememberedLogs.current.delete(rememberedLogs.current.keys().next().value!);
      onLog({ when: stat.timestamp ?? Date.now(), level: stat.error ? "error" : "info", text: message });
    }
  }, [indicatorState.stats, onLog]);

  const backdrop = useMemo(() => ({ "--right-width": prefs.width + "px", "--bottom-max": prefs.bottomHeight + "px" } as CSSProperties), [prefs.width, prefs.bottomHeight]);
  const modalTitle = dialog === "markets" ? "Cari pasar" : dialog === "indicators" ? "Pustaka indikator" : dialog === "alerts" ? "Alert" : dialog === "news" ? "Berita & kalender" : dialog === "data" ? "Data Forex & logam" : "Pengaturan workspace";
  const timezoneName = timezones.find(zone => zone[0] === prefs.tz)?.[1] ?? "WIB";
  const shortIndicators = indicators.slice(0, 8);

  return <div className={"terminal theme-" + prefs.theme + (wide ? " chart-only" : "")} style={backdrop}>
    <header className="topbar">
      <div className="branding" aria-label="AzusaTrade"><img src="/azusa.svg" width="35" height="35" alt=""/><div><strong>Azusa<span>Trade</span></strong></div></div>
      <div className="top-divider"/>
      <button className="global-search" onClick={() => setDialog("markets")} aria-label="Cari pasar"><Search size={17}/><span>Cari pasar</span><kbd>Ctrl K</kbd></button>
      <div className="top-actions">
        <button className="top-action" aria-label="Tambah indikator" onClick={() => setDialog("indicators")}><Activity size={17}/><span>Indikator</span></button>
        <button className="top-action" aria-label="Alerts" onClick={() => setDialog("alerts")}><Bell size={16}/><span>Alerts</span>{alerts.some(alert => !alert.fired) && <i/>}</button>
        <button className="top-action" onClick={() => setDialog("settings")}><LayoutPanelLeft size={17}/><span>Layout</span></button>
        <span className="top-divider compact"/>
        <IconButton title="Pengaturan workspace" onClick={() => setDialog("settings")}><Settings2 size={18}/></IconButton>
        <IconButton title={prefs.side ? "Sembunyikan sidebar" : "Tampilkan sidebar"} onClick={() => set({ side: !prefs.side })} active={prefs.side}><PanelRight size={18}/></IconButton>
      </div>
    </header>

    <main className={"work-area" + (prefs.side ? "" : " without-side")}>
      <section className="terminal-main">
        <div className="chart-toolbar">
          <button className="symbol-button" onClick={() => setDialog("markets")}><AssetIcon market={market} small/><strong>{market.id}</strong><ChevronDown size={14}/></button>
          <div className="tool-divider"/>
          <div className="time-buttons" aria-label="Timeframe">{primaryFrames.filter(value => supportedFrames.includes(value)).map(value => <button key={value} className={frame === value ? "selected" : ""} onClick={() => switchFrame(value)}>{value}</button>)}</div>
          <label className="time-overflow" title="Semua timeframe"><select aria-label="Semua timeframe" value={frame} className={primaryFrames.includes(frame) ? "" : "current"} onChange={event => switchFrame(event.target.value)}>
            {supportedFrames.map(value => <option key={value}>{value}</option>)}
          </select><ChevronDown size={13}/></label>
          <div className="tool-divider"/>
          <label title="Jenis chart" className="chart-type"><CandlestickChart size={17}/><select aria-label="Jenis chart" value={prefs.view} onChange={event => set({ view: event.target.value as ViewMode })}>{Object.entries(chartViews).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><ChevronDown size={13}/></label>
          <div className="chart-actions">
            <IconButton title="Perbesar chart" onClick={() => chart.current?.zoom(.7)}><Plus size={16}/></IconButton>
            <IconButton title="Perkecil chart" onClick={() => chart.current?.zoom(1.4)}><Minus size={16}/></IconButton>
            <IconButton title="Atur skala ulang" onClick={() => chart.current?.reset()}><RotateCcw size={15}/></IconButton>
            <IconButton title={hideAllIndicators ? "Tampilkan semua indikator" : "Sembunyikan semua indikator"} onClick={() => setHideAllIndicators(value => !value)} active={hideAllIndicators}>{hideAllIndicators ? <EyeOff size={16}/> : <Activity size={16}/>}</IconButton>
            <IconButton title={hideAllDrawings ? "Tampilkan semua drawing" : "Sembunyikan semua drawing"} onClick={() => setHideAllDrawings(value => !value)} active={hideAllDrawings}>{hideAllDrawings ? <EyeOff size={16}/> : <RectangleHorizontal size={16}/>}</IconButton>
            <IconButton title="Unduh gambar chart" onClick={() => chart.current?.capture()} disabled={!last}><Camera size={16}/></IconButton>
            <IconButton title={wide ? "Keluar dari layar penuh chart" : "Layar penuh chart"} onClick={() => setWide(value => !value)} active={wide}><Maximize size={16}/></IconButton>
          </div>
        </div>
        <div className="market-strip">
          <div className="market-main"><AssetIcon market={market}/><div><h1>{market.name}<span>{market.quote ? " / " + market.quote : ""}</span></h1><small>{market.id} <b>·</b> {marketPreset}</small></div></div>
          <div className="headline-price"><strong className={direction(currentChange)}>{number(last?.close, market.precision)}</strong><small className={direction(quote?.change)}>{quote ? signed(quote.change) + " dalam 24j" : currentChange !== null ? signed(currentChange) + " per candle" : "—"}</small></div>
          <div className="market-metrics">
            <div><small>24j tertinggi</small><strong>{number(quote?.high, market.precision)}</strong></div>
            <div><small>24j terendah</small><strong>{number(quote?.low, market.precision)}</strong></div>
            <div><small>{marketState.ask != null && marketState.bid != null ? "Spread" : "Volume 24j"}</small><strong>{marketState.ask != null && marketState.bid != null ? number(marketState.ask - marketState.bid, market.precision) : quote ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(quote.volume) : "—"}</strong></div>
          </div>
          <IconButton title={favorites.includes(market.id) ? "Hapus dari favorit" : "Tambah ke favorit"} onClick={() => favorite(market.id)} active={favorites.includes(market.id)}><Star size={17} fill={favorites.includes(market.id) ? "currentColor" : "none"}/></IconButton>
        </div>
        <div className={"chart-region" + (prefs.compare && !wide ? " with-comparison" : "")}>
          <aside className="drawing-tools" aria-label="Alat gambar chart">
            {toolList.map(([id, Icon, label]) => <IconButton key={id} title={label} onClick={() => setTool(id)} active={tool === id}><Icon size={17} className={id === "vertical" ? "rotate-90" : ""}/></IconButton>)}
            <div className="drawing-separator"/>
            <IconButton title="Kelola drawing (hapus / sembunyikan)" onClick={() => setShowDrawingsManager(value => !value)} active={showDrawingsManager}><Layers3 size={17}/></IconButton>
            <IconButton title={hideAllDrawings ? "Tampilkan semua drawing" : "Sembunyikan semua drawing"} onClick={() => setHideAllDrawings(value => !value)} active={hideAllDrawings}>{hideAllDrawings ? <EyeOff size={17}/> : <Eye size={17}/>}</IconButton>
            <IconButton title="Batalkan gambar terakhir" onClick={undoDrawing} disabled={!listed.length}><Undo2 size={17}/></IconButton>
            <IconButton title="Muat riwayat lebih lama" onClick={() => void marketState.loadOlder()} disabled={!last || marketState.loadingHistory}><ScanLine size={17}/></IconButton>
          </aside>
          <div className="plot-wrap">
            <Chart ref={chart} market={market} period={frames[frame as keyof typeof frames]} scene={chartKey} bars={marketState.bars} theme={prefs.theme} timezone={prefs.tz} type={prefs.view} bull={prefs.bull} bear={prefs.bear} indicators={hideAllIndicators ? [] : indicatorState.rendered} drawings={hideAllDrawings ? [] : listed} tool={tool} onDraw={addDrawing} onChangeDrawing={changeDrawing} onHover={setHoverBar}/>
            <div className="chart-caption">
              <div className="chart-caption-title"><strong>{market.id}</strong><span>·</span><span>{frame}</span><span>·</span><span>{marketState.source || market.category}</span>
                <span className={"feed-badge feed-" + marketState.status} title={marketState.message || labels[marketState.status]}>{live && <span className="status-dot"/>}{labels[marketState.status]}</span>
              </div>
              <div className="ohlc" aria-label="Harga OHLC">
                {([["O", observed?.open], ["H", observed?.high], ["L", observed?.low], ["C", observed?.close]] as const).map(([label, value]) => <span key={label}>{label} <b className={direction(observed && observed.close - observed.open)}>{number(value, market.precision)}</b></span>)}
              </div>
              <div className="plot-labels" aria-label="Kontrol indikator di chart">{shortIndicators.map(config => {
                const script = scripts.find(item => item.id === config.kind);
                const name = byIndicator[config.kind]?.short ?? script?.name ?? config.kind;
                return <span key={config.uid} className={"plot-chip" + (!config.visible || hideAllIndicators ? " muted" : "")}>
                  <i style={{ background: config.color }}/><span className="plot-chip-name" title={name}>{name}{byIndicator[config.kind]?.length > 1 ? " " + config.length : ""}{config.frame ? " · " + config.frame : ""}</span>
                  <button type="button" title={config.visible ? "Sembunyikan indikator" : "Tampilkan indikator"} aria-label={"Toggle " + name} onClick={() => updateIndicator(config.uid, {visible: !config.visible})}>{config.visible ? <Eye size={13}/> : <EyeOff size={13}/>}</button>
                  <button type="button" title="Edit pengaturan indikator" aria-label={"Pengaturan " + name} onClick={() => settingsForIndicator(config.uid)}><Settings2 size={13}/></button>
                  {script && <button type="button" title="Edit kode Pine" aria-label={"Edit kode " + name} onClick={() => showScript(script)}><Code2 size={13}/></button>}
                  <button type="button" title="Hapus indikator" aria-label={"Hapus " + name} onClick={() => setIndicators(items => items.filter(item => item.uid !== config.uid))}><X size={13}/></button>
                </span>;
              })}</div>
            </div>
            {!last && <div className="chart-blank">
              <span className="chart-blank-icon">{marketState.status === "connecting" ? <Activity size={23}/> : <CandlestickChart size={24}/>}</span>
              <strong>{marketState.status === "connecting" ? "Memuat riwayat pasar" : marketState.status === "setup" ? "Penyedia data belum terhubung" : "Chart belum tersedia"}</strong>
              <p>{marketState.message || market.id + " · " + frame}</p>
              {marketState.status !== "connecting" && <div className="chart-blank-actions">
                {usesBiquote && <button className="accent-button" onClick={() => setDialog("data")}><Settings2 size={14}/>Konfigurasi data</button>}
                <button className="subtle-button" onClick={marketState.refresh}><RotateCcw size={14}/>Coba lagi</button>
              </div>}
            </div>}
            {showDrawingsManager && <div className="drawing-manager-popup" role="dialog" aria-label="Kelola drawing">
              <div className="drawing-manager-title"><strong>Drawing · {listed.length}</strong><button aria-label="Tutup kelola drawing" onClick={() => setShowDrawingsManager(false)}><X size={15}/></button></div>
              {!listed.length && <p>Belum ada drawing.</p>}
              {listed.map((drawing, index) => <div className="drawing-manager-item" key={drawing.id}>
                <span>{index + 1}. {drawing.type}</span>
                <button title={drawing.visible === false ? "Tampilkan" : "Sembunyikan"} aria-label={"Toggle drawing " + (index+1)} onClick={() => changeDrawing(drawing.id, {visible: drawing.visible === false})}>{drawing.visible === false ? <EyeOff size={15}/> : <Eye size={15}/>}</button>
                <button title="Hapus" aria-label={"Hapus drawing " + (index+1)} onClick={() => changeDrawing(drawing.id, null)}><Trash2 size={15}/></button>
              </div>)}
              <button className="drawing-manager-all" onClick={() => setHideAllDrawings(value => !value)}>{hideAllDrawings ? "Tampilkan semua drawing" : "Sembunyikan semua drawing"}</button>
            </div>}
            {marketState.loadingHistory && <div className="chart-toast">Memuat candle sebelumnya…</div>}
            {tool !== "cursor" && last && <div className="chart-toast">{["horizontal","vertical"].includes(tool) ? "Klik untuk menempatkan garis." : "Klik dua titik atau tahan lalu geser."}</div>}
            {last && <button className="live-jump icon-btn" aria-label="Ke candle terbaru" title="Ke candle terbaru" onClick={() => chart.current?.live()}><Activity size={15}/></button>}
          </div>
          {prefs.compare && !wide && <ComparisonChart {...prefs.compare} theme={prefs.theme} timezone={prefs.tz} provider={prefs.provider} type={prefs.view} bull={prefs.bull || "#39c89b"} bear={prefs.bear || "#ed7b89"}
            onChange={(symbol, frame) => set({ compare: { symbol, frame } })} onClose={() => set({ compare: undefined })}/>}
        </div>
        <div className="lower-dock">
          <div className="dock-tabs">{lowerTabs.map(([id, Icon, label]) => <button key={id} className={lower === id ? "selected" : ""} aria-expanded={lower === id} onClick={() => toggleLower(id)}><Icon size={15}/><span>{label}</span></button>)}</div>
          <IconButton title={lower ? "Tutup panel bawah" : "Buka panel bawah"} onClick={() => setLower(lower ? null : "editor")} active={!!lower}><PanelBottom size={17}/></IconButton>
        </div>
        {lower && <section className="lower-panel" aria-label={lowerTabs.find(item => item[0] === lower)?.[2]}>
          <div className="resize-bottom" role="separator" aria-label="Ubah tinggi panel bawah" aria-orientation="horizontal" onPointerDown={event => {
            const top = event.clientY, height = prefs.bottomHeight;
            const target = event.currentTarget;
            target.setPointerCapture(event.pointerId);
            target.onpointermove = next => set({ bottomHeight: Math.max(190, Math.min(window.innerHeight * .7, height + top - next.clientY)) });
            target.onlostpointercapture = () => { target.onpointermove = null; };
          }}/>
          <div className="lower-mobile-head"><strong>{lowerTabs.find(item => item[0] === lower)?.[2]}</strong><IconButton title="Tutup panel" onClick={() => setLower(null)}><X size={18}/></IconButton></div>
          <div className="lower-content">
            {lower === "editor" && <ScriptEditor runnerKey={runnerKey} onRunnerKey={setRunnerKey} requested={requested} scripts={scripts} onSave={saveScript} onRun={runScript} onStop={id => setIndicators(items => items.map(item => item.kind === id ? { ...item, visible: false } : item))} onDelete={id => {
              setScripts(items => items.filter(item => item.id !== id)); setIndicators(items => items.filter(item => item.kind !== id)); setRequested(null);
            }} onLog={onLog}/>}
            {lower === "manager" && <IndicatorManager focusUid={focusIndicator} configs={indicators} scripts={scripts} stats={indicatorState.stats} onChange={updateIndicator} onRemove={uid => setIndicators(items => items.filter(item => item.uid !== uid))} timezone={prefs.tz}/>}
            {lower === "paper" && <PaperPanel key={market.id} market={market} last={last} live={live} positions={positions} timezone={prefs.tz} onOpen={item => { setPositions(items => [...items, item]); tell("Posisi simulasi dibuka."); }} onClose={closePosition}/>}
            {lower === "test" && <BacktestPanel key={chartKey} bars={marketState.bars} market={market} frame={frame} timezone={prefs.tz}/>}
            {lower === "journal" && <JournalPanel positions={positions} note={note} onNote={setNote} timezone={prefs.tz}/>}
            {lower === "console" && <div className="console"><div className="panel-intro"><h3>Runtime Console</h3><button className="subtle-button" onClick={() => setLogs([])} disabled={!logs.length}>Bersihkan</button></div>
              {!logs.length && <p className="empty-inline">Belum ada log kompilasi.</p>}{logs.slice().reverse().map((entry, index) => <p key={entry.when + ":" + index} className={entry.level === "error" ? "negative" : entry.level === "ok" ? "positive" : ""}><time>{stamp(entry.when, prefs.tz)}</time>{entry.text}</p>)}</div>}
          </div>
        </section>}
      </section>
      {prefs.side && !wide && <aside className="right-panel" aria-label="Pasar dan berita">
        <div className="resize-side" role="separator" aria-label="Ubah lebar sidebar" aria-orientation="vertical" onPointerDown={event => {
          const x = event.clientX, width = prefs.width;
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          target.onpointermove = next => set({ width: Math.min(465, Math.max(278, width + x - next.clientX)) });
          target.onlostpointercapture = () => { target.onpointermove = null; };
        }}/>
        <div className="sidebar-tabs">
          <button className={right === "watchlist" ? "selected" : ""} onClick={() => setRight("watchlist")}><List size={16}/>Watchlist</button>
          <button className={right === "news" ? "selected" : ""} onClick={() => setRight("news")}><Newspaper size={16}/>Berita</button>
          <button className={right === "calendar" ? "selected" : ""} onClick={() => setRight("calendar")}><Globe2 size={16}/>Kalender</button>
        </div>
        <div className="sidebar-content">
          {right === "watchlist" && <><Watchlist selected={market.id} favorites={favorites} lastPrice={last?.close} quotes={quotes} onMarket={selectMarket}/>
            <div className="news-preview-head"><span><Newspaper size={16}/>Berita pasar</span><button onClick={() => setRight("news")}>Lihat semua</button></div><NewsPanel timezone={prefs.tz} condensed/>
          </>}
          {right === "news" && <NewsPanel timezone={prefs.tz}/>}
          {right === "calendar" && <CalendarPanel timezone={prefs.tz}/>}
        </div>
      </aside>}
    </main>

    <footer className="statusbar">
      <span className={"footer-feed feed-" + marketState.status}><Wifi size={14}/>{labels[marketState.status]}</span><span className="status-spacer"/><span>{marketState.source || market.category}</span><span className="status-spacer"/>
      <span className="footer-history">{marketState.bars.length ? marketState.bars.length.toLocaleString("id-ID") + " candle" : market.id}</span>
      {marketState.updated && <span className="footer-update">Sinkron {stamp(marketState.updated, prefs.tz)}</span>}
      {trailingStatus && <span className="footer-warning" role="status">{trailingStatus}</span>}
      <span className="status-fill"/>
      <button className="timezone-button" onClick={() => setDialog("settings")}><Globe2 size={14}/><Clock timezone={prefs.tz}/><span>{timezoneName}</span></button>
    </footer>
    {!wide && <nav className="mobile-nav" aria-label="Navigasi mobile">
      <button className={!dialog && !lower ? "selected" : ""} onClick={() => { setDialog(null); setLower(null); }}><CandlestickChart size={19}/>Chart</button>
      <button className={dialog === "markets" ? "selected" : ""} onClick={() => { setLower(null); setDialog("markets"); }}><Search size={19}/>Markets</button>
      <button className={dialog === "indicators" ? "selected" : ""} onClick={() => { setLower(null); setDialog("indicators"); }}><Activity size={19}/>Indikator</button>
      <button className={dialog === "news" ? "selected" : ""} onClick={() => { setLower(null); setDialog("news"); }}><Newspaper size={19}/>Berita</button>
      <button className={dialog === "settings" ? "selected" : ""} onClick={() => { setLower(null); setDialog("settings"); }}><SlidersHorizontal size={19}/>Setelan</button>
    </nav>}
    {toast && <div className="toast" role="status"><CircleHelp size={17}/>{toast}<IconButton title="Tutup notifikasi" onClick={() => setToast("")}><X size={15}/></IconButton></div>}

    {dialog && <div className="modal-backdrop" onClick={() => setDialog(null)}><div className={"modal modal-" + dialog} ref={modal} role="dialog" aria-modal="true" aria-label={modalTitle} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <div className="modal-head"><h2>{modalTitle}</h2><IconButton title="Tutup dialog" onClick={() => setDialog(null)}><X size={20}/></IconButton></div>
      <div className="modal-body">
        {dialog === "markets" && <MarketPicker selected={market.id} favorites={favorites} recent={recent} quotes={quotes} onMarket={item => selectMarket(item, true)} onFavorite={favorite}/>}
        {dialog === "indicators" && <><div className="modal-quick"><button className="subtle-button" onClick={() => { setDialog(null); setLower("manager"); }}><Layers3 size={15}/>Kelola indikator</button><button className="accent-button" onClick={() => { setRequested(null); setDialog(null); setLower("editor"); }}><Code2 size={15}/>Code Editor</button></div><IndicatorLibrary configs={indicators} scripts={scripts} onAdd={addIndicator} onEdit={showScript}/></>}
        {dialog === "alerts" && <AlertsPanel key={market.id + frame} alerts={alerts} market={market} timeframe={frame} plots={alertPlots} current={last?.close} timezone={prefs.tz} onAdd={item => { setAlerts(value => [...value,item]); tell("Alert " + item.symbol + " dibuat."); }} onRemove={id => setAlerts(value => value.filter(item => item.id !== id))}/>}
        {dialog === "news" && <><div className="category-filters mobile-news-tabs"><button className={mobileEditorial === "news" ? "selected" : ""} onClick={() => setMobileEditorial("news")}>Berita</button><button className={mobileEditorial === "calendar" ? "selected" : ""} onClick={() => setMobileEditorial("calendar")}>Kalender ekonomi</button></div>{mobileEditorial === "news" ? <NewsPanel timezone={prefs.tz}/> : <CalendarPanel timezone={prefs.tz}/>}</>}
        {dialog === "data" && <MarketDataSetup market={usesBiquote ? market : byId.XAUUSD} frame={usesBiquote ? frame : "15m"}/>}
        {dialog === "settings" && <div className="settings">
          <div className="settings-form">
            <label>Tema<select value={prefs.theme} onChange={event => set({ theme: event.target.value })}><option value="dark">Gelap</option><option value="light">Terang</option></select></label>
            <label>Zona waktu<select value={prefs.tz} onChange={event => set({ tz: event.target.value })}>{timezones.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
            <label>Penyedia kripto<select value={prefs.provider} onChange={event => set({ provider: event.target.value as Preferences["provider"] })}><option value="auto">Otomatis</option><option value="binance">Binance Spot</option><option value="okx">OKX Spot</option></select></label>
            <label>Candle naik<input type="color" value={prefs.bull || "#39c89b"} onChange={event => set({ bull: event.target.value })}/></label>
            <label>Candle turun<input type="color" value={prefs.bear || "#ed7b89"} onChange={event => set({ bear: event.target.value })}/></label>
            <label>Chart pembanding<select aria-label="Chart pembanding" value={prefs.compare ? "visible" : "hidden"} onChange={event => set({ compare: event.target.value === "visible" ? { symbol: market.id === "ETHUSDT" ? "BTCUSDT" : "ETHUSDT", frame: "1h" } : undefined })}><option value="hidden">Tersembunyi</option><option value="visible">Tampil</option></select></label>
            <label>Panel kanan<select value={prefs.side ? "visible" : "hidden"} onChange={event => set({ side: event.target.value === "visible" })}><option value="visible">Tampil</option><option value="hidden">Tersembunyi</option></select></label>
          </div>
          <button className="subtle-button" onClick={() => setDialog("data")}><Settings2 size={15}/>Data Forex & logam</button>
          <h3>Layout tersimpan</h3>
          <form className="form-grid" onSubmit={event => { event.preventDefault(); const name = layoutName.trim(); if (!name) return; setSavedLayouts(items => ({ ...items, [name]: { preferences: prefs, indicators } })); setLayoutChoice(name); setLayoutName(""); tell("Layout " + name + " tersimpan."); }}>
            <label>Nama layout<input value={layoutName} maxLength={35} onChange={event => setLayoutName(event.target.value)} required/></label><button className="accent-button">Simpan layout</button>
          </form>
          <div className="form-grid">
            <label>Pilih layout<select value={layoutChoice} onChange={event => setLayoutChoice(event.target.value)}><option value="">Pilih…</option>{Object.keys(savedLayouts).map(value => <option key={value}>{value}</option>)}</select></label>
            <button className="subtle-button" disabled={!Object.hasOwn(savedLayouts, layoutChoice)} onClick={() => { const item = savedLayouts[layoutChoice]; setPrefs(item.preferences); setIndicators(item.indicators.filter(config => byIndicator[config.kind] || scripts.some(script => script.id === config.kind))); tell("Layout " + layoutChoice + " dipulihkan."); }}>Pulihkan</button>
          </div>
          {scriptsReady && <WorkspaceBackup snapshot={snapshot} onRestore={restoreWorkspace} tell={tell}/>}
          <div className="settings-actions"><button className="subtle-button" onClick={() => download("AzusaTrade-workspace.json", JSON.stringify({ settings: prefs, indicators, scripts, favorites, drawings }, null, 2), "application/json")}>Ekspor workspace</button>
            <button className="subtle-button" onClick={() => { setDialog(null); setLower("paper"); }}>Paper Trading</button><button className="subtle-button" onClick={() => { setDialog(null); setLower("test"); }}>Backtest</button></div>
        </div>}
      </div>
    </div></div>}
  </div>;
}

function Clock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(0);
  const formatter = useMemo(() => new Intl.DateTimeFormat("id-ID", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }), [timezone]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <time>{now ? formatter.format(now).replaceAll(".", ":") : "—"}</time>;
}
