/** @file Shared read-only paper ruling for PDF overlays, thumbnails and exports. */
(function (root) {
  let sequence = 0;
  /** Build transparent SVG paper guides in page coordinates. */
  function ruling(doc, type, width, height) {
    if (!["lined", "grid", "dots"].includes(type)) return null;
    const ns = "http://www.w3.org/2000/svg",
      group = doc.createElementNS(ns, "g"),
      id = "leaf-paper-" + ++sequence;
    group.setAttribute("data-paper", type);
    /** Evaluate an inline callback in dist/paper-engine.js; its direct operations are listed below. */
    function node(tag, attrs) {
      const n = doc.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      return n;
    }
    const defs = node("defs", {}),
      pattern = node("pattern", {
        id,
        width: 32,
        height: 32,
        patternUnits: "userSpaceOnUse",
      });
    pattern.append(
      type === "dots"
        ? node("circle", { cx: 16, cy: 16, r: 1.2, fill: "#cbd6c7" })
        : node("path", {
            d: type === "grid" ? "M32 0 H0 V32" : "M0 31.5 H32",
            stroke: "#d9e2d4",
            "stroke-width": 1,
            fill: "none",
          }),
    );
    defs.append(pattern);
    group.append(
      defs,
      node("rect", { x: 0, y: 0, width, height, fill: "url(#" + id + ")" }),
    );
    return group;
  }
  const api = { ruling };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LeafPaper = api;
})(globalThis);
