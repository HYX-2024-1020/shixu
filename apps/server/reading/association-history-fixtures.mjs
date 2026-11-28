// Synthetic saved-item corpus; no personal materials or provider calls.
export function seedAssociationHistory(
  f,
  count,
  { factBytes = 0, summaryBytes = 0, titleBytes = 0 } = {},
) {
  for (let n = 0; n < count; n++) {
    const id = "stream-old-" + String(n).padStart(5, "0");
    f.store.apply(
      f.device,
      {
        id,
        opId: "seed-" + id,
        type: "put",
        baseVersion: 0,
        data: {
          text: "",
          sources: [],
          attachments: [],
          captureDate: "2026-10-31",
          capturedAt: "2026-10-31T00:00:00.000Z",
          status: "ready",
          itemIds: ["old-item"],
          doneIds: [],
          result: {
            summary: "s".repeat(summaryBytes),
            warnings: [],
            items: [
              {
                kind: "task",
                title: "算法报告A7319-" + n + "x".repeat(titleBytes),
                summary: "已保存的实验",
                facts: [factBytes ? "x".repeat(factBytes) : "原有事实" + n],
                nextSteps: [],
                uncertainties: [],
                due: null,
                evidence: [
                  {
                    sourceId: "history-source-" + n,
                    quote: "算法实验报告A7319-" + n,
                  },
                ],
              },
            ],
          },
        },
      },
      f.store.epoch,
    );
  }
}
