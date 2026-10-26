import { bunnyFrame, type Skin } from "./skins";

export default function SkinArt({
  skin,
  time = -1,
}: {
  skin: Skin;
  time?: number;
}) {
  if (skin.art === "bunny" && time >= 0) {
    const frame = bunnyFrame(time);
    return (
      <span
        className="skin-art bunny-art bunny-frame"
        role="img"
        aria-label={skin.name}
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}${frame.image}")`,
          backgroundPosition: `${frame.x}% ${frame.y}%`,
        }}
      />
    );
  }
  return (
    <img
      className={`skin-art ${skin.art === "ice" ? "is-plain-art" : ""} ${skin.art === "bunny" ? "bunny-art" : ""}`}
      src={
        skin.art === "custom"
          ? skin.image
          : import.meta.env.BASE_URL +
            (skin.art === "ice"
              ? "ice.png"
              : skin.art === "bunny"
                ? "bunny.png"
                : "mascot.png")
      }
      alt={skin.name}
      draggable={false}
    />
  );
}
