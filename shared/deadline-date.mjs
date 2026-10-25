import { groundedTime, resolveDeadlineTime } from "./deadline-time.mjs";

export function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    !Number.isNaN(Date.parse(value + "T12:00:00Z")) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
const pad = (n) => String(n).padStart(2, "0");
const dateOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function shiftDate(day, n) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
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
function number(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes("十")) {
    const [a, b] = value.split("十");
    return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0);
  }
  return Number([...value].map((c) => digits[c]).join(""));
}
export function normalizeDateText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(
      /[零〇一二两三四五六七八九十]{1,4}(?=年|月|日|号|天[后内前])/g,
      (n) => String(number(n)),
    )
    .replace(/\s+/g, "");
}

// Infer omitted calendar components once from the saved capture day.
function point(text, today, inherited, end = false) {
  const [year, month] = today.split("-").map(Number);
  let date = "",
    inferred = false;
  const full = text.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})(?:日|号)?/);
  const relative = text.match(
    /大前天|前天|昨天|昨日|大后天|后天|明天|今天|今日|明早|明晚|今早|今晚|昨早|昨晚/,
  );
  const week = text.match(
    /(上上|上|下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天末])/,
  );
  const offset = text.match(/(\d{1,3})天(后|前|内)/);
  if (full) date = dateOf(+full[1], +full[2], +full[3]);
  else if (relative)
    date = shiftDate(
      today,
      {
        大前天: -3,
        前天: -2,
        昨天: -1,
        昨日: -1,
        大后天: 3,
        后天: 2,
        明天: 1,
        今天: 0,
        今日: 0,
        明早: 1,
        明晚: 1,
        今早: 0,
        今晚: 0,
        昨早: -1,
        昨晚: -1,
      }[relative[0]],
    );
  else if (offset)
    date = shiftDate(today, +offset[1] * (offset[2] === "前" ? -1 : 1));
  else if (week) {
    const weekBase = inherited && !week[1] ? inherited : today;
    const target = "一二三四五六日".indexOf(
      /[天末]/.test(week[2]) ? "日" : week[2],
    );
    const current = (new Date(weekBase + "T12:00:00Z").getUTCDay() + 6) % 7;
    let n = target - current;
    n += { 上上: -14, 上: -7, 下: 7, 下下: 14 }[week[1]] || 0;
    if (!week[1] && n < 0) n += 7;
    date = shiftDate(weekBase, n);
  } else if (/(?:本|这|下|上)?月[底末]/.test(text)) {
    const n = /下月/.test(text) ? 1 : /上月/.test(text) ? -1 : 0;
    date = new Date(Date.UTC(year, month + n, 0, 12))
      .toISOString()
      .slice(0, 10);
    inferred = true;
  } else {
    const md = text.match(
      /(?:(今年|明年|去年))?(\d{1,2})[月/.-](\d{1,2})(?:日|号)?/,
    );
    const dom =
      text.match(/(?:(本月|这个月|下月|下个月|上月))?(\d{1,2})(?:日|号)/) ||
      text.match(/^(\d{1,2})$/) ||
      (inherited && text.match(/^(\d{1,2})(?!\d|[:点时])/));
    if (md) {
      let y = inherited ? +inherited.slice(0, 4) : year;
      y += md[1] === "明年" ? 1 : md[1] === "去年" ? -1 : 0;
      date = dateOf(y, +md[2], +md[3]);
      if (!md[1] && date < (inherited || today))
        date = dateOf(y + 1, +md[2], +md[3]);
      inferred = !md[1];
    } else if (dom) {
      const scoped = dom.length > 2;
      const prefix = scoped ? dom[1] : "";
      const d = +(scoped ? dom[2] : dom[1]);
      const base = new Date((inherited || today) + "T12:00:00Z");
      let y = base.getUTCFullYear(),
        m = base.getUTCMonth() + 1;
      if (/下/.test(prefix || "")) m++;
      if (/上/.test(prefix || "")) m--;
      if (m > 12) {
        y++;
        m = 1;
      }
      if (m < 1) {
        y--;
        m = 12;
      }
      date = dateOf(y, m, d);
      if (!prefix && (!validDate(date) || date < (inherited || today))) {
        // Try subsequent months so a 31st never normalizes silently to another day.
        for (let n = 1; n <= 12; n++) {
          const next = new Date(Date.UTC(y, m - 1 + n, 1, 12));
          const candidate = dateOf(
            next.getUTCFullYear(),
            next.getUTCMonth() + 1,
            d,
          );
          if (validDate(candidate)) {
            date = candidate;
            break;
          }
        }
      }
      inferred = !prefix;
    } else if (inherited && /[:点时]|上午|下午|晚上|早上|中午|凌晨/.test(text))
      date = inherited;
  }
  if (!validDate(date)) return null;
  const timed = resolveDeadlineTime({
    date,
    time: "",
    anchor: text,
    sourceId: "",
  });
  if (!end && timed.timeInferred && timed.time === "23:59")
    timed.time = "00:00";
  return {
    ...timed,
    dateInferred: inferred,
    ...(inferred
      ? { dateReason: "省略年月按录入日推定最近的对应日期，可手动修改" }
      : {}),
  };
}

// A single date keeps the historical date/time fields. Ranges add startDate/startTime
// and keep date/time as their inclusive end, preserving old-client deadline sorting.
export function parseDateExpression(value, today) {
  if (!validDate(today)) return null;
  let text = normalizeDateText(value);
  if (
    /\d{1,2}[-~至到]\d{1,2}(?:分|秒|页|元|人|%)/.test(text) &&
    !/年|月|日|号|今天|明天|后天|周/.test(text)
  )
    return null;
  text = text.replace(
    /(\d{1,2}月\d{1,2})(?:日|号)?([-~～至到—–])(\d{1,2})(?:日|号)?(?!\d|[:点时月])/g,
    "$1日$2$3号",
  );
  const short = text.match(
    /(?:^|[^\d月/.-])(\d{1,2})\s*[-~～至到—–]\s*(\d{1,2})(?:日|号)?(?!\d|[:点时月/.-分秒页人元%])/,
  );
  if (short)
    text = text.replace(
      short[0],
      short[0]
        .replace(short[1], short[1] + "号")
        .replace(new RegExp(short[2] + "(?:日|号)?$"), short[2] + "号"),
    );
  text = text.replace(/([日号点分半刻])-/g, "$1至");
  const separator =
    /(?:至|到)(?=[\d今明后前昨上下本这周星礼零一二三四五六七八九十早晚凌中午])|~|～|—|–|-(?=\d{1,2}(?:日|号|点|时|:|\/|月))/;
  // Hyphenated ISO/month-day dates must remain intact. Normalize only range dashes.
  const isoRange = text.match(
    /^(.*?\d{4}-\d{1,2}-\d{1,2}[^至到~～—–]*?)-(\d{4}-\d{1,2}-\d{1,2}.*)$/,
  );
  const split = isoRange ? [isoRange[1], isoRange[2]] : text.split(separator);
  if (split.length > 2) return null;
  if (split.length === 2) {
    const start = point(split[0], today, null, false);
    if (!start) return null;
    // The first explicit month applies to a short second endpoint.
    let endText = split[1];
    const period = split[0].match(/凌晨|早上|上午|中午|下午|晚上|晚间/);
    if (period && !/日|号|月|年|今天|明天|后天|周|早|晚|午|凌/.test(endText))
      endText = period[0] + endText;
    const end = point(endText, today, start.date, true);
    if (!end) return null;
    if (end.date === start.date && end.time < start.time) {
      if (
        /晚|夜/.test(split[0]) &&
        !/日|号|月|年|今天|明天|后天|周/.test(split[1])
      )
        end.date = shiftDate(end.date, 1);
      else return null;
    }
    if (end.date < start.date) return null;
    return {
      ...end,
      startDate: start.date,
      startTime: start.time,
      dateInferred: start.dateInferred || end.dateInferred,
      ...(start.dateInferred || end.dateInferred
        ? { dateReason: start.dateReason || end.dateReason }
        : {}),
      ...(start.timeInferred || end.timeInferred
        ? {
            timeInferred: true,
            timeReason: "区间省略或模糊的时刻已按时段及日界补齐，可修改",
          }
        : {}),
    };
  }
  const dateTokens =
    text.match(
      /20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}|\d{1,2}月\d{1,2}(?:日|号)?|\d{1,2}(?:日|号)|今天|明天|后天|昨天|前天|(?:[上下本这]?周|星期|礼拜)[一二三四五六日天]/g,
    ) || [];
  if (
    new Set(
      dateTokens
        .map((token) => point(token, today, null, true)?.date)
        .filter(Boolean),
    ).size > 1
  )
    return null;
  return point(text, today, null, true);
}

export function deadlineLabel(due) {
  if (!due?.date) return "日期待确认";
  const end = `${due.date} ${due.time || "23:59"}`;
  return due.startDate
    ? `${due.startDate} ${due.startTime || "00:00"} → ${end}`
    : end;
}
