"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Coins, ExternalLink, Globe2, RefreshCw, Search, Star, X } from "lucide-react";
import { markets, byId } from "../lib/instruments.mjs";
import type { Article, CalendarEvent, Market, Quote } from "../lib/types";

export const number = (value: number | null | undefined, precision = 2) => value == null || !Number.isFinite(value) ? "—"
  : new Intl.NumberFormat("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision }).format(value);
export const signed = (value: number | null | undefined, suffix = "%") => value == null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + number(value) + suffix;
export const direction = (value?: number | null) => value === undefined || value === null ? "" : value > 0 ? "positive" : value < 0 ? "negative" : "";
export const stamp = (timestamp: number, timezone: string, dateStyle: "short" | "medium" = "short") => new Intl.DateTimeFormat("id-ID", { timeZone: timezone, dateStyle, timeStyle: "short" }).format(timestamp).replaceAll(".", ":");
const time = (timestamp: number, timezone: string) => new Intl.DateTimeFormat("id-ID", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(timestamp).replaceAll(".", ":");
const grouped = ["Semua", "Crypto", "Forex", "Metals", "Favorit"] as const;

const currencyFlags: Record<string, string> = {
  EUR: "eu", USD: "us", GBP: "gb", JPY: "jp", AUD: "au", CAD: "ca", CHF: "ch", NZD: "nz",
};

export function AssetIcon({ market, small = false }: { market: Market; small?: boolean }) {
  const size = "asset-icon" + (small ? " small" : "");
  const base = market.category === "Forex" ? currencyFlags[market.asset] : undefined;
  const quote = currencyFlags[market.quote];
  if (base && quote) return <span className={size + " currency-pair"} aria-hidden="true">
    <img className="currency-base" src={"/market-flags/" + base + ".png"} alt=""/>
    <img className="currency-quote" src={"/market-flags/" + quote + ".png"} alt=""/>
  </span>;
  return <span className={size + (market.category === "Metals" ? " metal-asset" : "")} aria-hidden="true"
    style={{ color: market.color, backgroundColor: market.color + "19" }}>
    {market.category === "Metals" ? <Coins size={small ? 15 : 21} strokeWidth={1.7}/> : market.mark}
  </span>;
}

export function MarketPicker({ selected, quotes, favorites, recent, onMarket, onFavorite, embedded = false }: {
  selected: string; quotes: Record<string, Quote>; favorites: string[]; recent: string[];
  onMarket: (market: Market) => void; onFavorite: (symbol: string) => void; embedded?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof grouped)[number]>("Semua");
  const found = markets.filter(market => (category === "Semua" || category === "Favorit" && favorites.includes(market.id) || category === market.category)
    && (market.id + " " + market.name + " " + market.asset + "/" + market.quote).toLowerCase().includes(query.toLowerCase().trim()));
  return <div className="market-picker">
    <form className="search-field" onSubmit={event => { event.preventDefault(); if (found[0]) onMarket(found[0]); }}>
      <Search size={17}/><input aria-label="Cari instrumen" autoFocus={!embedded} value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari simbol atau nama pasar"/>
      {query && <button type="button" aria-label="Hapus pencarian" className="icon-btn tiny" onClick={() => setQuery("")}><X size={15}/></button>}
    </form>
    <div className="category-filters">{grouped.map(group => <button key={group} className={category === group ? "selected" : ""} onClick={() => setCategory(group)}>{group}</button>)}</div>
    {!query && category === "Semua" && recent.length > 0 && <div className="recent-row"><span>Terakhir dibuka</span>{recent.slice(0,4).map(id => byId[id] && <button key={id} onClick={() => onMarket(byId[id])}>{id}</button>)}</div>}
    <div className="picker-results">
      {found.map(market => <div className={"picker-item" + (selected === market.id ? " current" : "")} key={market.id}>
        <button className="market-result" onClick={() => onMarket(market)}><AssetIcon market={market}/><div><strong>{market.id}</strong><small>{market.name}</small></div><div className="market-result-price"><strong>{number(quotes[market.id]?.price, market.precision)}</strong><small className={direction(quotes[market.id]?.change)}>{signed(quotes[market.id]?.change)}</small></div></button>
        <button className={"icon-btn tiny " + (favorites.includes(market.id) ? "favorite" : "")} aria-label={(favorites.includes(market.id) ? "Hapus favorit " : "Tambah favorit ") + market.id} onClick={() => onFavorite(market.id)}><Star size={15} fill={favorites.includes(market.id) ? "currentColor" : "none"}/></button>
      </div>)}
      {!found.length && <div className="empty-inline">Pasar tidak ditemukan.</div>}
    </div>
  </div>;
}

export function Watchlist({ selected, favorites, quotes, lastPrice, onMarket }: { selected: string; favorites: string[]; quotes: Record<string, Quote>; lastPrice?: number; onMarket: (market: Market) => void }) {
  const [filter, setFilter] = useState<"market" | "favorites" | "fx">("market");
  const visible = (filter === "favorites" ? favorites.map(symbol => byId[symbol]).filter(Boolean)
    : filter === "fx" ? markets.filter(market => market.category !== "Crypto")
    : markets.filter(market => market.category === "Crypto"));
  return <>
    <div className="watch-filters"><button className={filter === "market" ? "selected" : ""} onClick={() => setFilter("market")}>Crypto</button><button className={filter === "fx" ? "selected" : ""} onClick={() => setFilter("fx")}>Forex & lainnya</button><button aria-label="Favorit" className={filter === "favorites" ? "selected" : ""} onClick={() => setFilter("favorites")}><Star size={14}/></button></div>
    <div className="watch-list">
      <div className="watch-table-head"><span>Pasar</span><span>Harga</span><span>24J</span></div>
      {visible.map(market => {
        const quote = quotes[market.id];
        return <button key={market.id} className={"watch-item" + (selected === market.id ? " current" : "")} onClick={() => onMarket(market)}>
          <div className="watch-asset"><AssetIcon market={market} small/><span><strong>{market.id}</strong><small>{market.name}</small></span></div>
          <span>{number((selected === market.id ? lastPrice : undefined) ?? quote?.price, market.precision)}</span>
          <span className={direction(quote?.change)}>{signed(quote?.change)}</span>
        </button>;
      })}
      {!visible.length && <div className="empty-inline">Daftar favorit kosong.</div>}
    </div>
  </>;
}

type FeedPayload<T> = { items: T[]; updated: number; stale?: boolean; partial?: boolean; error?: string };
const feeds = new Map<string, FeedPayload<Article | CalendarEvent>>();
function useEditorial<T extends Article | CalendarEvent>(type: "news" | "calendar", open: boolean) {
  const [payload, setPayload] = useState<FeedPayload<T> | undefined>(() => feeds.get(type) as FeedPayload<T>);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function update() {
      if (!feeds.has(type)) setLoading(true);
      try {
        const response = await fetch("/api/" + type, { signal: AbortSignal.any([AbortSignal.timeout(11000), controller.signal]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const feed: FeedPayload<T> = { items: data.news ?? data.events, updated: data.updated, stale: data.stale, partial: data.partial };
        if (controller.signal.aborted) return;
        feeds.set(type, feed);
        setPayload(feed);
      } catch {
        if (!controller.signal.aborted) setPayload(previous => ({ items: previous?.items ?? [], updated: previous?.updated ?? 0, stale: !!previous?.items.length, error: "Sumber data sedang tidak dapat dihubungi." }));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void update();
    const timer = setInterval(update, type === "calendar" ? 60000 : 90000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [type, refresh, open]);
  return { payload, loading, refresh: () => setRefresh(value => value + 1) };
}

export function NewsPanel({ timezone, condensed = false }: { timezone: string; condensed?: boolean }) {
  const { payload, refresh, loading } = useEditorial<Article>("news", true);
  const [category, setCategory] = useState("Semua");
  const [count, setCount] = useState(condensed ? 4 : 15);
  const filtered = useMemo(() => (payload?.items ?? []).filter(item => category === "Semua" || item.category === category), [payload, category]);
  if (condensed && !payload?.items.length && !payload?.error) return <p className="empty-inline">Memuat berita…</p>;
  return <div className={"editorial " + (condensed ? "condensed" : "")}>
    {!condensed && <div className="category-filters">{["Semua", "Moneter", "Inflasi", "Tenaga kerja", "Pertumbuhan", "Metals", "Forex", "Crypto"].map(item => <button key={item} onClick={() => { setCategory(item); setCount(15); }} className={category === item ? "selected" : ""}>{item}</button>)}</div>}
    {(!condensed || payload?.stale || payload?.error) && <div className="feed-update"><span>{payload?.updated ? "Diperbarui " + time(payload.updated, timezone) + (payload.stale ? " · data tersimpan" : payload.partial ? " · sebagian sumber" : "") : loading ? "Memuat sumber resmi…" : "Pembaruan gagal"}</span><button className="icon-btn tiny" onClick={refresh} aria-label="Perbarui berita"><RefreshCw size={14}/></button></div>}
    {payload?.error && <p className="empty-inline">{payload.error}</p>}
    {filtered.slice(0,count).map(article => <a className="news-item" key={article.id} href={article.url} target="_blank" rel="noopener noreferrer">
      <span className="news-meta"><span>{article.source}</span><time dateTime={new Date(article.date).toISOString()}>{condensed ? time(article.date, timezone) : stamp(article.date, timezone, "medium")}</time></span>
      <strong>{article.title}</strong>{!condensed && <ExternalLink size={13} className="news-link-icon"/>}
    </a>)}
    {payload && !filtered.length && !payload.error && <p className="empty-inline">Belum ada artikel dalam kategori ini.</p>}
    {!condensed && filtered.length > count && <button className="subtle-button list-more" onClick={() => setCount(value => value + 15)}>Tampilkan berita lain</button>}
  </div>;
}

export function CalendarPanel({ timezone }: { timezone: string }) {
  const { payload, refresh, loading } = useEditorial<CalendarEvent>("calendar", true);
  const [highOnly, setHighOnly] = useState(false);
  const [past, setPast] = useState(false);
  const now = Date.now();
  const filtered = (payload?.items ?? []).filter(event => (past ? event.date < now : event.date >= now) && (!highOnly || event.impact >= 3));
  return <div className="editorial calendar">
    <div className="category-filters"><button className={!past ? "selected" : ""} onClick={() => setPast(false)}>Mendatang</button><button className={past ? "selected" : ""} onClick={() => setPast(true)}>Riwayat</button><button className={highOnly ? "selected" : ""} onClick={() => setHighOnly(value => !value)}>Dampak tinggi</button></div>
    <div className="feed-update"><span>{payload?.updated ? "Diperbarui " + time(payload.updated, timezone) + (payload.stale ? " · data tersimpan" : "") : loading ? "Memuat kalender…" : "Pembaruan gagal"}</span><button className="icon-btn tiny" onClick={refresh} aria-label="Perbarui kalender"><RefreshCw size={14}/></button></div>
    {payload?.error && <p className="empty-inline">{payload.error}</p>}
    {filtered.slice(0,36).map(event => <div className="calendar-item" key={event.id}>
      <div className="news-meta"><span><Globe2 size={12}/>{event.country} · {event.source}</span><time>{stamp(event.date, timezone, "medium")}</time></div>
      <div className="event-title"><span className={"impact impact-" + event.impact} aria-label={"Dampak " + event.impact}>▂▅▇</span>{event.url ? <a href={event.url} target="_blank" rel="noopener noreferrer">{event.title}</a> : <strong>{event.title}</strong>}</div>
      <div className="release-values"><span>Sebelumnya <strong>{event.previous ?? "—"}</strong></span><span>Perkiraan <strong>{event.forecast ?? "—"}</strong></span><span>Aktual <strong>{event.actual ?? "—"}</strong></span></div>
      <small className="event-state">{event.actual ? "Dirilis" : event.date < now ? "Jadwal terlewati" : "Terjadwal"}</small>
    </div>)}
    {!filtered.length && !loading && !payload?.error && <div className="empty-inline"><CalendarDays size={16}/>Tidak ada jadwal untuk filter ini.</div>}
  </div>;
}

export function MarketDataSetup({ market, frame }: { market: Market; frame: string }) {
  const [config, setConfig] = useState<{ forex: boolean; forexStream: string | null }>();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ message: string; ok: boolean }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
    async function check() {
      try {
        const settings = await fetch("/api/config", { cache: "no-store", signal });
        if (!settings.ok) throw Error("Status deployment tidak dapat dibaca.");
        const data = await settings.json();
        if (signal.aborted) return;
        setConfig(data);
        if (!attempt) return;
        const query = new URLSearchParams({ symbol: market.id, frame, limit: "10" });
        const response = await fetch("/api/history?" + query, { cache: "no-store", signal });
        const history = await response.json();
        if (!response.ok) throw Error(history.error || "Riwayat dari Twelve Data belum tersedia.");
        if (signal.aborted) return;
        setResult(history.stale
          ? { message: "Riwayat masih dari cache. Penyedia belum memberi respons terbaru.", ok: false }
          : { message: market.id + " · " + history.bars.length + " candle diterima dari " + history.source + ".", ok: true });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ message: signal.aborted ? "Waktu pemeriksaan habis." : error instanceof Error ? error.message : "Pemeriksaan gagal.", ok: false });
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }
    void check();
    return () => controller.abort();
  }, [attempt, frame, market.id]);

  return <div className="data-setup">
    <dl>
      <div><dt>API key Twelve Data</dt><dd>{config ? config.forex ? "Tersimpan" : "Belum disetel" : "—"}</dd></div>
      <div><dt>Relay tick live</dt><dd>{config ? config.forexStream ? "URL tersedia" : "Belum aktif" : "—"}</dd></div>
    </dl>
    <ol>
      <li>Ambil API key dari <a href="https://twelvedata.com/account/api-keys" target="_blank" rel="noreferrer">Twelve Data</a>.</li>
      <li>Di Vercel, buka <strong>Settings → Environment Variables</strong>. Simpan key sebagai <code>TWELVE_DATA_API_KEY</code> untuk Production, tipe Secret.</li>
      <li>Redeploy, lalu uji riwayat {market.id}. Tick live memerlukan relay HTTPS lewat <code>TWELVE_STREAM_URL</code>.</li>
    </ol>
    <div className="settings-actions"><button className="accent-button" type="button" disabled={checking} onClick={() => {
      setResult(undefined);
      setChecking(true);
      setAttempt(value => value + 1);
    }}><RefreshCw size={15}/>{checking ? "Menguji…" : "Uji riwayat " + market.id}</button></div>
    {result && <p className={result.ok ? "positive" : "negative"} role="status">{result.message}</p>}
  </div>;
}
