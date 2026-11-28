import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateClientParity(files) {
  const runtime = files.filter(
    (file) =>
      /^(src\/bucket\/|shared\/|desktop\/|miniprogram\/(pages\/|lib\/|assets\/|app\.)|server\/)/.test(
        file,
      ) && !/(\.test\.|\/fixtures\/|\/generated\/)/.test(file),
  );
  if (runtime.length && !files.includes("docs/client-parity.md"))
    return [
      "Product changes must update docs/client-parity.md with actual Windows/WeChat behavior, platform adaptations and remaining validation.",
    ];
  return [];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (event.pull_request) {
    const { base, head } = event.pull_request;
    if (![base.sha, head.sha].every((sha) => /^[a-f0-9]{40,64}$/.test(sha)))
      throw new Error("Invalid comparison revisions");
    const files = execFileSync(
      "git",
      ["diff", "--name-only", `${base.sha}...${head.sha}`],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/);
    const errors = validateClientParity(files);
    errors.forEach((error) => console.error(error));
    if (errors.length) process.exitCode = 1;
    else
      console.log(
        "Dual-client impact record is present (implementation and device acceptance still require review).",
      );
  } else console.log("No pull request comparison for this event.");
}
