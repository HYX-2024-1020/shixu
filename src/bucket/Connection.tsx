import { useEffect, useRef, useState } from "react";
import { Check, Download, KeyRound, LoaderCircle, X } from "lucide-react";
import { DEFAULT_MODEL } from "../../shared/bucket-engine.mjs";
import { exportPackets, serviceRequest, type Health } from "./service";
import type { Packet } from "./types";

export default function Connection({
  apiKey,
  model,
  remember,
  health,
  packets,
  onConnected,
  onClose,
  notify,
}: {
  apiKey: string;
  model: string;
  remember: boolean;
  health: Health | null;
  packets: Packet[];
  onConnected: (key: string, model: string, remember: boolean) => void;
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
    [models, setModels] = useState<string[]>([model || DEFAULT_MODEL]);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
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
            onConnected("", next.model, false);
            onClose();
            return;
          }
          notify("访问口令已验证，可以连接 DeepSeek");
          return;
        }
        await serviceRequest("settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: key.trim() || undefined,
            model: selected,
          }),
        });
        onConnected("", selected, false);
        notify("DeepSeek 已连接，密钥只保存在个人服务");
        onClose();
        return;
      }
      if (!key.trim()) throw new Error("填写你的 DeepSeek API 密钥即可开始");
      const response = await fetch("https://api.deepseek.com/models", {
        headers: { Authorization: `Bearer ${key.trim()}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "DeepSeek 密钥不正确"
            : "暂时无法校验 DeepSeek，请检查网络",
        );
      const payload = await response.json(),
        available = Array.isArray(payload.data)
          ? payload.data
              .map((m: { id: string }) => m.id)
              .filter((id: unknown) => typeof id === "string")
          : [];
      let choice = selected;
      if (available.length && !available.includes(choice))
        choice = available.includes(DEFAULT_MODEL)
          ? DEFAULT_MODEL
          : available.includes("deepseek-chat")
            ? "deepseek-chat"
            : available[0];
      setModels(available.length ? available : [choice]);
      setSelected(choice);
      onConnected(key.trim(), choice, persist);
      notify("已连接。桶里等待整理的内容会自动开始处理。");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="bucket-dialog" onCancel={onClose}>
      <header>
        <div>
          <span className="dialog-kicker">只需配置一次</span>
          <h2>
            {health && !authenticated ? "进入你的个人桶" : "连接 DeepSeek"}
          </h2>
        </div>
        <button aria-label="关闭设置" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
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
            <details className="connection-advanced">
              <summary>模型选项</summary>
              <label>
                模型 ID
                <input
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  list="bucket-models"
                  maxLength={100}
                />
                <datalist id="bucket-models">
                  {models.map((id) => (
                    <option value={id} key={id} />
                  ))}
                </datalist>
              </label>
              <p>
                默认优先使用账号中可用的 {DEFAULT_MODEL}
                。长文件会自动分段并合并，可能产生多次按量调用。
              </p>
            </details>
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
                : "文字和提取出的文件内容会直接发送给 DeepSeek。默认密钥仅留在当前页面；勾选记住后会存入本机浏览器，不进入备份或仓库。"}
            </p>
          </>
        )}
        <button
          className="bucket-primary connection-submit"
          type="submit"
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle size={17} className="bucket-spin" />
          ) : (
            <Check size={17} />
          )}{" "}
          {health && !authenticated ? "进入" : "连接并开始"}
        </button>
      </form>
      <div className="connection-data">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportPackets(packets);
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
        <details>
          <summary>关于这个版本</summary>
          <p>
            支持 TXT、MD、CSV、DOCX、文字型 PDF。扫描件暂不做
            OCR，无法读取时会保留原文件并提示。日期不明确时留空并说明，不会擅自猜测。
          </p>
          <p>
            {health
              ? "此入口已连接个人服务。同一服务地址和访问口令可供多设备使用。"
              : "当前是浏览器直连版，内容保存在此设备。手机电脑互通需要把仓库中的个人服务部署到带 HTTPS 的托管环境，再用该服务地址访问。无需自建 GPU。"}
          </p>
          <a
            href="https://github.com/HYX-2024-1020/shixu"
            target="_blank"
            rel="noreferrer"
          >
            查看开源项目与部署说明
          </a>
          <a href={`${import.meta.env.BASE_URL}?legacy=1`}>打开旧版资料空间</a>
        </details>
      </div>
    </dialog>
  );
}
