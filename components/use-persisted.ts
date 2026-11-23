"use client";
import { useEffect, useState } from "react";

export function usePersisted<T>(name: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("azusa:" + name);
      if (stored !== null) setValue(JSON.parse(stored));
    } catch { setError("Pengaturan tersimpan tidak dapat dibaca."); }
    setReady(true);
  }, [name]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("azusa:" + name, JSON.stringify(value)); setError(""); }
    catch { setError("Ruang penyimpanan browser tidak tersedia."); }
  }, [name, ready, value]);
  return [value, setValue, ready, error] as const;
}

export function download(filename: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useScripts<T>(name: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [error, setError] = useState("");
  const [database, setDatabase] = useState<IDBDatabase | null>(null);
  useEffect(() => {
    let closed = false;
    let db: IDBDatabase | undefined;
    const fail = () => {
      if (closed) return;
      setState("unavailable");
      setError("Penyimpanan script tidak tersedia.");
    };
    const open = indexedDB.open("AzusaTrade", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("workspace");
    open.onerror = fail;
    open.onsuccess = () => {
      db = open.result;
      if (closed) { db.close(); return; }
      db.onversionchange = () => { db?.close(); fail(); };
      const get = db.transaction("workspace", "readonly").objectStore("workspace").get(name);
      get.onerror = fail;
      get.onsuccess = () => {
        if (closed) return;
        try {
          const stored = get.result ?? JSON.parse(localStorage.getItem("azusa:" + name) ?? "null");
          if (stored !== null) setValue(stored);
        } catch { setError("Script tersimpan tidak dapat dibaca."); }
        setDatabase(db!);
        setState("ready");
      };
    };
    return () => { closed = true; db?.close(); };
  }, [name]);
  useEffect(() => {
    if (state !== "ready" || !database) return;
    try {
      const transaction = database.transaction("workspace", "readwrite");
      transaction.objectStore("workspace").put(value, name);
      transaction.oncomplete = () => {
        setError("");
        try { localStorage.removeItem("azusa:" + name); } catch { /* Original migration record is optional. */ }
      };
      transaction.onabort = () => setError("Script tidak dapat disimpan di browser.");
    } catch { setError("Script tidak dapat disimpan di browser."); }
  }, [database, name, state, value]);
  return [value, setValue, state !== "loading", error] as const;
}
