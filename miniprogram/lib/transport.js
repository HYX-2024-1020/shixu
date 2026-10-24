function normalizeServiceURL(value, environment) {
  const text = String(value || "")
    .trim()
    .replace(/\/$/, "");
  const match = /^(https?):\/\/([^/?#\s]+)$/.exec(text);
  if (!match || match[2].includes("@"))
    throw new Error("请填写没有路径的 HTTPS 服务地址");
  const host = match[2].toLowerCase();
  const local = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
  if (match[1] !== "https" && !(environment === "develop" && local))
    throw new Error("真机与正式服务需要 HTTPS；本机 HTTP 仅供开发工具调试");
  return `${match[1]}://${host}`;
}
function createTransport(base, getToken) {
  return (method, path, data) =>
    new Promise((resolve, reject) => {
      const token = getToken();
      wx.request({
        url: base + path,
        method,
        ...(data ? { data } : {}),
        timeout: 15000,
        header: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        success(response) {
          const body = response.data;
          if (
            response.statusCode >= 200 &&
            response.statusCode < 300 &&
            body &&
            typeof body === "object"
          )
            resolve(body);
          else
            reject(
              Object.assign(
                new Error((body && body.error) || "服务返回异常，请稍后重试"),
                body && typeof body === "object" ? body : {},
                { status: response.statusCode },
              ),
            );
        },
        fail() {
          reject(new Error("暂时连不上服务，本机内容已保留"));
        },
      });
    });
}
module.exports = { normalizeServiceURL, createTransport };
