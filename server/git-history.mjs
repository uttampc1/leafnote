/** @file Private Git ledger for autosaved server snapshots. Git HEAD is the durable revision authority. */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
/** Open an isolated local repository. No remote, credentials, global hooks, or shell commands are used. */
export async function createGitHistory(root) {
  const directory = path.join(root, "history");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const globalConfig = path.join(directory, "empty-config");
  await fs.writeFile(globalConfig, "", { mode: 0o600 });
  /** Execute fixed Git arguments with bounded output and no interactive credential prompts. */
  async function git(...args) {
    const { stdout } = await execute(
      "git",
      [
        "-c",
        "core.hooksPath=" + path.join(directory, "disabled-hooks"),
        "-c",
        "core.fsync=committed",
        "-c",
        "gc.auto=0",
        "-c",
        "maintenance.auto=false",
        "-c",
        "core.autocrlf=false",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Leafnote Autosave",
        "-c",
        "user.email=leafnote@localhost",
        "-C",
        directory,
        ...args,
      ],
      {
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: globalConfig,
          GIT_TERMINAL_PROMPT: "0",
        },
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 128 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    return stdout;
  }
  await git("init", "--quiet", "--initial-branch=main");
  /** Read only a reachable, full-length revision ID; never interpolate paths or revision expressions. */
  async function read(hash) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash))
      throw Error("Invalid revision");
    await git("merge-base", "--is-ancestor", hash, "HEAD");
    return JSON.parse(await git("show", hash + ":notebook.json"));
  }
  /** Return the latest committed snapshot, or null for a newly initialized repository. */
  async function head() {
    let hash;
    try {
      hash = (await git("rev-parse", "--verify", "HEAD")).trim();
    } catch (error) {
      if (error.code === 128) {
        const recorded = await fs
          .stat(path.join(directory, ".git", "logs", "HEAD"))
          .then(
            (stat) => stat.size > 0,
            () => false,
          );
        if (recorded)
          throw Error(
            "Git HEAD is missing from an existing history; restore the complete server backup",
          );
        return null;
      }
      throw error;
    }
    return { hash, snapshot: await read(hash) };
  }
  /** Create one commit per accepted autosave; publish HEAD only after the complete snapshot is staged. */
  async function commit(snapshot) {
    await fs.writeFile(
      path.join(directory, "notebook.json"),
      JSON.stringify(snapshot) + "\n",
      { mode: 0o600 },
    );
    await git("add", "--", "notebook.json");
    await git(
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "--no-verify",
      "-m",
      "Autosave revision " + snapshot.revision,
    );
    return (await git("rev-parse", "HEAD")).trim();
  }
  /** Page through commit metadata without reading note bodies or running caller-supplied Git options. */
  async function list(offset = 0) {
    if (!(await head())) return [];
    return (
      await git(
        "log",
        "--format=%H%x09%ct%x09%s",
        "--max-count=30",
        "--skip=" + offset,
      )
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, time, ...message] = line.split("\t");
        return { hash, at: Number(time) * 1000, message: message.join("\t") };
      });
  }
  return { head, commit, list, read };
}
