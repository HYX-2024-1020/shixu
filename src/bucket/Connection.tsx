import { useEffect, useRef, useState } from "react";
import { Check, Download, KeyRound, LoaderCircle, X } from "lucide-react";
import { DEFAULT_MODEL } from "../../shared/bucket-engine.mjs";
import { exportPackets, serviceRequest, type Health } from "./service";
import type { Packet } from "./types";
import { getModels, KNOWN_MODELS, modelLabel } from "./model-api";
import CloudConnection from "./CloudConnection";
import UsagePanel from "./UsagePanel";
import { rateFor, type UsageRecord } from "../../shared/usage.mjs";

export default function Connection({
  canSwitchCloud,
  apiKey,
  model,
  remember,
  health,
  packets,
  usage,
  onConnected,
  onClose,
  notify,
}: {
  canSwitchCloud: () => boolean;
  apiKey: string;
  model: string;
  remember: boolean;
  health: Health | null;
  packets: Packet[];
  usage: UsageRecord[];
  onConnected: (
    key: string,
    model: string,
    remember: boolean,
  ) => void | Promise<void>;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [key, setKey] = useState(apiKey),
    [selected, setSelected] = useState(model || DEFAULT_MODEL),
    [persist, setPersist] = useState(remember),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState(""),
    [authenticated, setAuthenticated] = useState(
      health?.authenticated || false,
    ),
    [models, setModels] = useState<string[]>([
      ...new Set([model || DEFAULT_MODEL, ...KNOWN_MODELS]),
    ]),
    [modelsBusy, setModelsBusy] = useState(false);
  const verified = useRef<{ key: string; ids: string[] } | null>(null);
  const [space, setSpace] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  async function readModels() {
    setModelsBusy(true);
    try {
      const ids = await getModels(key, health);
      verified.current = { key: key.trim(), ids };
      setModels(ids);
      if (!ids.includes(selected)) {
        setSelected(ids[0]);
        notify("已读取可用模型，请确认选择后再连接");
      }
      return ids;
    } finally {
      setModelsBusy(false);
    }
  }
  useEffect(() => {
    if (apiKey || (health?.authenticated && health.modelReady))
      void readModels().catch(() => {});
  }, []);
  async function connect() {
    setBusy(true);
    try {
      if (health) {
        if (!authenticated) {
          await serviceRequest("login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          setAuthenticated(true);
          setPassword("");
          const next = await serviceRequest("health");
          if (next.modelReady) {
            await onConnected("", next.model, false);
            onClose();
            return;
          }
          notify("访问口令已验证，可以连接 DeepSeek");
          return;
        }
        const available =
          verified.current?.key === key.trim()
            ? verified.current.ids
            : await readModels();
        if (!available.includes(selected))
          throw new Error("当前模型不可用，请确认新选择后再连接");
        await serviceRequest("settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: key.trim() || undefined,
            model: selected,
          }),
        });
        await onConnected("", selected, false);
        notify("DeepSeek 已连接，密钥只保存在个人服务");
        onClose();
        return;
      }
      if (!key.trim()) throw new Error("填写你的 DeepSeek API 密钥即可开始");
      const available =
        verified.current?.key === key.trim()
          ? verified.current.ids
          : await readModels();
      if (!available.includes(selected))
        throw new Error("当前模型不可用，请确认新选择后再连接");
      await onConnected(key.trim(), selected, persist);
      notify("已连接。桶里等待整理的内容会自动开始处理。");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="bucket-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <header>
        <div>
          <span className="dialog-kicker">只需配置一次</span>
          <h2>
            {health && !authenticated
              ? "进入你的个人桶"
              : window.desktop
                ? "连接与设置"
                : "连接 DeepSeek"}
          </h2>
        </div>
        <button aria-label="关闭设置" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {window.desktop && <CloudConnection canSwitch={canSwitchCloud} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <p className="connection-intro">
          连接后，你只管把文字和文件丢进来。分类、提炼和附件关联都会自动完成。
        </p>
        {health && !authenticated ? (
          <label>
            个人服务的访问口令
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
        ) : (
          <>
            <label>
              DeepSeek API 密钥
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  health?.modelReady
                    ? "已配置，留空保留现有密钥"
                    : "粘贴你的 API 密钥"
                }
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required={!health?.modelReady}
                autoFocus
              />
            </label>
            <div className="connection-model">
              <label>
                整理模型
                <select
                  aria-label="整理模型"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={busy || modelsBusy}
                >
                  {models.map((id) => (
                    <option value={id} key={id}>
                      {modelLabel(id)} · {id}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || modelsBusy}
                onClick={() =>
                  void readModels().catch((error) =>
                    notify(
                      error instanceof Error ? error.message : "读取模型失败",
                    ),
                  )
                }
              >
                {modelsBusy ? "读取中…" : "读取可用模型"}
              </button>
              <p>
                {rateFor(selected)
                  ? `每百万 Tokens：未缓存输入 ¥${rateFor(selected)!.miss}–${rateFor(selected)!.miss * 2}，输出 ¥${rateFor(selected)!.output}–${rateFor(selected)!.output * 2}。`
                  : "该模型暂无价格快照，记录用量但不猜费用。"}{" "}
                长文件和跨次关联可能多次调用。切换对下一次投递生效，已开始的整理使用原模型。
              </p>
            </div>
            {!health && (
              <label className="remember-key">
                <input
                  type="checkbox"
                  checked={persist}
                  onChange={(e) => setPersist(e.target.checked)}
                />
                在这台个人设备上记住密钥
              </label>
            )}
            <p className="connection-privacy">
              <KeyRound size={14} />
              {health
                ? "密钥只保存在你的个人服务，不发送给其他设备。"
                : window.desktop
                  ? "文字、文件提取文本、图片及扫描页会发送给 DeepSeek 用于识别、整理和关联。图像识别固定使用 DeepSeek Flash，沿用同一密钥；选择的模型用于文字整理。记住的密钥以 Windows 系统加密保存，不进入备份。"
                  : "输入、文件文字及已有未完成事项的摘要会发送给 DeepSeek，用于整理和关联。默认密钥仅留在当前页面；勾选记住后存入本机浏览器，不进入备份或仓库。"}
            </p>
          </>
        )}
        <button
          className="bucket-primary connection-submit"
          type="submit"
          disabled={busy || modelsBusy}
        >
          {busy ? (
            <LoaderCircle size={17} className="bucket-spin" />
          ) : (
            <Check size={17} />
          )}{" "}
          {health && !authenticated ? "进入" : "连接并开始"}
        </button>
      </form>
      {(!health || authenticated) && (
        <UsagePanel
          records={usage}
          apiKey={key}
          health={health}
          notify={notify}
        />
      )}
      <div className="connection-data">
        {window.desktop && (
          <>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const stats = await window.desktop!.store("cleanup");
                  setSpace(
                    `${stats.packets} 次投递 · ${stats.files} 个独立原件 · ${(stats.bytes / 1024 / 1024).toFixed(2)} MB；本次清理 ${stats.removed} 个无引用原件${stats.failures.length ? "；部分文件暂未清理，下次会重试：" + stats.failures.join("，") : ""}`,
                  );
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              清理到期内容并查看本机空间
            </button>
            {space && <p role="status">{space}</p>}
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.flushDesktopDraft?.();
                  notify(await window.desktop!.backup("export"));
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              备份全部资料（含草稿、最近删除与原件）
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await window.desktop!.backup("import");
                  notify(result);
                  if (result.startsWith("恢复完成")) location.reload();
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              从备份恢复
            </button>
            <p>
              桌面资料保存在本机；记住的密钥使用 Windows 系统加密，不进入备份。
            </p>
          </>
        )}
        {!window.desktop && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await exportPackets(packets, usage);
                notify(
                  "已导出原文、整理结果和附件。备份包含个人内容，请妥善保管。",
                );
              } catch (error) {
                notify(error instanceof Error ? error.message : "备份失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={15} />
            备份桶里的内容
          </button>
        )}
        <details>
          <summary>关于这个版本</summary>
          <p>
            支持文字、代码、DOC/DOCX、XLS/XLSX、PPT/PPTX、PDF、PNG/JPEG/GIF/WebP；桌面版支持
            ZIP/RAR/7z。扫描页使用图像识别，识别结果需要核对。旧版 PPT
            的文本流可能包含母版和历史文字，旧版 XLS 最多读取 5000
            行；读取失败可另存为现代 Office 或 PDF。
            嵌入图片和复杂图表不会假装已全部识别，读取覆盖情况见每次回执。
          </p>
          <p>
            {health
              ? "此入口已连接个人服务。同一服务地址和访问口令可供多设备使用。"
              : window.desktop
                ? "当前是 Windows 本机版，资料保存在本机独立目录；关闭窗口后继续在托盘运行，托盘菜单可明确退出。最近删除保留 30 天，永久删除投递不删除用量记账。"
                : "当前是浏览器直连版，内容保存在此设备。手机电脑互通需要把仓库中的个人服务部署到带 HTTPS 的托管环境，再用该服务地址访问。无需自建 GPU。"}
          </p>
          <a
            href="https://github.com/HYX-2024-1020/shixu"
            target="_blank"
            rel="noreferrer"
          >
            查看开源项目与部署说明
          </a>
          {!window.desktop && (
            <a href={`${import.meta.env.BASE_URL}?legacy=1`}>
              打开旧版资料空间
            </a>
          )}
        </details>
      </div>
    </dialog>
  );
}
