#!/usr/bin/env node
/**
 * OpenClaw exec SecretRef resolver for seekrit.
 *
 * OpenClaw runs this file — `${node} ./seekrit-secret-ref-resolver.js`, declared
 * in `openclaw.plugin.json` — with the request on stdin and a narrow environment
 * allowlist, and reads the response from stdout. All this file does is hand that
 * request to `seekrit openclaw resolve` and pass the answer back.
 *
 * It is a bridge on purpose, for three reasons.
 *
 * **One implementation of the protocol.** `seekrit openclaw resolve` is also the
 * command a plain CLI install points an exec provider straight at. If the
 * protocol lived here as well, a fix would land in one of the two shapes only.
 *
 * **The gateway process never holds key material.** The decryption happens in a
 * child that exits when the batch is answered — the same reason
 * `@seekrit/paperclip-plugin` shells out rather than importing the crypto into a
 * long-lived worker.
 *
 * **Zero dependencies, and a real path on disk.** OpenClaw resolves the
 * entrypoint OpenClaw declared, then refuses it if it is a symlink, a hardlink,
 * or inside a world-writable directory. A plain committed `.js` file at the
 * plugin root satisfies that; a bundler output behind a symlinked `dist` does
 * not.
 *
 * Failure is fail-closed and quiet. A resolver that cannot reach seekrit answers
 * with a per-id error code and exits 0, so OpenClaw refuses to start with a
 * clear "unresolved ref" rather than a resolver crash — and never with a message,
 * because resolver output may contain credentials and OpenClaw declines to
 * display it.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const PROTOCOL_VERSION = 1;

/** Under the manifest's 30s, so a hung child still produces a clean response. */
const CHILD_TIMEOUT_MS = 25_000;

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += String(chunk);
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(input));
  });
}

function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

/** The ids we owe an answer for, so a failure can be reported against each. */
function requestedIds(input) {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.ids)) {
    throw new Error("invalid exec SecretRef request");
  }
  // `trim()`, not just `length`, so this list matches the one
  // `seekrit openclaw resolve` builds — a blank id must not become an error key
  // here that the CLI never reports.
  return parsed.ids.filter((id) => typeof id === "string" && id.trim().length > 0);
}

function errorResponse(ids, code) {
  const errors = {};
  for (const id of ids) errors[id] = { code };
  return { protocolVersion: PROTOCOL_VERSION, values: {}, errors };
}

/**
 * Locate the seekrit CLI's entry file.
 *
 * `SEEKRIT_CLI` first, for an install this package cannot see — but only as an
 * absolute path: a bare name would be looked up on `PATH`, and `PATH` is
 * attacker-influenced in a way an explicit absolute path is not.
 *
 * Otherwise resolve `@seekrit/cli` out of this package's own dependency tree.
 * That is deliberately not a `PATH` lookup either: the `seekrit` on `PATH` is a
 * package-manager shim that symlinks into `node_modules`, and its version is
 * whatever the machine happens to have rather than the one this plugin was
 * published against.
 */
function resolveCliEntry() {
  const override = process.env.SEEKRIT_CLI?.trim();
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error("SEEKRIT_CLI must be an absolute path");
    }
    return override;
  }
  const require = createRequire(import.meta.url);
  return require.resolve("@seekrit/cli/cli-entry");
}

/** Run the CLI on the request, resolving to its stdout. */
function runCli(entry, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "openclaw", "resolve"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new Error("seekrit CLI timed out"));
    }, CHILD_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    // Drained and dropped. The CLI writes diagnostics here, and a full pipe
    // would deadlock a child that is otherwise about to answer — but nothing
    // from it may reach our own stderr, which OpenClaw captures.
    child.stderr.resume();
    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, new Error(`seekrit CLI exited ${code}`));
    });

    child.stdin.on("error", (err) => finish(reject, err));
    child.stdin.end(input);
  });
}

/** Accept only a well-formed protocol response, so junk cannot look like values. */
function parseCliResponse(stdout) {
  const parsed = JSON.parse(stdout);
  if (!parsed || typeof parsed !== "object" || typeof parsed.values !== "object") {
    throw new Error("seekrit CLI returned an unexpected shape");
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    values: parsed.values ?? {},
    ...(parsed.errors ? { errors: parsed.errors } : {}),
  };
}

async function main() {
  const input = await readStdin();

  let ids;
  try {
    ids = requestedIds(input);
  } catch (err) {
    // Nothing to answer: no ids to attach an error to. Exit non-zero so OpenClaw
    // reports a resolver fault rather than a silently empty batch.
    process.stderr.write(`seekrit: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  let entry;
  try {
    entry = resolveCliEntry();
  } catch {
    writeResponse(errorResponse(ids, "UNAVAILABLE"));
    return;
  }

  try {
    writeResponse(parseCliResponse(await runCli(entry, input)));
  } catch {
    writeResponse(errorResponse(ids, "UNAVAILABLE"));
  }
}

await main();
