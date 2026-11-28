import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n"),
  ),
];
const errors = [];
for (const file of files) {
  if (!file || !existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
    if (!existsSync(path.resolve(path.dirname(file), decodeURI(target))))
      errors.push(`${file}: missing ${target}`);
  }
  if (!file.startsWith("docs/archive/") && /C:[/\\]Users[/\\]/i.test(text))
    errors.push(
      `${file}: machine-specific path belongs in a local note, not a public guide`,
    );
}
const readme = readFileSync("README.md", "utf8");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (!readme.includes(`**${version}**`))
  errors.push("README current version must match package.json");
if (!readme.includes("https://github.com/HYX-2024-1020/shixu/releases/latest"))
  errors.push("README must link to the latest release");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Documentation links and current entry points verified (${files.length} Markdown files).`,
  );
