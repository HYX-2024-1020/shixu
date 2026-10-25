import { parseDateExpression, deadlineLabel } from "./deadline-date.mjs";
export { deadlineLabel };
import {
  groundedTime,
  itemDeadlineTime,
  resolveDeadlineTime,
} from "./deadline-time.mjs";

// Resolve against the saved local capture day, never the day a card is viewed.
const relative =
  /(?:\d{1,2}月)?\d{1,2}(?:日|号)?\s*[-~～至到—–]\s*(?:\d{1,2}月)?\d{1,2}(?:日|号)?(?!\d|分|页|元|人|%)|(?:今年|明年|去年)?\d{1,2}月\d{1,2}(?:日|号)?|(?:本月|下月|下个月|上月)?\d{1,2}(?:日|号)|(?:本|下|上)?月[底末]|[\d一二两三四五六七八九十]+天[后前内]|大前天|前天|昨天|昨日|大后天|后天|明天|今天|今日|明早|明晚|今早|今晚|昨早|昨晚|(?:上上|上|下下|下|本|这)?(?:周|星期|礼拜)[一二三四五六日天末]/g;
export function absoluteText(text, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return text;
  let previousWeek = "",
    previousEnd = 0;
  return text.replace(relative, (token, offset) => {
    const scoped = token.match(/^(上上|上|下下|下|本|这)(?:周|星期|礼拜)/);
    const isWeek = /(?:周|星期|礼拜)/.test(token);
    const coordinated =
      isWeek &&
      !scoped &&
      previousWeek &&
      /^[、和及与或\s]+$/.test(text.slice(previousEnd, offset));
    const anchor = coordinated ? previousWeek + token : token;
    previousWeek = isWeek
      ? scoped?.[1] || (coordinated ? previousWeek : "")
      : "";
    previousEnd = offset + token.length;
    // Already absolute calendar dates must not have their month/day re-inferred.
    if (/[\d年/-]$/.test(text.slice(0, offset)) && /^\d/.test(token))
      return token;
    const parsed = parseDateExpression(anchor, day);
    const date = parsed?.date;
    if (parsed?.startDate) return `${parsed.startDate} 至 ${parsed.date}`;
    return date
      ? date.replace(/^(\d+)-(\d+)-(\d+)$/, "$1年$2月$3日") +
          (/晚$/.test(token) ? "晚上" : /早$/.test(token) ? "早上" : "")
      : token;
  });
}
export function absoluteItem(item, day, sources = [], chat = []) {
  const context = [
    ...sources,
    ...chat
      .filter((e) => e.role === "user")
      .slice()
      .reverse()
      .map((e) => ({ id: "item-chat", name: "事项对话", text: e.text })),
  ];
  let due = item.due;
  if (
    !item.dueCleared &&
    ((!due && ["task", "event", "notice"].includes(item.kind)) ||
      (due &&
        !due.startDate &&
        /至|到|~|～|—|–|\d-\d/.test(due.anchor || ""))) &&
    !(item.uncertainties || []).some((text) => /冲突|矛盾/.test(text))
  ) {
    const candidates = due?.anchor
      ? [{ quote: due.anchor, sourceId: due.sourceId }]
      : item.evidence?.length
        ? item.evidence
        : [
            { quote: item.title, sourceId: "" },
            { quote: item.summary, sourceId: "" },
          ];
    const parsed = candidates
      .map((e) => {
        const value = parseDateExpression(e.quote, day);
        return value
          ? { ...value, anchor: e.quote, sourceId: e.sourceId }
          : null;
      })
      .filter(Boolean);
    if (new Set(parsed.map((d) => deadlineLabel(d))).size === 1)
      due = parsed[0];
  }
  return {
    ...item,
    due: due ? itemDeadlineTime({ ...item, due }, context) : null,
    title: absoluteText(item.title, day),
    summary: absoluteText(item.summary, day),
    facts: (item.facts || []).map((t) => absoluteText(t, day)),
    nextSteps: (item.nextSteps || []).map((t) => absoluteText(t, day)),
    uncertainties: (item.uncertainties || []).filter(
      (text) =>
        !(
          due &&
          /日期还不明确|没有找到可靠的日期|缺少.*年份|未.*年份/.test(text)
        ) &&
        (text.includes("日期") ||
          !/(?:时刻|几点|具体时间).*(?:未知|不明|未明确|未指定|未给出|需核对)|(?:没有|未指定|未给出|未明确|缺少|未自动填入).*(?:时刻|几点|具体时间)/.test(
            text,
          )),
    ),
  };
}
export function parseDeadline(text, day, time = "") {
  text = text.trim();
  const parsed = parseDateExpression(text, day);
  if (!parsed)
    throw new Error(
      "暂时无法确定时间，可写 26号、10月26日、26-28 或明天14:00到16:00",
    );
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("时刻格式应为 HH:mm");
  return resolveDeadlineTime({
    ...parsed,
    time: time || parsed.time,
    ...(time ? { timeInferred: undefined, timeReason: undefined } : {}),
    anchor: [text, time].filter(Boolean).join(" "),
    sourceId: "manual",
  });
}
export function setDeadline(item, due, captureDay) {
  const result = absoluteItem(item, captureDay);
  if (item.due && due) {
    const label = (date) => date.replace(/^(\d+)-(\d+)-(\d+)$/, "$1年$2月$3日");
    const replace = (text) => {
      text = text
        .split(label(item.due.date))
        .join(label(due.date))
        .split(item.due.date)
        .join(due.date);
      if (item.due.time) {
        text = text.replace(
          /(?:凌晨|早上|上午|中午|下午|晚上|晚间)?\s*(?:\d{1,2}[:：]\d{2}|[\d零〇一二两三四五六七八九十]{1,3}[点时](?:半|\d{1,2}分?)?)/g,
          (token) => (groundedTime(token) === item.due.time ? due.time : token),
        );
      }
      return text;
    };
    result.title = replace(result.title);
    result.summary = replace(result.summary);
    result.facts = result.facts.map(replace);
    result.nextSteps = result.nextSteps.map(replace);
  }
  return {
    ...result,
    due: due ? resolveDeadlineTime(due) : null,
    dueCleared: !due,
  };
}
export function deadlineSections(rows, day, nowTime, days = 7) {
  const sections = {
    overdue: [],
    today: [],
    soon: [],
    later: [],
    unsure: [],
    done: [],
  };
  const end = new Date(day + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + days);
  const last = end.toISOString().slice(0, 10);
  for (const row of rows) {
    if (row.deleted || row.meta?.purgedAt) continue;
    if (row.done) {
      if (row.date || ["task", "event", "notice"].includes(row.kind))
        sections.done.push(row);
      continue;
    }
    if (!row.date) {
      if (["task", "event", "notice"].includes(row.kind))
        sections.unsure.push(row);
      continue;
    }
    const section =
      row.date < day || (row.date === day && row.time && row.time < nowTime)
        ? "overdue"
        : row.date === day
          ? "today"
          : (row.startDate || row.date) <= last
            ? "soon"
            : "later";
    sections[section].push(row);
  }
  for (const values of Object.values(sections))
    values.sort(
      (a, b) =>
        (a.date || "9999").localeCompare(b.date || "9999") ||
        (a.time || "99:99").localeCompare(b.time || "99:99") ||
        a.id.localeCompare(b.id),
    );
  return sections;
}
