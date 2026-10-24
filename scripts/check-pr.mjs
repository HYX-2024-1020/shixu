import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validatePullRequest(pr) {
  const errors = [];
  if (!pr || !pr.head || !pr.base) return ["Missing pull request payload"];
  if (pr.base.ref !== "main") errors.push("PR must target main");
  // GitHub supplies the creator identity; do not infer bots from a branch name.
  if (pr.user?.login === "dependabot[bot]") return errors;
  if (
    !/^(feat|fix|docs|refactor|test|chore|ci|perf)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      pr.head.ref,
    )
  ) {
    errors.push("Use a task branch such as fix/attachment-recovery");
  }
  if (
    !/^(feat|fix|docs|refactor|test|chore|ci|perf|build|revert)(\([a-z0-9-]+\))?!?: \S.+$/u.test(
      pr.title ?? "",
    )
  ) {
    errors.push("PR title must use Conventional Commits: type(scope): summary");
  }
  const body = (pr.body ?? "").replace(/<!--[\s\S]*?-->/g, "");
  for (const heading of ["变更内容", "验证结果", "风险与回滚"]) {
    const section = body.match(
      new RegExp(
        `^## ${heading}\\s*\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
        "m",
      ),
    )?.[1];
    const content = (section ?? "").replace(/^\s*- \[[ xX]\].*$/gm, "").trim();
    if (
      content.length < 10 ||
      /^(待补充|TODO|TBD|N\/A|无)[。.!\s]*$/i.test(content)
    ) {
      errors.push(
        `Fill the ${heading} section with actual details (at least 10 characters)`,
      );
    }
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  if (!event.pull_request) {
    if (
      !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)
    ) {
      throw new Error("Expected a pull_request event");
    }
    console.log("No PR metadata to validate for this event");
  } else {
    const errors = validatePullRequest(event.pull_request);
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
    else console.log("PR title, branch, target and description are valid");
  }
}
