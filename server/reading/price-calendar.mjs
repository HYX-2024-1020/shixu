// Reviewed against the State Council 2026 holiday notice:
// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
// DeepSeek peak periods are weekdays, excluding Chinese holiday breaks.
const holidays = [
  ["01-01", "01-03"],
  ["02-15", "02-23"],
  ["04-04", "04-06"],
  ["05-01", "05-05"],
  ["06-19", "06-21"],
  ["09-25", "09-27"],
  ["10-01", "10-07"],
];
export function pricePeriod(at) {
  const date = new Date(at + 8 * 3600000),
    day = date.toISOString().slice(5, 10),
    hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  if (date.getUTCFullYear() !== 2026)
    throw Error("PRICE_CALENDAR_REVIEW_REQUIRED");
  const weekday = date.getUTCDay() > 0 && date.getUTCDay() < 6;
  const holiday = holidays.some(([start, end]) => day >= start && day <= end);
  return weekday &&
    !holiday &&
    ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
    ? "peak"
    : "offpeak";
}
