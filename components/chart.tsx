"use client";

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EyeOff, Pencil, Trash2, X } from "lucide-react";
import { AreaSeries, BarSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart } from "lightweight-charts";
import type { Coordinate, IChartApi, ISeriesApi, ITimeScaleApi, SeriesType, Time, UTCTimestamp } from "lightweight-charts";
import type { Bar, DrawPoint, Drawing, Market, RenderedIndicator, Tool } from "../lib/types";
import PineDrawingLayer from "./pine-drawing-layer";

export type ViewMode = "candles" | "line" | "area" | "bars" | "hollow";
export type ChartApi = { reset: () => void; fit: () => void; capture: () => void; zoom: (factor: number) => void; live: () => void };
type ChartProps = {
  market: Market; period: number; scene: string; bars: Bar[]; type: ViewMode; theme: string;
  timezone: string; bull?: string; bear?: string; indicators: RenderedIndicator[]; drawings: Drawing[]; tool: Tool;
  onDraw: (drawing: Drawing) => void; onChangeDrawing: (id: string, patch: Partial<Drawing> | null) => void; onHover: (bar: Bar | null) => void;
};

type Coordinates = { x: number; y: number };
const utc = (value: number) => value as UTCTimestamp;
const seriesKinds = { candles: CandlestickSeries, line: LineSeries, area: AreaSeries, bars: BarSeries, hollow: CandlestickSeries };
const up = "#39c89b";
const down = "#ed7b89";
const color = (tone: string, opacity: number) => tone + Math.round(opacity / 100 * 255).toString(16).padStart(2,"0");
const fill = (tone: string, opacity: number) => color(tone, opacity);

function showRecent(scale: ITimeScaleApi<Time>, bars: Bar[]) {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return;
  const firstIndex = scale.timeToIndex(utc(first.time));
  const lastIndex = scale.timeToIndex(utc(last.time));
  if (firstIndex === null || lastIndex === null) return;
  const compact = scale.width() < 600;
  const count = compact ? 56 : 92;
  scale.setVisibleLogicalRange({
    from: Math.max(firstIndex, lastIndex - count + 1),
    to: lastIndex + (compact ? 5 : 8),
  });
}

function nearSegment(point: Coordinates, start: Coordinates, end: Coordinates, padding: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const fraction = length ? Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy) <= padding;
}

export default memo(forwardRef<ChartApi, ChartProps>(function Chart(props, ref) {
  const { market, period, scene, bars, type, theme, timezone, indicators, drawings, tool, bull = up, bear = down } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(0);
  const [pending, setPending] = useState<DrawPoint | null>(null);
  const [pointer, setPointer] = useState<Coordinates | null>(null);
  const [dragStart, setDragStart] = useState<DrawPoint | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPreview, setEditPreview] = useState<{ id: string; points: DrawPoint[] } | null>(null);
  const editGesture = useRef<{ id: string; index: number; pointerId: number } | null>(null);
  const gesture = useRef<{ start: DrawPoint; x: number; y: number; pointerId: number } | null>(null);
  const api = useRef<IChartApi | null>(null);
  const main = useRef<ISeriesApi<SeriesType> | null>(null);
  const overlays = useRef(new Map<string, { signature: string; series: ISeriesApi<"Line" | "Histogram">; first?: number; count?: number; last?: number }>());
  const latest = useRef(props);
  latest.current = props;
  const lastSeries = useRef<{ bars: Bar[]; scene: string; type: ViewMode } | null>(null);
  const currentBars = useRef(new Map<number, Bar>());
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
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      kineticScroll: { mouse: false, touch: true },
    });
    api.current = chart;
    const repaint = () => {
      if (drawFrame.current) return;
      const { drawings, indicators, tool } = latest.current;
      if (!drawings.length && tool === "cursor" && !indicators.some(item => item.config.visible && item.visuals)) return;
      drawFrame.current = requestAnimationFrame(() => { drawFrame.current = 0; setLayout(value => value + 1); });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(repaint);
    chart.subscribeCrosshairMove(event => {
      latest.current.onHover(typeof event.time === "number" ? currentBars.current.get(event.time) || null : null);
      if (latest.current.tool !== "cursor") setPointer(event.point ?? null);
    });
    // Select after a chart click so pointer-down and touch gestures can reach the canvas.
    chart.subscribeClick(event => {
      if (latest.current.tool !== "cursor" || event.paneIndex !== 0 || !event.point) return;
      const id = findDrawing(event.point);
      setSelectedId(id);
      setEditingId(current => current === id ? current : null);
    });
    const resize = new ResizeObserver(repaint);
    const node = canvas.current;
    resize.observe(node);
    node.addEventListener("wheel", repaint, { passive: true });
    node.addEventListener("pointerup", repaint);
    function repaintDuringDrag(event: PointerEvent) {
      if (event.buttons & 1) repaint();
    }
    node.addEventListener("pointermove", repaintDuringDrag, { passive: true });
    return () => {
      resize.disconnect();
      node.removeEventListener("wheel", repaint);
      node.removeEventListener("pointerup", repaint);
      node.removeEventListener("pointermove", repaintDuringDrag);
      cancelAnimationFrame(drawFrame.current);
      drawFrame.current = 0;
      chart.remove();
      api.current = null;
      main.current = null;
      overlays.current.clear();
    };
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
      const range = same && last.bars.length && bars.length ? line.getVisibleLogicalRange() : null;
      const oldFirst = last?.bars[0];
      const oldLastIndex = previous ? line.timeToIndex(utc(previous.time)) : null;
      const followsNewBar = !!(range && bar && previous && bar.time > previous.time
        && oldLastIndex !== null && range.from <= oldLastIndex && range.to >= oldLastIndex);
      let anchor: Bar | undefined;
      let anchorBefore: number | null = null;
      if (range && last && oldFirst && !followsNewBar && oldFirst.time !== bars[0].time) {
        const firstIndex = line.timeToIndex(utc(oldFirst.time)) ?? 0;
        const position = Math.round((range.from + range.to) / 2) - firstIndex;
        anchor = last.bars[Math.max(0, Math.min(last.bars.length - 1, position))];
        anchorBefore = line.timeToIndex(utc(anchor.time));
      }

      series.setData(bars.map(transform));
      currentBars.current = new Map(bars.map(value => [value.time, value]));
      if (bars.length && (!same || !last.bars.length)) {
        showRecent(line, bars);
      } else if (range && anchor && anchorBefore !== null) {
        const anchorAfter = line.timeToIndex(utc(anchor.time));
        if (anchorAfter !== null) {
          const shift = anchorAfter - anchorBefore;
          line.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
        }
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

  useEffect(() => {
    setPending(null); setPointer(null); setDragStart(null);
    gesture.current = null; editGesture.current = null;
    setSelectedId(null); setEditingId(null); setEditPreview(null);
  }, [tool, scene]);

  // Delete/Backspace only affect a selected drawing, never an input or code editor.
  useEffect(() => {
    if (!selectedId || tool !== "cursor") return;
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (element?.closest('input,textarea,select,[contenteditable="true"], [role="textbox"]')) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        latest.current.onChangeDrawing(selectedId, null);
        setSelectedId(null); setEditingId(null); setEditPreview(null);
      } else if (event.key === "Escape") {
        setSelectedId(null); setEditingId(null); setEditPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, tool]);
  function position(point: DrawPoint): Coordinates | null {
    const chart = api.current;
    const series = main.current;
    if (!chart || !series) return null;
    let x: number | null = chart.timeScale().timeToCoordinate(utc(point.time));
    const y = series.priceToCoordinate(point.price);
    // Lightweight Charts may not map timestamps beyond the latest candle.
    // Future/right-margin drawing points still need to be rendered.
    if (x === null && latest.current.bars.length) {
      const source = latest.current.bars;
      const last = source[source.length - 1];
      const logical = source.length - 1 + (point.time - last.time) / latest.current.period;
      x = chart.timeScale().logicalToCoordinate(logical as import("lightweight-charts").Logical);
    }
    return x === null || y === null ? null : { x: Number(x), y: Number(y) };
  }
  function findDrawing(point: Coordinates) {
    const list = latest.current.drawings;
    for (let index = list.length - 1; index >= 0; index--) {
      const drawing = list[index];
      if (drawing.visible === false) continue;
      const a = position(drawing.points[0]);
      if (!a) continue;
      if (drawing.type === "horizontal") {
        if (Math.abs(point.y - a.y) <= 8) return drawing.id;
        continue;
      }
      if (drawing.type === "vertical") {
        if (Math.abs(point.x - a.x) <= 8) return drawing.id;
        continue;
      }
      const b = drawing.points[1] && position(drawing.points[1]);
      if (!b) continue;
      if (drawing.type === "trend" || drawing.type === "measure") {
        if (nearSegment(point, a, b, 9)) return drawing.id;
      } else if (point.x >= Math.min(a.x, b.x) - 7 && point.x <= Math.max(a.x, b.x) + 7
        && point.y >= Math.min(a.y, b.y) - 7 && point.y <= Math.max(a.y, b.y) + 7) {
        return drawing.id;
      }
    }
    return null;
  }

  // The overlay consumes pointer gestures only while a drawing tool is selected.
  // Clicking twice and pressing/dragging both produce the same two-point shape.
  function pointerCoordinates(event: ReactPointerEvent<SVGSVGElement>): Coordinates {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function chartPoint(coords: Coordinates): DrawPoint | null {
    const series = main.current;
    const chart = api.current;
    if (!series || !chart) return null;
    const price = series.coordinateToPrice(coords.y as Coordinate);
    if (price === null || !Number.isFinite(price)) return null;
    const scale = chart.timeScale();
    const ts = scale.coordinateToTime(coords.x as Coordinate);
    let time = typeof ts === "number" ? ts : NaN;
    if (!Number.isFinite(time)) {
      const logical = scale.coordinateToLogical(coords.x as Coordinate);
      if (logical === null || !latest.current.bars.length) return null;
      const list = latest.current.bars;
      const index = Math.round(logical);
      time = index < 0 ? list[0].time + index * period : index >= list.length
        ? list[list.length - 1].time + (index - list.length + 1) * period : list[index].time;
    }
    return { time: Math.round(time), price };
  }
  function beginDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool === "cursor" || event.button !== 0) return;
    const coords = pointerCoordinates(event);
    const point = chartPoint(coords);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { start: point, x: coords.x, y: coords.y, pointerId: event.pointerId };
    setDragStart(point);
    setPointer(coords);
  }
  function moveDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    const coords = pointerCoordinates(event);
    if (editGesture.current) {
      if (event.pointerId !== editGesture.current.pointerId) return;
      const point = chartPoint(coords);
      const drawing = latest.current.drawings.find(item => item.id === editGesture.current?.id);
      if (point && drawing) {
        const points = [...(editPreview?.id === drawing.id ? editPreview.points : drawing.points)];
        points[editGesture.current.index] = point;
        setEditPreview({ id: drawing.id, points });
      }
      return;
    }
    if (tool !== "cursor") setPointer(coords);
  }
  function beginEdit(event: ReactPointerEvent<SVGCircleElement>, id: string, index: number) {
    if (tool !== "cursor" || editingId !== id) return;
    event.stopPropagation(); event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    editGesture.current = { id, index, pointerId: event.pointerId };
  }
  function finishEdit(event: ReactPointerEvent<SVGSVGElement>) {
    const active = editGesture.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    const coords = pointerCoordinates(event);
    const point = chartPoint(coords);
    const drawing = latest.current.drawings.find(item => item.id === active.id);
    if (point && drawing) {
      const points = [...(editPreview?.id === drawing.id ? editPreview.points : drawing.points)];
      points[active.index] = point;
      latest.current.onChangeDrawing(active.id, { points });
    }
    editGesture.current = null;
    setEditPreview(null);
    return true;
  }
  function endDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId || tool === "cursor") return;
    gesture.current = null;
    setDragStart(null);
    const coords = pointerCoordinates(event);
    const target = chartPoint(coords);
    if (!target) return;
    const moved = Math.hypot(coords.x - active.x, coords.y - active.y) >= 5;
    if (tool === "horizontal" || tool === "vertical") {
      latest.current.onDraw({ id: crypto.randomUUID(), type: tool, points: [target] });
    } else if (moved) {
      latest.current.onDraw({ id: crypto.randomUUID(), type: tool, points: [pending ?? active.start, target] });
      setPending(null);
    } else if (pending) {
      latest.current.onDraw({ id: crypto.randomUUID(), type: tool, points: [pending, target] });
      setPending(null);
    } else setPending(target);
  }
  useImperativeHandle(ref, () => ({
    reset() {
      const chart = api.current;
      if (!chart) return;
      chart.priceScale("right").applyOptions({ autoScale: true });
      showRecent(chart.timeScale(), latest.current.bars);
    },
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
    if (drawing.visible === false) return null;
    const a = position(drawing.points[0]);
    const b = drawing.points[1] ? position(drawing.points[1]) : null;
    const width = canvas.current?.clientWidth || 0;
    const height = chartHeight(api.current, canvas.current);
    if (!a) return null;
    const selected = selectedId === drawing.id;
    const style = { stroke: selected ? "#f2d184" : "#7fbcf9", strokeWidth: selected ? 2.4 : 1.4 };
    let shape;
    if (drawing.type === "horizontal") {
      shape = <><line {...style} x1="0" x2={width - 74} y1={a.y} y2={a.y} strokeDasharray="5 4"/><text x="12" y={a.y - 5}>{drawing.points[0].price.toFixed(market.precision)}</text></>;
    } else if (drawing.type === "vertical") {
      shape = <line {...style} x1={a.x} x2={a.x} y1="0" y2={height} strokeDasharray="5 4"/>;
    } else if (b) {
      const x = Math.min(a.x, b.x), w = Math.max(1, Math.abs(a.x - b.x));
      const y = Math.min(a.y, b.y), h = Math.max(1, Math.abs(a.y - b.y));
      if (drawing.type === "trend") shape = <line {...style} x1={a.x} x2={b.x} y1={a.y} y2={b.y}/>;
      else if (drawing.type === "rectangle") shape = <rect {...style} x={x} y={y} width={w} height={h} fill="#7fbcf91a"/>;
      else if (drawing.type === "fibonacci") shape = <>{[0, .236, .382, .5, .618, .786, 1].map(ratio => {
        const top = a.y + (b.y - a.y) * ratio;
        return <g key={ratio}><line {...style} x1={x} x2={x+w} y1={top} y2={top}/><text x={x+4} y={top-3}>{ratio}</text></g>;
      })}</>;
      else if (drawing.type === "measure") shape = <><line {...style} x1={a.x} x2={b.x} y1={a.y} y2={b.y} strokeDasharray="3 4"/><text x={x+4} y={y-5}>{(Math.abs(drawing.points[1].price-drawing.points[0].price)/drawing.points[0].price*100).toFixed(2)}%</text></>;
      else {
        const yTarget = a.y + (a.y - b.y) * 2;
        shape = <><rect x={x} y={y} width={w} height={h} fill="#ed7b8938" stroke={down}/><rect x={x} y={Math.min(yTarget,a.y)} width={w} height={Math.abs(yTarget-a.y)} fill="#39c89b30" stroke={up}/><text x={x+5} y={a.y-5}>R/R 2.00</text></>;
      }
    }
    return shape ? <g key={drawing.id}>{shape}</g> : null;
  }
  const selected = drawings.find(item => item.id === selectedId && item.visible !== false);
  const activeSelected = selected && editPreview?.id === selected.id ? { ...selected, points: editPreview.points } : selected;
  const previewAnchor = pending ?? dragStart;
  const previewPoint = pointer && tool !== "cursor" ? chartPoint(pointer) : null;
  const onePoint = tool === "horizontal" || tool === "vertical";
  const previewDrawing: Drawing | null = tool !== "cursor" && (onePoint ? (previewPoint || previewAnchor) : previewAnchor) ? {
    id: "__draft__", type: tool,
    points: onePoint ? [previewPoint ?? previewAnchor!] :
      previewAnchor && previewPoint ? [previewAnchor, previewPoint] : [previewAnchor!],
  } : null;
  const selectedCoordinates = activeSelected?.points.map(position).filter((point): point is Coordinates => point !== null) ?? [];
  const anchorX = selectedCoordinates.length ? selectedCoordinates.reduce((sum, point) => sum + point.x, 0) / selectedCoordinates.length : 0;
  const anchorY = selectedCoordinates.length ? Math.min(...selectedCoordinates.map(point => point.y)) : 0;
  const width = canvas.current?.clientWidth ?? 800;
  const height = canvas.current?.clientHeight ?? 400;
  const toolbar = {
    left: Math.max(82, Math.min(width - 82, anchorX)),
    top: Math.min(height - 52, Math.max(10, anchorY >= 55 ? anchorY - 46 : anchorY + 18)),
  };
  return <div className={"chart-frame draw-" + tool} data-repaint={layout}>
    <div ref={canvas} className="chart-canvas" aria-label={"Chart " + market.name}/>
    <PineDrawingLayer chart={api.current} series={main.current} bars={bars} indicators={indicators} width={width} height={height}/>
    {(tool !== "cursor" || drawings.some(item => item.visible !== false)) && <svg
      className={"chart-drawings" + (tool !== "cursor" ? " drawing-mode" : "")}
      aria-label="Drawing pada chart"
      onPointerDown={beginDrawing}
      onPointerMove={moveDrawing}
      onPointerUp={event => { if (!finishEdit(event)) endDrawing(event); }}
      onPointerCancel={() => { gesture.current = null; editGesture.current = null; setEditPreview(null); setDragStart(null); }}>
      {tool !== "cursor" && <rect className="drawing-input-area" width={api.current?.timeScale().width() ?? 0}
        height={chartHeight(api.current, canvas.current)} fill="transparent" />}
      {drawings.map(item => visual(editPreview?.id === item.id ? { ...item, points: editPreview.points } : item))}
      {previewDrawing && <g className="drawing-preview" pointerEvents="none">{visual(previewDrawing)}</g>}
      {editingId && activeSelected?.id === editingId && activeSelected.points.map((point, index) => {
        const coordinate = position(point);
        return coordinate && <circle key={index} className="drawing-edit-handle" cx={coordinate.x} cy={coordinate.y} r="6.5"
          onPointerDown={event => beginEdit(event, activeSelected.id, index)}
          aria-label={"Geser titik " + (index + 1)} />;
      })}
    </svg>}
    {selected && tool === "cursor" && <div className="drawing-selection-menu" style={toolbar} role="toolbar" aria-label="Pengaturan drawing terpilih">
      <button type="button" className={editingId === selected.id ? "active" : ""} title="Edit drawing: geser titik biru" aria-label="Edit posisi drawing"
        onClick={() => { setEditingId(value => value === selected.id ? null : selected.id); setEditPreview(null); }}><Pencil size={16}/></button>
      <button type="button" title="Sembunyikan drawing" aria-label="Sembunyikan drawing" onClick={() => {
        latest.current.onChangeDrawing(selected.id, { visible: false }); setSelectedId(null); setEditingId(null);
      }}><EyeOff size={16}/></button>
      <button type="button" className="danger" title="Hapus drawing (Delete)" aria-label="Hapus drawing" onClick={() => {
        latest.current.onChangeDrawing(selected.id, null); setSelectedId(null); setEditingId(null);
      }}><Trash2 size={16}/></button>
      <button type="button" title="Tutup toolbar" aria-label="Batalkan seleksi" onClick={() => { setSelectedId(null); setEditingId(null); }}><X size={16}/></button>
    </div>}
  </div>;
}));

function chartHeight(api: IChartApi | null, node: HTMLElement | null) {
  return api?.panes()[0]?.getHeight() || node?.clientHeight || 0;
}
