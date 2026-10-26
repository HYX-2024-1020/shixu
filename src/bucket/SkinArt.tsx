import { useEffect, useRef } from "react";
import type { Skin } from "./skins";

export default function SkinArt({
  skin,
  animate = false,
  playing = false,
  playSignal = 0,
}: {
  skin: Skin;
  animate?: boolean;
  playing?: boolean;
  playSignal?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.pause();
    element.currentTime = 0;
    if (playing) void element.play().catch(() => {});
    return () => element.pause();
  }, [playing, playSignal, animate, skin.art]);
  if (skin.art === "bunny" && animate) {
    return (
      <video
        ref={video}
        className="skin-art bunny-art bunny-video"
        role="img"
        aria-label={skin.name}
        src={import.meta.env.BASE_URL + "bunny-motion.webm"}
        poster={import.meta.env.BASE_URL + "bunny.png"}
        muted
        playsInline
        preload="auto"
        data-playing={playing}
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
