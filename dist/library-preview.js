/** @file Read-only SVG page previews. Thumbnails never alter note or recognition state. */
(function (root) {
  "use strict";
  const Ink =
      typeof module === "object" && module.exports
        ? require("./ink-engine.js")
        : root.LeafInk,
    Board =
      typeof module === "object" && module.exports
        ? require("./board-engine.js")
        : root.LeafBoardEngine;
  /** Fit brainstorming content while ordinary notes and PDFs retain their page coordinates. */
  function bounds(note, index = 0) {
    if (note.pdf) {
      const page = note.pdf.pages[index] || note.pdf.pages[0];
      return { x: 0, y: 0, width: page.width, height: page.height };
    }
    if (!note.board)
      return {
        x: 0,
        y: 0,
        width: 800,
        height:
          (index > 0 ? note.extraPages?.[index - 1] : note)?.height || 1050,
      };
    const points = [];
    for (const n of note.board.nodes)
      points.push([n.x, n.y], [n.x + n.width, n.y + n.height]);
    for (const stroke of note.strokes || [])
      for (const pt of stroke.points) points.push(pt);
    for (const t of note.texts || [])
      points.push(
        [t.x, t.y - t.size],
        [t.x + (t.width || 300), t.y + t.size * 2],
      );
    if (!points.length) return { x: 0, y: 0, width: 800, height: 1050 };
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const pt of points) {
      left = Math.min(left, pt[0]);
      top = Math.min(top, pt[1]);
      right = Math.max(right, pt[0]);
      bottom = Math.max(bottom, pt[1]);
    }
    return {
      x: Math.max(0, left - 60),
      y: Math.max(0, top - 60),
      width: Math.max(400, right - Math.max(0, left - 60) + 60),
      height: Math.max(300, bottom - Math.max(0, top - 60) + 60),
    };
  }
  /** Render paper, board connections, typed text, and pressure ink using safe DOM nodes. */
  function render(note, index = 0, doc = root.document) {
    const box = bounds(note, index),
      page = note.pdf
        ? note.pdf.pages[index] || note.pdf.pages[0]
        : (index > 0 ? note.extraPages?.[index - 1] : note) || note;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    /** Append an SVG element with fixed attribute names and optional safe text. */
    function add(tag, attrs = {}, text) {
      const el = doc.createElementNS(svg.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs))
        el.setAttribute(key, String(value));
      if (text !== undefined) el.textContent = text;
      svg.append(el);
      return el;
    }
    svg.setAttribute(
      "viewBox",
      [box.x, box.y, box.width, box.height].join(" "),
    );
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (!note.pdf)
      add("rect", {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        fill: "#fff",
      });
    const Paper =
      typeof module === "object" && module.exports
        ? require("./paper-engine.js")
        : root.LeafPaper;
    if (!note.board) {
      const rules = Paper.ruling(
        doc,
        page.paper || (!note.pdf ? note.paper : "plain"),
        box.width,
        box.height,
      );
      if (rules) svg.append(rules);
    }
    if (note.board) {
      const nodes = new Map(note.board.nodes.map((n) => [n.id, n]));
      for (const link of note.board.links) {
        const a = nodes.get(link.from),
          b = nodes.get(link.to);
        if (!a || !b) continue;
        const x1 = a.x + a.width / 2,
          y1 = a.y + a.height / 2,
          x2 = b.x + b.width / 2,
          y2 = b.y + b.height / 2;
        add("path", {
          d:
            "M" +
            x1 +
            " " +
            y1 +
            " C" +
            (x1 + x2) / 2 +
            " " +
            y1 +
            " " +
            (x1 + x2) / 2 +
            " " +
            y2 +
            " " +
            x2 +
            " " +
            y2,
          fill: "none",
          stroke: "#739067",
          "stroke-width": 3,
          "data-connection": "",
        });
      }
      for (const node of note.board.nodes) {
        add("rect", {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rx: 10,
          fill: node.color,
          stroke: "#9daf8d",
          "stroke-width": 1.5,
        });
        Board.textLines(node).forEach((line, i) =>
          add(
            "text",
            {
              x: node.x + 14,
              y:
                node.y +
                (node.size || 18) +
                12 +
                i * (node.size || 18) * (node.lineHeight || 1.5),
              "font-size": node.size || 18,
              "font-family": "monospace",
              fill: node.textColor || "#293e2d",
              "xml:space": "preserve",
            },
            line,
          ),
        );
      }
    }
    for (const stroke of page.strokes || [])
      add("path", {
        d: Ink.outline(stroke),
        fill: stroke.color,
        "fill-opacity": stroke.opacity,
        "data-ink": "",
      });
    for (const text of page.texts || [])
      String(text.text)
        .split("\n")
        .forEach((line, i) => {
          const el = add(
            "text",
            {
              x: text.x,
              y: text.y + i * text.size * (text.lineHeight || 1.5),
              "font-size": text.size,
              "font-family": "monospace",
              fill: text.color,
              "xml:space": "preserve",
            },
            line,
          );
          el.style.whiteSpace = "pre";
        });
    return svg;
  }
  const api = { bounds, render };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LeafPreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
