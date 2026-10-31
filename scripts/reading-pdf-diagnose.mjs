import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const base = process.argv[2];
if (process.platform !== "linux" || process.getuid() !== 0 || !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)) throw Error("SYNTHETIC_ROOT_REQUIRED");
const root = "/sys/fs/cgroup/system.slice";
const previous = new Set(await readdir(root));
const readings = [];
let busy = false;
const inspect = async () => {
  if (busy) return;
  busy = true;
  try {
    for (const name of await readdir(root)) {
      if (previous.has(name) || !/^shixu-reader-[a-f0-9-]+\.service$/.test(name)) continue;
      try {
        const [memory, events, cpu] = await Promise.all(["memory.current", "memory.events", "cpu.stat"].map(f => readFile(root + "/" + name + "/" + f, "utf8")));
        readings.push({ memoryBytes: Number(memory), events, cpu });
      } catch { /* The transient group may already have been collected. */ }
    }
  } finally { busy = false; }
};
const timer = setInterval(inspect, 100);
const child = spawn(process.execPath, ["scripts/reading-pdf-safety.mjs", base], { cwd: base, stdio: ["ignore", "pipe", "inherit"] });
let output = "";
child.stdout.on("data", b => { output += b; });
const code = await new Promise(resolve => child.on("close", resolve));
clearInterval(timer);
while (busy) await new Promise(resolve => setTimeout(resolve, 5));
if (code) throw Error("SYNTHETIC_PRESSURE_FAILED");
const report = { synthetic: true, realProviderCalls: 0, purpose: "identify memory versus wall-clock rejection of the existing fixed dense PDF", result: JSON.parse(output),
  samples: readings.length, maxObservedBytes: Math.max(0, ...readings.map(r => r.memoryBytes)), last: readings.at(-1) };
await writeFile(base + "/pdf-diagnose.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
