// Windows hosted runners may have no audio output device. Keep checking the
// real MP3 decoder and greeting lifecycle, with an explicit playback clock
// adapter there. Local acceptance still uses actual HTMLMediaElement playback.
export async function installAudioClock(page) {
  await page.addInitScript(() => {
    window.__syntheticAudio = true;
    const durations = new Map();
    const durationFor = (src) => {
      if (!durations.has(src))
        durations.set(
          src,
          fetch(src)
            .then((r) => {
              if (!r.ok) throw Error("Bundled audio missing");
              return r.arrayBuffer();
            })
            .then((bytes) =>
              new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes),
            )
            .then((buffer) => buffer.duration),
        );
      return durations.get(src);
    };
    // Install synchronously, before React preloads the greeting element.
    window.Audio = class extends EventTarget {
      constructor(src) {
        super();
        this.src = src;
        this.paused = true;
        this.ended = false;
        this.offset = 0;
        this.started = 0;
        this.duration = 0;
        this.generation = 0;
      }
      get currentTime() {
        return this.paused
          ? this.offset
          : Math.min(
              this.duration,
              this.offset + (performance.now() - this.started) / 1000,
            );
      }
      set currentTime(value) {
        this.offset = value;
        this.started = performance.now();
        this.ended = false;
        if (!this.paused) this.schedule();
      }
      async play() {
        window.__greetingAudio = this;
        window.__mediaPlays++;
        const generation = this.generation;
        this.duration = await durationFor(this.src);
        if (generation !== this.generation) return;
        if (this.paused) this.started = performance.now();
        this.paused = false;
        this.ended = false;
        this.schedule();
      }
      pause() {
        this.offset = this.currentTime;
        this.paused = true;
        this.generation++;
        clearTimeout(this.timer);
      }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(
          () => {
            this.offset = this.duration;
            this.paused = true;
            this.ended = true;
            this.onended?.();
            this.dispatchEvent(new Event("ended"));
          },
          Math.max(0, (this.duration - this.currentTime) * 1000),
        );
      }
    };
  });
  await page.reload();
}
