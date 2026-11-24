"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, CircleAlert, Code2, Copy, Download, Eye, EyeOff, FileUp, Play, Plus, Save, Search, Settings2, Square, Trash2, Wand2 } from "lucide-react";
import { catalog, byIndicator, MAX_ACTIVE } from "../lib/indicators.mjs";
import { primaryFrames } from "../lib/instruments.mjs";
import type { Execution, Indicator, Script } from "../lib/types";
import { runNative, sampleCandle } from "./native-runner";
import { compileInWorker } from "./use-indicators";
import { download } from "./use-persisted";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, openSearchPanel } from "@codemirror/search";
import { autocompletion, completeFromList, completionKeymap } from "@codemirror/autocomplete";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting, StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";

export const GOLD: Script = { id: "goldguard", name: "AzusaTrade — Advanced Indicator", language: "pine", source: "", overlay: true, builtin: true };
const langLabels: Record<string, string> = { pine: "Pine Script v6", javascript: "JavaScript", typescript: "TypeScript", c: "C", java: "Java" };
const samples: Record<string, string> = {
  pine: '//@version=6\nindicator("EMA Signal", overlay=true)\nlength = input.int(20, "Length")\nbase = ta.ema(close, length)\nplot(base, title="EMA", color=color.orange)\n',
  javascript: `const title = "Range Midpoint";
const overlay = true;
function calculate(candles) {
  const values = candles.map(({ high, low }) => (high + low) / 2);
  return [{ name: title, values, color: "#76e4bc" }];
}
`,
  typescript: `type Candle = { high: number; low: number };
const title = "Range Midpoint";
const overlay = true;
function calculate(candles: Candle[]) {
  const values: number[] = candles.map(({ high, low }) => (high + low) / 2);
  return [{ name: title, values, color: "#76e4bc" }];
}
`,
  c: 'double indicator(double open, double high, double low, double close, double volume) {\n    return (high + low + close) / 3.0;\n}\n',
  java: 'class Indicator {\n    static double indicator(double open, double high, double low, double close, double volume) {\n        return (open + close) / 2.0;\n    }\n}\n',
};
const nativeSamples = {
  c: `#include <stdio.h>

int main(void) {
    long long time;
    double open, high, low, close, volume;
    while (scanf("%lld,%lf,%lf,%lf,%lf,%lf", &time, &open, &high, &low, &close, &volume) == 6) {
        printf("%.12g\\n", (high + low + close) / 3.0);
    }
    return 0;
}
`,
  java: `import java.io.BufferedReader;
import java.io.InputStreamReader;

class Main {
    public static void main(String[] args) throws Exception {
        var reader = new BufferedReader(new InputStreamReader(System.in));
        for (String row; (row = reader.readLine()) != null; ) {
            var fields = row.split(",");
            double midpoint = (Double.parseDouble(fields[1]) + Double.parseDouble(fields[4])) / 2;
            System.out.println(midpoint);
        }
    }
}
`,
};

const extensions: Record<string, string> = { pine: "pine", javascript: "js", typescript: "ts", c: "c", java: "java" };
const extensionsToLanguage = Object.fromEntries(Object.entries(extensions).map(([key, value]) => [value, key]));

export function IndicatorLibrary({ configs, scripts, onAdd, onEdit }: { configs: Indicator[]; scripts: Script[]; onAdd: (kind: string) => void; onEdit: (script: Script) => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const found = catalog.filter(item => (category === "Semua" || category === item.category)
    && (item.name + " " + item.short).toLowerCase().includes(search.toLowerCase().trim()));
  const activeCount = configs.filter(config => config.visible).length;
  const custom = [GOLD, ...scripts].filter(script => script.name.toLowerCase().includes(search.toLowerCase().trim()));
  return <div className="indicator-library">
    <div className="search-field"><Search size={17}/><input aria-label="Cari indikator" placeholder="Cari SMA, Bollinger Bands, Stochastic…" value={search} onChange={event => setSearch(event.target.value)}/></div>
    <div className="category-filters">{["Semua", "Tren", "Momentum", "Volatilitas", "Volume", "Script"].map(item => <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}>{item}</button>)}<span className="limit-pill">{configs.filter(config => config.visible).length}/{MAX_ACTIVE} aktif</span></div>
    {(category === "Semua" || category === "Script") && custom.map(script => <div key={script.id} className="indicator-option">
      <span className="indicator-icon"><Code2 size={16}/></span><div><strong>{script.name}</strong><small>{langLabels[script.language]}{script.builtin ? " · Migrasi tertunda" : " · Script tersimpan"}</small></div>
      <button className="icon-btn" aria-label={"Buka kode " + script.name} onClick={() => onEdit(script)}><BookOpen size={15}/></button>
      {!script.builtin && <button className="icon-btn" title="Tambah ke chart" aria-label={"Tambahkan " + script.name} onClick={() => onAdd(script.id)} disabled={activeCount >= MAX_ACTIVE}><Plus size={17}/></button>}
    </div>)}
    {category !== "Script" && found.map(item => <div key={item.id} className="indicator-option">
      <span className="indicator-icon"><Activity size={17}/></span><div><strong>{item.name}</strong><small>{item.category} · {item.overlay ? "Overlay" : "Panel terpisah"}</small></div>
      <button className="icon-btn" title="Tambah ke chart" aria-label={"Tambahkan " + item.name} onClick={() => onAdd(item.id)} disabled={activeCount >= MAX_ACTIVE}><Plus size={17}/></button>
    </div>)}
    {!found.length && !custom.length && <p className="empty-inline">Indikator tidak ditemukan.</p>}
  </div>;
}

export function IndicatorManager({ configs, scripts, stats, onChange, onRemove, timezone, focusUid = "" }: { focusUid?: string; configs: Indicator[]; scripts: Script[]; stats: Record<string, Execution>; onChange: (uid: string, patch: Partial<Indicator>) => void; onRemove: (uid: string) => void; timezone: string }) {
  const [expanded, setExpanded] = useState("");
  useEffect(() => { if (focusUid) setExpanded(focusUid); }, [focusUid]);
  return <div className="indicator-manager">
    <div className="panel-intro"><h3>Indikator pada chart</h3><span className="limit-pill">{configs.filter(config => config.visible).length}/{MAX_ACTIVE} aktif</span></div>
    {!configs.length && <p className="empty-inline">Belum ada indikator pada chart.</p>}
    {configs.map(config => {
      const builtin = byIndicator[config.kind];
      const script = scripts.find(item => item.id === config.kind);
      const stat = stats[config.uid];
      return <div className="manager-entry" key={config.uid}>
        <div className="manager-row">
          <span className="plot-dot" style={{ background: config.color }}/>
          <div className="manager-title"><strong>{builtin?.name || script?.name || config.kind}</strong><small>{script ? langLabels[script.language] : "Indikator bawaan"}</small></div>
          <span className={stat?.error ? "negative runtime-label" : "runtime-label"} title={stat?.error}>{!config.visible ? "Dijeda" : stat?.error ? "Error" : stat?.duration != null ? stat.duration.toFixed(1) + " ms" : "Menunggu"}</span>
          <button className="icon-btn tiny" title="Tampilkan/sembunyikan" aria-label={"Visibilitas " + config.kind} onClick={() => onChange(config.uid, { visible: !config.visible })}>{config.visible ? <Eye size={16}/> : <EyeOff size={16}/>}</button>
          <button className="icon-btn tiny" title="Pengaturan" aria-label={"Pengaturan " + config.kind} onClick={() => setExpanded(expanded === config.uid ? "" : config.uid)}><Settings2 size={16}/></button>
          <button className="icon-btn tiny danger" title="Hapus" aria-label={"Hapus " + config.kind} onClick={() => onRemove(config.uid)}><Trash2 size={15}/></button>
        </div>
        {stat?.error && <p className="runtime-error"><CircleAlert size={14}/>{stat.error}</p>}
        {stat?.log && <p className="runtime-error">{stat.log}</p>}
        {expanded === config.uid && <div className="indicator-settings">
          {builtin && <label>Periode<input type="number" min={1} max={500} value={config.length} onChange={event => onChange(config.uid, { length: Math.max(1, Math.min(500, +event.target.value)) })}/></label>}
          {["bb", "supertrend", "keltner"].includes(config.kind) && <label>Multiplier<input type="number" min={.1} max={20} step={.1} value={config.multiplier} onChange={event => onChange(config.uid, { multiplier: +event.target.value })}/></label>}
          <label>Warna<input type="color" value={config.color} onChange={event => onChange(config.uid, { color: event.target.value })}/></label>
          <label>Lebar garis<select value={config.width} onChange={event => onChange(config.uid, { width: +event.target.value })}>{[1,2,3,4].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Opasitas<input type="range" min={10} max={100} value={config.opacity} onChange={event => onChange(config.uid, { opacity: +event.target.value })}/></label>
          <label>Timeframe<select value={config.frame} onChange={event => onChange(config.uid, { frame: event.target.value })}><option value="">Chart</option>{primaryFrames.map(frame => <option key={frame}>{frame}</option>)}</select></label>
          {stat?.timestamp && <small title="Estimasi data input dan output runtime">{((stat.bytes ?? 0) / 1024).toFixed(1)} KB data · {new Intl.DateTimeFormat("id-ID", { timeZone: timezone, timeStyle: "medium" }).format(stat.timestamp)}</small>}
        </div>}
      </div>;
    })}
  </div>;
}

const pineMode = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/^(?:"[^"\n]*"|'[^'\n]*')/)) return "string";
    if (stream.match(/^\d+(?:\.\d+)?\b/)) return "number";
    if (stream.match(/^(?:var|varip|type|function|if|else|for|while|switch|float|bool|int|string|true|false|and|or|not)\b/)) return "keyword";
    if (stream.match(/^(?:indicator|plot|input|ta|request|barstate|math|color|strategy|open|high|low|close|volume)\b/)) return "variableName";
    stream.next();
    return null;
  },
});

const cmLook = EditorView.theme({
  "&": { height: "100%", background: "var(--chart)", color: "var(--text)", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', overflow: "auto", lineHeight: "1.65" },
  ".cm-gutters": { background: "var(--panel)", color: "var(--muted)", borderRightColor: "var(--border)" },
  ".cm-activeLine, .cm-activeLineGutter": { background: "var(--hover)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-panels": { background: "var(--panel)", color: "var(--text)" },
  ".cm-search": { display: "flex", flexWrap: "wrap", gap: "4px" },
});
const completions = completeFromList(["indicator", "plot", "open", "high", "low", "close", "volume", "ta.ema", "ta.sma", "ta.rsi", "ta.highest", "ta.lowest"].map(label => ({ label, type: "variable" })));
const languageFor = (id: string) => id === "pine" ? pineMode : id === "c" ? cpp() : id === "java" ? java() : javascript({ typescript: id === "typescript" });

export type EditorLog = { when: number; level: "error" | "ok" | "info"; text: string };
export function ScriptEditor({ requested, scripts, onSave, onRun, onStop, onDelete, onLog, runnerKey, onRunnerKey }: {
  requested: Script | null; scripts: Script[]; onSave: (script: Script) => void; onRun: (script: Script) => void;
  runnerKey: string; onRunnerKey: (key: string) => void;
  onStop: (id: string) => void; onDelete: (id: string) => void; onLog: (log: EditorLog) => void;
}) {
  const [source, setSource] = useState(samples.pine);
  const [language, setLanguage] = useState("pine");
  const [name, setName] = useState("Indikator baru");
  const [id, setId] = useState("");
  const [remoteByLanguage, setRemoteByLanguage] = useState<Record<string, boolean>>({});
  const [remote, setRemote] = useState(false);
  const nativeLanguage = language === "c" || language === "java";
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/runner", { signal: controller.signal }).then(response => response.json()).then(setRemoteByLanguage).catch(() => {});
    return () => controller.abort();
  }, []);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; features?: { name: string; count: number; line: number }[] } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const compartments = useMemo(() => ({ language: new Compartment(), edit: new Compartment() }), []);
  const isGold = id === GOLD.id;
  const selection = requested?.id ?? "";
  const currentSelection = useRef(0);
  const requestVersion = useRef(0);

  async function select(script: Script | null) {
    const version = ++currentSelection.current;
    requestVersion.current++;
    setLoading(false);
    setMessage(null);
    if (!script) { setId(""); setRemote(false); setName("Indikator baru"); setLanguage("pine"); setSource(samples.pine); return; }
    setId(script.id); setRemote(Boolean(script.remote)); setName(script.name); setLanguage(script.language); setSource(script.source);
    if (!script.builtin) return;
    try {
      const response = await fetch("/api/goldguard");
      if (response.status === 404) {
        if (version === currentSelection.current) setMessage({ text: "GoldGuard belum bisa dijalankan. Sumber asli tersedia di repo proyek." });
        return;
      }
      if (!response.ok) throw Error();
      const code = await response.text();
      if (version !== currentSelection.current) return;
      setSource(code);
      setMessage({ text: "Sumber asli GoldGuard. Periksa kompatibilitas sebelum menjalankan indikator." });
    } catch {
      if (version === currentSelection.current) setMessage({ text: "Sumber GoldGuard tidak dapat dimuat.", error: true });
    }
  }
  useEffect(() => { void select(requested); }, [selection]); // Selection is keyed by the script ID.

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({
      doc: samples.pine,
      extensions: [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), drawSelection(), bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle), autocompletion({ override: [completions] }), cmLook, compartments.language.of(pineMode),
        compartments.edit.of(EditorView.editable.of(true)), keymap.of([...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
        EditorView.updateListener.of(update => { if (update.docChanged) setSource(update.state.doc.toString()); })],
    }) });
    editor.current = view;
    return () => { view.destroy(); editor.current = null; };
  }, [compartments]);
  useEffect(() => {
    const view = editor.current;
    if (view && source !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
  }, [source]);
  useEffect(() => {
    editor.current?.dispatch({ effects: [
      compartments.language.reconfigure(languageFor(language)),
      compartments.edit.reconfigure(EditorView.editable.of(!isGold)),
    ] });
  }, [language, isGold, compartments]);

  function save(programOverlay = true) {
    if (isGold || !source.trim()) return;
    const script = { id: id || crypto.randomUUID(), name: name.trim() || "Indikator baru", language, source, overlay: programOverlay, ...(remote && nativeLanguage ? { remote: true } : {}) };
    onSave(script); setId(script.id);
    return script;
  }

  async function compile(run = false) {
    setLoading(true);
    setMessage(null);
    const request = ++requestVersion.current;
    try {
      const started = performance.now();
      const result = remote && nativeLanguage
        ? await runNative({ language, source, name }, [sampleCandle], runnerKey).then(result => {
          if (result.log) onLog({ when: Date.now(), text: result.log, level: "info" });
          return { plots: result.plots, duration: performance.now() - started, overlay: true };
        })
        : await compileInWorker(language, source);
      if (request !== requestVersion.current) return;
      const text = "Kompilasi berhasil · " + result.plots.length + " plot · " + result.duration.toFixed(1) + " ms";
      setMessage({ text }); onLog({ when: Date.now(), text, level: "ok" });
      if (run) { const script = save(result.overlay); if (script) onRun(script); }
    } catch (error) {
      if (request !== requestVersion.current) return;
      const issue = error as Error & { features?: { name: string; count: number; line: number }[] };
      setMessage({ text: issue.message, error: true, features: issue.features });
      onLog({ when: Date.now(), text: issue.message, level: "error" });
    } finally { if (request === requestVersion.current) setLoading(false); }
  }

  return <div className="script-editor">
    <div className="editor-controls">
      <select aria-label="Script tersimpan" value={id} onChange={event => void select([GOLD, ...scripts].find(script => script.id === event.target.value) ?? null)}>
        <option value="">Script baru</option><option value={GOLD.id}>{GOLD.name}</option>{scripts.map(script => <option key={script.id} value={script.id}>{script.name}</option>)}
      </select>
      <select aria-label="Bahasa indikator" value={language} disabled={isGold} onChange={event => {
        const next = event.target.value;
        const useRemote = Boolean(remoteByLanguage[next]);
        if (!id && [...Object.values(samples), ...Object.values(nativeSamples)].includes(source)) {
          setSource(useRemote && (next === "c" || next === "java") ? nativeSamples[next] : samples[next]);
        }
        setRemote(useRemote);
        setLanguage(next);
      }}>{Object.entries(langLabels).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select>
      <input className="script-name" aria-label="Nama indikator" value={name} disabled={isGold} maxLength={80} onChange={event => setName(event.target.value)}/>
      <button className="icon-btn" title="Cari/ganti kode" aria-label="Cari dan ganti kode" onClick={() => editor.current && openSearchPanel(editor.current)}><Search size={16}/></button>
      <button className="icon-btn" title="Rapikan spasi" aria-label="Rapikan spasi kode" disabled={isGold} onClick={() => setSource(source.split("\n").map(line => line.trimEnd()).join("\n").trimEnd() + "\n")}><Wand2 size={15}/></button>
      <button className="icon-btn" title="Impor file" aria-label="Impor script" onClick={() => file.current?.click()}><FileUp size={16}/></button>
      <button className="icon-btn" title="Ekspor file" aria-label="Ekspor script" disabled={!source} onClick={() => download((name.replace(/[^a-z0-9-_ ]/gi, "") || "indicator") + "." + extensions[language], source)}><Download size={16}/></button>
      <button className="icon-btn" title="Duplikat" aria-label="Duplikat script" disabled={!source} onClick={() => { setId(""); setName(name + " copy"); setMessage({ text: "Salinan siap diedit." }); }}><Copy size={15}/></button>
      <button className="icon-btn danger" title="Hapus script" aria-label="Hapus script" disabled={!id || isGold} onClick={() => {
        if (window.confirm("Hapus script ini dan lepaskan dari chart?")) { onDelete(id); void select(null); }
      }}><Trash2 size={15}/></button>
      <input type="file" hidden ref={file} accept=".pine,.js,.ts,.c,.java,.txt" onChange={async event => {
        const item = event.target.files?.[0];
        event.target.value = "";
        if (!item) return;
        try {
          const code = await item.text();
          const nextLanguage = extensionsToLanguage[item.name.split(".").at(-1) || ""] || language;
          setId(""); setName(item.name.replace(/\.[^.]+$/, "")); setLanguage(nextLanguage);
          setRemote(Boolean(remoteByLanguage[nextLanguage])); setSource(code); setMessage(null);
        }
        catch { setMessage({ text: "File tidak dapat dibaca.", error: true }); }
      }}/>
    </div>
    <div ref={host} className="code-host" aria-label="Editor kode indikator"/>
    <div className="editor-controls editor-actions">
      <button className="subtle-button" disabled={loading || !source} onClick={() => void compile()}>{isGold ? "Cek kompatibilitas" : "Compile"}</button>
      <button className="accent-button" disabled={loading || isGold || !source} onClick={() => void compile(true)}><Play size={14}/>Run</button>
      <button className="subtle-button" disabled={!id || isGold} onClick={() => onStop(id)}><Square size={13}/>Stop</button>
      <button className="subtle-button" disabled={isGold || !source} onClick={() => { if (save(scripts.find(item => item.id === id)?.overlay)) setMessage({ text: "Script tersimpan." }); }}><Save size={14}/>Simpan</button>
      {nativeLanguage && (remoteByLanguage[language] || remote) && <label className="native-runner-choice">
        <input type="checkbox" checked={remote} onChange={event => {
          const enabled = event.target.checked;
          if (!id && [samples[language], nativeSamples[language]].includes(source)) setSource(enabled ? nativeSamples[language] : samples[language]);
          setRemote(enabled);
        }}/>Compiler
      </label>}
      {remote && nativeLanguage && <input type="password" aria-label="Kunci runner" placeholder="Kunci runner" value={runnerKey} autoComplete="off" onChange={event => onRunnerKey(event.target.value)}/>}
      <span className="secondary">{loading ? "Mengompilasi…" : nativeLanguage && !remote ? "Formula lokal" : langLabels[language]}</span>
    </div>
    {message && <div className={"compile-message" + (message.error ? " negative" : "")}><p>{message.text}</p>
      {message.features?.length ? <details><summary>Fitur Pine yang masih dibutuhkan</summary>
        <ul>{message.features.map(feature => <li key={feature.name}>{feature.name} · {feature.count} penggunaan · baris {feature.line}</li>)}</ul>
      </details> : null}
    </div>}
  </div>;
}
