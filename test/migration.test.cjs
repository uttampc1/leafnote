const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const source = path.resolve(__dirname, "../scripts/change-sync-folder.sh");
/** Convert controlled fixture paths for the POSIX helper on Windows Git Bash. */
function posix(value) {
  return process.platform === "win32"
    ? "/" + value[0].toLowerCase() + value.slice(2).replaceAll("\\", "/")
    : value;
}
/** Run a real folder migration with only the Docker CLI replaced by a recorder. */
function fixture(t, fail = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leafnote-migration-"));
  t.after(() => {
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(root).startsWith("leafnote-migration-"),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "dist"));
  fs.mkdirSync(path.join(root, "old", "history", ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, "old", "blobs"));
  fs.mkdirSync(path.join(root, "bin"));
  fs.copyFileSync(source, path.join(root, "scripts/change-sync-folder.sh"));
  fs.writeFileSync(path.join(root, "old/auth.key"), "a".repeat(64) + "\n");
  fs.writeFileSync(
    path.join(root, "old/history/.git/HEAD"),
    "fixture Git identity",
  );
  fs.writeFileSync(path.join(root, "old/blobs/original.pdf"), "%PDF-fixture");
  fs.writeFileSync(
    path.join(root, ".env"),
    "LEAFNOTE_HOST=192.168.1.50\nLEAFNOTE_SYNC_DIR=" +
      posix(path.join(root, "old")) +
      "\n",
  );
  const docker =
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_DOCKER_LOG"\ncase "$*" in\n "compose up"*) if [ -f "$MOCK_FAIL_ONCE" ]; then mv "$MOCK_FAIL_ONCE" "$MOCK_FAIL_ONCE.used"; exit 1; fi;;\nesac\nexit 0\n';
  fs.writeFileSync(path.join(root, "bin/docker"), docker, { mode: 0o755 });
  const marker = path.join(root, "fail-once");
  if (fail) fs.writeFileSync(marker, "");
  let shell = "sh";
  if (process.platform === "win32") {
    const gitPath = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
    }).trim();
    shell = path.resolve(gitPath, "../../../bin/bash.exe");
  }
  return {
    root,
    /** Implement the run callback in this object. */
    run(destination) {
      return execFileSync(
        shell,
        [
          "-c",
          "PATH='" +
            posix(path.join(root, "bin")) +
            "':$PATH; export PATH; sh scripts/change-sync-folder.sh '" +
            posix(destination || path.join(root, "new")) +
            "'",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            MOCK_DOCKER_LOG: posix(path.join(root, "docker.log")),
            MOCK_FAIL_ONCE: posix(marker),
          },
          windowsHide: true,
        },
      );
    },
  };
}
test("Linux folder helper copies notes, PDFs and Git history and preserves the original (mock Docker)", (t) => {
  const f = fixture(t);
  f.run();
  assert.ok(
    fs
      .readFileSync(path.join(f.root, ".env"), "utf8")
      .includes("LEAFNOTE_SYNC_DIR=" + posix(path.join(f.root, "new"))),
  );
  for (const name of ["auth.key", "history/.git/HEAD", "blobs/original.pdf"])
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, "new", name)),
      fs.readFileSync(path.join(f.root, "old", name)),
    );
  assert.match(
    fs.readFileSync(path.join(f.root, "docker.log"), "utf8"),
    /compose stop sync/,
  );
});
test("Linux folder helper rolls configuration back after a failed service switch (mock Docker)", (t) => {
  const f = fixture(t, true),
    before = fs.readFileSync(path.join(f.root, ".env"), "utf8");
  assert.throws(() => f.run());
  assert.equal(fs.readFileSync(path.join(f.root, ".env"), "utf8"), before);
  assert.equal(
    fs
      .readFileSync(path.join(f.root, "docker.log"), "utf8")
      .match(/compose up/g).length,
    2,
  );
  assert.ok(fs.existsSync(path.join(f.root, "new/history/.git/HEAD")));
  assert.ok(fs.existsSync(path.join(f.root, "old/history/.git/HEAD")));
});
test("Linux folder helper refuses a nonempty destination before stopping sync (mock Docker)", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, "new"));
  fs.writeFileSync(path.join(f.root, "new/keep"), "keep");
  assert.throws(() => f.run());
  assert.equal(fs.existsSync(path.join(f.root, "docker.log")), false);
  assert.equal(fs.readFileSync(path.join(f.root, "new/keep"), "utf8"), "keep");
});
