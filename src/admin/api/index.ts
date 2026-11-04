import type { AdminApi } from "./client";
import { createHttpApi } from "./http";
import { createSyntheticApi } from "./synthetic";

/**
 * 适配层选择：
 * - 默认使用合成数据（后端 /admin/v1 未就绪），界面会标明「演示数据」。
 * - VITE_ADMIN_API=http 或 ?api=http 切换为真实回环接口。
 */
export function createAdminApi(): AdminApi {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get("api");
  const env = import.meta.env?.VITE_ADMIN_API as string | undefined;
  if (forced === "http" || (!forced && env === "http")) {
    return createHttpApi();
  }
  return createSyntheticApi();
}

export { getSyntheticControls } from "./synthetic";
export { AdminApiError } from "./client";
export type { AdminApi } from "./client";
