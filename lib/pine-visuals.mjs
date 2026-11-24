/**
 * Lossless-enough display transport for PineTS v0.13.1 drawing snapshots.
 * This file ONLY reads PineTS output. It never recomputes a trade, score,
 * zone, exit, or reverse signal. Missing objects remain missing.
 */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const limitText = (text, length = 220) => typeof text === 'string' ? text.slice(0, length) : '';
const limitArray = (value, limit) => Array.isArray(value) ? value.slice(-limit) : [];
const live = value => value && typeof value === 'object' && value._deleted !== true;

// PineTS serializes current drawing objects as one snapshot at data[-1].value,
// not one drawing object per bar.
function snapshot(plots, key, max) {
  const points = plots?.[key]?.data;
  if (!Array.isArray(points) || !points.length) return [];
  const latest = points.at(-1)?.value;
  return limitArray(latest, max).filter(live);
}

export function extractPineVisuals(plots, options = {}) {
  const maxLabels = Math.min(500, Math.max(0, options.maxLabels ?? 220));
  const maxBoxes = Math.min(100, Math.max(0, options.maxBoxes ?? 80));
  const maxLines = Math.min(200, Math.max(0, options.maxLines ?? 120));
  const out = { labels: [], boxes: [], lines: [], tables: [], shapes: [] };
  for (const key of ['__labels__', '__labels_overlay__']) {
    for (const x of snapshot(plots, key, maxLabels)) {
      if (!finite(x.x) || (!finite(x.y) && !/above|below/i.test(x.yloc || ''))) continue;
      out.labels.push({ id: String(x.id ?? ''), x: x.x, y: x.y,
        xloc: x.xloc || 'bi', yloc: x.yloc || 'pr', text: limitText(x.text),
        color: x.color, textcolor: x.textcolor, style: x.style, size: x.size });
    }
  }
  for (const key of ['__boxes__', '__boxes_overlay__']) {
    for (const x of snapshot(plots, key, maxBoxes)) {
      if (![x.left, x.right, x.top, x.bottom].every(finite)) continue;
      out.boxes.push({ id: String(x.id ?? ''), left: x.left, right: x.right,
        top: x.top, bottom: x.bottom, xloc: x.xloc || 'bi', extend: x.extend || 'none',
        border_color: x.border_color, border_style: x.border_style,
        border_width: finite(x.border_width) ? x.border_width : 1,
        bgcolor: x.bgcolor, text: limitText(x.text, 100) });
    }
  }
  for (const key of ['__lines__', '__lines_overlay__']) {
    for (const x of snapshot(plots, key, maxLines)) {
      if (![x.x1, x.y1, x.x2, x.y2].every(finite)) continue;
      out.lines.push({ id: String(x.id ?? ''), x1: x.x1, y1: x.y1, x2: x.x2,
        y2: x.y2, xloc: x.xloc || 'bi', extend: x.extend || 'none',
        color: x.color, style: x.style, width: finite(x.width) ? x.width : 1 });
    }
  }
  for (const key of ['__tables__', '__tables_overlay__']) {
    for (const x of snapshot(plots, key, 2)) {
      if (!Array.isArray(x.cells)) continue;
      // PineTS represents cells as [row][column]. Respect it directly;
      // never recalculate performance or create placeholder statistics.
      out.tables.push({ id: String(x.id ?? ''), position: x.position || 'bottom_right',
        cells: x.cells.slice(0, 12).map(row => Array.isArray(row) ? row.slice(0, 8).map(c =>
          c && typeof c === 'object' ? {
            text: limitText(c.text, 160), bgcolor: c.bgcolor, text_color: c.text_color,
            text_halign: c.text_halign,
          } : null) : []) });
    }
  }
  // Native plotshape events (BREAK/SWEEP), not derived from candle heuristics.
  for (const [key, plot] of Object.entries(plots || {})) {
    if (!plot || plot?.options?.style !== 'shape' || !Array.isArray(plot.data)) continue;
    for (const point of plot.data.slice(-400)) {
      if (point?.value !== true && !(finite(point?.value) && point.value !== 0)) continue;
      if (!finite(point?.time)) continue;
      const appearance = point.options || {};
      out.shapes.push({ id: `${key}:${point.time}`, time: Math.floor(point.time / 1000),
        title: limitText(plot.title || key, 36), text: limitText(appearance.text, 20),
        shape: appearance.shape || plot.options.shape || 'shape_circle',
        location: appearance.location || plot.options.location || 'abovebar',
        color: appearance.color || plot.options.color });
    }
  }
  out.labels = out.labels.slice(-maxLabels);
  out.boxes = out.boxes.slice(-maxBoxes);
  out.lines = out.lines.slice(-maxLines);
  out.tables = out.tables.slice(-2);
  out.shapes = out.shapes.slice(-160);
  return out;
}
