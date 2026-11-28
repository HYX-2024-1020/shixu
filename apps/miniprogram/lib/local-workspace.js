const { makeId } = require("./sync-client");
const KEY = "shixu:mini:local:v1";
function createLocalWorkspace(read, write) {
  const saved = read();
  if (saved && (saved.version !== 1 || !Array.isArray(saved.records)))
    throw new Error("本机资料无法读取，请保留数据联系开发者");
  let records = saved ? saved.records : [];
  const commit = (next) => {
    const durable = JSON.parse(JSON.stringify(next));
    write({ version: 1, records: durable });
    records = durable;
  };
  const change = (id, mutate) => {
    const before = records.find((r) => r.id === id);
    const next = mutate(before);
    commit([...records.filter((r) => r.id !== id), next]);
    return id;
  };
  return {
    putMany(entries) {
      let staged;
      const workspace = createLocalWorkspace(
        () => ({ version: 1, records }),
        (value) => {
          staged = value;
        },
      );
      for (const { id, patch } of entries) workspace.put(id, patch);
      if (staged) commit(staged.records);
    },
    newId: makeId,
    records: () => JSON.parse(JSON.stringify(records)),
    put(id, patch) {
      return change(id, (before) => {
        if (before && (before.deletedAt || before.purged))
          throw new Error("请先恢复投递");
        const data = { ...(before && before.data), ...patch, id };
        if (patch.itemState) {
          data.itemState = { ...(before && before.data.itemState) };
          Object.keys(patch.itemState).forEach((key) => {
            data.itemState[key] = {
              ...data.itemState[key],
              ...patch.itemState[key],
            };
          });
        }
        return {
          id,
          data,
          version: 0,
          deletedAt: null,
          purged: false,
          pending: false,
        };
      });
    },
    remove: (id) =>
      change(id, (r) => {
        if (!r || r.purged) throw new Error("投递不存在");
        return { ...r, deletedAt: new Date().toISOString() };
      }),
    restore: (id) =>
      change(id, (r) => {
        if (!r || r.purged) throw new Error("投递已永久删除");
        return { ...r, deletedAt: null };
      }),
    purge: (id) =>
      change(id, (r) => {
        if (!r || !r.deletedAt) throw new Error("请先移入最近删除");
        return { ...r, data: null, purged: true };
      }),
    pendingCount: () => 0,
    conflicts: () => [],
  };
}
module.exports = { KEY, createLocalWorkspace };
