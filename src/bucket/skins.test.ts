import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_SKINS,
  isSkinImage,
  loadSkinCollection,
  MAX_CUSTOM_SKINS,
  parseSkinCollection,
  saveSkinCollection,
  skinStorageKey,
  skinSound,
  bunnyFrame,
  BUNNY_CLIP,
  type Skin,
} from "./skins";

const custom: Skin = {
  ...BUILTIN_SKINS[1],
  id: "custom-example",
  art: "custom",
  image: "data:image/webp;base64,YWJj",
};
afterEach(() => vi.unstubAllGlobals());

describe("skin collection persistence", () => {
  it("persists the bunny and maps the whole audio timeline to valid atlas cells", () => {
    expect(parseSkinCollection('{"selected":"bunny"}').selected).toBe("bunny");
    expect(skinSound(BUILTIN_SKINS[2])).toBe("bunny-voice.mp3");
    expect(bunnyFrame(0)).toEqual({ image: "bunny-motion-00.png", x: 0, y: 0 });
    expect(bunnyFrame(20 / 15)).toEqual({
      image: "bunny-motion-01.png",
      x: 0,
      y: 0,
    });
    expect(bunnyFrame(BUNNY_CLIP.duration + 99).image).toBe(
      "bunny-motion-05.png",
    );
    for (const time of [-1, NaN, 0, 1, 4, 7, 100]) {
      const frame = bunnyFrame(time);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x).toBeLessThanOrEqual(100);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeLessThanOrEqual(100);
    }
  });
  it("recovers missing, corrupt, and invalid saved collections", () => {
    for (const raw of [null, "broken", "null", "[]", '{"selected":"missing"}'])
      expect(parseSkinCollection(raw)).toEqual({
        selected: "whale",
        custom: [],
      });
  });
  it("retains selected custom art and its interaction settings", () => {
    const collection = { selected: custom.id, custom: [custom] };
    expect(parseSkinCollection(JSON.stringify(collection))).toEqual(collection);
    expect(
      parseSkinCollection(JSON.stringify({ selected: "planet" })).selected,
    ).toBe("whale");
  });
  it("offers all builtins and validates the persisted voice", () => {
    expect(BUILTIN_SKINS.map((s) => s.id)).toEqual(["whale", "ice", "bunny"]);
    for (const voice of ["voice-1", "voice-2"] as const) {
      const saved = parseSkinCollection(
        JSON.stringify({ selected: "ice", iceVoice: voice }),
      );
      expect(saved.iceVoice).toBe(voice);
      expect(skinSound(BUILTIN_SKINS[1], saved.iceVoice)).toBe(
        `ice-${voice}.mp3`,
      );
    }
    expect(
      parseSkinCollection('{"iceVoice":"constructor"}').iceVoice,
    ).toBeUndefined();
    expect(skinSound(BUILTIN_SKINS[0])).toBe("laugh.mp3");
    expect(skinSound(custom)).toBeNull();
  });
  it("discards invalid images, unknown actions, forged builtins, duplicate ids and oversized fields", () => {
    const invalid = [
      { ...custom, image: "https://example.com/tracker.png" },
      { ...custom, image: "data:image/svg+xml;base64,YWJj" },
      { ...custom, motion: "__proto__" },
      { ...custom, motion: "constructor" },
      { ...custom, color: "url(example)" },
      { ...custom, id: "whale" },
      { ...custom, greeting: "x".repeat(41) },
      { ...custom, name: " " },
    ];
    expect(
      parseSkinCollection(
        JSON.stringify({
          selected: custom.id,
          custom: [...invalid, custom, custom],
        }),
      ),
    ).toEqual({ selected: custom.id, custom: [custom] });
  });
  it("limits custom storage and isolates the example space", () => {
    const result = parseSkinCollection(
      JSON.stringify({
        custom: Array.from({ length: 20 }, (_, i) => ({
          ...custom,
          id: `custom-${i}`,
        })),
      }),
    );
    expect(result.custom).toHaveLength(MAX_CUSTOM_SKINS);
    expect(skinStorageKey(true)).not.toBe(skinStorageKey(false));
  });
  it("handles unavailable storage on load and reports failed writes", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(loadSkinCollection("test").selected).toBe("whale");
    expect(() =>
      saveSkinCollection("test", { selected: custom.id, custom: [custom] }),
    ).toThrow("本机空间不足或无法保存");
  });
  it("rejects large or unsupported encoded image data", () => {
    expect(isSkinImage("data:image/png;base64," + "a".repeat(400_000))).toBe(
      false,
    );
    expect(isSkinImage("javascript:alert(1)")).toBe(false);
    expect(isSkinImage(custom.image)).toBe(true);
  });
});
