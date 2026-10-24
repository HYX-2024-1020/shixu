import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePullRequest } from "./check-pr.mjs";

const valid = () => ({
  head: { ref: "chore/open-source-workflow" },
  base: { ref: "main" },
  title: "chore: establish public contributor workflow",
  user: { login: "contributor" },
  body: "## 变更内容\n为公开仓库增加贡献约定和自动检查。\n## 验证结果\n已运行核心验证及规范门禁，结果通过。\n## 风险与回滚\n不修改个人数据，必要时撤回本次提交。\n## 双端影响\n桌面和小程序均不改变资料行为，仅增加贡献流程。",
});

test("accepts a complete contributor PR, including CRLF", () => {
  const pr = valid();
  assert.deepEqual(validatePullRequest(pr), []);
  pr.body = pr.body.replaceAll("\n", "\r\n");
  assert.deepEqual(validatePullRequest(pr), []);
});
test("rejects direct/default or malformed branches and nonconventional titles", () => {
  const pr = valid();
  pr.head.ref = "main";
  pr.title = "changes";
  pr.base.ref = "release";
  assert.equal(validatePullRequest(pr).length, 3);
});
test("template comments and checkboxes do not count as validation evidence", () => {
  const pr = valid();
  pr.body =
    "## 变更内容\n<!-- 填写变更内容的详细说明 -->\n## 验证结果\n- [x] 已执行适用验证并如实记录结果\n## 风险与回滚\nTODO\n## 双端影响\n<!-- 尚未填写实际影响 -->";
  assert.equal(validatePullRequest(pr).length, 4);
});
test("requires every section and rejects an empty payload", () => {
  const pr = valid();
  pr.body = "A description without the required sections";
  assert.equal(validatePullRequest(pr).length, 4);
  assert.equal(validatePullRequest(null).length, 1);
});
test("only the authenticated Dependabot creator has a metadata exemption", () => {
  const pr = valid();
  pr.head.ref = "dependabot/npm_and_yarn/example-1.2.3";
  pr.title = "Bump example";
  pr.body = "Generated dependency update";
  assert.ok(validatePullRequest(pr).length > 0);
  pr.user.login = "dependabot[bot]";
  assert.deepEqual(validatePullRequest(pr), []);
  pr.base.ref = "other";
  assert.equal(validatePullRequest(pr).length, 1);
});

test("requires concrete dual-client impact instead of an empty checklist", () => {
  const pr = valid();
  pr.body = pr.body.split("## 双端影响")[0];
  assert.ok(
    validatePullRequest(pr).some((error) => error.includes("双端影响")),
  );
  pr.body += "## 双端影响\n- [x] 已评估两端\n<!-- TODO -->";
  assert.ok(
    validatePullRequest(pr).some((error) => error.includes("双端影响")),
  );
});
