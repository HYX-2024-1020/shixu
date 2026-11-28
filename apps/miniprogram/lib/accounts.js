const SERVICE_ORIGIN = "https://sync.shixunote.top";
const CONNECTION = "shixu:mini:account:v3";
const { createTransport } = require("./transport");
const { hydrateReadingChanges } = require("./reading-transport");
const DEVELOPMENT_SERVICE_KEY = "shixu:mini:development-service";
function accountServiceOrigin(runtime) {
  const environment = runtime.getAccountInfoSync?.().miniProgram?.envVersion;
  if (environment !== "develop") return SERVICE_ORIGIN;
  const saved = runtime.getStorageSync?.(DEVELOPMENT_SERVICE_KEY);
  if (!saved) return SERVICE_ORIGIN;
  if (
    typeof saved !== "string" ||
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/.test(saved)
  )
    throw Error("开发联调仅允许本机 SSH 隧道地址");
  const port = Number(saved.slice(saved.lastIndexOf(":") + 1));
  if (port < 1 || port > 65535) throw Error("开发隧道端口无效");
  return saved;
}
function spaceKey(connection) {
  return connection.protocolVersion === 3
    ? "account:" + connection.userId
    : connection.base;
}
function accountTransport(connection, runtime, onAccount = () => {}) {
  const request = createTransport(
    connection.base,
    () => connection.token,
    runtime,
  );
  let reading = false;
  return async (method, path, data) => {
    const next =
      connection.protocolVersion === 3
        ? path.replace(/^\/api\/v2\//, "/api/v3/")
        : path;
    if (reading && method === "GET" && next.startsWith("/api/v3/changes?"))
      return hydrateReadingChanges(request, next);
    const result = await request(method, next, data);
    if (next === "/api/v3/account") {
      reading = !!result.reading;
      onAccount(result);
    }
    if (connection.protocolVersion === 3 && next === "/api/v3/status") {
      const account = await request("GET", "/api/v3/account");
      reading = !!account.reading;
      onAccount(account);
      return { ...result, epoch: account.epoch, account };
    }
    return result;
  };
}
async function activate(
  invite,
  runtime,
  origin = accountServiceOrigin(runtime),
) {
  if (typeof invite !== "string" || !invite.trim() || invite.length > 100)
    throw Error("请填写邀请码");
  const login = await new Promise((resolve, reject) =>
    runtime.login({
      success: resolve,
      fail: () => reject(Error("微信登录暂时失败，请重试")),
    }),
  );
  if (!login.code) throw Error("微信未返回登录凭证，请重试");
  const request = createTransport(origin, () => null, runtime);
  const enrolled = await request("POST", "/api/v3/activate/wechat", {
    invite: invite.trim(),
    code: login.code,
  });
  if (
    enrolled.protocolVersion !== 3 ||
    !/^[a-f0-9-]{36}$/.test(enrolled.userId) ||
    typeof enrolled.token !== "string" ||
    typeof enrolled.epoch !== "string"
  )
    throw Error("激活响应无效");
  return { ...enrolled, base: origin };
}
async function credentials(action, value, runtime, connection) {
  const origin = accountServiceOrigin(runtime);
  const request = createTransport(origin, () => connection?.token, runtime);
  if (action === "claim")
    return request("POST", "/api/v4/auth/claim-legacy", {
      contractVersion: 1,
      ...value,
    });
  const login = await new Promise((resolve, reject) =>
    runtime.login({
      success: resolve,
      fail: () => reject(Error("微信登录暂时失败")),
    }),
  );
  if (!login.code) throw Error("微信未返回登录凭证");
  const enrolled = await request("POST", `/api/v4/auth/${action}`, {
    contractVersion: 1,
    ...value,
    platform: "wechat",
    deviceName: "拾序微信",
    code: login.code,
  });
  if (
    enrolled.protocolVersion !== 3 ||
    !/^[a-f0-9-]{36}$/.test(enrolled.userId) ||
    typeof enrolled.token !== "string"
  )
    throw Error("账号响应无效");
  return { ...enrolled, base: origin };
}
module.exports = {
  SERVICE_ORIGIN,
  CONNECTION,
  spaceKey,
  accountTransport,
  activate,
  accountServiceOrigin,
  DEVELOPMENT_SERVICE_KEY,
  credentials,
};
