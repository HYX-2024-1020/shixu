// Inject exhaustion only while the synthetic task still has its initial budget.
// Pre-read validation may exhaust that budget without ever invoking this reader.
export function executionLimitReader(read, initialLimitMs = 80) {
  return async (file, options) => {
    if (options.activeBudgetMs > initialLimitMs) return read(file, options);
    return new Promise((resolve, reject) => {
      const aborted = () => reject(Object.assign(Error("READING_ABORTED"), {
        timing: { waitingMs: 0 },
      }));
      if (options.signal.aborted) aborted();
      else options.signal.addEventListener("abort", aborted, { once: true });
    });
  };
}
