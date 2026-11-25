/** @file Pure validation, text wrapping, and hit testing for brainstorm boards. */
(function (root) {
  "use strict";
  /** Clamp a numeric board property, or substitute its default. */
  const size = (v, d, min, max) =>
    Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d;
  /** Validate board nodes and connectors and discard invalid references. */
  function valid(b) {
    if (!b) return undefined;
    const nodes = (Array.isArray(b.nodes) ? b.nodes : [])
      .slice(0, 3000)
      .map((n) => ({
        id: String(n.id),
        x: size(n.x, 0, 0, 100000),
        y: size(n.y, 0, 0, 100000),
        width: size(n.width, 260, 120, 1000),
        height: size(n.height, 120, 60, 3000),
        text: String(n.text || "").slice(0, 20000),
        size: size(n.size, 18, 8, 72),
        lineHeight: [1, 1.5, 2].includes(n.lineHeight) ? n.lineHeight : 1.5,
        color: /^#[a-f0-9]{6}$/i.test(n.color) ? n.color : "#f3f7ed",
        textColor: /^#[a-f0-9]{6}$/i.test(n.textColor)
          ? n.textColor
          : "#293e2d",
      }));
    if (new Set(nodes.map((n) => n.id)).size !== nodes.length)
      throw Error("Duplicate idea cards");
    return {
      width: size(b.width, 3200, 800, 100000),
      height: size(b.height, 2400, 1050, 100000),
      nodes,
      links: (Array.isArray(b.links) ? b.links : [])
        .filter(
          (l) =>
            l.from !== l.to &&
            nodes.some((n) => n.id === l.from) &&
            nodes.some((n) => n.id === l.to),
        )
        .slice(0, 10000)
        .map((l) => ({ from: String(l.from), to: String(l.to) })),
    };
  }
  /** Split and wrap stored text into display lines using the container’s width and font size. */
  function textLines(node) {
    const limit = Math.max(
        1,
        Math.floor((node.width - 28) / ((node.size || 18) * 0.6)),
      ),
      lines = [];
    for (const line of node.text.split("\n")) {
      if (!line) {
        lines.push("");
        continue;
      }
      for (let i = 0; i < line.length; i += limit)
        lines.push(line.slice(i, i + limit));
    }
    return lines;
  }
  /** Find the topmost idea card containing a board coordinate. */
  function hit(board, p) {
    return [...board.nodes]
      .reverse()
      .find(
        (n) =>
          p[0] >= n.x &&
          p[0] <= n.x + n.width &&
          p[1] >= n.y &&
          p[1] <= n.y + n.height,
      );
  }
  const api = { valid, textLines, hit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LeafBoardEngine = api;
})(globalThis);
