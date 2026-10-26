import type { Skin } from "./skins";

export default function SkinArt({ skin }: { skin: Skin }) {
  return (
    <img
      className="skin-art"
      src={
        skin.art === "custom"
          ? skin.image
          : import.meta.env.BASE_URL +
            (skin.art === "ice" ? "ice.png" : "mascot.png")
      }
      alt={skin.name}
      draggable={false}
    />
  );
}
