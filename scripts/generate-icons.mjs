import fs from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
/** Draw the first-party notebook/pencil mark without external fonts or images. */
function drawIcon(size) {
  const canvas = createCanvas(size, size),
    ctx = canvas.getContext("2d");
  ctx.scale(size / 512, size / 512);
  ctx.fillStyle = "#264c3d";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(135, 120, 210, 275, 18);
  ctx.fill();
  ctx.strokeStyle = "#c4d8c4";
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  for (const y of [180, 225, 270, 315]) {
    ctx.beginPath();
    ctx.moveTo(175, y);
    ctx.lineTo(290, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#e9bb64";
  ctx.lineWidth = 29;
  ctx.beginPath();
  ctx.moveTo(290, 345);
  ctx.lineTo(377, 164);
  ctx.stroke();
  ctx.fillStyle = "#e9bb64";
  ctx.beginPath();
  ctx.moveTo(277, 357);
  ctx.lineTo(278, 386);
  ctx.lineTo(302, 369);
  ctx.closePath();
  ctx.fill();
  return canvas.toBuffer("image/png");
}
const directory = new URL("../dist/icons/", import.meta.url);
await fs.mkdir(directory, { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
])
  await fs.writeFile(new URL(name, directory), drawIcon(size));
