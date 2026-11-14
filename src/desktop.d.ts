interface Window {
  flushDesktopDraft?: () => Promise<void>;
  desktop?: {
    cloud(
      action: string,
      value?: unknown,
    ): Promise<{
      base: string;
      pending: number;
      conflicts: { id: string; text: string; code?: string }[];
      error: string;
      originalNotice?: string;
      originalDownload?: { saved: boolean; path: string } | null;
      localSaveNotice?: string;
      materialUseNotice?: { version: number; text: string } | null;
      materialConsentAccepted?: boolean;
      materialPurposeAccepted?: boolean;
      materialRetentionAccepted?: boolean;
      taskPreview?: {
        taskId: string;
        readOnly: boolean;
        published: boolean;
        nextOffset: number | null;
        items: {
          previewKey: string;
          title: string;
          summary: string;
          facts?: string[];
          nextSteps?: string[];
          uncertainties?: string[];
          due?: { date: string; time: string } | null;
          evidence?: { name: string; quote: string }[];
        }[];
      } | null;
      originalStorage?: {
        hasMore: boolean;
        nextCursor: number | null;
        usedBytes: number;
        reservedBytes: number;
        limitBytes: number;
        originals: {
          id: string;
          packetId: string;
          name: string;
          mode: string;
          state: string;
          version: number;
          remind: boolean;
          available: boolean;
          packetDeleted?: boolean;
          expiresAt: number | null;
          cleanupAt: number | null;
        }[];
      };
      activation?: string;
      capabilities?: { features: { registration: boolean } };
      devices?: {
        id: string;
        kind: string;
        slot: number;
        name: string;
        lastSeen: number;
      }[];
      loginDevices?: {
        id: string;
        kind: string;
        slot: number;
        name: string;
        lastSeen: number;
      }[];
      job?: string;
      jobs?: {
        disposition?: "kept" | "deleted" | null;
        diagnostic?: {
          id: string;
          at: number;
          code: string;
          phase: string;
          version: string;
        } | null;
        id: string;
        packetId?: string;
        state: string;
        error?: string;
        output?: unknown;
        protocol?: number;
        calls?: number;
        phase?: string;
        completedMergeBatches?: number;
        completedAssociationBatches?: number;
        completedVisualBatches?: number;
        reusedBlocks?: number;
        readingSummary?: {
          name?: string;
          pdfPages?: { checked: number; total: number };
        }[];
        rootTaskId?: string;
        rootCalls?: number;
        rootActiveMs?: number;
        rootActiveSeconds?: number;
        actions?: string[];
        hasPreview?: boolean;
      }[];
      account?: {
        aiAvailability?: { available: boolean; reason: string };
        usageSummary?: {
          day: string;
          timezone: string;
          sampledAt: number;
          daySpentMicro: number;
          personalRemainingMicro: number;
          siteRemainingMicro: number;
        } | null;
        activation: string;
        authentication?: {
          passwordChangeRequired?: boolean;
          version: number;
          claimed: boolean;
          username: string;
        };
        reading?: { features: { readingEnabled: boolean } };
        wallet?: {
          spent?: number;
          available: number;
          lowBalance?: boolean;
          pausedReason?: string;
        };
        ai: {
          enabled: boolean;
          dailyLimit: number;
          usage: { day: string; requests: number; reservedMicros: number }[];
        };
      } | null;
    }>;
    store(method: string, value?: unknown): Promise<any>;
    key(
      action: "read" | "save" | "remove",
      value?: string,
    ): Promise<string | void>;
    backup(action: "export" | "import"): Promise<string>;
    archive(
      bytes: ArrayBuffer,
      extension: string,
    ): Promise<{ name: string; bytes?: ArrayBuffer; error?: string }[]>;
    office(bytes: ArrayBuffer, extension: string): Promise<string>;
  };
}
