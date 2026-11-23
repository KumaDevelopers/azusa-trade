"use client";
import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload, Copy } from "lucide-react";
import { usePersisted } from "./use-persisted";

export default function WorkspaceBackup<T>({ snapshot, onRestore, tell }: { snapshot: () => T; onRestore: (snapshot: T) => void; tell: (message: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved, ready] = usePersisted("backup-v1", { key: "", revision: 0 });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/workspace", { signal: abort.signal }).then(response => response.json()).then(data => setEnabled(data.enabled === true)).catch(() => {});
    return () => abort.abort();
  }, []);
  if (!enabled || !ready) return null;

  async function transfer(restore: boolean) {
    const entered = draft.trim();
    const key = entered || saved.key || Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (!/^[a-f0-9]{64}$/.test(key)) { tell("Kunci pemulihan tidak valid."); return; }
    if (restore && !window.confirm("Pulihkan backup Neon dan ganti workspace lokal?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/workspace", {
        method: restore ? "GET" : "PUT",
        headers: { Authorization: "Bearer " + key, ...(restore ? {} : { "Content-Type": "application/json" }) },
        ...(restore ? {} : { body: JSON.stringify({ revision: key === saved.key ? saved.revision : 0, snapshot: snapshot() }) }),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transfer backup gagal.");
      if (restore) onRestore(result.snapshot);
      setSaved({ key, revision: result.revision });
      setDraft("");
      tell(restore ? "Workspace dipulihkan dari Neon." : "Backup tersimpan. Salin kunci pemulihan untuk perangkat lain.");
    } catch (error) { tell(error instanceof Error ? error.message : "Workspace tidak dapat disinkronkan."); }
    finally { setBusy(false); }
  }

  return <div className="backup-settings">
    <h3>Backup Neon</h3>
    <div className="form-grid">
      <label>Kunci pemulihan<input aria-label="Kunci pemulihan Neon" type="password" autoComplete="off" placeholder={saved.key ? "Kunci perangkat tersimpan" : "Kunci dari perangkat lain"} value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <button className="subtle-button" disabled={busy} onClick={() => void transfer(false)}><CloudUpload size={15}/>Backup</button>
      <button className="subtle-button" disabled={busy || (!saved.key && !draft)} onClick={() => void transfer(true)}><CloudDownload size={15}/>Pulihkan</button>
      <button className="subtle-button" disabled={!saved.key || busy} onClick={() => navigator.clipboard.writeText(saved.key).then(() => tell("Kunci disalin. Simpan secara privat.")).catch(() => tell("Kunci tidak dapat disalin."))}><Copy size={15}/>Salin kunci</button>
    </div>
  </div>;
}
