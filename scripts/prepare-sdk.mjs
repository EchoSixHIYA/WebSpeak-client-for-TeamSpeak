import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

const root = process.cwd();
const sdkPackage = "@echosixhiya/teamspeak-client";
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dependency = packageJson.dependencies?.[sdkPackage];
const match = typeof dependency === "string" ? /^git\+(.+?)#(.+)$/.exec(dependency) : null;

if (!match) {
  throw new Error(`${sdkPackage} must be pinned to a Git repository commit`);
}

const [, repository, commit] = match;
const temporaryRoot = mkdtempSync(join(tmpdir(), "webspeak-sdk-build-"));
const destination = join(root, "node_modules", "@echosixhiya", "teamspeak-client", "dist");

try {
  execFileSync("git", ["clone", "--no-checkout", repository, temporaryRoot], { stdio: "inherit" });
  execFileSync("git", ["checkout", "--detach", commit], { cwd: temporaryRoot, stdio: "inherit" });
  const npmOptions = { cwd: temporaryRoot, stdio: "inherit" };
  const runNpm = (args) => {
    if (process.platform === "win32") {
      execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], npmOptions);
    } else {
      execFileSync("npm", args, npmOptions);
    }
  };
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  runNpm(["run", "build"]);

  const source = join(temporaryRoot, "dist");
  if (!existsSync(join(source, "index.mjs"))) {
    throw new Error(`SDK build did not produce ${join(source, "index.mjs")}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(destination, entry), { recursive: true, force: true });
  }
  console.log(`Prepared ${sdkPackage} from ${commit}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
