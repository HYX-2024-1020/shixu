export const SKIN_MOTIONS = {
  bounce: "开心蹦跳",
  wiggle: "左右摇摆",
  spin: "转个圈圈",
  float: "轻轻漂浮",
} as const;
export type SkinMotion = keyof typeof SKIN_MOTIONS;
export type SkinArt =
  | "whale"
  | "cat"
  | "sprout"
  | "robot"
  | "ghost"
  | "rabbit"
  | "planet"
  | "pudding"
  | "custom";
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
    id: "cat",
    name: "摸鱼小橘",
    description: "接住烦恼，继续摸鱼。",
    art: "cat",
    color: "#ffe2b5",
    motion: "wiggle",
    hello: "喵，今天的烦恼归我了。",
    greeting: "呼噜呼噜，摸到我啦！",
    feeding: "啊呜，这口是小鱼干味的！",
  },
  {
    id: "sprout",
    name: "发芽计划",
    description: "每个念头，都能长大。",
    art: "sprout",
    color: "#deedc9",
    motion: "float",
    hello: "把想法种在这里吧。",
    greeting: "又长高了一点点！",
    feeding: "收到新养分，正在发芽！",
  },
  {
    id: "robot",
    name: "罐头同学",
    description: "认真接收一切奇思妙想。",
    art: "robot",
    color: "#e3ddff",
    motion: "bounce",
    hello: "哔——接收频道已开启。",
    greeting: "检测到快乐，电量加满！",
    feeding: "咔哒，正在拆解你的灵感。",
  },
  {
    id: "ghost",
    name: "幽幽",
    description: "轻飘飘地，带走压力。",
    art: "ghost",
    color: "#ece4ff",
    motion: "float",
    hello: "烦恼交给我，你去放空。",
    greeting: "被你发现啦，呜呼～",
    feeding: "呼——烦恼被我吸走了！",
  },
  {
    id: "rabbit",
    name: "迟到小兔",
    description: "事情很多，也不必着急。",
    art: "rabbit",
    color: "#ffdfe7",
    motion: "bounce",
    hello: "慢慢来，我一直在。",
    greeting: "耳朵竖起来听你说！",
    feeding: "咔嚓，像胡萝卜一样好吃。",
  },
  {
    id: "planet",
    name: "小小宇宙",
    description: "装下天马行空的你。",
    art: "planet",
    color: "#dce7ff",
    motion: "spin",
    hello: "你的脑洞，这里装得下。",
    greeting: "围着你的好心情转一圈！",
    feeding: "新想法进入轨道！",
  },
  {
    id: "pudding",
    name: "布丁吨吨",
    description: "软乎乎，但很能装。",
    art: "pudding",
    color: "#fff0b8",
    motion: "wiggle",
    hello: "让今天，软乎一点。",
    greeting: "晃呀晃，快乐加倍！",
    feeding: "吨吨吨，又吃掉一件事。",
  },
];
export type SkinCollection = { selected: string; custom: Skin[] };
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
    return { selected, custom };
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
