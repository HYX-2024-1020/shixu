const digits = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
function numeral(value) {
  if (value.includes("十")) {
    const [a, b] = value.split("十");
    return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0);
  }
  return value.length > 1
    ? Number([...value].map((c) => digits[c]).join(""))
    : digits[value];
}
const normalize = (text) =>
  String(text || "")
    .normalize("NFKC")
    .replace(/[零〇一二两三四五六七八九十]{1,3}(?=\s*[点时分])/g, (m) =>
      String(numeral(m)),
    )
    .replace(
      /([点时])\s*([零〇一二两三四五六七八九十]{1,3})(?=分|[^零〇一二两三四五六七八九十刻]|$)/g,
      (_, unit, value) => unit + numeral(value),
    );
export const validTime = (time) =>
  typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
const format = (hour, minute) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
function clock(text, guess = false) {
  text = normalize(text);
  const ampm = text.match(
    /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i,
  );
  if (ampm)
    return {
      time: format(
        (Number(ampm[1]) % 12) + (ampm[3].toLowerCase() === "p" ? 12 : 0),
        Number(ampm[2] || 0),
      ),
    };
  const match = text.match(
    /(凌晨|午夜|清晨|早晨|早上|上午|中午|下午|午后|傍晚|晚上|夜晚|晚间|夜里|今晚|明晚|今早|明早|晚|早|夜)?\s*(\d{1,2})\s*(?:(:)(\d{1,2})(?::\d{2})?|[点时](?:钟)?\s*(三刻|一刻|半|\d{1,2}分?)?)/,
  );
  if (!match) return null;
  let hour = Number(match[2]);
  const tail = match[5] || "";
  const minute = match[3]
    ? Number(match[4])
    : tail === "半"
      ? 30
      : tail === "一刻"
        ? 15
        : tail === "三刻"
          ? 45
          : parseInt(tail || "0");
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  let nextDay = hour === 24;
  if (nextDay) hour = 0;
  const ambiguous = !match[1] && !match[3] && Number(match[2]) < 12;
  if (ambiguous && !guess) return null;
  if (ambiguous && hour >= 1 && hour <= 6) hour += 12;
  if (
    /下午|午后|傍晚|晚上|夜晚|晚间|夜里|今晚|明晚|^晚$|^夜$/.test(
      match[1] || "",
    ) &&
    hour < 12
  )
    hour += 12;
  if (
    /晚上|夜晚|晚间|夜里|今晚|明晚|^晚$|^夜$/.test(match[1] || "") &&
    hour === 12
  ) {
    hour = 0;
    nextDay = true;
  }
  if (match[1] === "中午" && hour < 11) hour += 12;
  if (/凌晨|午夜/.test(match[1] || "") && hour === 12) hour = 0;
  return {
    time: format(hour, minute),
    ...(nextDay ? { nextDay: true } : {}),
    ...(ambiguous
      ? {
          timeInferred: true,
          timeReason: `未注明上午或下午，按 ${format(hour, minute)} 安排，可手动修改`,
        }
      : {}),
  };
}
function applyClock(due, parsed) {
  const { nextDay, ...result } = parsed;
  const date = new Date(due.date + "T12:00:00Z");
  if (nextDay && due.time !== result.time && !Number.isNaN(date.valueOf())) {
    date.setUTCDate(date.getUTCDate() + 1);
    return { ...due, ...result, date: date.toISOString().slice(0, 10) };
  }
  return { ...due, ...result };
}
export function groundedTime(text) {
  return clock(text)?.time || "";
}
function inferred(time, reason) {
  return { time, timeInferred: true, timeReason: reason };
}
// Restrict recovery to the clause containing the item's anchor, rather than an
// unrelated event elsewhere in a long notice. One adjacent clock-only clause is allowed.
function anchorContext(text, anchor) {
  const compact = (t) => normalize(t).replace(/\s+/g, "");
  const pieces = String(text || "").split(/[。；;\n！？]/);
  for (const piece of pieces) {
    const at = compact(piece).indexOf(compact(anchor));
    if (!anchor || at < 0) continue;
    const value = compact(piece),
      key = compact(anchor);
    const left = Math.max(
      value.lastIndexOf("，", at),
      value.lastIndexOf(",", at),
    );
    const rightMatch = value.slice(at + key.length).search(/[，,]/);
    const right = rightMatch < 0 ? value.length : at + key.length + rightMatch;
    let context = value.slice(left + 1, right);
    if (!clock(context, true) && right < value.length) {
      const adjacent = value.slice(right + 1).split(/[，,]/)[0];
      if (
        !/(?:今天|明天|后天|前天|昨天|[上下本这]?周[一二三四五六日天]|\d+[年月日号])/.test(
          adjacent,
        )
      )
        context += "，" + adjacent;
    }
    return context;
  }
  return "";
}
export function resolveDeadlineTime(due, evidence = [], sources = []) {
  if (
    validTime(due?.time) &&
    (!due.timeInferred ||
      due.sourceId === "manual" ||
      due.anchor === "人工确认")
  ) {
    const anchorClock = clock(due.anchor || "");
    if (
      due.sourceId !== "manual" &&
      due.anchor !== "人工确认" &&
      anchorClock &&
      anchorClock.time !== due.time
    )
      return applyClock(due, anchorClock);
    return due;
  }
  const anchor = due?.anchor || "";
  const contexts = [];
  if (anchor !== "人工确认") {
    for (const e of evidence.filter(
      (e) => !due.sourceId || e.sourceId === due.sourceId,
    )) {
      for (const source of sources.filter((s) => s.id === due.sourceId)) {
        const full = normalize(source.text).replace(/[^\S\n]+/g, "");
        const quote = normalize(e.quote).replace(/\s+/g, "");
        const at = quote ? full.indexOf(quote) : -1;
        if (at >= 0) {
          const bound = anchorContext(full.slice(at), anchor);
          if (bound) contexts.push(bound);
        }
      }
      const scoped = anchorContext(e.quote, anchor);
      // Evidence is already bound to this item. Do not choose among several clocks
      // when the date anchor was omitted from the quote.
      if (scoped) contexts.push(scoped);
      else if (
        (normalize(e.quote).match(/\d{1,2}\s*(?:[:点时])/g) || []).length === 1
      )
        contexts.push(e.quote);
    }
    for (const source of sources.filter((s) => s.id === due.sourceId)) {
      const scoped = anchorContext(source.text, anchor);
      if (scoped) contexts.push(scoped);
    }
  }
  contexts.push(anchor);
  for (const text of contexts) {
    const exact = clock(text);
    if (exact) {
      const { timeInferred, timeReason, ...rest } = due;
      return applyClock(rest, exact);
    }
  }
  for (const source of sources.filter((s) => s.id === due.sourceId)) {
    const text = normalize(source.text);
    const clocks =
      text.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b|\d{1,2}\s*(?:[:点时])/gi) ||
      [];
    const dates =
      text.match(
        /(?:20\d{2}[年\/-]\d{1,2}[月\/-]\d{1,2}|今天|明天|后天|昨天|前天|今[早晚]|明[早晚]|(?:[上下本这]?周|星期|礼拜)[一二三四五六日天])/g,
      ) || [];
    const parsed = clock(text);
    if (
      anchor !== "人工确认" &&
      clocks.length === 1 &&
      dates.length <= 1 &&
      parsed &&
      text.replace(/\s+/g, "").includes(normalize(anchor).replace(/\s+/g, ""))
    ) {
      return {
        ...applyClock(due, parsed),
        timeInferred: true,
        timeReason: `从同一来源的时刻推定为 ${parsed.time}，可手动修改`,
      };
    }
  }
  if (validTime(due?.time)) return due;
  for (const text of contexts) {
    const guessed = clock(text, true);
    if (guessed) return applyClock(due, guessed);
  }
  for (const text of contexts) {
    const part = String(text).match(
      /凌晨|午夜|清晨|早晨|早上|上午|中午|下午|午后|傍晚|晚上|夜晚|晚间|夜里|今晚|明晚|今早|明早/,
    );
    if (part) {
      const time = /凌晨|午夜/.test(part[0])
        ? "00:00"
        : /中午/.test(part[0])
          ? "12:00"
          : /下午|午后/.test(part[0])
            ? "15:00"
            : /傍晚/.test(part[0])
              ? "18:00"
              : /晚|夜/.test(part[0])
                ? "20:00"
                : "09:00";
      return {
        ...due,
        ...inferred(
          time,
          `原文只写了“${part[0]}”，按 ${time} 安排，可手动修改`,
        ),
      };
    }
  }
  return {
    ...due,
    ...inferred("23:59", "未指定时刻，按截止日 23:59 安排，可手动修改"),
  };
}

// An undated card can still carry a clearly stated clock. Keep the date pending
// while showing that clock; do not replace an explicit 15:10 with a generic default.
export function itemDeadlineTime(item, sources = [], chat = []) {
  const context = [
    ...sources,
    ...chat
      .filter((e) => e.role === "user")
      .slice()
      .reverse()
      .map((e) => ({ id: "item-chat", name: "事项对话", text: e.text })),
  ];
  if (item.due)
    return resolveDeadlineTime(item.due, item.evidence || [], context);
  const ids = [
    ...new Set([
      ...(item.sourceIds || []),
      ...(item.evidence || []).map((e) => e.sourceId),
      ...(chat.length ? ["item-chat"] : []),
    ]),
  ];
  const candidates = (ids.length ? ids : [""]).map((sourceId) =>
    resolveDeadlineTime(
      { date: "", time: "", anchor: "", sourceId },
      item.evidence || [],
      context,
    ),
  );
  const rank = (d) =>
    !d.timeInferred ? 0 : d.timeReason?.startsWith("未指定时刻") ? 2 : 1;
  return candidates.sort((a, b) => rank(a) - rank(b))[0];
}
