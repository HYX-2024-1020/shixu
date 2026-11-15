import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BoardAdapter,
  BoardSnapshot,
  Planning,
  SaveState,
} from "../types/board";
import { clone } from "../utils/board";

export type BoardMutator = (draft: BoardSnapshot) => void;

interface BoardContextValue {
  snapshot: BoardSnapshot;
  adapter: BoardAdapter;
  activePlan: Planning;
  saveState: SaveState;
  commit: (mutator: BoardMutator, message: string) => void;
  retrySave: () => void;
  setActivePlan: (planId: string) => void;
  addResources: (files: File[], planningId: string) => Promise<void>;
  reload: () => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard() {
  const value = useContext(BoardContext);
  if (!value) throw new Error("useBoard 必须在 BoardProvider 内使用");
  return value;
}

export function BoardProvider({
  adapter,
  children,
}: {
  adapter: BoardAdapter;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({
    phase: "idle",
    message: "已读取保存的看板",
  });
  const snapshotRef = useRef<BoardSnapshot | null>(null);
  const saveSequence = useRef(0);
  const pending = useRef(false);
  const inflight = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stateRef = useRef(saveState);
  stateRef.current = saveState;
  snapshotRef.current = snapshot;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await adapter.load();
      setSnapshot(data);
      setSaveState({
        phase: "idle",
        message: adapter.statusMessage?.() || "已读取保存的看板",
      });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "读取失败，请重试。",
      );
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (next: BoardSnapshot, successMessage: string) => {
      const sequence = ++saveSequence.current;
      pending.current = false;
      inflight.current++;
      setSaveState({ phase: "saving", message: "正在保存…" });
      try {
        await adapter.save(next);
        if (sequence === saveSequence.current) {
          setSaveState({
            phase: "saved",
            message: adapter.statusMessage?.() || successMessage,
          });
        }
      } catch (error) {
        if (sequence === saveSequence.current) {
          setSaveState({
            phase: "error",
            message:
              error instanceof Error
                ? error.message
                : "保存失败，修改仍保留，可重试。",
          });
        }
      } finally {
        inflight.current--;
      }
    },
    [adapter],
  );

  const commit = useCallback(
    (mutator: BoardMutator, message: string) => {
      const current = snapshotRef.current;
      if (!current) return;
      const next = clone(current);
      mutator(next);
      for (const task of next.tasks.filter((t) => t.origin === "source")) {
        const old = current.tasks.find((t) => t.id === task.id);
        if (!old) continue;
        for (const key of ["title", "dueAt", "completedAt"] as const)
          if (task[key] !== old[key])
            for (const linked of next.tasks.filter(
              (t) => t.sourceId === task.sourceId,
            ))
              Object.assign(linked, { [key]: task[key] });
      }
      snapshotRef.current = next;
      setSnapshot(next);
      pending.current = true;
      setSaveState({ phase: "saving", message: "正在保存…" });
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => void persist(snapshotRef.current!, message),
        350,
      );
    },
    [persist],
  );

  useEffect(() => {
    const flush = async () => {
      clearTimeout(saveTimer.current);
      if (pending.current && snapshotRef.current)
        await persist(snapshotRef.current, "已保存看板");
      await adapter.flush?.();
      if (stateRef.current.phase === "error")
        throw Error(stateRef.current.message);
    };
    window.flushBoardDraft = flush;
    const unsubscribe = adapter.subscribe?.(() => {
      if (
        pending.current ||
        inflight.current ||
        stateRef.current.phase === "error"
      )
        return;
      void adapter
        .load(
          () =>
            !pending.current &&
            !inflight.current &&
            stateRef.current.phase !== "error",
        )
        .then((data) => {
          if (
            !pending.current &&
            !inflight.current &&
            JSON.stringify(data) !== JSON.stringify(snapshotRef.current)
          ) {
            snapshotRef.current = data;
            setSnapshot(data);
          }
        })
        .catch(() => {});
    });
    return () => {
      clearTimeout(saveTimer.current);
      unsubscribe?.();
      delete window.flushBoardDraft;
    };
  }, [adapter, persist]);

  const addResources = async (files: File[], planningId: string) => {
    await window.flushBoardDraft?.();
    if (!adapter.addResources) throw Error("当前环境不支持保存文件");
    const data = await adapter.addResources(files, planningId);
    snapshotRef.current = data;
    setSnapshot(data);
  };

  const retrySave = useCallback(() => {
    if (snapshotRef.current) void persist(snapshotRef.current, "重试成功");
  }, [persist]);

  const setActivePlan = useCallback(
    (planId: string) => {
      commit((draft) => {
        draft.activePlanId = planId;
      }, "已切换当前规划");
    },
    [commit],
  );

  const value = useMemo<BoardContextValue | null>(() => {
    if (!snapshot) return null;
    const activePlan =
      snapshot.plans.find((plan) => plan.id === snapshot.activePlanId) ??
      snapshot.plans[0];
    if (!activePlan) return null;
    return {
      snapshot,
      adapter,
      activePlan,
      saveState,
      commit,
      retrySave,
      setActivePlan,
      addResources,
      reload: () => void load(),
    };
  }, [snapshot, adapter, saveState, commit, retrySave, setActivePlan, load]);

  if (loading) {
    return (
      <div className="sx-state" role="status">
        <span className="sx-state-mark">序</span>
        <strong>正在展开看板…</strong>
        <span>通过 adapter 读取规划与来源数据</span>
      </div>
    );
  }

  if (loadError || !value) {
    return (
      <div className="sx-state sx-state-error" role="alert">
        <span className="sx-state-mark">!</span>
        <strong>看板暂时没有读出来</strong>
        <span>{loadError || "没有可用规划。"}</span>
        <button
          className="sx-button sx-button-primary"
          type="button"
          onClick={() => void load()}
        >
          重试读取
        </button>
      </div>
    );
  }

  return (
    <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
  );
}

export function useBoardDraft(key: string, initial = "") {
  const { snapshot, commit } = useBoard();
  const value = snapshot.drafts?.[key] ?? initial;
  const setValue = (next: string) =>
    commit((draft) => {
      draft.drafts = { ...draft.drafts, [key]: next };
    }, "输入草稿已保存");
  return [value, setValue] as const;
}
