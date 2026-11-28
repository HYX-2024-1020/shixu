import {
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  chownSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { pricePeriod } from "../../server/reading/price-calendar.mjs";
const path = process.argv[2];
if (!path || !path.startsWith("/etc/shixu-cloud/"))
  throw Error("CONFIG_PATH_REQUIRED");
const response = await fetch(
  "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
  { redirect: "error", signal: AbortSignal.timeout(20_000) },
);
if (!response.ok) throw Error("PRICE_VERIFICATION_FAILED");
const html = await response.text(),
  table = html.match(/<table[\s\S]*?<\/table>/)?.[0];
// Exact reviewed official table. Changed prices/models fail closed; never adopt
// an unseen tariff automatically. No API key or business material is involved.
if (
  !table ||
  createHash("sha256").update(table).digest("hex") !==
    "5cab23423a0c51a9ec159b665ba1a20018884561fb5ce0cff05d69639a947d0c"
)
  throw Error("PRICE_REVIEW_REQUIRED");
const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
if (
  !text.includes("北京时间周一至周五") ||
  !text.includes("9:00 - 12:00") ||
  !text.includes("14:00 - 18:00")
)
  throw Error("PRICE_PERIOD_REVIEW_REQUIRED");
const now = Date.now(),
  config = JSON.parse(readFileSync(path, "utf8")),
  info = statSync(path);
config.tariff = {
  id: `deepseek-flash-1017-20261028-${pricePeriod(now)}`,
  verifiedAt: now,
  validUntil: now + 86400000,
};
writeFileSync(path + ".next", JSON.stringify(config, null, 2) + "\n", {
  mode: 0o640,
});
chownSync(path + ".next", info.uid, info.gid);
renameSync(path + ".next", path);
console.log("official-price-verification-refreshed");
