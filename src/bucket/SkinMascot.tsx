import { useCallback, useEffect, useRef, useState } from "react";
import { SKIN_INTERACTION } from "./client-ui";
import SkinArt from "./SkinArt";
import { skinSound, type Skin, type IceVoice } from "./skins";

export default function SkinMascot({
  skin,
  iceVoice,
  state = "idle",
  compact = false,
  suspended = false,
  feedSignal = 0,
}: {
  skin: Skin;
  iceVoice?: IceVoice;
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
  const [playSignal, setPlaySignal] = useState(0);
  const finishPlayback = useCallback(() => setHappy(false), []);
  const plain = skin.art === "ice" || skin.art === "bunny";
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        audio.current?.pause();
        setHappy(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (feedSignal === lastFeed.current) return;
    lastFeed.current = feedSignal;
    setEating(true);
    const timeout = window.setTimeout(
      () => setEating(false),
      SKIN_INTERACTION.feedingMs,
    );
    return () => clearTimeout(timeout);
  }, [feedSignal]);
  useEffect(() => {
    setHappy(false);
    const source = skinSound(skin, iceVoice);
    if (source && skin.art !== "bunny") {
      const sound = new Audio(import.meta.env.BASE_URL + source);
      sound.loop = false;
      sound.preload = "auto";
      sound.volume = SKIN_INTERACTION.volume;
      audio.current = sound;
    }
    return () => {
      clearTimeout(timer.current);
      audio.current?.pause();
      audio.current = null;
    };
  }, [skin.id, iceVoice]);
  useEffect(() => {
    if (state !== "idle" || suspended) {
      setHappy(false);
      clearTimeout(timer.current);
      audio.current?.pause();
    }
  }, [state, suspended]);
  function greet() {
    if (suspended || state !== "idle") return;
    setPlaySignal((value) => value + 1);
    setHappy(true);
    clearTimeout(timer.current);
    if (skin.art === "bunny") return;
    if (audio.current) {
      const sound = audio.current;
      sound.currentTime = 0;
      sound.onended = () => {
        setHappy(false);
      };
      sound.onerror = () => setHappy(false);
      void sound.play().catch(() => {
        if (sound.paused) setHappy(false);
      });
    } else
      timer.current = window.setTimeout(
        () => setHappy(false),
        SKIN_INTERACTION.greetingMs,
      );
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
      className={`skin-mascot ${compact ? "is-compact" : "bucket-drawing"} ${plain ? "is-plain" : ""} ${skin.art === "bunny" ? "bunny-mascot" : ""}`}
      data-motion={
        !plain && !suspended && (happy || feeding) ? skin.motion : "idle"
      }
      data-skin={skin.id}
      aria-label={`和${skin.name}打个招呼`}
      onClick={greet}
    >
      {!plain && (
        <span className="skin-bubble" aria-live="polite">
          {bubble}
        </span>
      )}
      <span className="skin-body">
        <SkinArt
          skin={skin}
          animate={skin.art === "bunny"}
          playing={happy && !suspended}
          playSignal={playSignal}
          onPlaybackEnd={finishPlayback}
        />
      </span>
      {!plain && (
        <>
          <span className="skin-spark skin-spark-one" aria-hidden="true">
            ✦
          </span>
          <span className="skin-spark skin-spark-two" aria-hidden="true">
            ✧
          </span>
        </>
      )}
    </button>
  );
}
