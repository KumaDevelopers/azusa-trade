"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CloudDownload, Eye, EyeOff, LogIn, LogOut, RefreshCw } from "lucide-react";

type Session = { enabled: boolean; user: "admin" | null };
type Status = "local" | "loading" | "saving" | "synced" | "conflict" | "offline";
type SyncAction = "save" | "poll" | "restore";
const sessionUrl = "/api/admin/session";
const workspaceUrl = "/api/admin/workspace";
const messages: Record<Status, string> = {
  local: "Workspace lokal",
  loading: "Mengambil workspace…",
  saving: "Menyinkronkan…",
  synced: "Tersinkron ke Neon",
  conflict: "Perangkat lain mengubah workspace.",
  offline: "Sinkronisasi tertunda.",
};

class AdminRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(12_000);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { cache: "no-store", ...options, signal });
  const data = await response.json();
  if (!response.ok) throw new AdminRequestError(response.status, data.error || "Permintaan gagal.");
  return data;
}

function canonical(snapshot: object) {
  return JSON.stringify(snapshot, (_key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
}

export function useAdminWorkspace<T extends object>(snapshot: T, onRestore: (snapshot: T) => void, ready: boolean) {
  const [session, setSession] = useState<Session>();
  const [sessionError, setSessionError] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [status, setStatus] = useState<Status>("local");
  const user = session?.user;
  const serialized = useMemo(() => ready && user ? canonical(snapshot) : "", [ready, snapshot, user]);
  const latest = useRef({ serialized, onRestore });
  latest.current = { serialized, onRestore };
  const syncNow = useRef<(action: SyncAction) => Promise<void>>(async () => {});

  useEffect(() => {
    const controller = new AbortController();
    request<Session>(sessionUrl, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setSession(value);
    }).catch(error => {
      if (!controller.signal.aborted) setSessionError(error.message);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!user || !ready) { setStatus("local"); return; }
    const controller = new AbortController();
    const { signal } = controller;
    let mirror: { revision: number; serialized: string } | null = null;
    let busy = false;
    let queued = false;
    let blocked = false;

    async function reconcile(action: SyncAction) {
      if (signal.aborted || (blocked && action !== "restore")) return;
      if (busy) { queued = true; return; }
      busy = true;
      try {
        const start = latest.current.serialized;
        if (!mirror || action === "restore" || (action === "poll" && mirror.serialized === start)) {
          if (!mirror || action === "restore") setStatus("loading");
          const known = mirror && action !== "restore" ? "?revision=" + mirror.revision : "";
          const cloud = await request<{ revision: number; snapshot: T | null }>(workspaceUrl + known, { signal });
          if (signal.aborted) return;
          if (cloud.snapshot) {
            if (action !== "restore" && mirror && start !== latest.current.serialized) {
              blocked = true;
              setStatus("conflict");
              return;
            }
            latest.current.onRestore(cloud.snapshot);
            mirror = { revision: cloud.revision, serialized: canonical(cloud.snapshot) };
            blocked = false;
            setStatus("synced");
            return;
          }
          if (cloud.revision === 0 && !mirror) mirror = { revision: 0, serialized: "" };
          if (action === "restore") {
            blocked = false;
            if (cloud.revision === 0) mirror = { revision: 0, serialized: "" };
          }
        }

        const current = latest.current.serialized;
        if (mirror && current !== mirror.serialized) {
          setStatus("saving");
          const saved = await request<{ revision: number }>(workspaceUrl, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: `{"revision":${mirror.revision},"snapshot":${current}}`, signal,
          });
          if (signal.aborted) return;
          mirror = { revision: saved.revision, serialized: current };
          if (latest.current.serialized !== current) queued = true;
        }
        setStatus("synced");
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof AdminRequestError && error.status === 401) {
          setSession({ enabled: true, user: null });
          setSessionError("Sesi admin habis. Masuk lagi untuk sinkronisasi.");
        } else if (error instanceof AdminRequestError && error.status === 409) {
          blocked = true;
          setStatus("conflict");
        } else setStatus("offline");
      } finally {
        busy = false;
        if (queued && !signal.aborted) {
          queued = false;
          // Let a state restore render before comparing the local snapshot.
          setTimeout(() => { if (!signal.aborted) void reconcile("save"); }, 700);
        }
      }
    }

    syncNow.current = reconcile;
    const pull = () => { if (!document.hidden) void reconcile("poll"); };
    void reconcile("poll");
    const timer = setInterval(pull, 20_000);
    window.addEventListener("focus", pull);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", pull);
      syncNow.current = async () => {};
    };
  }, [ready, user]);

  useEffect(() => {
    if (!user || !ready) return;
    const timer = setTimeout(() => void syncNow.current("save"), 650);
    return () => clearTimeout(timer);
  }, [ready, serialized, user]);

  async function login(username: string, password: string) {
    setSessionBusy(true);
    setSessionError("");
    try {
      const next = await request<Session>(sessionUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      setSession(next);
      return true;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Login gagal.");
      return false;
    } finally { setSessionBusy(false); }
  }

  async function logout() {
    setSessionBusy(true);
    setSessionError("");
    try {
      await syncNow.current("save");
      setSession(await request<Session>(sessionUrl, { method: "DELETE" }));
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Logout gagal.");
    } finally { setSessionBusy(false); }
  }

  return {
    session, sessionBusy, sessionError, status, login, logout,
    sync: () => void syncNow.current("poll"),
    restore: () => void syncNow.current("restore"),
  };
}

type AdminState = ReturnType<typeof useAdminWorkspace<object>>;

export function AdminPanel({ admin }: { admin: AdminState }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const busy = admin.sessionBusy || admin.status === "loading" || admin.status === "saving";

  if (admin.session?.user) return <div className="admin-panel">
    <div className="admin-status">
      <strong>admin</strong>
      <span role="status" className={admin.status === "synced" ? "positive" : "secondary"}>{messages[admin.status]}</span>
    </div>
    <div className="settings-actions">
      {admin.status === "conflict"
        ? <button type="button" className="subtle-button" disabled={busy} onClick={() => {
          if (window.confirm("Muat workspace dari Neon dan ganti perubahan lokal di perangkat ini?")) admin.restore();
        }}><CloudDownload size={15}/>Ambil versi cloud</button>
        : <button type="button" className="subtle-button" disabled={busy} onClick={admin.sync}><RefreshCw size={15}/>Sinkron sekarang</button>}
      <button type="button" className="subtle-button" disabled={busy} onClick={() => void admin.logout()}><LogOut size={15}/>Keluar</button>
    </div>
    {admin.sessionError && <p className="negative" role="alert">{admin.sessionError}</p>}
  </div>;

  if (admin.session?.enabled === false) return <p className="secondary">Aktifkan Neon dan konfigurasi login admin di Vercel.</p>;
  if (!admin.session && !admin.sessionError) return <p className="secondary" role="status">Memeriksa sesi…</p>;

  return <form className="admin-panel form-grid" onSubmit={async event => {
    event.preventDefault();
    if (await admin.login(username, password)) { setPassword(""); setShow(false); }
  }}>
    <label>Username<input name="username" value={username} autoComplete="username" required onChange={event => setUsername(event.target.value)}/></label>
    <label htmlFor="azusa-admin-password">Password</label>
    <div className="admin-password">
      <input id="azusa-admin-password" name="password" type={show ? "text" : "password"} value={password}
        required maxLength={512} autoComplete="current-password" onChange={event => setPassword(event.target.value)}/>
      <button type="button" className="icon-btn" aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
        aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
    </div>
    <button type="submit" className="accent-button" disabled={admin.sessionBusy}><LogIn size={15}/>{admin.sessionBusy ? "Memeriksa…" : "Masuk"}</button>
    {admin.sessionError && <p className="negative" role="alert">{admin.sessionError}</p>}
  </form>;
}
