/** @file Pure three-way notebook merge. Concurrent edits are preserved as deterministic copies. */
/** Serialize JSON consistently for comparisons and deterministic conflict IDs. */
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** Ignore timestamps and unreviewed OCR cache fields when detecting meaningful note changes. */
function semanticNote(note) {
  if (!note) return null;
  const copy = structuredClone(note);
  delete copy.updated;
  if (!copy.handwriting?.reviewed) delete copy.handwriting;
  for (const pg of copy.pdf?.pages || [])
    if (!pg.handwriting?.reviewed) delete pg.handwriting;
  return copy;
}
/** Compare a note together with its immutable original PDF reference. */
export function noteKey(note, hash) {
  return canonical({ note: semanticNote(note), file: hash || null });
}
/** Generate a stable, non-secret conflict suffix so a retried push does not multiply copies. */
function suffix(text) {
  let a = 2166136261,
    b = 5381;
  for (const c of text) {
    a = Math.imul(a ^ c.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ c.charCodeAt(0);
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
/** Make a valid empty ancestor for a device or a newly selected server workspace. */
export function emptySnapshot() {
  return { data: { books: [], notes: [] }, files: {} };
}
/** Preserve a local automatic transcript when the same remote note has no such cache. */
function preserveIndex(remote, local) {
  const chosen = structuredClone(remote);
  if (local && noteKey(remote) === noteKey(local)) {
    if (!chosen.handwriting && local.handwriting)
      chosen.handwriting = structuredClone(local.handwriting);
    for (let i = 0; i < (chosen.pdf?.pages.length || 0); i++)
      if (!chosen.pdf.pages[i].handwriting && local.pdf?.pages[i]?.handwriting)
        chosen.pdf.pages[i].handwriting = structuredClone(
          local.pdf.pages[i].handwriting,
        );
  }
  return chosen;
}
/** Merge notes, notebooks, deletions, and PDF references without a last-writer-wins overwrite. */
export function mergeSnapshots(base, local, remote, deviceId) {
  base = base || emptySnapshot();
  const conflicts = [],
    books = new Map(),
    localBookMap = new Map(),
    bmap = new Map(base.data.books.map((b) => [b.id, b])),
    lmap = new Map(local.data.books.map((b) => [b.id, b])),
    rmap = new Map(remote.data.books.map((b) => [b.id, b]));
  for (const id of new Set([...bmap.keys(), ...rmap.keys(), ...lmap.keys()])) {
    const b = bmap.get(id),
      l = lmap.get(id),
      r = rmap.get(id),
      lc = canonical(l) !== canonical(b),
      rc = canonical(r) !== canonical(b);
    if (lc && rc && canonical(l) !== canonical(r) && l && r) {
      books.set(id, structuredClone(r));
      let copyId = "book_conflict_" + suffix(id + deviceId + canonical(l));
      const copy = {
        ...structuredClone(l),
        id: copyId,
        name: l.name + " (conflict copy)",
      };
      const existing =
        books.get(copyId) || rmap.get(copyId) || lmap.get(copyId);
      if (existing && canonical(existing) !== canonical(copy))
        copyId += "_" + suffix(canonical(existing));
      copy.id = copyId;
      books.set(copyId, copy);
      localBookMap.set(id, copyId);
    } else {
      const chosen = lc ? l : r;
      if (chosen) books.set(id, structuredClone(chosen));
    }
  }
  const bn = new Map(base.data.notes.map((n) => [n.id, n])),
    ln = new Map(local.data.notes.map((n) => [n.id, n])),
    rn = new Map(remote.data.notes.map((n) => [n.id, n])),
    notes = new Map(),
    files = {};
  /** Add a note and its matching PDF; apply notebook remapping only to local versions. */
  function add(note, hash, fromLocal = false) {
    const copy = structuredClone(note);
    if (fromLocal && localBookMap.has(copy.book))
      copy.book = localBookMap.get(copy.book);
    notes.set(copy.id, copy);
    if (hash) files[copy.id] = hash;
  }
  /** Retain a divergent edit under a stable new note ID. */
  function conflictCopy(note, hash, kind, fromLocal = true) {
    let copyId =
      "conflict_" +
      suffix(note.id + "|" + deviceId + "|" + noteKey(note, hash));
    const copy = {
      ...structuredClone(note),
      id: copyId,
      title:
        (note.title || "Untitled note") +
        (kind === "edit-delete" ? " (recovered edit)" : " (conflict copy)"),
    };
    const existing = notes.get(copyId) || rn.get(copyId) || ln.get(copyId);
    if (
      existing &&
      noteKey(
        existing,
        files[copyId] || remote.files[copyId] || local.files[copyId],
      ) !== noteKey(copy, hash)
    )
      copyId += "_" + suffix(canonical(existing));
    copy.id = copyId;
    add(copy, hash, fromLocal);
    conflicts.push({ noteId: note.id, copyId, kind });
  }
  for (const id of new Set([...rn.keys(), ...ln.keys(), ...bn.keys()])) {
    const b = bn.get(id),
      l = ln.get(id),
      r = rn.get(id),
      bh = base.files[id],
      lh = local.files[id],
      rh = remote.files[id],
      lc = noteKey(l, lh) !== noteKey(b, bh),
      rc = noteKey(r, rh) !== noteKey(b, bh);
    if (noteKey(l, lh) === noteKey(r, rh)) {
      if (r) add(preserveIndex(r, l), rh);
      continue;
    }
    if (!lc) {
      if (r) add(r, rh);
      continue;
    }
    if (!rc) {
      if (l) add(l, lh, true);
      continue;
    }
    if (l && r) {
      add(r, rh);
      conflictCopy(l, lh, "edit-edit");
    } else if (l) conflictCopy(l, lh, "edit-delete");
    else if (r) conflictCopy(r, rh, "edit-delete", false);
  }
  if (!books.size)
    books.set("personal", {
      id: "personal",
      name: "Personal",
      color: "#839d70",
    });
  for (const note of notes.values())
    if (!books.has(note.book)) {
      const recovered =
        lmap.get(note.book) || rmap.get(note.book) || bmap.get(note.book);
      if (recovered) books.set(recovered.id, structuredClone(recovered));
      else note.book = books.keys().next().value;
    }
  return {
    snapshot: {
      data: { books: [...books.values()], notes: [...notes.values()] },
      files,
    },
    conflicts,
  };
}
/** Compare durable user content while allowing local derived recognition caches to differ. */
export function sameSnapshot(a, b) {
  /** Evaluate an inline callback in dist/sync-merge.mjs; its direct operations are listed below. */
  const normalize = (s) => ({
    books: [...s.data.books].sort((x, y) => x.id.localeCompare(y.id)),
    notes: s.data.notes
      .map((n) => ({ id: n.id, key: noteKey(n, s.files[n.id]) }))
      .sort((x, y) => x.id.localeCompare(y.id)),
  });
  return canonical(normalize(a)) === canonical(normalize(b));
}
