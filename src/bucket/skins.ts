export const SKIN_MOTIONS = {
  bounce: "开心蹦跳",
  wiggle: "左右摇摆",
  spin: "转个圈圈",
  float: "轻轻漂浮",
} as const;
export type SkinMotion = keyof typeof SKIN_MOTIONS;
export type SkinArt = "whale" | "ice" | "bunny" | "custom";
export type Skin = {
  id: string;
  name: string;
  description: string;
  art: SkinArt;
  color: string;
  motion: SkinMotion;
  hello: string;
  greeting: string;
  feeding: string;
  image?: string;
};
export const BUILTIN_SKINS: Skin[] = [
  {
    id: "whale",
    name: "小鲸鱼",
    description: "老朋友，大胃口。",
    art: "whale",
    color: "#dcecff",
    motion: "bounce",
    hello: "扔给我，什么都吃！",
    greeting: "哈哈，今天也要开心呀！",
    feeding: "啊呜，让我慢慢消化！",
  },
  {
    id: "ice",
    name: "冰冰冰",
    description: "冰冰凉凉，烦恼冻住。",
    art: "ice",
    color: "#def3ff",
    motion: "wiggle",
    hello: "冰冰冰，戳我听一声！",
    greeting: "冰冰冰！",
    feeding: "咔嚓，烦恼冻住啦！",
  },
  {
    id: "bunny",
    name: "绯樱狐",
    description: "戳一下，听她说。",
    art: "bunny",
    color: "#f7dce9",
    motion: "wiggle",
    hello: "",
    greeting: "",
    feeding: "",
  },
];
export const BUNNY_CLIP = {
  fps: 15,
  frames: 110,
  columns: 5,
  rows: 4,
  width: 160,
  height: 232,
  duration: 220 / 30,
} as const;
export function bunnyFrame(time: number) {
  const frame = Math.min(
    BUNNY_CLIP.frames - 1,
    Math.max(
      0,
      Math.floor((Number.isFinite(time) ? time : 0) * BUNNY_CLIP.fps),
    ),
  );
  const cell = frame % (BUNNY_CLIP.columns * BUNNY_CLIP.rows);
  return {
    image: `bunny-motion-${String(Math.floor(frame / 20)).padStart(2, "0")}.png`,
    x: ((cell % BUNNY_CLIP.columns) * 100) / (BUNNY_CLIP.columns - 1),
    y: (Math.floor(cell / BUNNY_CLIP.columns) * 100) / (BUNNY_CLIP.rows - 1),
  };
}
export const ICE_VOICES = { "voice-1": "声音一", "voice-2": "声音二" } as const;
export type IceVoice = keyof typeof ICE_VOICES;
export function skinSound(
  skin: Skin,
  voice: IceVoice = "voice-1",
): string | null {
  if (skin.art === "whale") return "laugh.mp3";
  if (skin.art === "bunny") return "bunny-voice.mp3";
  if (skin.art === "ice")
    return `ice-${voice === "voice-2" ? "voice-2" : "voice-1"}.mp3`;
  return null;
}
export type SkinCollection = {
  selected: string;
  custom: Skin[];
  iceVoice?: IceVoice;
};
export const MAX_CUSTOM_SKINS = 8;
const MAX_IMAGE_LENGTH = 400_000;
export const skinStorageKey = (demo: boolean) =>
  `shixu-bucket-skins-v1${demo ? "-demo" : ""}`;

export function isSkinImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < MAX_IMAGE_LENGTH &&
    /^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value)
  );
}
function isCustomSkin(value: unknown): value is Skin {
  if (!value || typeof value !== "object") return false;
  const s = value as Skin;
  return (
    typeof s.id === "string" &&
    /^custom-[\w-]{1,80}$/.test(s.id) &&
    s.art === "custom" &&
    typeof s.name === "string" &&
    !!s.name.trim() &&
    s.name.length <= 20 &&
    typeof s.description === "string" &&
    s.description.length <= 60 &&
    typeof s.color === "string" &&
    /^#[a-f\d]{6}$/i.test(s.color) &&
    Object.hasOwn(SKIN_MOTIONS, s.motion) &&
    [s.hello, s.greeting, s.feeding].every(
      (v) => typeof v === "string" && !!v.trim() && v.length <= 40,
    ) &&
    isSkinImage(s.image)
  );
}
export function parseSkinCollection(raw: string | null): SkinCollection {
  try {
    const value = JSON.parse(raw || "{}");
    const seen = new Set<string>();
    const custom = (Array.isArray(value.custom) ? value.custom : []).filter(
      (s: unknown) => {
        if (!isCustomSkin(s) || seen.has(s.id) || seen.size >= MAX_CUSTOM_SKINS)
          return false;
        seen.add(s.id);
        return true;
      },
    ) as Skin[];
    const selected = [...BUILTIN_SKINS, ...custom].some(
      (s) => s.id === value.selected,
    )
      ? value.selected
      : "whale";
    return {
      selected,
      custom,
      ...(Object.hasOwn(ICE_VOICES, value.iceVoice)
        ? { iceVoice: value.iceVoice }
        : {}),
    };
  } catch {
    return { selected: "whale", custom: [] };
  }
}
export function loadSkinCollection(key: string): SkinCollection {
  try {
    return parseSkinCollection(localStorage.getItem(key));
  } catch {
    return { selected: "whale", custom: [] };
  }
}
export function saveSkinCollection(key: string, value: SkinCollection) {
  if (JSON.stringify(value).length > 2_000_000)
    throw new Error("皮肤收藏空间已满，请先删除一些自定义皮肤");
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("本机空间不足或无法保存，请释放网站存储空间后再试");
  }
}

export async function readSkinImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("请选择 PNG、JPG 或 WebP 图片");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight)
      throw new Error("invalid image");
    const scale = Math.min(
      1,
      480 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/webp", 0.88);
    if (!isSkinImage(image))
      throw new Error("图片处理后仍然太大，请换一张更简单的图片");
    return image;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("图片处理"))
      throw error;
    throw new Error("这张图片无法读取，请换一张图片试试");
  } finally {
    URL.revokeObjectURL(url);
  }
}
