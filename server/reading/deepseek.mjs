import { buildMessages, checkSources } from "../../shared/bucket-engine.mjs";
import { validateUsage } from "./ledger.mjs";

// Documented 2026-10-28 at the official CNY pricing and chat-completion pages.
// No default tariff selector: holiday/peak classification must be independently
// verified before enabling live execution. Reserve and settle the same snapshot.
export const DEEPSEEK_PRICE_SOURCE =
  "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
export function deepseekPriceSnapshots(verifiedAt) {
  return [
    {
      period: "peak",
      inputMicrosPerMillion: 2000000,
      cachedMicrosPerMillion: 40000,
      outputMicrosPerMillion: 8000000,
    },
    {
      period: "offpeak",
      inputMicrosPerMillion: 1000000,
      cachedMicrosPerMillion: 20000,
      outputMicrosPerMillion: 4000000,
    },
  ].map(({ period, ...rates }) => ({
    id: `deepseek-flash-1017-20261028-${period}`,
    model: "DeepSeek-V4.1-Flash-1017",
    currency: "CNY",
    source: DEEPSEEK_PRICE_SOURCE,
    verifiedAt,
    ...rates,
  }));
}

export function createDeepSeekReadingProvider({
  apiKey,
  priceAt,
  fetcher = fetch,
  now = Date.now,
}) {
  if (
    typeof apiKey !== "string" ||
    !apiKey.trim() ||
    typeof priceAt !== "function"
  )
    throw Error("VERIFIED_PROVIDER_CONFIGURATION_REQUIRED");
  const prepare = (sources, { captureDate, maxOutputTokens = 4000 } = {}) => {
    checkSources(sources);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(captureDate || "") ||
      !Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens < 1 ||
      maxOutputTokens > 4000
    )
      throw Error("INVALID_PROVIDER_INPUT");
    const body = JSON.stringify({
      model: "deepseek-flash",
      messages: buildMessages(sources, captureDate),
      response_format: { type: "json_object" },
      max_tokens: maxOutputTokens,
      stream: false,
      thinking: { type: "disabled" },
      tool_choice: "none",
    });
    const bytes = Buffer.byteLength(body);
    if (bytes > 1024 * 1024) throw Error("PROVIDER_REQUEST_LIMIT");
    const priceId = priceAt(now());
    if (!/^deepseek-flash-1017-20261028-(peak|offpeak)$/.test(priceId || ""))
      throw Error("VERIFIED_PRICE_REQUIRED");
    // Conservative UTF-8 byte envelope, including the entire prompt and framing.
    // Under-reservation still records actual usage and globally pauses the ledger.
    return { body, priceId, maxPromptTokens: bytes + 2048, maxOutputTokens };
  };
  const provider = async (sources, signal, context = {}) => {
    const prepared = context.prepared || prepare(sources, context);
    const response = await fetcher(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        signal,
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: prepared.body,
      },
    );
    // No automatic retry, error-body logging, tools, search or external links.
    if (!response.ok) {
      await response.body?.cancel();
      throw Error("PROVIDER_USAGE_UNKNOWN");
    }
    const chunks = [];
    let size = 0;
    if (response.body)
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1024 * 1024 + 65536) throw Error("PROVIDER_RESPONSE_LIMIT");
        chunks.push(chunk);
      }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const usage = validateUsage(payload.usage);
    const choice = payload.choices?.[0];
    let result = null;
    if (
      choice?.finish_reason === "stop" &&
      typeof choice.message?.content === "string"
    ) {
      try {
        result = JSON.parse(choice.message.content);
      } catch {
        /* Valid usage still settles invalid output. */
      }
    }
    return { usage, result };
  };
  provider.prepare = prepare;
  return provider;
}
