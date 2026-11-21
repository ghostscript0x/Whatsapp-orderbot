#!/usr/bin/env node
/**
 * `npm run dev:all` — runs the Next.js dev server and the bot worker together.
 *
 * - Output is prefixed per process: [web] / [worker].
 * - Ctrl+C (SIGINT) or SIGTERM stops both; if either process exits on its own, the other is stopped
 *   and this script exits with that process's code.
 * - Windows-safe: binaries are run with the current Node executable (no shell, no .cmd shims), and
 *   process trees are killed with `taskkill /T` because `tsx watch` runs the worker in a grandchild.
 *
 * No dependencies beyond Node itself.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const isWindows = process.platform === "win32";
/** How long children get to exit cleanly before their process trees are killed. */
const GRACE_MS = 8000;

/** Absolute path to a package's bin script, read from its package.json. */
function binPath(pkg, name) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const { bin } = require(pkgJsonPath);
  const rel = typeof bin === "string" ? bin : bin[name];
  if (!rel) throw new Error(`${pkg} has no "${name}" bin`);
  return path.join(path.dirname(pkgJsonPath), rel);
}

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const procs = [
  { name: "web", tag: color(36)("[web]   "), args: [binPath("next", "next"), "dev"] },
  { name: "worker", tag: color(35)("[worker]"), args: [binPath("tsx", "tsx"), "watch", "worker/index.ts"] },
];
const log = (msg) => console.log(`${color(33)("[dev:all]")} ${msg}`);

let shuttingDown = false;
let exitCode = 0;

function pipe(stream, tag, out) {
  readline.createInterface({ input: stream }).on("line", (line) => out.write(`${tag} ${line}\n`));
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

/** `fromSignal`: the user pressed Ctrl+C (or SIGTERM), so the children are already shutting down. */
function stopAll(reason, { fromSignal = false } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${reason}; stopping...`);
  for (const p of procs) {
    if (!isWindows) {
      if (p.child.exitCode === null) p.child.kill("SIGINT");
    } else if (!fromSignal) {
      // Windows can't deliver SIGINT to another process; Ctrl+C reaches the children through the
      // shared console, but when one child died on its own the other has to be killed outright.
      killTree(p.child);
    }
  }
  setTimeout(() => {
    for (const p of procs) killTree(p.child);
  }, GRACE_MS).unref();
}

function maybeExit() {
  if (procs.every((p) => p.child.exitCode !== null || p.child.signalCode !== null)) process.exit(exitCode);
}

for (const p of procs) {
  log(`starting ${p.name}: node ${path.relative(root, p.args[0])} ${p.args.slice(1).join(" ")}`);
  p.child = spawn(process.execPath, p.args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipe(p.child.stdout, p.tag, process.stdout);
  pipe(p.child.stderr, p.tag, process.stderr);
  p.child.on("error", (err) => {
    log(`${p.name} failed to start: ${err.message}`);
    exitCode = 1;
    stopAll(`${p.name} failed to start`);
  });
  p.child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      exitCode = code ?? 1;
      stopAll(`${p.name} exited (${signal ?? `code ${code}`})`);
    }
    maybeExit();
  });
}

process.on("SIGINT", () => stopAll("received SIGINT", { fromSignal: true }));
process.on("SIGTERM", () => stopAll("received SIGTERM", { fromSignal: true }));
