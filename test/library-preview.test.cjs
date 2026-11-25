const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { JSDOM } = require("jsdom"),
  Preview = require("../dist/library-preview.js");
/** Create a representative page without touching browser or server storage. */
function note() {
  return {
    paper: "plain",
    strokes: [
      {
        color: "#264c3d",
        width: 3,
        opacity: 0.68,
        brush: "pencil",
        grade: "HB",
        points: [
          [20, 30, 0.2],
          [80, 60, 0.8],
        ],
      },
    ],
    texts: [
      {
        x: 40,
        y: 100,
        width: 400,
        size: 24,
        lineHeight: 2,
        color: "#cc3355",
        text: "typed <script>alert(1)</script>\n  spaced text",
      },
    ],
  };
}
test("page previews retain ink, color and exact safe text without mutating a note", () => {
  const dom = new JSDOM(""),
    n = note(),
    before = JSON.stringify(n),
    svg = Preview.render(n, 0, dom.window.document);
  assert.equal(
    svg.querySelector("[data-ink]").getAttribute("fill-opacity"),
    "0.68",
  );
  assert.equal(svg.querySelectorAll("text")[1].textContent, "  spaced text");
  assert.equal(svg.querySelector("text").getAttribute("fill"), "#cc3355");
  assert.equal(svg.querySelector("script"), null);
  assert.equal(JSON.stringify(n), before);
  assert.equal(svg.getAttribute("viewBox"), "0 0 800 1050");
  dom.window.close();
});
test("board thumbnails fit distant ideas and retain cards, lettering and connections", () => {
  const dom = new JSDOM(""),
    n = note();
  n.board = {
    width: 10000,
    height: 10000,
    nodes: [
      {
        id: "a",
        x: 4000,
        y: 6000,
        width: 260,
        height: 120,
        text: "Idea A",
        color: "#f3f7ed",
        textColor: "#293e2d",
        size: 18,
      },
      {
        id: "b",
        x: 4500,
        y: 6300,
        width: 260,
        height: 120,
        text: "Idea B",
        color: "#f3f7ed",
        textColor: "#293e2d",
        size: 18,
      },
    ],
    links: [{ from: "a", to: "b" }],
  };
  const before = JSON.stringify(n),
    svg = Preview.render(n, 0, dom.window.document);
  assert.ok(svg.querySelector("[data-connection]"));
  assert.match(svg.textContent, /Idea A/);
  assert.match(svg.textContent, /Idea B/);
  const b = Preview.bounds(n);
  assert.ok(b.x + b.width >= 4760 && b.y + b.height >= 6420);
  assert.equal(JSON.stringify(n), before);
  dom.window.close();
});
test("PDF preview overlays use the selected page dimensions and stay transparent over the PDF", () => {
  const dom = new JSDOM(""),
    n = note();
  n.pdf = {
    pages: [
      { width: 400, height: 600, strokes: [], texts: [] },
      { width: 600, height: 400, strokes: n.strokes, texts: n.texts },
    ],
  };
  const svg = Preview.render(n, 1, dom.window.document);
  assert.equal(svg.getAttribute("viewBox"), "0 0 600 400");
  assert.equal(svg.querySelector("rect"), null);
  assert.ok(svg.querySelector("[data-ink]"));
  dom.window.close();
});
