// Bounded account round robin. Each run performs at most one model call and
// yields; the separate Linux broker serializes heavy parsing globally.
export function createReadingScheduler({
  concurrency = 3,
  waitingLimit = 20,
} = {}) {
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 3 ||
    !Number.isInteger(waitingLimit) ||
    waitingLimit < 1 ||
    waitingLimit > 20
  )
    throw Error("INVALID_SCHEDULER_LIMIT");
  const waiting = [],
    accounts = new Set(),
    running = new Set();
  let closed = false,
    scheduled = false;
  const kick = () => {
    if (!scheduled && !closed) {
      scheduled = true;
      setImmediate(drain);
    }
  };
  const drain = () => {
    scheduled = false;
    while (!closed && running.size < concurrency && waiting.length) {
      const entry = waiting.shift();
      running.add(entry);
      Promise.resolve()
        .then(() => entry.engine.run(entry.id))
        .then(
          (task) => {
            running.delete(entry);
            if (task.state === "queued" && !closed) waiting.push(entry);
            else {
              accounts.delete(entry.engine.account);
              entry.resolve(task);
            }
          },
          (error) => {
            running.delete(entry);
            accounts.delete(entry.engine.account);
            entry.reject(error);
          },
        )
        .finally(kick);
    }
  };
  return {
    submit(engine, id) {
      if (closed) return Promise.reject(Error("SCHEDULER_CLOSED"));
      if (accounts.has(engine.account))
        return Promise.reject(Error("TASK_SLOT_FULL"));
      if (waiting.length >= waitingLimit)
        return Promise.reject(Error("QUEUE_FULL"));
      accounts.add(engine.account);
      const promise = new Promise((resolve, reject) =>
        waiting.push({ engine, id, resolve, reject }),
      );
      kick();
      return promise;
    },
    snapshot() {
      return {
        running: running.size,
        waiting: waiting.length,
        accounts: accounts.size,
      };
    },
    close() {
      closed = true;
      for (const e of waiting.splice(0)) {
        accounts.delete(e.engine.account);
        e.reject(Error("SCHEDULER_CLOSED"));
      }
      for (const e of running) e.engine.close();
    },
  };
}
