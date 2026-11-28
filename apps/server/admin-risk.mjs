// Ordinary content failures remain in the user's task history. Escalate only
// a sustained service pattern; safety and billing gates escalate separately.
export function serviceFailureSignals(failures, observations, now) {
  const candidates = new Map();
  for (const f of failures || []) {
    if (
      !["READING_TASK_FAILED", "READING_TIMEOUT", "SHUTDOWN_TIMEOUT"].includes(
        f.reason,
      )
    )
      continue;
    const group = candidates.get(f.reason) || { count: 0, accounts: new Set() };
    group.count += f.count;
    group.accounts.add(f.account);
    candidates.set(f.reason, group);
  }
  const signals = [];
  for (const [reason, group] of candidates) {
    if (group.count < 5 || group.accounts.size < 3) continue;
    if (!observations.has(reason)) observations.set(reason, now);
    if (now - observations.get(reason) >= 120000)
      signals.push({
        kind: "task-" + reason,
        object: "site",
        severity: "warning",
        message: `近10分钟${group.accounts.size}个账号共${group.count}项处理异常，持续观察超过2分钟：${reason}；请核对服务健康、读取器和供应商，用户任务不由管理员代重试`,
      });
  }
  for (const reason of observations.keys()) {
    const g = candidates.get(reason);
    if (!g || g.count < 5 || g.accounts.size < 3) observations.delete(reason);
  }
  return signals;
}
