interface Window {
  flushDesktopDraft?: () => Promise<void>;
  desktop?: {
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
