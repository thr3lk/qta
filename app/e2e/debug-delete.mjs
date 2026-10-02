import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync, rmSync, mkdtempSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { tmpdir } from "os";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const file = join("dist", p);
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(5200, r));

const sampleRate = 8000, seconds = 70;
const data = Buffer.alloc(sampleRate * seconds * 2);
const b = Buffer.alloc(44);
b.write("RIFF", 0); b.writeUInt32LE(36 + data.length, 4); b.write("WAVE", 8);
b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(data.length, 40);
const wavPath = join(tmpdir(), "qta-e2e", "GMT20250115-140000_Recording.wav");
writeFileSync(wavPath, Buffer.concat([b, data]));

const userDataDir = ".pw-debug";
rmSync(userDataDir, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(userDataDir, { args: ["--headless=new"] });
let page = await ctx.newPage();
page.on("console", (m) => console.log("[pg]", m.text().slice(0, 160)));
page.on("pageerror", (e) => console.log("[err]", String(e).slice(0, 200)));

await page.goto("http://localhost:5200/", { waitUntil: "load" });
await page.waitForSelector('[data-testid="welcome-import"]', { timeout: 120000 });
await page.click('[data-testid="welcome-import"]');
await page.setInputFiles('[data-testid="vtt-file-input"]',
  ["../sample-data/GMT20250115-140000_Recording.transcript.vtt", wavPath]);
await page.click('[data-testid="vtt-file-row"] button.primary');
await page.waitForSelector('[data-testid="transcript-pane"]', { timeout: 60000 });

await page.evaluate(() => {
  const segs = document.querySelectorAll('[data-testid="segment"]');
  const range = document.createRange();
  range.setStart(segs[0].firstChild.firstChild, 0);
  range.setEnd(segs[2].firstChild.firstChild, 10);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.querySelector('[data-testid="transcript-pane"]')
    .dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 300, clientY: 300 }));
});
await page.click('[data-testid="highlight-button"]');
await page.waitForSelector('[data-testid="tray-card"]');

// exercise the same pre-delete sequence as the failing e2e: export CSV
await page.click('[data-testid="tab-library"]');
await page.waitForSelector('[data-testid="library-row"]');
await page.click('[data-testid="export-button"]');
await page.waitForFunction(() => document.querySelector('[data-testid="export-status"]')?.textContent === "Exported", { timeout: 30000 }).catch(() => {});
// restart into a third session exactly like the failing e2e
await ctx.close();
const ctx3 = await chromium.launchPersistentContext(userDataDir, { args: ["--headless=new"] });
const page3 = await ctx3.newPage();
page3.on("console", (m) => console.log("[pg3]", m.text().slice(0, 160)));
page3.on("pageerror", (e) => console.log("[err3]", String(e).slice(0, 200)));
page = page3;
await page3.goto("http://localhost:5200/", { waitUntil: "load" });
await page3.waitForSelector('[data-testid="transcript-pane"]', { timeout: 120000 });
await page3.click('[data-testid="export-button"]');
await page3.waitForFunction(() => document.querySelector('[data-testid="export-status"]')?.textContent === "Exported", { timeout: 30000 }).catch(() => {});
await page3.click('[data-testid="tab-library"]');
await page3.waitForSelector('[data-testid="library-row"]');

console.log("--- app state primed; probing deletes ---");

const probe = async (label, fn) => {
  const r = await Promise.race([
    fn().then((v) => `OK ${JSON.stringify(v).slice(0, 80)}`),
    new Promise((res) => setTimeout(() => res("TIMEOUT"), 8000)),
  ]);
  console.log(`[${label}] ${r}`);
};

await page.evaluate(async () => {
  const dbg = window.__qtaDebug;
  const race = (p) => Promise.race([p.then(() => "done"), new Promise((r) => setTimeout(() => r("TIMEOUT"), 8000))]);
  const tid = document.querySelector('[data-testid="library-row"]') ? null : null;
  window.__results = [];
  window.__results.push(await race(dbg.query("SELECT count(*) AS n FROM annotation_tag")));
  window.__results.push(await race(dbg.query("DELETE FROM tag WHERE name = 'zzz-nonexistent'")));
  window.__results.push(await race(dbg.query("SELECT count(*) AS n FROM transcript")));
  window.__results.push(await race(dbg.query("DELETE FROM annotation_tag WHERE tag_id = '00000000-0000-0000-0000-000000000000'")));
  const idRow = await dbg.query("SELECT CAST(annotation_id AS VARCHAR) AS id FROM annotation LIMIT 1");
  const aid = idRow.length ? idRow[0].id : null;
  if (aid) {
    window.__results.push("aid=" + aid);
    window.__results.push(await race(dbg.query(`DELETE FROM annotation_tag WHERE annotation_id = '${aid}'`)));
  }
});
const results = await page.evaluate(() => window.__results);
results.forEach((r) => console.log("[probe]", r));

console.log("--- fresh connection probe ---");
await page.evaluate(async () => {
  const dbg = window.__qtaDebug;
  const race = (p) => Promise.race([p.then(() => "done"), new Promise((r) => setTimeout(() => r("TIMEOUT"), 8000))]);
  window.__results2 = [];
  const conn2 = await dbg.newConnection();
  window.__results2.push(await race(conn2.query("SELECT count(*) AS n FROM annotation_tag").then((t) => t.toArray().length)));
  window.__results2.push(await race(conn2.query("DELETE FROM annotation_tag WHERE tag_id = '00000000-0000-0000-0000-000000000000'")));
});
console.log(JSON.stringify(await page.evaluate(() => window.__results2)));

console.log("--- fresh worker probe ---");
await page.evaluate(async () => {
  const dbg = window.__qtaDebug;
  const race = (p) => Promise.race([p.then(() => "done"), new Promise((r) => setTimeout(() => r("TIMEOUT"), 8000))]);
  window.__results3 = [];
  const conn3 = await dbg.reopen();
  window.__results3.push(await race(conn3.query("SELECT count(*) AS n FROM annotation_tag").then((t) => t.toArray().length)));
  window.__results3.push(await race(conn3.query("DELETE FROM annotation_tag WHERE tag_id = '00000000-0000-0000-0000-000000000000'")));
});
console.log(JSON.stringify(await page.evaluate(() => window.__results3)));

await ctx.close();
server.close();
