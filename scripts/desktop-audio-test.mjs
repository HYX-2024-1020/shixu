// Windows hosted runners may have no audio output device. Keep checking the
// real MP3 decoder and greeting lifecycle, with an explicit playback clock
// adapter there. Local acceptance still uses actual HTMLMediaElement playback.
export async function installAudioClock(page) {
  await page.addInitScript(() => {
    window.__syntheticAudio = true;
    const duration = fetch("/laugh.mp3")
      .then((response) => {
        if (!response.ok) throw Error("Bundled greeting MP3 is missing");
        return response.arrayBuffer();
      })
      .then((bytes) =>
        new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes),
      )
      .then((buffer) => buffer.duration);
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
        this.duration = await duration;
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
