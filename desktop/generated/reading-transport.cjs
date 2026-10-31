// Shared by the native mini client and Windows main process. Hydration finishes
// before the sync engine can advance its cursor. A changed version aborts the
// whole pull, preserving the local queue and previous cursor for a safe retry.
async function hydrateReadingChanges(request, path) {
  const result = await request(
    "GET",
    path.replace(/^\/api\/v[23]\/changes/, "/api/v4/changes"),
  );
  for (let index = 0; index < result.records.length; index++) {
    const record = result.records[index];
    if (!record.paged) continue;
    const parts = [];
    let offset = 0;
    while (offset < record.paged.units) {
      const page = await request(
        "GET",
        `/api/v4/records/${record.id}?epoch=${encodeURIComponent(result.epoch)}&version=${record.version}&offset=${offset}`,
      );
      if (
        page.offset !== offset ||
        page.version !== record.version ||
        page.total !== record.paged.units ||
        typeof page.text !== "string" ||
        !page.text.length ||
        page.text.length > 65536
      )
        throw Object.assign(Error("长结果分页已变化，请重试同步"), {
          code: "INVALID_PAGE",
        });
      parts.push(page.text);
      offset += page.text.length;
      if (offset > page.total) throw Error("INVALID_PAGE");
    }
    const hydrated = JSON.parse(parts.join(""));
    if (hydrated.id !== record.id || hydrated.version !== record.version)
      throw Error("INVALID_PAGE");
    result.records[index] = hydrated;
  }
  return result;
}
module.exports = { hydrateReadingChanges };
