"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { IChartApi, ISeriesApi, SeriesType, UTCTimestamp, Logical } from "lightweight-charts";
import type { Bar, PineVisuals, RenderedIndicator } from "../lib/types";

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<SeriesType> | null;
  bars: Bar[];
  indicators: RenderedIndicator[];
  width: number;
  height: number;
};

// Never allow Pine script text to become HTML, SVG markup or a CSS expression.
const cssColor = (candidate: unknown, fallback: string) => {
  if (typeof candidate !== "string") return fallback;
  if (/^#[a-f\d]{3,8}$/i.test(candidate)) return candidate;
  if (/^rgba?\([\d.,\s%]+\)$/i.test(candidate)) return candidate;
  if (/^(transparent|red|green|blue|white|black|orange|yellow|gray|grey|lime|teal|aqua|fuchsia)$/i.test(candidate)) return candidate;
  return fallback;
};
const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const dashed = (s: unknown) => typeof s === "string" && /dash|dot/.test(s) ? (/dot/.test(s) ? "2 3" : "6 4") : undefined;
const xIsTime = (xloc?: string) => xloc === "bt" || xloc === "bar_time" || xloc === "xloc.bar_time";
const yIsPrice = (yloc?: string) => !yloc || yloc === "pr" || yloc === "price" || yloc === "yloc.price";
const asTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

function Layer({ chart, series, bars, indicators, width, height }: Props) {
  const atTime = useMemo(() => new Map(bars.map((bar, index) => [bar.time, index])), [bars]);
  if (!chart || !series || !bars.length || width < 50 || height < 50) return null;
  const visible = indicators.filter(i => i?.config?.visible && i.visuals);
  if (!visible.length) return null;
  const scale = chart.timeScale();
  const resolveX = (n: number, xloc: string | undefined, visuals: PineVisuals) => {
    if (!num(n)) return null;
    if (xIsTime(xloc)) {
      const sec = Math.floor(n / 1000);
      // PineTS xloc.bar_time carries Unix milliseconds. Native MTF labels may
      // fall *inside* a chart candle. Interpolate their x coordinate instead
      // of snapping the timestamp or inventing a new chart bar.
      if (atTime.has(sec)) {
        const exact = scale.timeToCoordinate(asTime(n));
        return exact === null ? null : Number(exact);
      }
      if (sec < bars[0].time) return null;
      let lo = 0, hi = bars.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (bars[mid].time <= sec) lo = mid + 1;
        else hi = mid - 1;
      }
      const left = Math.max(0, hi);
      if (left === bars.length - 1) {
        const duration = bars.length > 1 ? bars.at(-1)!.time - bars.at(-2)!.time : 0;
        if (duration <= 0 || sec - bars[left].time > 256 * duration) return null;
        const projected = scale.logicalToCoordinate((left + (sec - bars[left].time) / duration) as Logical);
        return projected === null ? null : Number(projected);
      }
      const span = bars[left + 1].time - bars[left].time;
      if (span <= 0) return null;
      const logical = left + (sec - bars[left].time) / span;
      const px = scale.logicalToCoordinate(logical as Logical);
      return px === null ? null : Number(px);
    }
    const logical = (visuals.barIndexOffset ?? 0) + n;
    const px = scale.logicalToCoordinate(logical as Logical);
    return px === null ? null : Number(px);
  };
  const resolveY = (price: number) => {
    if (!num(price)) return null;
    const px = series.priceToCoordinate(price);
    return px === null ? null : Number(px);
  };
  const drawings: ReactNode[] = [];
  const tables: ReactNode[] = [];
  for (const indicator of visible) {
    const v = indicator.visuals!;
    const key = indicator.config.uid;
    for (const [idx, box] of v.boxes.entries()) {
      let x1 = resolveX(box.left, box.xloc, v);
      let x2 = resolveX(box.right, box.xloc, v);
      const y1 = resolveY(box.top), y2 = resolveY(box.bottom);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      if (/right|both/.test(box.extend || "")) x2 = width - 78;
      if (/left|both/.test(box.extend || "")) x1 = 0;
      const x = Math.min(x1, x2), y = Math.min(y1, y2);
      const w = Math.max(1, Math.abs(x2 - x1)), h = Math.max(1, Math.abs(y2 - y1));
      drawings.push(<g key={`${key}-box-${box.id}-${idx}`}>
        <rect x={x} y={y} width={w} height={h} stroke={cssColor(box.border_color, "#7ca4bf")}
          strokeWidth={Math.min(4, Math.max(0, box.border_width || 1))} strokeDasharray={dashed(box.border_style)}
          fill={cssColor(box.bgcolor, "#426b8530")}/>
        {box.text && w > 55 && h > 20 && <text x={x + 5} y={y + 13} fill="#ebf2fa" fontSize="10">{box.text.slice(0, 42)}</text>}
      </g>);
    }
    for (const [idx, line] of v.lines.entries()) {
      let x1 = resolveX(line.x1, line.xloc, v);
      let x2 = resolveX(line.x2, line.xloc, v);
      const y1 = resolveY(line.y1), y2 = resolveY(line.y2);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      // Respect horizontal native Pine lines for extended price levels.
      if (y1 === y2 && /right|both/.test(line.extend || "")) x2 = width - 78;
      if (y1 === y2 && /left|both/.test(line.extend || "")) x1 = 0;
      drawings.push(<line key={`${key}-line-${line.id}-${idx}`} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={cssColor(line.color, "#97b6d6")} strokeWidth={Math.min(5, Math.max(0.5, line.width || 1))}
        strokeDasharray={dashed(line.style)}/>);
    }
    for (const [idx, label] of v.labels.entries()) {
      const x = resolveX(label.x, label.xloc, v);
      let y = resolveY(label.y);
      if (x === null) continue;
      if (!yIsPrice(label.yloc) && (y === null || !num(label.y))) {
        // Above/below bars are position hints, not prices. This only moves
        // the native label; it does not infer a trade or signal.
        const index = xIsTime(label.xloc) ? atTime.get(Math.floor(label.x / 1000)) : (v.barIndexOffset ?? 0) + Math.round(label.x);
        const sourceBar = index == null ? null : bars[index];
        if (sourceBar) {
          const anchor = /below/.test(label.yloc || "") ? sourceBar.low : sourceBar.high;
          const px = resolveY(anchor);
          if (px !== null) y = px + (/below/.test(label.yloc || "") ? 15 : -15);
        }
      }
      if (y === null) continue;
      const lines = (label.text || "").split("\n").slice(0, 5);
      const fontSize = /tiny/.test(label.size || "") ? 9 : /small/.test(label.size || "") ? 10 : 11;
      const boxWidth = Math.min(255, Math.max(35, ...lines.map(l => l.length * (fontSize * .57) + 14)));
      const boxHeight = Math.max(18, lines.length * (fontSize + 3) + 7);
      const isDown = /down/.test(label.style || "");
      const top = isDown ? y - boxHeight - 6 : y + 6;
      const fill = cssColor(label.color, "#283e59");
      drawings.push(<g key={`${key}-label-${label.id}-${idx}`}>
        <rect x={x - boxWidth / 2} y={top} width={boxWidth} height={boxHeight} rx={5}
          fill={fill} fillOpacity={0.94} stroke={cssColor(label.textcolor, "#ffffff")} strokeOpacity={.20}/>
        {lines.map((text, lineIndex) => <text key={lineIndex} x={x} y={top + 5 + fontSize + lineIndex * (fontSize + 3)}
          textAnchor="middle" fontSize={fontSize} fill={cssColor(label.textcolor, "#ffffff")}>{text.slice(0, 55)}</text>)}
      </g>);
    }
    for (const [idx, shape] of v.shapes.entries()) {
      if (!atTime.has(shape.time)) continue;
      const sourceBar = bars[atTime.get(shape.time)!];
      if (!sourceBar) continue;
      const xPos = scale.timeToCoordinate(shape.time as UTCTimestamp);
      const isBelow = /below/i.test(shape.location || "");
      const priceY = resolveY(isBelow ? sourceBar.low : sourceBar.high);
      if (xPos === null || priceY === null) continue;
      const x = Number(xPos), y = priceY + (isBelow ? 13 : -13);
      const tone = cssColor(shape.color, isBelow ? "#51d5a4" : "#ed7b89");
      const isTriangle = /triang|arrow/.test(shape.shape || "");
      drawings.push(<g key={`${key}-shape-${shape.id}-${idx}`}>
        {isTriangle ? <polygon fill={tone} points={isBelow ? `${x},${y - 6} ${x - 5},${y + 4} ${x + 5},${y + 4}` : `${x},${y + 6} ${x - 5},${y - 4} ${x + 5},${y - 4}`}/>
          : <circle cx={x} cy={y} r={3.7} fill={tone}/>}
        {shape.text && <text x={x} y={y + (isBelow ? 16 : -10)} textAnchor="middle" fontSize={9} fill={tone}>{shape.text}</text>}
      </g>);
    }
    for (const [idx, table] of v.tables.entries()) {
      const position = /bottom_left/i.test(table.position) ? "bottom-left" : /top_right/i.test(table.position) ? "top-right" : /top_left/i.test(table.position) ? "top-left" : "bottom-right";
      tables.push(<div key={`${key}-table-${table.id}-${idx}`} className={`pine-native-table pine-${position}`} aria-label="Statistik asli PineTS">
        <table><tbody>{table.cells.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} style={{
          color: cssColor(cell?.text_color, "#dbe7f4"),
          backgroundColor: cssColor(cell?.bgcolor, "transparent"),
          textAlign: cell?.text_halign === "left" ? "left" : cell?.text_halign === "right" ? "right" : "center",
        }}>{cell?.text || ""}</td>)}</tr>)}</tbody></table>
      </div>);
    }
  }
  if (!drawings.length && !tables.length) return null;
  return <>
    {!!drawings.length && <svg className="pine-native-drawings" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      aria-label="Label, zona dan level hasil asli PineTS" pointerEvents="none">{drawings}</svg>}
    {tables}
  </>;
}

export default Layer;
