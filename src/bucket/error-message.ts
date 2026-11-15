const messages: Record<string, string> = {
  TASK_SLOT_FULL:
    "当前仍有整理任务占用名额，请在整理任务中查看或停止；不用重复投递。",
  "这次投递已有其他 AI 任务，请等待完成":
    "这份材料还有未结束的AI任务。请从世界的整理任务入口查看或停止，再进行新的修改；不用重复投递。",
  INVALID_MANIFEST:
    "附件格式或大小不符合要求，原材料已保留。每份最多10 MiB，每次合计最多20 MiB。",
  UPLOAD_LIMIT: "本次附件合计超过20 MiB，请减少附件后再提交。",
  ACCOUNT_CHANGED: "账号已切换，请在当前账号重新打开此页面。",
};
export function errorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error || "操作未完成，请稍后再试");
  const text = raw.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    "",
  );
  return messages[text] || text;
}
