"use client";

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AreaSeries, BarSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LogicalRange, MouseEventParams, SeriesType, Time, UTCTimestamp } from "lightweight-charts";
import type { Bar, DrawPoint, Drawing, Market, RenderedIndicator, Tool } from "../lib/types";

export type ViewMode = "candles" | "line" | "area" | "bars" | "hollow";
export type ChartApi = { reset: () => void; fit: () => void; capture: () => void; zoom: (factor: number) => void; live: () => void };
type ChartProps = {
  market: Market; period: number; scene: string; bars: Bar[]; type: ViewMode; theme: string;
  timezone: string; bull?: string; bear?: string; indicators: RenderedIndicator[]; drawings: Drawing[]; tool: Tool;
  onDraw: (drawing: Drawing) => void; onHover: (bar: Bar | null) => void;
};

type Coordinates = { x: number; y: number };
const utc = (value: number) => value as UTCTimestamp;
const seriesKinds = { candles: CandlestickSeries, line: LineSeries, area: AreaSeries, bars: BarSeries, hollow: CandlestickSeries };
const up = "#39c89b";
const down = "#ed7b89";
const color = (tone: string, opacity: number) => tone + Math.round(opacity / 100 * 255).toString(16).padStart(2,"0");
const fill = (tone: string, opacity: number) => color(tone, opacity);

export default memo(forwardRef<ChartApi, ChartProps>(function Chart(props, ref) {
  const { market, period, scene, bars, type, theme, timezone, indicators, drawings, tool, bull = up, bear = down } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(0);
  const [pending, setPending] = useState<DrawPoint | null>(null);
  const [pointer, setPointer] = useState<Coordinates | null>(null);
  const api = useRef<IChartApi | null>(null);
  const main = useRef<ISeriesApi<SeriesType> | null>(null);
  const overlays = useRef(new Map<string, { signature: string; series: ISeriesApi<"Line" | "Histogram">; first?: number; count?: number; last?: number }>());
  const latest = useRef(props);
  latest.current = props;
  const lastSeries = useRef<{ bars: Bar[]; scene: string; type: ViewMode } | null>(null);
  const currentBars = useRef(new Map<number, Bar>());
  const originalRange = useRef<LogicalRange | null>(null);
  const chartClick = useRef<(data: MouseEventParams<Time>) => void>(() => {});
  const drawFrame = useRef(0);
  const themeIsLight = theme === "light";

  useEffect(() => {
    if (!canvas.current) return;
    const chart = createChart(canvas.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#141a23" }, textColor: "#9aa7ba", fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 12, panes: { separatorColor: "#262f40", separatorHoverColor: "#34435a", enableResize: true }, attributionLogo: true },
      rightPriceScale: { borderColor: "#293340", scaleMargins: { top: 0.14, bottom: 0.14 }, minimumWidth: 74 },
      timeScale: { borderColor: "#293340", rightOffset: 8, timeVisible: true, secondsVisible: false, minBarSpacing: 1.2, barSpacing: 9 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#6b7b90", style: LineStyle.Dashed, labelBackgroundColor: "#334256" }, horzLine: { color: "#6b7b90", style: LineStyle.Dashed, labelBackgroundColor: "#334256" } },
      localization: { locale: "id-ID" },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    api.current = chart;
    const repaint = () => {
      if (drawFrame.current) return;
      drawFrame.current = requestAnimationFrame(() => { drawFrame.current = 0; setLayout(value => value + 1); });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(repaint);
    chart.subscribeCrosshairMove(event => {
      latest.current.onHover(typeof event.time === "number" ? currentBars.current.get(event.time) || null : null);
      if (latest.current.tool !== "cursor") setPointer(event.point ?? null);
    });
    chart.subscribeClick(event => chartClick.current(event));
    const resize = new ResizeObserver(repaint);
    const node = canvas.current;
    resize.observe(node);
    node.addEventListener("wheel", repaint, { passive: true });
    node.addEventListener("pointerup", repaint);
    return () => { resize.disconnect(); node.removeEventListener("wheel", repaint); node.removeEventListener("pointerup", repaint); cancelAnimationFrame(drawFrame.current); chart.remove(); api.current = null; main.current = null; overlays.current.clear(); };
  }, []);

  useEffect(() => {
    const chart = api.current;
    if (!chart) return;
    const dark = themeIsLight ? "#eef2f6" : "#121822";
    const grid = themeIsLight ? "#dfe5ed" : "#222c3a";
    const border = themeIsLight ? "#d6dde6" : "#283343";
    const date = new Intl.DateTimeFormat("id-ID", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
    const clock = new Intl.DateTimeFormat("id-ID", { timeZone: timezone, hour: "2-digit", minute: "2-digit", ...(period < 60 ? { second: "2-digit" } : {}), hourCycle: "h23" });
    const compactDate = new Intl.DateTimeFormat("id-ID", { timeZone: timezone, month: "short", day: "numeric" });
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: dark }, textColor: themeIsLight ? "#495b70" : "#8997aa", panes: { separatorColor: border } },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: period < 86400, secondsVisible: period < 60,
        tickMarkFormatter: (time: Time, tick: number) => typeof time !== "number" ? null : tick <= 2 ? compactDate.format(time * 1000) : clock.format(time * 1000).replaceAll(".", ":") },
      localization: { timeFormatter: (time: Time) => typeof time === "number" ? date.format(time * 1000) : String(time) },
    });
    // Apply options after the chart exists in the mount effect.
  }, [themeIsLight, timezone, period]);

  useEffect(() => {
    const chart = api.current;
    if (!chart) return;
    if (main.current) chart.removeSeries(main.current);
    const common = { priceFormat: { type: "price" as const, precision: market.precision, minMove: 10 ** -market.precision }, lastValueVisible: true, priceLineVisible: true, priceLineColor: bull };
    main.current = chart.addSeries(seriesKinds[type], {
      ...common,
      ...(type === "line" ? { color: bull, lineWidth: 2 }
        : type === "area" ? { lineColor: bull, topColor: fill(bull, 42), bottomColor: fill(bull, 7), lineWidth: 2 }
          : type === "bars" ? { upColor: bull, downColor: bear }
            : { upColor: type === "hollow" ? "transparent" : bull, downColor: bear, wickUpColor: bull, wickDownColor: bear, borderUpColor: bull, borderDownColor: bear }),
    }) as ISeriesApi<SeriesType>;
    lastSeries.current = null;
  }, [type, market.precision, bull, bear]);

  useEffect(() => {
    const chart = api.current;
    const series = main.current;
    if (!chart || !series) return;
    const last = lastSeries.current;
    const bar = bars.at(-1);
    const previous = last?.bars.at(-1);
    const same = last?.scene === scene && last.type === type;
    const transform = (value: Bar) => type === "line" || type === "area" ? { time: utc(value.time), value: value.close } : { ...value, time: utc(value.time), volume: undefined };
    const line = chart.timeScale();
    const currentRange = line.getVisibleLogicalRange();
    if (bar && previous && same && last.bars[0]?.time === bars[0]?.time && previous.time === bar.time && last.bars.length === bars.length
      && last.bars.at(-2) === bars.at(-2)) {
      series.update(transform(bar));
      currentBars.current.set(bar.time, bar);
    } else if (bar && same && previous && previous.time < bar.time && last.bars[0]?.time === bars[0]?.time && last.bars.length + 1 === bars.length) {
      const before = bars.at(-2)!;
      if (before !== previous) { series.update(transform(before)); currentBars.current.set(before.time, before); }
      series.update(transform(bar));
      currentBars.current.set(bar.time, bar);
    } else {
      series.setData(bars.map(transform));
      currentBars.current = new Map(bars.map(value => [value.time, value]));
      if (bars.length && (!same || !last?.bars.length)) {
        const windowSize = (canvas.current?.clientWidth || 840) < 600 ? 56 : 92;
        const visible = { from: Math.max(0, bars.length - windowSize), to: bars.length + 7 } as LogicalRange;
        line.setVisibleLogicalRange(visible);
        originalRange.current = visible;
      } else if (same && currentRange && last?.bars[0]?.time && bars[0]?.time < last.bars[0].time) {
        const added = bars.findIndex(value => value.time === last.bars[0].time);
        if (added > 0) line.setVisibleLogicalRange({ from: currentRange.from + added, to: currentRange.to + added });
      }
    }
    lastSeries.current = { bars, scene, type };
    if (latest.current.drawings.length) setLayout(value => value + 1);
  }, [bars, scene, type, market.precision, bull, bear]);

  const paneSignature = indicators.filter(indicator => indicator?.config.visible).map(indicator => indicator.config.uid + ":" + indicator.overlay + ":" + indicator.plots.map(plot => plot.type).join(",")).join("|");
  useEffect(() => {
    const chart = api.current;
    if (!chart) return;
    for (const entry of overlays.current.values()) chart.removeSeries(entry.series);
    overlays.current.clear();
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
  }, [paneSignature, scene]);

  useEffect(() => {
    const chart = api.current;
    if (!chart) return;
    let pane = 0;
    for (const indicator of indicators) {
      if (!indicator?.config.visible) continue;
      const { config } = indicator;
      const index = indicator.overlay ? 0 : ++pane;
      indicator.plots.forEach((plot, plotIndex) => {
        const key = config.uid + ":" + plotIndex;
        const tone = color(plot.color || config.color, config.opacity);
        let entry = overlays.current.get(key);
        const options = { title: "", priceLineVisible: false, lastValueVisible: config.kind !== "volume", color: tone };
        if (!entry) {
          const series = plot.type === "histogram" ? chart.addSeries(HistogramSeries, { ...options, priceFormat: { type: "volume" } }, index)
            : chart.addSeries(LineSeries, { ...options, lineWidth: config.width as 1 | 2 | 3 | 4, crosshairMarkerVisible: false }, index);
          entry = { series, signature: "" };
          overlays.current.set(key, entry);
          if (index > 0) chart.panes()[index]?.setHeight(config.kind === "volume" ? 70 : 115);
        }
        const format = (value: number | null, i: number) => {
          const offset = plot.offset || 0;
          const point = indicator.bars[i + offset];
          const last = indicator.bars.at(-1);
          if (!point && (i + offset < 0 || !last)) return null;
          const time = point?.time ?? last!.time + (i + offset - indicator.bars.length + 1) * period;
          const tick = indicator.bars[i];
          return value === null || !Number.isFinite(value) ? { time: utc(time) }
            : { time: utc(time), value, ...(plot.directionColor ? { color: fill(tick.close >= tick.open ? up : down, Math.min(config.opacity, 43)) } : {}) };
        };
        const first = indicator.bars[0]?.time;
        const last = indicator.bars.at(-1)?.time;
        const styleKey = tone + ":" + config.width;
        if (entry.signature !== styleKey) { entry.series.applyOptions({ ...options, lineWidth: config.width as 1 | 2 | 3 | 4 }); entry.signature = styleKey; }
        const count = plot.values.length;
        if (!plot.offset && !config.frame && entry.first === first && entry.count === count && entry.last === last && count > 0) {
          const point = format(plot.values[count - 1], count - 1);
          if (point) entry.series.update(point);
        } else {
          const points = plot.values.map(format).filter((point): point is NonNullable<typeof point> => !!point);
          entry.series.setData(points);
        }
        entry.first = first;
        entry.last = last;
        entry.count = count;
      });
    }
  }, [indicators, scene, paneSignature, period]);

  useEffect(() => { setPending(null); setPointer(null); }, [tool, scene]);
  function position(point: DrawPoint): Coordinates | null {
    const chart = api.current;
    const series = main.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(utc(point.time));
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x: Number(x), y: Number(y) };
  }
  chartClick.current = event => {
    if (tool === "cursor" || typeof event.time !== "number" || !event.point) return;
    const price = main.current?.coordinateToPrice(event.point.y);
    if (price === null || price === undefined) return;
    const point = { time: event.time, price };
    if (tool === "horizontal" || tool === "vertical") { props.onDraw({ id: crypto.randomUUID(), type: tool, points: [point] }); return; }
    if (!pending) { setPending(point); return; }
    props.onDraw({ id: crypto.randomUUID(), type: tool, points: [pending, point] });
    setPending(null);
  };
  useImperativeHandle(ref, () => ({
    reset() { if (originalRange.current) api.current?.timeScale().setVisibleLogicalRange(originalRange.current); },
    fit() { api.current?.timeScale().fitContent(); },
    live() { api.current?.timeScale().scrollToRealTime(); },
    zoom(factor) {
      const line = api.current?.timeScale();
      const range = line?.getVisibleLogicalRange();
      if (!line || !range) return;
      const center = (range.from + range.to) / 2;
      const half = (range.to - range.from) * factor / 2;
      line.setVisibleLogicalRange({ from: center - half, to: center + half });
    },
    capture() {
      const picture = api.current?.takeScreenshot(true, true);
      if (!picture) return;
      const link = document.createElement("a");
      link.href = picture.toDataURL("image/png");
      link.download = "AzusaTrade-" + market.id + ".png";
      link.click();
    },
  }), [market.id]);

  function visual(drawing: Drawing) {
    const a = position(drawing.points[0]);
    const b = drawing.points[1] ? position(drawing.points[1]) : null;
    const width = canvas.current?.clientWidth || 0;
    const height = chartHeight(api.current, canvas.current);
    if (!a) return null;
    const style = { stroke: "#7fbcf9", strokeWidth: 1.4 };
    if (drawing.type === "horizontal") return <g key={drawing.id}><line {...style} x1="0" x2={width - 74} y1={a.y} y2={a.y} strokeDasharray="5 4"/><text x="12" y={a.y - 5}>{drawing.points[0].price.toFixed(market.precision)}</text></g>;
    if (drawing.type === "vertical") return <line key={drawing.id} {...style} x1={a.x} x2={a.x} y1="0" y2={height} strokeDasharray="5 4"/>;
    if (!b) return null;
    if (drawing.type === "trend") return <line key={drawing.id} {...style} x1={a.x} x2={b.x} y1={a.y} y2={b.y}/>;
    const x = Math.min(a.x, b.x), w = Math.max(1, Math.abs(a.x - b.x)), y = Math.min(a.y, b.y), h = Math.abs(a.y - b.y);
    if (drawing.type === "rectangle") return <rect key={drawing.id} {...style} x={x} y={y} width={w} height={h} fill="#7fbcf91a"/>;
    if (drawing.type === "fibonacci") return <g key={drawing.id}>{[0, .236, .382, .5, .618, .786, 1].map(ratio => {
      const top = a.y + (b.y - a.y) * ratio;
      return <g key={ratio}><line {...style} x1={x} x2={x + w} y1={top} y2={top}/><text x={x + 4} y={top - 3}>{ratio}</text></g>;
    })}</g>;
    const loss = Math.abs(drawing.points[1].price - drawing.points[0].price);
    if (drawing.type === "measure") return <g key={drawing.id}><line {...style} x1={a.x} x2={b.x} y1={a.y} y2={b.y} strokeDasharray="3 4"/><text x={x + 4} y={y - 5}>{(loss / drawing.points[0].price * 100).toFixed(2)}%</text></g>;
    const yTarget = a.y + (a.y - b.y) * 2;
    return <g key={drawing.id}><rect x={x} y={y} width={w} height={h} fill="#ed7b8938" stroke={down}/><rect x={x} y={Math.min(yTarget, a.y)} width={w} height={Math.abs(yTarget - a.y)} fill="#39c89b30" stroke={up}/><text x={x + 5} y={a.y - 5}>R/R 2.00</text></g>;
  }
  const draft = pending ? position(pending) : null;
  return <div className={"chart-frame draw-" + tool} data-repaint={layout}>
    <div ref={canvas} className="chart-canvas" aria-label={"Chart " + market.name}/>
    {(drawings.length > 0 || draft) && <svg className="chart-drawings" aria-hidden="true">
      {drawings.map(visual)}
      {draft && <><circle cx={draft.x} cy={draft.y} r="4" fill="#8cc3ff"/>{pointer && <line x1={draft.x} y1={draft.y} x2={pointer.x} y2={pointer.y} stroke="#8cc3ff" strokeDasharray="4 4"/>}</>}
    </svg>}
  </div>;
}));

function chartHeight(api: IChartApi | null, node: HTMLElement | null) {
  return api?.panes()[0]?.getHeight() || node?.clientHeight || 0;
}
