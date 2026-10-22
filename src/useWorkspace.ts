import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PREFS, type Entry, type Preferences } from "./types";
import {
  mergeEntries,
  readAll,
  setNamespace,
  validateBackup,
  writeEntries,
  writePreferences,
} from "./storage";
import {
  refreshCloud,
  syncCloud,
  type CloudConfig,
  type CloudSession,
} from "./cloud";

const AUTH_KEY = "shixu-cloud-session-v1";
type Account = { config: CloudConfig; session: CloudSession };
export function useWorkspace(onError: (message: string) => void) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [syncState, setSyncState] = useState("本机已保存");
  const [lastSynced, setLastSynced] = useState("");
  const [syncError, setSyncError] = useState("");
  const generation = useRef(0),
    syncing = useRef(false),
    accountRef = useRef<Account | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const reload = useCallback(async () => {
    const result = await readAll();
    setEntries(result.entries);
    setPreferences(result.preferences);
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      let stored: Account | null = null;
      try {
        const raw = localStorage.getItem(AUTH_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (
            parsed.session?.user?.id &&
            parsed.config?.url &&
            parsed.config?.anonKey
          )
            stored = parsed;
        }
      } catch {
        /* local mode remains usable */
      }
      if (!active) return;
      setNamespace(
        stored
          ? `shixu-${new URL(stored.config.url).hostname}-${stored.session.user.id}`
          : "shixu",
      );
      accountRef.current = stored;
      setAccount(stored);
      await reload();
      if (active) setReady(true);
    })().catch((e) => errorRef.current(e.message));
    return () => {
      active = false;
    };
  }, [reload]);

  const save = useCallback(async (updates: Entry[]) => {
    await writeEntries(updates);
    setEntries((previous) => {
      const map = new Map(previous.map((e) => [e.id, e]));
      updates.forEach((e) => map.set(e.id, e));
      return [...map.values()];
    });
    if (accountRef.current) setSyncState("等待同步");
  }, []);
  const savePrefs = useCallback(async (value: Preferences) => {
    await writePreferences(value);
    setPreferences(value);
  }, []);
  const connect = useCallback(
    async (config: CloudConfig, session: CloudSession, mergeLocal: boolean) => {
      const guest = mergeLocal ? (await readAll()).entries : [];
      generation.current++;
      const next = { config, session };
      localStorage.setItem(AUTH_KEY, JSON.stringify(next));
      setNamespace(`shixu-${new URL(config.url).hostname}-${session.user.id}`);
      if (guest.length) {
        const own = await readAll();
        const ownIds = new Set(own.entries.map((e) => e.id));
        await writeEntries(guest.filter((e) => !ownIds.has(e.id)));
      }
      accountRef.current = next;
      setAccount(next);
      await reload();
      setSyncState("等待同步");
    },
    [reload],
  );
  const disconnect = useCallback(async () => {
    const current = accountRef.current;
    generation.current++;
    localStorage.removeItem(AUTH_KEY);
    accountRef.current = null;
    setAccount(null);
    setNamespace("shixu");
    await reload();
    setSyncState("本机已保存");
    setSyncError("");
    setLastSynced("");
    if (current)
      fetch(`${current.config.url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: current.config.anonKey,
          Authorization: `Bearer ${current.session.access_token}`,
        },
      }).catch(() => {});
  }, [reload]);
  const sync = useCallback(async () => {
    if (syncing.current || !accountRef.current) return;
    if (!navigator.onLine) {
      setSyncState("离线 · 联网后同步");
      return;
    }
    syncing.current = true;
    const gen = generation.current;
    setSyncState("正在同步");
    try {
      const current = accountRef.current;
      const session = await refreshCloud(current.config, current.session);
      if (gen !== generation.current) return;
      const updated = { ...current, session };
      accountRef.current = updated;
      localStorage.setItem(AUTH_KEY, JSON.stringify(updated));
      const before = await readAll();
      const remote = await syncCloud(current.config, session, before.entries);
      if (gen !== generation.current) return;
      const validated = validateBackup({ version: 1, entries: remote }).entries;
      await mergeEntries(validated);
      if (gen !== generation.current) return;
      const final = await readAll();
      setEntries(final.entries);
      setSyncState("云端已同步");
      setSyncError("");
      setLastSynced(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (e) {
      if (gen === generation.current) {
        setSyncState("同步未完成");
        setSyncError(
          e instanceof Error ? e.message : "同步失败，本机内容已保留",
        );
      }
    } finally {
      syncing.current = false;
    }
  }, []);
  useEffect(() => {
    if (!ready || !account) return;
    void sync();
    const interval = window.setInterval(sync, 30000);
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
    };
  }, [account, ready, sync]);
  useEffect(() => {
    if (syncState !== "等待同步") return;
    const timeout = window.setTimeout(sync, 1200);
    return () => clearTimeout(timeout);
  }, [entries, syncState, sync]);
  useEffect(() => {
    const channel = new BroadcastChannel("shixu-workspace");
    channel.onmessage = () => {
      void reload();
    };
    return () => channel.close();
  }, [reload]);
  const broadcast = () => {
    const channel = new BroadcastChannel("shixu-workspace");
    channel.postMessage("changed");
    channel.close();
  };
  return {
    entries,
    preferences,
    ready,
    account,
    syncState,
    lastSynced,
    syncError,
    save: async (updates: Entry[]) => {
      await save(updates);
      broadcast();
    },
    savePrefs,
    connect,
    disconnect,
    sync,
    reload,
  };
}
