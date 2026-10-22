import { useEffect, useRef, useState } from "react";
import {
  Check,
  Cloud,
  Download,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Modal } from "./components";
import {
  DEFAULT_PREFS,
  type Entry,
  type Preferences,
  type Snapshot,
} from "./types";
import { decryptBackup, encryptBackup, validateBackup } from "./storage";
import {
  checkCloud,
  cloudAuth,
  type CloudConfig,
  type CloudSession,
} from "./cloud";
import { localDate } from "./organize";

interface Props {
  preview?: boolean;
  preferences: Preferences;
  entries: Entry[];
  aiKey: string;
  onKey: (key: string) => void;
  account: { config: CloudConfig; session: CloudSession } | null;
  onConnect: (
    config: CloudConfig,
    session: CloudSession,
    merge: boolean,
  ) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onSave: (p: Preferences) => Promise<void>;
  onImport: (s: Snapshot) => Promise<void>;
  onClose: () => void;
  notify: (s: string) => void;
  sync: () => Promise<void>;
  syncState: string;
  syncError: string;
}
export default function Settings(props: Props) {
  const { preferences, entries, account, notify } = props;
  const [tab, setTab] = useState("general"),
    [value, setValue] = useState(preferences),
    [key, setKey] = useState(props.aiKey),
    [busy, setBusy] = useState(false);
  const [cloudUrl, setCloudUrl] = useState(account?.config.url || ""),
    [anonKey, setAnonKey] = useState(account?.config.anonKey || ""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [signup, setSignup] = useState(false),
    [merge, setMerge] = useState(false);
  const [backupPassword, setBackupPassword] = useState(""),
    [importData, setImportData] = useState<Snapshot | null>(null),
    [encrypted, setEncrypted] = useState<Record<string, string> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [offlineStatus, setOfflineStatus] =
    useState("离线资源正在准备，请保持联网并稍候。");
  useEffect(() => {
    let active = true;
    if (!("serviceWorker" in navigator)) {
      setOfflineStatus(
        "当前浏览器环境不支持离线安装，请在 Safari 中打开正式 HTTPS 地址。",
      );
      return;
    }
    navigator.serviceWorker.ready
      .then(() => {
        if (active)
          setOfflineStatus("离线资源已就绪，可添加到主屏幕后重新打开验证。");
      })
      .catch(() => {
        if (active) setOfflineStatus("离线资源尚未准备好，请保持联网后重试。");
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  function snapshot(): Snapshot {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
      preferences: { ...preferences, aiEndpoint: "", aiModel: "" },
    };
  }
  function download(content: string, suffix: string) {
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `shixu-backup-${localDate()}${suffix}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("备份文件不能超过 20 MB");
      const data = JSON.parse(await file.text());
      if (data?.format === "shixu-encrypted-v1") {
        setEncrypted(data);
        setImportData(null);
        notify("这是加密备份，请填写密码后解密");
      } else {
        setImportData(validateBackup(data));
        setEncrypted(null);
      }
    });
    if (fileInput.current) fileInput.current.value = "";
  }
  async function login() {
    await run(async () => {
      const config = checkCloud({ url: cloudUrl.trim(), anonKey });
      const session = await cloudAuth(config, email.trim(), password, signup);
      if (!session) {
        notify("注册已提交，请先到邮箱点击确认链接，再回来登录");
        setSignup(false);
        return;
      }
      await props.onConnect(config, session, merge);
      setPassword("");
      notify("已登录，同步将自动开始");
    });
  }
  return (
    <Modal
      title="让拾序更适合你"
      subtitle="数据、设备与整理方式，都由你决定。"
      onClose={() => {
        if (!busy) props.onClose();
      }}
      wide
    >
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {[
          ["general", "偏好设置"],
          ["ai", "AI 整理"],
          ["cloud", "登录与同步"],
          ["data", "数据与备份"],
        ]
          .filter(([id]) => !props.preview || id !== "cloud")
          .map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="settings-body">
        {tab === "general" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await props.onSave(value);
                notify("偏好设置已保存");
              });
            }}
          >
            <h3>给每天一点自己的节奏</h3>
            <label>
              怎么称呼你
              <input
                value={value.name}
                maxLength={30}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
              />
            </label>
            <div className="two-columns">
              <label>
                每日小目标
                <select
                  value={value.dailyGoal}
                  onChange={(e) =>
                    setValue({ ...value, dailyGoal: Number(e.target.value) })
                  }
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} 件事
                    </option>
                  ))}
                </select>
              </label>
              <label>
                外观
                <select
                  value={value.theme}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      theme: e.target.value as Preferences["theme"],
                    })
                  }
                >
                  <option value="light">浅色 · 日间纸张</option>
                  <option value="dark">深色 · 夜间书桌</option>
                  <option value="system">跟随系统</option>
                </select>
              </label>
            </div>
            <p className="helper">
              目标只是温柔的参考。计划有变化，也可以重新开始。
            </p>
            <button className="button primary" disabled={busy} type="submit">
              <Check size={15} />
              保存偏好
            </button>
            <div className="settings-divider" />
            <h3>安装到手机或电脑</h3>
            <p className="helper" role="status">
              {offlineStatus}
            </p>
            <p>
              手机浏览器打开应用地址，在浏览器菜单选择“添加到主屏幕”；电脑上的
              Chrome / Edge
              可点击地址栏中的安装图标。离线资源准备完成后，日常打开优先读取本机缓存。
            </p>
            <p className="helper">
              iPhone：用 Safari 打开在线地址 → 分享（方框向上箭头）→
              添加到主屏幕。如果有“作为网页 App 打开”，请开启。
              添加后从主屏幕图标重新打开，并保持联网完成该空间的离线准备。电脑本机预览地址不能在手机上直接使用。
            </p>
          </form>
        )}
        {tab === "ai" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (value.aiEndpoint) {
                  const u = new URL(value.aiEndpoint);
                  if (
                    (u.protocol !== "https:" &&
                      !(
                        u.protocol === "http:" &&
                        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
                      )) ||
                    u.username ||
                    u.password ||
                    u.search ||
                    u.hash
                  )
                    throw new Error(
                      "请输入 HTTPS 或本机 API 根地址，不含凭据与参数",
                    );
                }
                await props.onSave(value);
                props.onKey(key);
                notify("AI 配置已保存，密钥仅在当前页面内存保留");
              });
            }}
          >
            <div className="info-card">
              <KeyRound size={22} />
              <div>
                <h3>选择你信任的模型服务</h3>
                <p>
                  支持兼容 Chat Completions 的接口。每次仅在你点击“发送给
                  AI”时传送选中的文字，文件原件不会上传。
                </p>
              </div>
            </div>
            <label>
              API 根地址
              <input
                type="url"
                value={value.aiEndpoint}
                placeholder="https://your-provider.example/v1"
                onChange={(e) =>
                  setValue({ ...value, aiEndpoint: e.target.value.trim() })
                }
              />
            </label>
            <label>
              模型名称
              <input
                value={value.aiModel}
                placeholder="填写服务商提供的模型 ID"
                maxLength={100}
                onChange={(e) =>
                  setValue({ ...value, aiModel: e.target.value })
                }
              />
            </label>
            <label>
              API 密钥
              <input
                type="password"
                autoComplete="off"
                value={key}
                placeholder="仅当前页面保存，刷新后需重新填写"
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <p className="helper">
              接口须允许浏览器跨域请求。密钥不写入本机数据库、备份或源码；如需长期使用，建议部署自己的受保护代理。模型服务可能产生费用。
            </p>
            <button className="button primary" type="submit" disabled={busy}>
              <Check size={15} />
              保存 AI 配置
            </button>
            <div className="settings-divider" />
            <h3>没有 AI 也可以用</h3>
            <p>
              本机模式可以按句提取事项、识别常见日期和分类、摘录通知重点。短灵感可生成通用思考提纲；自然语言总结和个性化扩写由
              AI 模式提供。
            </p>
          </form>
        )}
        {tab === "cloud" && (
          <div>
            <div className="info-card">
              <Cloud size={24} />
              <div>
                <h3>同一个你，同一份生活</h3>
                <p>
                  连接自己的 Supabase
                  项目后，登录同一个账号即可在手机、电脑自动同步。离线修改先保存在设备，联网后继续同步。
                </p>
              </div>
            </div>
            {account ? (
              <div className="connected">
                <span className="badge task">已登录</span>
                <h3>{account.session.user.email || "云端账号"}</h3>
                <p>{props.syncState}</p>
                {props.syncError && (
                  <p className="error-text">{props.syncError}</p>
                )}
                <div className="inline-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void run(props.sync)}
                  >
                    <Cloud size={16} />
                    立即同步
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void run(props.onDisconnect)}
                  >
                    <LogOut size={16} />
                    退出登录
                  </button>
                </div>
                <p className="helper">
                  退出后回到本机空间。云端空间的离线缓存仍保留在当前浏览器，公共设备请清除本站浏览器数据。
                </p>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void login();
                }}
              >
                <details className="setup-guide">
                  <summary>首次使用：3 步配置云同步</summary>
                  <ol>
                    <li>
                      在{" "}
                      <a
                        href="https://supabase.com/dashboard"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Supabase 控制台
                        <ExternalLink size={12} />
                      </a>{" "}
                      创建自己的项目。
                    </li>
                    <li>
                      在 SQL Editor 执行开源仓库中的{" "}
                      <a
                        href="https://github.com/HYX-2024-1020/shixu/blob/main/supabase/schema.sql"
                        target="_blank"
                        rel="noreferrer"
                      >
                        supabase/schema.sql
                      </a>
                      ，启用事项表和每用户访问隔离。
                    </li>
                    <li>
                      复制项目 URL 和 publishable / anon
                      公钥，在下方填入，然后注册并确认邮箱。另一台设备填写同一项目并登录。
                    </li>
                  </ol>
                  <p>
                    请勿粘贴 service_role 或 secret
                    密钥。此配置需要你自己拥有的云服务账号，拾序不会替你开通付费服务。
                  </p>
                </details>
                <label>
                  Supabase 项目 URL
                  <input
                    type="url"
                    value={cloudUrl}
                    required
                    placeholder="https://your-project.supabase.co"
                    onChange={(e) => setCloudUrl(e.target.value)}
                  />
                </label>
                <label>
                  Publishable / anon 公钥
                  <input
                    value={anonKey}
                    required
                    autoComplete="off"
                    placeholder="sb_publishable_… 或 anon JWT"
                    onChange={(e) => setAnonKey(e.target.value)}
                  />
                </label>
                <div className="two-columns">
                  <label>
                    邮箱
                    <input
                      type="email"
                      value={email}
                      autoComplete="email"
                      required
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    密码
                    <input
                      type="password"
                      value={password}
                      autoComplete={
                        signup ? "new-password" : "current-password"
                      }
                      minLength={6}
                      required
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={merge}
                    onChange={(e) => setMerge(e.target.checked)}
                  />
                  把当前本机空间的事项合并到此账号（会上传内容）
                </label>
                <div className="inline-actions">
                  <button
                    className="button primary"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Cloud size={15} />
                    )}{" "}
                    {signup ? "创建账号" : "登录并开启同步"}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setSignup(!signup)}
                  >
                    {signup ? "已有账号，去登录" : "没有账号，先注册"}
                  </button>
                </div>
              </form>
            )}
            <p className="helper">
              配置与登录会话保存在当前浏览器，不会进入备份或 GitHub。偏好与 AI
              配置按设备保存。自动同步每 30 秒检查，修改后约 1
              秒发起；同一事项冲突采用最后修改时间，设备时间请保持准确。
            </p>
          </div>
        )}
        {tab === "data" && (
          <div>
            <div className="info-card">
              <ShieldCheck size={24} />
              <div>
                <h3>你的数据，始终可以带走</h3>
                <p>
                  当前空间共 {entries.filter((e) => !e.deletedAt).length}{" "}
                  条事项。备份含个人事项与偏好，不含密钥、登录会话和云服务配置。请妥善保管备份文件。
                </p>
              </div>
            </div>
            <h3>导出备份</h3>
            <label>
              加密密码（至少 8 个字符）
              <input
                type="password"
                autoComplete="new-password"
                value={backupPassword}
                placeholder="推荐加密后再转存或发送"
                onChange={(e) => setBackupPassword(e.target.value)}
              />
            </label>
            <div className="inline-actions">
              <button
                className="button primary"
                disabled={busy || backupPassword.length < 8}
                onClick={() =>
                  void run(async () => {
                    download(
                      await encryptBackup(snapshot(), backupPassword),
                      "-encrypted",
                    );
                    notify("已导出加密备份，请牢记密码");
                  })
                }
              >
                <Download size={15} />
                导出加密备份
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  download(JSON.stringify(snapshot(), null, 2), "");
                  notify("已导出明文备份，文件包含个人内容，请勿上传公开仓库");
                }}
              >
                导出明文 JSON
              </button>
            </div>
            <div className="settings-divider" />
            <h3>导入备份</h3>
            <p>
              导入会合并事项。同一 ID
              仅保留修改时间较新的版本，不会清空现有内容。
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".json"
              hidden
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={15} />
              选择备份文件
            </button>
            {encrypted && (
              <div className="confirm-box">
                <p>输入上方的备份密码，然后解密。</p>
                <button
                  className="button secondary"
                  disabled={busy || !backupPassword}
                  onClick={() =>
                    void run(async () => {
                      setImportData(
                        await decryptBackup(encrypted, backupPassword),
                      );
                      setEncrypted(null);
                    })
                  }
                >
                  解密并预览
                </button>
              </div>
            )}
            {importData && (
              <div className="confirm-box">
                <p>
                  已验证备份：共 {importData.entries.length} 条事项，导出于{" "}
                  {importData.exportedAt
                    ? new Date(importData.exportedAt).toLocaleString("zh-CN")
                    : "未知时间"}
                  。
                </p>
                <div className="inline-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await props.onImport(importData);
                        setImportData(null);
                        notify("备份已合并");
                      })
                    }
                  >
                    确认合并到当前空间
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setImportData(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="settings-foot">
        <span>拾序 0.1 · 开源，用自己的节奏生活</span>
        <a
          href="https://github.com/HYX-2024-1020/shixu"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
          <ExternalLink size={12} />
        </a>
      </footer>
    </Modal>
  );
}
