"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Plus, X } from "lucide-react";
import { byId } from "../lib/instruments.mjs";
import type { Bar, Market } from "../lib/types";
import { AssetIcon } from "./market-panels";
import { useMarket } from "./use-market";

export type MarketTab = { symbol: string; frame: string };
type MarketState = ReturnType<typeof useMarket>;
export const MAX_MARKET_TABS = 5;
const defaultTabs = [{ symbol: "BTCUSDT", frame: "15m" }, { symbol: "XAUUSD", frame: "15m" }];
const bars: Bar[] = [];
const pending: MarketState = {
  key: "", seconds: 0, bars, status: "connecting", source: "", message: "",
  refresh() {}, async loadOlder() {}, loadingHistory: false, historyMessage: "",
};

export function normalizeMarketTabs(saved: MarketTab[] | undefined, active: MarketTab, availableFrames: (market: Market) => string[]): MarketTab[] {
  const open = new Map<string, MarketTab>();
  for (const tab of Array.isArray(saved) ? saved : defaultTabs) {
    if (!tab || !Object.hasOwn(byId, tab.symbol) || open.has(tab.symbol)) continue;
    const marketFrames = availableFrames(byId[tab.symbol]);
    open.set(tab.symbol, { symbol: tab.symbol, frame: marketFrames.includes(tab.frame) ? tab.frame : marketFrames[0] });
    if (open.size === MAX_MARKET_TABS) break;
  }
  if (!open.has(active.symbol) && open.size === MAX_MARKET_TABS) open.delete(Array.from(open.keys()).at(-1)!);
  open.set(active.symbol, active);
  return [...open.values()];
}

function createFeedStore() {
  const values = new Map<string, MarketState>();
  const subscribers = new Map<string, Set<() => void>>();
  function publish(key: string, value?: MarketState) {
    if (value) values.set(key, value);
    else values.delete(key);
    subscribers.get(key)?.forEach(notify => notify());
  }
  return {
    get: (key: string) => values.get(key),
    publish,
    subscribe(key: string, notify: () => void) {
      const set = subscribers.get(key) ?? new Set<() => void>();
      set.add(notify);
      subscribers.set(key, set);
      return () => {
        set.delete(notify);
        if (!set.size) subscribers.delete(key);
      };
    },
  };
}

const feedKey = ({ symbol, frame }: MarketTab, provider: string) => symbol + ":" + frame + ":" + provider;

export function useMarketTabsFeed(active: MarketTab, provider: string) {
  const [store] = useState(createFeedStore);
  const key = feedKey(active, provider);
  const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [key, store]);
  const getState = useCallback(() => store.get(key), [key, store]);
  const state = useSyncExternalStore(subscribe, getState, () => undefined);
  return { store, state: state ?? pending };
}

const MarketFeed = memo(function MarketFeed({ symbol, frame, provider, store }: MarketTab & {
  provider: string; store: ReturnType<typeof createFeedStore>;
}) {
  const key = feedKey({ symbol, frame }, provider);
  const quotes = useMarket(byId[symbol], frame, provider, true);
  useLayoutEffect(() => () => store.publish(key), [key, store]);
  useLayoutEffect(() => { store.publish(key, quotes); }, [key, quotes, store]);
  return null;
});

export function MarketTabFeeds({ tabs, provider, store, enabled }: {
  tabs: MarketTab[]; provider: string; store: ReturnType<typeof createFeedStore>; enabled: boolean;
}) {
  if (!enabled) return null;
  return tabs.map(tab => <MarketFeed key={feedKey(tab, provider)} {...tab} provider={provider} store={store}/>);
}

export function MarketTabs({ tabs, selected, onSelect, onClose, onAdd }: {
  tabs: MarketTab[]; selected: string; onSelect: (tab: MarketTab) => void; onClose: (symbol: string) => void; onAdd: () => void;
}) {
  const current = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const item = current.current;
    const viewport = item?.parentElement;
    if (!item || !viewport) return;
    const target = item.getBoundingClientRect();
    const visible = viewport.getBoundingClientRect();
    if (target.left < visible.left) viewport.scrollLeft += target.left - visible.left;
    else if (target.right > visible.right) viewport.scrollLeft += target.right - visible.right;
  }, [selected, tabs.length]);
  const full = tabs.length >= MAX_MARKET_TABS;
  return <div className="market-tabs">
    <div className="market-tab-list" role="group" aria-label="Tab pasar">
      {tabs.map(tab => {
        const active = selected === tab.symbol;
        return <div className={"market-tab" + (active ? " selected" : "")} key={tab.symbol} ref={active ? current : undefined}>
          <button type="button" className="market-tab-select" aria-pressed={active} title={byId[tab.symbol].name}
            onClick={() => onSelect(tab)}><AssetIcon market={byId[tab.symbol]} small/><strong>{tab.symbol}</strong><span>{tab.frame}</span></button>
          {tabs.length > 1 && <button type="button" className="market-tab-close" aria-label={"Tutup tab " + tab.symbol}
            title={"Tutup tab " + tab.symbol} onClick={() => onClose(tab.symbol)}><X size={13}/></button>}
        </div>;
      })}
    </div>
    <button type="button" className="icon-btn market-tab-add" disabled={full} aria-label="Tambah tab pasar"
      title={full ? "Maksimal " + MAX_MARKET_TABS + " tab pasar" : "Tambah tab pasar"} onClick={onAdd}><Plus size={17}/></button>
  </div>;
}
