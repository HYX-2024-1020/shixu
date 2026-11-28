import { useState } from "react";
import {
  allPackets,
  allUsage,
  readDraft,
  restoreBrowserSnapshot,
} from "./store";
import {
  encodeSnapshot,
  decodeSnapshot,
  type BrowserSnapshot,
} from "./admin-backup";
export default function AdminBackup({
  canUse,
  notify,
}: {
  canUse: () => boolean;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BrowserSnapshot | null>(null);
  async function run(action: () => Promise<void>) {
    if (!canUse()) {
      notify("请等正在进行的整理或对话结束后再备份或恢复");
      return;
    }
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败，本机资料已保留");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-backup" aria-label="本机备份与恢复">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await window.flushDesktopDraft?.();
            const [packets, usage, draft] = await Promise.all([
              allPackets(),
              allUsage(),
              readDraft(),
            ]);
            const data = await encodeSnapshot({ packets, usage, draft });
            const url = URL.createObjectURL(
              new Blob([data as Uint8Array<ArrayBuffer>], {
                type: "application/zip",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `shixu-admin-test-${new Date().toLocaleDateString("sv-SE")}.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            notify(
              "已生成备份，请在下载列表保存到文件；含草稿、事项、原件和用量，不含密钥",
            );
          })
        }
      >
        备份全部本机资料
      </button>
      <label>
        选择管理员测试版备份
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            setPending(null);
            if (file)
              void run(async () => {
                if (file.size > 100 * 1024 * 1024)
                  throw Error("备份文件超过 100MB");
                setPending(
                  decodeSnapshot(new Uint8Array(await file.arrayBuffer())),
                );
              });
          }}
        />
      </label>
      {pending && (
        <div>
          <p>
            已校验 {pending.packets.length} 次投递。合并只添加不存在的记录，同
            ID 保留手机当前版本；当前草稿非空时保留当前草稿。不会自动发起 AI
            请求。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.flushDesktopDraft?.();
                await restoreBrowserSnapshot(pending);
                location.reload();
              })
            }
          >
            确认合并恢复
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            取消恢复
          </button>
        </div>
      )}
      <p>
        备份含个人资料，请存入“文件”妥善保管。只支持本测试版 ZIP，展开后最多
        100MB；恢复失败不改动现有记录。没有云备份。
      </p>
    </section>
  );
}
