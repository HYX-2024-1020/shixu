import {
  organizePacket,
  chatWithItem,
  DEFAULT_MODEL,
} from "./generated/ai-core.mjs";
import { SyncError } from "./sync-store.mjs";

// One upstream request per durable job. Splitting/repair requests are explicitly
// refused; otherwise a nominal one-job budget could pay for many model calls.
export function boundedModelFetch({
  maxOutputTokens,
  maxRequestBytes = 64000,
  fetcher = fetch,
}) {
  let called = false;
  return async (url, init) => {
    if (called)
      throw new SyncError(
        422,
        "AI_CALL_LIMIT",
        "材料需要多次模型调用，请缩减后重试；本次结果未覆盖原文",
      );
    if (String(url) !== "https://api.deepseek.com/chat/completions")
      throw Error("Unexpected model endpoint");
    const payload = JSON.parse(init.body);
    payload.max_tokens = maxOutputTokens;
    payload.stream = false;
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > maxRequestBytes)
      throw new SyncError(
        413,
        "AI_INPUT_LIMIT",
        "模型输入超过限制，请缩减材料",
      );
    called = true;
    const response = await fetcher(url, { ...init, body, redirect: "error" });
    if (!response.ok) return new Response("{}", { status: response.status });
    let size = 0;
    const chunks = [];
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 128000)
            throw new SyncError(
              502,
              "AI_OUTPUT_LIMIT",
              "模型返回超过限制，原文保留",
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    return new Response(Buffer.concat(chunks), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
export function createServerAI({
  apiKey,
  model = DEFAULT_MODEL,
  fetcher = fetch,
}) {
  if (typeof apiKey !== "string" || !apiKey.trim())
    throw Error("Server model key required");
  const options = (packet, signal, limits) => ({
    apiKey,
    model,
    signal,
    captureDate: packet.captureDate,
    packetId: packet.id,
    fetcher: boundedModelFetch({ ...limits, fetcher }),
  });
  return {
    async organize(packet, signal, limits) {
      return {
        result: await organizePacket(
          packet.sources,
          options(packet, signal, limits),
        ),
      };
    },
    async chat(packet, itemId, instruction, signal, limits) {
      return chatWithItem(
        packet.result.items[packet.itemIds.indexOf(itemId)],
        packet.itemState?.[itemId] || {},
        instruction,
        packet.sources.map((s) => s.name + "\n" + s.text).join("\n"),
        {
          ...options(packet, signal, limits),
          itemCaptureDate: packet.captureDate,
          captureDate: new Intl.DateTimeFormat("en-CA", {
            timeZone: packet.captureTimezone || "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date()),
        },
      );
    },
  };
}
