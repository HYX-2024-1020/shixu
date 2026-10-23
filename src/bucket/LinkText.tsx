import { Fragment } from "react";
export function safeWebUrl(value: string) {
  try {
    const url = new URL(/^www\./i.test(value) ? "https://" + value : value);
    return ["https:", "http:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function textLinks(text: string): { text: string; href?: string }[] {
  const result: { text: string; href?: string }[] = [];
  const pattern =
    /\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+?)\)|(?:https?:\/\/|www\.)[^\s<>"'，。；：！？、（）【】]+/gi;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    if (start > end) result.push({ text: text.slice(end, start) });
    const raw = match[0],
      label = match[1];
    const url = (match[2] || raw).replace(/[.,;!?)\]}]+$/, "");
    const href = safeWebUrl(url);
    result.push({ text: label || url, ...(href ? { href } : {}) });
    if (!label && url.length < raw.length)
      result.push({ text: raw.slice(url.length) });
    end = start + raw.length;
  }
  if (end < text.length) result.push({ text: text.slice(end) });
  return result;
}
export default function LinkText({ text }: { text: string }) {
  return (
    <>
      {textLinks(text).map((part, i) =>
        part.href ? (
          <a
            key={i}
            className="content-link"
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
