import type { BucketItem } from "./types";

function clean(value: string) {
  return value
    .replace(/^\s*\[演示\]\s*/, "")
    .replace(/【演示\d+[·・]([^】]+)】/g, "$1")
    .replace(/[（(][^）)]*(?:待确认|日期不明|时间未定)[^）)]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:根据原文[，：:]?|本次需要[，：:]?|你需要[，：:]?)/, "")
    .trim();
}
export function cardCopy(
  item: Pick<BucketItem, "title" | "summary" | "facts">,
) {
  const title = clean(item.title);
  const normalize = (value: string) =>
    clean(value).replace(/[\s，。；：、,.!！?？]/g, "");
  const titleKey = normalize(title);
  const candidates = [item.summary, ...item.facts].map(clean).filter(Boolean);
  const summary =
    candidates.find(
      (value) =>
        normalize(value) !== titleKey && !titleKey.startsWith(normalize(value)),
    ) || "";
  const clauses = summary
    .split(/(?<=[。；;])/)
    .filter(
      (clause) =>
        !/^(?:原文(?:另)?(?:注明|标注|明确|把它列为)|具体日期(?:没有|尚未)|[^，。；]{0,8}(?:尚未确定|未指定具体时刻))/.test(
          clause.trim(),
        ),
    );
  const compact = clauses.slice(0, 2).join("").trim();
  return { title, summary: compact };
}
