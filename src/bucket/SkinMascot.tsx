import { useEffect, useRef, useState } from "react";
import SkinArt from "./SkinArt";
import type { Skin } from "./skins";

export default function SkinMascot({
  skin,
  state = "idle",
  compact = false,
  suspended = false,
  feedSignal = 0,
}: {
  skin: Skin;
  state?: "idle" | "drag" | "feeding";
  compact?: boolean;
  suspended?: boolean;
  feedSignal?: number;
}) {
  const [happy, setHappy] = useState(false);
  const [eating, setEating] = useState(false);
  const lastFeed = useRef(feedSignal);
  const timer = useRef<number>(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (feedSignal === lastFeed.current) return;
    lastFeed.current = feedSignal;
    setEating(true);
    const timeout = window.setTimeout(() => setEating(false), 2800);
    return () => clearTimeout(timeout);
  }, [feedSignal]);
  useEffect(() => {
    setHappy(false);
    return () => {
      clearTimeout(timer.current);
      audio.current?.pause();
    };
  }, [skin.id]);
  useEffect(() => {
    if (state !== "idle" || suspended) {
      setHappy(false);
      clearTimeout(timer.current);
      audio.current?.pause();
    }
  }, [state, suspended]);
  function greet() {
    if (happy) {
      clearTimeout(timer.current);
      audio.current?.pause();
      setHappy(false);
      return;
    }
    setHappy(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setHappy(false);
      audio.current?.pause();
    }, 3200);
    if (skin.art === "whale") {
      const sound =
        audio.current || new Audio(import.meta.env.BASE_URL + "laugh.mp3");
      audio.current = sound;
      sound.volume = 0.5;
      sound.currentTime = 0;
      sound.onended = () => {
        clearTimeout(timer.current);
        setHappy(false);
      };
      void sound.play().catch(() => {});
    }
  }
  const feeding = state === "feeding" || eating;
  const bubble =
    state === "drag"
      ? "张嘴啦，松手交给我！"
      : feeding
        ? skin.feeding
        : happy
          ? skin.greeting
          : skin.hello;
  return (
    <button
      type="button"
      className={`skin-mascot ${compact ? "is-compact" : "bucket-drawing"}`}
      data-motion={!suspended && (happy || feeding) ? skin.motion : "idle"}
      data-skin={skin.id}
      aria-label={
        happy
          ? skin.art === "whale"
            ? "停止鲸鱼笑声"
            : `停止${skin.name}互动`
          : `和${skin.name}打个招呼`
      }
      aria-pressed={happy}
      onClick={greet}
    >
      <span className="skin-bubble" aria-live="polite">
        {bubble}
      </span>
      <span className="skin-body">
        <SkinArt skin={skin} />
      </span>
      <span className="skin-spark skin-spark-one" aria-hidden="true">
        ✦
      </span>
      <span className="skin-spark skin-spark-two" aria-hidden="true">
        ✧
      </span>
    </button>
  );
}
