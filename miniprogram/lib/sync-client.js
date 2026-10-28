const copy = (value) => JSON.parse(JSON.stringify(value));
const isId = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-]{1,120}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
const uid = () =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
function issue(code, message) {
  return Object.assign(new Error(message), { code });
}
function validRecord(record) {
  return (
    record &&
    isId(record.id) &&
    Number.isSafeInteger(record.version) &&
    record.version > 0 &&
    typeof record.purged === "boolean" &&
    (record.deletedAt === null || typeof record.deletedAt === "string") &&
    (record.purged
      ? record.data === null
      : record.data &&
        typeof record.data === "object" &&
        !Array.isArray(record.data) &&
        record.data.id === record.id)
  );
}
function merge(before, patch, id) {
  const next = Object.assign({}, before, copy(patch), { id });
  if (patch.itemState) {
    next.itemState = Object.assign({}, before && before.itemState);
    Object.keys(patch.itemState).forEach((itemId) => {
      if (!isId(itemId)) throw issue("INVALID_DATA", "事项 ID 无效");
      next.itemState[itemId] = Object.assign(
        {},
        next.itemState[itemId],
        patch.itemState[itemId],
      );
    });
  }
  return next;
}

// No wx or Node dependency: the same queue can later serve the desktop client.
// write() must persist synchronously; a failed write never advances in-memory state.
function createSyncClient({
  read,
  write,
  request,
  makeId = uid,
  protocolVersion = 2,
}) {
  if (![2, 3].includes(protocolVersion))
    throw issue("INCOMPATIBLE_SERVICE", "同步协议版本不兼容");
  const api = `/api/v${protocolVersion}`;
  let state = read() || {
    version: 1,
    epoch: null,
    cursor: 0,
    records: {},
    outbox: [],
    conflicts: [],
  };
  if (
    state.version !== 1 ||
    !Number.isSafeInteger(state.cursor) ||
    state.cursor < 0 ||
    !state.records ||
    typeof state.records !== "object" ||
    Array.isArray(state.records) ||
    !Array.isArray(state.outbox) ||
    !Array.isArray(state.conflicts)
  )
    throw issue(
      "LOCAL_DATA_INVALID",
      "本机同步资料无法读取，请保留数据并联系开发者",
    );
  state = copy(state);
  let running = null;
  function commit(next) {
    write(copy(next));
    state = next;
  }
  function view() {
    const rows = copy(state.records);
    for (const pending of state.outbox)
      rows[pending.operation.id] = copy(pending.local);
    for (const conflict of state.conflicts)
      rows[conflict.id] = Object.assign(copy(conflict.local), {
        conflict: true,
      });
    return rows;
  }
  function enqueue(type, id, data, finish) {
    if (!isId(id)) throw issue("INVALID_DATA", "投递 ID 无效");
    if (state.conflicts.some((entry) => entry.id === id))
      throw issue("UNRESOLVED_CONFLICT", "请先处理这次投递的同步冲突");
    if (state.outbox.length >= 1000)
      throw issue("QUEUE_FULL", "未同步操作较多，请先连接服务器完成同步");
    const before = view()[id];
    if (before && before.purged) throw issue("PURGED", "投递已永久删除");
    if (type !== "put" && !before) throw issue("NOT_FOUND", "投递不存在");
    if (type === "put" && before && before.deletedAt)
      throw issue("DELETED", "请先恢复投递");
    const previous = state.outbox
      .filter((entry) => entry.operation.id === id)
      .slice(-1)[0];
    const opId = makeId();
    const operation = {
      opId,
      id,
      type,
      baseVersion: (state.records[id] || {}).version || 0,
    };
    if (type === "put") {
      operation.data = copy(data);
      // Existing server-owned long result/coverage is preserved by merge. Only
      // changed fields travel upstream; the optimistic local view stays whole.
      if (before?.data)
        for (const key of Object.keys(operation.data))
          if (
            JSON.stringify(operation.data[key]) ===
            JSON.stringify(before.data[key])
          )
            delete operation.data[key];
    }
    const local = {
      id,
      version: (before || {}).version || 0,
      data:
        type === "put" ? merge(before && before.data, data, id) : before.data,
      deletedAt:
        type === "delete"
          ? new Date().toISOString()
          : type === "restore" || type === "put"
            ? null
            : before.deletedAt,
      purged: type === "purge",
      pending: true,
    };
    if (type === "purge") {
      if (!before.deletedAt) throw issue("NOT_DELETED", "请先移入最近删除");
      local.data = null;
    }
    const next = copy(state);
    next.outbox.push({
      operation,
      dependsOn: previous ? previous.operation.opId : null,
      local,
    });
    if (finish) finish(next);
    commit(next);
    return id;
  }
  async function pull() {
    let more;
    do {
      const cursor = state.cursor;
      const result = await request(
        "GET",
        `${api}/changes?cursor=${cursor}&epoch=${encodeURIComponent(state.epoch)}`,
      );
      if (result.epoch !== state.epoch)
        throw issue("RESET_REQUIRED", "服务器资料版本已变化，未同步内容已保留");
      if (
        !Number.isSafeInteger(result.cursor) ||
        result.cursor < cursor ||
        !Array.isArray(result.records) ||
        !result.records.every(validRecord) ||
        typeof result.more !== "boolean" ||
        (result.more && result.cursor <= cursor)
      )
        throw issue("INVALID_RESPONSE", "同步响应无效，本机内容已保留");
      const next = copy(state);
      result.records.forEach((row) => {
        if (
          !next.records[row.id] ||
          next.records[row.id].version <= row.version
        )
          next.records[row.id] = row;
      });
      next.cursor = result.cursor;
      commit(next);
      more = result.more;
    } while (more);
  }
  async function execute() {
    const status = await request("GET", `${api}/status`);
    if (protocolVersion === 3 && status.protocolVersion === 3) {
      const account = await request("GET", `${api}/account`);
      status.epoch = account.epoch;
    }
    if (
      status.application !== "shixu-sync" ||
      status.protocolVersion !== protocolVersion ||
      typeof status.epoch !== "string"
    )
      throw issue("INCOMPATIBLE_SERVICE", "该地址不是兼容的拾序同步服务");
    if (state.epoch && state.epoch !== status.epoch)
      throw issue(
        "RESET_REQUIRED",
        "服务器资料版本已变化，本机内容已保留，请核对后重新接入",
      );
    if (!state.epoch) {
      const next = copy(state);
      next.epoch = status.epoch;
      commit(next);
    }
    await pull();
    while (state.outbox.length) {
      const entry = copy(state.outbox[0]);
      if (entry.dependsOn)
        throw issue("QUEUE_DEPENDENCY", "同步队列顺序异常，本机内容已保留");
      const op = entry.operation;
      let result;
      try {
        result = await request("POST", `${api}/operations`, {
          epoch: state.epoch,
          operation: op,
        });
      } catch (error) {
        if (
          !["REVISION_CONFLICT", "DELETED", "PURGED", "NOT_DELETED"].includes(
            error.code,
          )
        )
          throw error;
        const same = state.outbox.filter((item) => item.operation.id === op.id);
        const next = copy(state);
        if (error.current && validRecord(error.current))
          next.records[op.id] = error.current;
        next.conflicts.push({
          id: op.id,
          local: copy(same[same.length - 1].local),
          code: error.code,
        });
        next.outbox = next.outbox.filter((item) => item.operation.id !== op.id);
        commit(next);
        continue;
      }
      if (
        result.opId !== op.opId ||
        !validRecord(result.record) ||
        result.record.id !== op.id ||
        !Number.isSafeInteger(result.acceptedVersion) ||
        result.acceptedVersion < 1 ||
        result.record.version < result.acceptedVersion
      )
        throw issue("INVALID_RESPONSE", "同步确认无效，操作已保留以便安全重试");
      const next = copy(state);
      if (
        !next.records[op.id] ||
        next.records[op.id].version <= result.record.version
      )
        next.records[op.id] = result.record;
      next.outbox = next.outbox.filter(
        (item) => item.operation.opId !== op.opId,
      );
      next.outbox.forEach((item) => {
        if (item.dependsOn === op.opId) {
          item.dependsOn = null;
          item.operation.baseVersion = result.acceptedVersion;
        }
      });
      commit(next);
    }
    await pull();
    return {
      pending: state.outbox.length,
      conflicts: state.conflicts.length,
      capabilities: status.capabilities || {},
      epoch: status.epoch,
    };
  }
  return {
    newId: makeId,
    putMany(entries) {
      let staged;
      const client = createSyncClient({
        read: () => state,
        write: (value) => {
          staged = value;
        },
        request,
        makeId,
        protocolVersion,
      });
      for (const { id, patch } of entries) client.put(id, patch);
      if (staged) commit(staged);
    },
    put: (id, data) => enqueue("put", id, data),
    remove: (id) => enqueue("delete", id),
    restore: (id) => enqueue("restore", id),
    purge: (id) => enqueue("purge", id),
    records: () => Object.values(view()).map(copy),
    pendingCount: () => state.outbox.length,
    conflicts: () => copy(state.conflicts),
    acceptRemote(id) {
      const next = copy(state);
      next.conflicts = next.conflicts.filter((item) => item.id !== id);
      commit(next);
    },
    keepLocalCopy(id) {
      const conflict = state.conflicts.find((entry) => entry.id === id);
      if (!conflict || !conflict.local.data)
        throw issue("NOT_FOUND", "没有可另存的本机内容");
      const newId = makeId();
      // A single durable write both creates the copy and resolves the conflict.
      enqueue(
        "put",
        newId,
        Object.assign({}, conflict.local.data, { id: newId }),
        (next) => {
          next.conflicts = next.conflicts.filter((entry) => entry.id !== id);
        },
      );
      return newId;
    },
    sync() {
      if (!running)
        running = execute().finally(() => {
          running = null;
        });
      return running;
    },
  };
}
module.exports = { createSyncClient, makeId: uid };
