import { useState } from "react";
import type { ItemState } from "./types";

export default function ItemSupplement({
  additions = [],
  save,
  notify,
}: {
  additions?: NonNullable<ItemState["additions"]>;
  save: (additions: NonNullable<ItemState["additions"]>) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="item-supplement" aria-label="补充信息">
      <h3>我的补充</h3>
      {additions.map((entry) => (
        <div className="supplement-entry" key={entry.id}>
          <p>{entry.text}</p>
        </div>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          setBusy(true);
          try {
            await save([
              ...additions,
              {
                id: crypto.randomUUID(),
                text: text.trim(),
                at: new Date().toISOString(),
              },
            ]);
            setText("");
            notify("补充已保存");
          } catch (error) {
            notify((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          aria-label="补充信息"
          placeholder="记点新进展、补充要求，或者留句话给自己…"
          value={text}
          maxLength={6000}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim() || busy}>
          {busy ? "保存中…" : "保存补充"}
        </button>
      </form>
    </section>
  );
}
