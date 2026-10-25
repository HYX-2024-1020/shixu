const SERVICE_ORIGIN = "https://sync.shixunote.top";
const CONNECTION = "shixu:mini:account:v3";
const { createTransport } = require("./transport");
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
  return async (method, path, data) => {
    const next =
      connection.protocolVersion === 3
        ? path.replace(/^\/api\/v2\//, "/api/v3/")
        : path;
    const result = await request(method, next, data);
    if (connection.protocolVersion === 3 && next === "/api/v3/status") {
      const account = await request("GET", "/api/v3/account");
      onAccount(account);
      return { ...result, epoch: account.epoch, account };
    }
    return result;
  };
}
async function activate(invite, runtime, origin = SERVICE_ORIGIN) {
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
module.exports = {
  SERVICE_ORIGIN,
  CONNECTION,
  spaceKey,
  accountTransport,
  activate,
};
