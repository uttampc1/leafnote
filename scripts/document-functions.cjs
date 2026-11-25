const fs = require("node:fs"),
  path = require("node:path"),
  acorn = require("acorn"),
  walk = require("acorn-walk"),
  purposes = require("./function-purposes.cjs");
/** Evaluate an inline callback in scripts/document-functions.cjs; its direct operations are listed below. */
const root = path.resolve(__dirname, ".."),
  isFunction = (n) =>
    [
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunctionExpression",
    ].includes(n.type);
const overviews = {
  "app.js":
    "Base notebook state, legacy migration helpers, navigation, and event wiring. features.js replaces the original storage and drawing handlers after IndexedDB is ready.",
  "features.js":
    "Active note engine: IndexedDB persistence, plain-text editing, pressure/pencil ink, PDF import/render/export, undo history, and the LeafnoteApp bridge.",
  "board.js":
    "Mind-map cards, connectors, drag/pan/zoom, and card editing layered on the note engine.",
  "board-engine.js":
    "Pure validation, text wrapping, and hit testing for brainstorm boards.",
  "ink-engine.js":
    "Pure pressure/pencil geometry, eraser hit testing, pointer normalization, and rotated PDF placement.",
  "search.js":
    "Search UI, PDF/handwriting indexing, recognition-worker messages, result highlighting, and protected transcript review.",
  "search-engine.js":
    "Pure Unicode search records, ink signatures, line grouping, and transcript validation.",
  "minimal.js":
    "Progressive-disclosure UI: library visibility, tool popups, text styling, pencil grades, keyboard access, and layout preferences.",
  "language-models.js":
    "Reviewed install/use/remove controls for local recognition models.",
  "language-catalog.mjs":
    "Pinned local model asset catalogue and source/licence metadata.",
  "model-storage.mjs":
    "Dedicated IndexedDB model storage with resumable installation, hashes, removal, and runtime URL aliases.",
  "recognition-worker.js":
    "Worker entry point dispatching English and Marathi recognition without uploading note images.",
  "devanagari-recognizer.mjs":
    "Local Devanagari preprocessing, ONNX/WASM inference, and multiple visual candidates.",
  "marathi-candidates.mjs":
    "Conservative dictionary-assisted ranking of actual optical candidates.",
  "pwa.js":
    "Installation controls and user-approved offline updates that wait for note persistence.",
  "sw.js":
    "Versioned offline shell caching; intentionally excludes note data and optional model downloads.",
};
/** Enumerate only maintained first-party JavaScript, including tests and tools. */
function collectFiles() {
  return ["dist", "scripts", "server", "test"]
    .flatMap((dir) =>
      fs
        .readdirSync(path.join(root, dir))
        .filter(
          (f) => /\.(js|mjs|cjs)$/.test(f) && f !== "precache-manifest.js",
        )
        .map((f) => dir + "/" + f),
    )
    .sort();
}
/** Produce a compact source excerpt suitable for a review table. */
function short(value, limit = 180) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}
/** Infer a stable readable name for a declaration or object callback. */
function functionName(node, parent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (
    parent?.type === "AssignmentExpression" &&
    parent.left.type === "Identifier"
  )
    return parent.left.name;
  if (parent?.type === "Property" && !parent.computed)
    return parent.key.name || String(parent.key.value);
  return null;
}
/** Describe anonymous callback registration without guessing application behavior. */
function contextPurpose(node, parent, source, file) {
  if (parent?.type === "CallExpression") {
    const callee = short(
      source.slice(parent.callee.start, parent.callee.end),
      100,
    );
    if (parent.callee === node)
      return "Initialize " + file + " inside an isolated scope.";
    const event = parent.arguments[0];
    if (callee.endsWith(".addEventListener") && event?.type === "Literal")
      return (
        "Handle the " +
        JSON.stringify(event.value) +
        " event registered by " +
        callee +
        "."
      );
    return "Provide the callback passed to " + callee + ".";
  }
  if (parent?.type === "AssignmentExpression")
    return (
      "Handle the callback assigned to " +
      short(source.slice(parent.left.start, parent.left.end), 120) +
      "."
    );
  if (parent?.type === "Property")
    return (
      "Implement the " +
      (parent.key.name || parent.key.value) +
      " callback in this object."
    );
  return (
    "Evaluate an inline callback in " +
    file +
    "; its direct operations are listed below."
  );
}
/** Extract only this function’s calls, writes, and return expressions, excluding nested functions. */
function directFacts(node, source) {
  const calls = new Set(),
    writes = new Set(),
    returns = new Set();
  const visitors = {
    /** Implement the FunctionDeclaration callback in this object. */
    FunctionDeclaration() {} /** Implement the FunctionExpression callback in this object. */,
    /** Implement the FunctionExpression callback in this object. */
    FunctionExpression() {} /** Implement the ArrowFunctionExpression callback in this object. */,
    /** Implement the ArrowFunctionExpression callback in this object. */
    ArrowFunctionExpression() {} /** Implement the CallExpression callback in this object. */,
    /** Implement the CallExpression callback in this object. */
    CallExpression(n, state, c) {
      calls.add(short(source.slice(n.callee.start, n.callee.end), 100));
      walk.base.CallExpression(n, state, c);
    } /** Implement the AssignmentExpression callback in this object. */,
    /** Implement the AssignmentExpression callback in this object. */
    AssignmentExpression(n, state, c) {
      writes.add(short(source.slice(n.left.start, n.left.end), 100));
      walk.base.AssignmentExpression(n, state, c);
    } /** Implement the UpdateExpression callback in this object. */,
    /** Implement the UpdateExpression callback in this object. */
    UpdateExpression(n, state, c) {
      writes.add(short(source.slice(n.argument.start, n.argument.end), 100));
      walk.base.UpdateExpression(n, state, c);
    } /** Implement the ReturnStatement callback in this object. */,
    /** Implement the ReturnStatement callback in this object. */
    ReturnStatement(n, state, c) {
      returns.add(
        n.argument
          ? short(source.slice(n.argument.start, n.argument.end))
          : "undefined",
      );
      walk.base.ReturnStatement(n, state, c);
    },
  };
  walk.recursive(node.body, null, visitors);
  if (node.body.type !== "BlockStatement")
    returns.add(short(source.slice(node.body.start, node.body.end)));
  return {
    calls: [...calls].sort(),
    writes: [...writes].sort(),
    returns: [...returns],
  };
}
/** Parse every function and attach its reviewed purpose plus mechanically derived facts. */
function analyze(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8"),
    comments = [],
    ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      onComment: comments,
    }),
    entries = [];
  walk.fullAncestor(ast, (node, ancestors) => {
    if (!isFunction(node)) return;
    const parent = ancestors.at(-2),
      name = functionName(node, parent),
      target =
        parent?.type === "ExportNamedDeclaration" ||
        parent?.type === "ExportDefaultDeclaration"
          ? parent
          : parent?.type === "VariableDeclarator"
            ? ancestors.at(-3)
            : parent?.type === "Property"
              ? parent
              : node;
    const preceding = comments
      .filter(
        (c) =>
          c.end <= target.start &&
          /^\s*$/.test(source.slice(c.end, target.start)),
      )
      .at(-1);
    const documented =
      preceding?.type === "Block" && preceding.value.startsWith("*")
        ? preceding.value
            .replace(/^\*\s*/, "")
            .split("\n")
            .map((l) => l.replace(/^\s*\*\s?/, ""))
            .join(" ")
            .trim()
        : null;
    const purpose =
      (name && purposes[name]) ||
      documented ||
      contextPurpose(node, parent, source, file);
    entries.push({
      file,
      line: node.loc.start.line,
      column: node.loc.start.column + 1,
      endLine: node.loc.end.line,
      name: name || "<anonymous callback>",
      async: !!node.async,
      parameters: node.params.map((p) => short(source.slice(p.start, p.end))),
      purpose,
      ...directFacts(node, source),
      start: target.start,
      hasDoc: !!documented,
      annotate: !!name,
    });
  });
  return {
    source,
    entries: entries.sort((a, b) => a.line - b.line || a.column - b.column),
  };
}
/** Add concise source comments once; generated catalogue regeneration never rewrites app code. */
function annotate() {
  for (const file of collectFiles()) {
    const { source, entries } = analyze(file),
      insertions = new Map();
    for (const e of entries)
      if (e.annotate && !e.hasDoc) {
        const list = insertions.get(e.start) || [];
        if (!list.includes(e.purpose)) list.push(e.purpose);
        insertions.set(e.start, list);
      }
    let updated = source;
    for (const [start, text] of [...insertions].sort((a, b) => b[0] - a[0]))
      updated =
        updated.slice(0, start) +
        "/** " +
        text.join(" ") +
        " */\n" +
        updated.slice(start);
    if (overviews[path.basename(file)] && !source.startsWith("/** @file"))
      updated =
        "/** @file " + overviews[path.basename(file)] + " */\n" + updated;
    fs.writeFileSync(path.join(root, file), updated);
  }
}
/** Build the complete, line-linked function reference and machine-readable coverage index. */
function buildCatalogue() {
  const entries = collectFiles()
    .flatMap((file) => analyze(file).entries)
    .map(({ start, hasDoc, annotate, ...entry }) => entry);
  let markdown =
    "# Function reference\n\nGenerated by `npm run docs`. Every first-party function and callback is listed, including tests and tooling. Vendored libraries are documented by their upstream projects; see THIRD_PARTY_NOTICES.md.\n\nHuman-written purpose descriptions explain named helpers. Calls, writes, parameters, and return expressions are derived directly from the source and exclude nested callbacks. A listed return expression is code, not a guarantee about its runtime type. “Writes” lists assignments and updates, not all effects inside called APIs. Read the linked function for full control flow.\n\n";
  for (const file of collectFiles()) {
    const functions = entries.filter((e) => e.file === file);
    markdown +=
      "## " +
      file +
      "\n\n" +
      (overviews[path.basename(file)] ||
        "First-party development or verification code.") +
      "\n\n";
    for (const e of functions) {
      markdown +=
        "### " +
        e.name +
        " — line " +
        e.line +
        "\n\n" +
        e.purpose +
        "\n\n- Source: [`" +
        e.file +
        ":" +
        e.line +
        "`](../" +
        e.file +
        "#L" +
        e.line +
        ")\n- Parameters: `" +
        (e.parameters.join(", ") || "(none)").replaceAll("`", "\u02cb") +
        "`; async: " +
        e.async +
        "\n";
      for (const [key, label] of [
        ["calls", "Direct calls"],
        ["writes", "Assigned/updated targets"],
        ["returns", "Return expressions"],
      ])
        markdown +=
          "- " +
          label +
          ": " +
          (e[key].length
            ? e[key]
                .map((x) => "`" + x.replaceAll("`", "\u02cb") + "`")
                .join(", ")
            : "(none)") +
          "\n";
      markdown += "\n";
    }
  }
  return { entries, markdown: markdown.trimEnd() + "\n" };
}
if (process.argv.includes("--annotate")) annotate();
else {
  const { entries, markdown } = buildCatalogue(),
    json =
      JSON.stringify(
        { functionCount: entries.length, functions: entries },
        null,
        2,
      ) + "\n",
    md = path.join(root, "docs/FUNCTIONS.md"),
    data = path.join(root, "docs/functions.json");
  if (process.argv.includes("--check")) {
    if (
      !fs.existsSync(md) ||
      fs.readFileSync(md, "utf8") !== markdown ||
      !fs.existsSync(data) ||
      fs.readFileSync(data, "utf8") !== json
    ) {
      console.error("Function reference is stale. Run npm run docs.");
      process.exitCode = 1;
    } else
      console.log(
        "Function coverage: " +
          entries.length +
          " documented functions/callbacks.",
      );
  } else {
    fs.mkdirSync(path.dirname(md), { recursive: true });
    fs.writeFileSync(md, markdown);
    fs.writeFileSync(data, json);
    console.log("Documented " + entries.length + " functions/callbacks.");
  }
}
