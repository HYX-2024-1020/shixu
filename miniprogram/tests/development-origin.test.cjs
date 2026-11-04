const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  accountServiceOrigin,
  SERVICE_ORIGIN,
  DEVELOPMENT_SERVICE_KEY,
} = require("../lib/accounts");
test("only develop can use an explicitly saved loopback SSH tunnel; trial/release ignore override", () => {
  const runtime = (env, value) => ({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: env } }),
    getStorageSync: (key) => {
      assert.equal(key, DEVELOPMENT_SERVICE_KEY);
      return value;
    },
  });
  assert.equal(
    accountServiceOrigin(runtime("develop", "http://127.0.0.1:18885")),
    "http://127.0.0.1:18885",
  );
  for (const env of ["trial", "release", undefined])
    assert.equal(
      accountServiceOrigin(runtime(env, "http://127.0.0.1:18885")),
      SERVICE_ORIGIN,
    );
  for (const value of [
    "http://evil.example:18885",
    "http://127.0.0.1:0",
    "http://127.0.0.1:99999",
    "http://127.0.0.1:18885/path",
    "https://evil.example",
  ])
    assert.throws(() => accountServiceOrigin(runtime("develop", value)));
});
