import { Check, Layers2, Unlink } from "lucide-react";
import type { ItemGroup } from "../../shared/relations.mjs";
import { itemRef } from "../../shared/relations.mjs";
import type { UsageRecord } from "../../shared/usage.mjs";
import type { Packet } from "./types";
import PacketCard from "./PacketCard";
export default function GroupCard({
  group,
  packets,
  usage,
  onToggle,
  onSplit,
  onDelete,
  notify,
}: {
  group: ItemGroup;
  packets: Packet[];
  usage: UsageRecord[];
  onToggle: (refs: string[], done: boolean) => Promise<void>;
  onSplit: () => void;
  onDelete: (p: Packet) => Promise<void>;
  notify: (s: string) => void;
}) {
  const originals = packets
    .filter((p) => group.packetIds.includes(p.id) && !p.deletedAt)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const done = group.units.filter((u) => u.done).length;
  return (
    <article
      className={`bucket-group ${done === group.units.length && group.kind === "task" ? "group-done" : ""}`}
    >
      <div className="group-stamp">
        <span>
          <Layers2 size={14} />
          自动关联 · {group.packetIds.length} 次投递
        </span>
        {group.kind === "task" && (
          <small>
            {done}/{group.units.length} 已完成
          </small>
        )}
      </div>
      <h3>{group.title}</h3>
      <div className="group-units">
        {group.units.map((unit) => (
          <section
            className={`group-unit ${unit.done ? "unit-done" : ""}`}
            key={unit.refs[0]}
          >
            <div className="group-unit-title">
              {group.kind === "task" ? (
                <button
                  className={`bucket-check ${unit.done ? "checked" : ""}`}
                  aria-label={`${unit.done ? "取消完成" : "完成"}：${unit.item.title}`}
                  onClick={() => void onToggle(unit.refs, !unit.done)}
                >
                  {unit.done && <Check size={13} />}
                </button>
              ) : (
                <span className="group-unit-dot" />
              )}
              <strong>{unit.item.title}</strong>
              {unit.item.due && (
                <span className="group-unit-due">
                  {Number(unit.item.due.date.slice(5, 7))}月
                  {Number(unit.item.due.date.slice(8))}日 {unit.item.due.time}
                </span>
              )}
            </div>
            {unit.item.facts.length > 0 && (
              <ul>
                {unit.item.facts.slice(0, 4).map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            )}
            {unit.members.length > 1 && (
              <p className="group-repeat">
                同一事项的 {unit.members.length} 次补充已归在一起
              </p>
            )}
          </section>
        ))}
      </div>
      <details className="group-details">
        <summary>要求、原文与附件</summary>
        <p>各次投递均保留；不同子项的日期和完成状态分别计算。</p>
        {originals.map((p) => (
          <PacketCard
            key={p.id}
            packet={p}
            usage={usage.filter((r) => r.packetId === p.id)}
            progress=""
            itemIndexes={p.result?.items
              .map((_, i) => i)
              .filter((i) => group.refs.includes(itemRef(p.id, p.itemIds?.[i] || i)))}
            onRetry={() => {}}
            onToggle={(i) => {
              const unit = group.units.find((u) =>
                u.refs.includes(itemRef(p.id, p.itemIds?.[i] || i)),
              );
              if (unit) void onToggle(unit.refs, !unit.done);
            }}
            onDelete={() => void onDelete(p)}
            notify={notify}
          />
        ))}
        <button className="group-split" onClick={onSplit}>
          <Unlink size={14} />
          拆开这一组
        </button>
      </details>
    </article>
  );
}
