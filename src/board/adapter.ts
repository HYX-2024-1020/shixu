import type { BoardAdapter, BoardSnapshot, ResourceItem } from "./types/board";
import { sourceEdits } from "../../shared/board.mjs";
import { browserBoardAction } from "./browser-store";
type View = {
  snapshot: BoardSnapshot;
  stamp: string;
  sourceTokens: Record<string, string>;
  syncConflict?: boolean;
  pending?: number;
  error?: string;
};
export class RealBoardAdapter implements BoardAdapter {
  private view!: View;
  private enqueued!: BoardSnapshot;
  private saved!: BoardSnapshot;
  private tail: Promise<void> = Promise.resolve();
  private failed: unknown;
  private urls = new Map<string, string>();
  constructor(
    private onSource: (id: string) => void,
    private onResource: (file: {
      name: string;
      type: string;
      bytes: ArrayBuffer;
    }) => void,
  ) {}
  private call(action: string, value?: unknown): Promise<any> {
    const host = window.boardHost || window.desktop?.board;
    return host
      ? host.invoke(action, value)
      : browserBoardAction(action, value).then((result) => {
          if (["save", "addFiles"].includes(action))
            window.dispatchEvent(new Event("shixu-board-changed"));
          return result;
        });
  }
  private async accept(view: View, guard?: () => boolean) {
    for (const r of view.snapshot.resources) {
      if (r.kind !== "image" || r.deletedAt) continue;
      if (!this.urls.has(r.id)) {
        try {
          const f = await this.call("resource", { id: r.id });
          this.urls.set(
            r.id,
            URL.createObjectURL(new Blob([f.bytes], { type: f.type })),
          );
        } catch {
          /* Availability is reported on explicit open, never faked with examples. */
        }
      }
      r.url = this.urls.get(r.id);
    }
    if (guard && !guard()) return this.enqueued;
    this.view = view;
    this.enqueued = structuredClone(view.snapshot);
    this.saved = structuredClone(view.snapshot);
    return view.snapshot;
  }
  async load(guard?: () => boolean) {
    await this.tail.catch(() => {});
    const view = await this.call("load");
    if (guard && !guard()) return this.enqueued;
    this.failed = undefined;
    return this.accept(view, guard);
  }
  statusMessage() {
    return this.view?.syncConflict
      ? "看板存在同步冲突，请到主程序账号设置核对；本机内容仍保留"
      : this.view?.error
        ? `已保存到本机，云同步待重试：${this.view.error}`
        : this.view?.pending
          ? `已保存到本机，${this.view.pending} 项待同步`
          : "已保存到当前资料空间";
  }
  save(snapshot: BoardSnapshot) {
    // Compute intent before asynchronous saves: a later queued snapshot cannot
    // accidentally undo a source edit from an earlier one.
    const next = structuredClone(snapshot),
      edits = sourceEdits(this.enqueued, next);
    this.enqueued = next;
    const run = this.tail
      .catch(() => {})
      .then(async () => {
        if (this.failed) {
          // Explicit retry sends all changes since the last durable success.
          const allEdits = sourceEdits(this.saved, next);
          const view = await this.call("save", {
            snapshot: next,
            stamp: this.view.stamp,
            sourceTokens: this.view.sourceTokens,
            sourceEdits: allEdits,
          });
          this.view = view;
          this.saved = next;
          this.failed = undefined;
          return;
        }
        const view = await this.call("save", {
          snapshot: next,
          stamp: this.view.stamp,
          sourceTokens: this.view.sourceTokens,
          sourceEdits: edits,
        });
        this.view = view;
        this.saved = next;
      })
      .catch((e) => {
        this.failed = e;
        throw e;
      });
    this.tail = run;
    return run;
  }
  async flush() {
    await this.tail;
    if (this.failed) throw this.failed;
  }
  async addResources(files: File[], planningId: string) {
    await this.flush();
    const encoded = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        type: f.type,
        bytes: await f.arrayBuffer(),
      })),
    );
    return this.accept(
      await this.call("addFiles", {
        files: encoded,
        planningId,
        stamp: this.view.stamp,
      }),
    );
  }
  async openResource(resource: ResourceItem) {
    this.onResource(await this.call("resource", { id: resource.id }));
  }
  async openSource(id: string) {
    if (window.boardHost) await this.call("openSource", { id });
    else this.onSource(id);
  }
  subscribe(listener: () => void) {
    const host = window.boardHost || window.desktop?.board;
    const unsubscribe = host?.onChanged(listener);
    // Poll only metadata/local cache; cloud polling stays in the existing main
    // account loop. Never replace optimistic edits while a save is outstanding.
    const timer = window.setInterval(listener, 5000);
    window.addEventListener("focus", listener);
    return () => {
      unsubscribe?.();
      clearInterval(timer);
      window.removeEventListener("focus", listener);
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
      this.urls.clear();
    };
  }
}
