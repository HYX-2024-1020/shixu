// Count local calendar days, not 24-hour blocks (including across DST).
function calendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date.getTime() / 86400000
    : NaN;
}

export function deadlineCountdown(
  date: string,
  day: string,
  time: string,
  clock: string,
  done = false,
) {
  if (done) return { label: "已完成", status: "done" };
  const days = calendarDay(date) - calendarDay(day);
  if (!Number.isFinite(days)) return { label: "日期待确认", status: "unsure" };
  if (days < 0) return { label: `已逾期 ${-days} 天`, status: "overdue" };
  if (days > 0) return { label: `还剩 ${days} 天`, status: "future" };
  // Match deadlineSections: the deadline minute itself is still due today.
  if (time && time < clock) return { label: "今天已逾期", status: "overdue" };
  return { label: "今天截止", status: "today" };
}
