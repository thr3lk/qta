import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync, rmSync } from "fs";
import { extname, join } from "path";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};

const server = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const file = join("dist", p);
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] || "application/octet-stream",
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(5200, r));

const userDataDir = ".pw-profile";
rmSync(userDataDir, { recursive: true, force: true });

const ctx = await chromium.launchPersistentContext(userDataDir, {
  args: ["--headless=new"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR:", e));

const fail = async (msg) => {
  console.error("E2E FAIL:", msg);
  console.error(await page.textContent("body").catch(() => "(no body)"));
  await ctx.close();
  server.close();
  process.exit(1);
};

await page.goto("http://localhost:5200/", { waitUntil: "load" });

// 1. welcome state, import via file input (folder picker is manual-only)
await page.waitForSelector('[data-testid="welcome-import"]', { timeout: 120000 });
await page.click('[data-testid="welcome-import"]');
await page.waitForSelector('[data-testid="import-dialog"]');
await page.setInputFiles('[data-testid="vtt-file-input"]',
  "../sample-data/GMT20250115-140000_Recording.transcript.vtt");
await page.waitForSelector('[data-testid="vtt-file-row"]');
await page.click('[data-testid="vtt-file-row"] button.primary');
await page.waitForSelector('[data-testid="transcript-pane"]', { timeout: 60000 });

const segCount = await page.locator('[data-testid="segment"]').count();
console.log(`segments rendered: ${segCount}`);
if (segCount < 400) await fail(`expected ~502 segments, got ${segCount}`);
const body = await page.textContent("body");
if (!body.includes("Great, we're recording")) await fail("first cue text missing");
if (!body.includes("Marcus Webb")) await fail("speaker label missing");

// 2. create a highlight by selecting across two segments programmatically
await page.evaluate(() => {
  const segs = document.querySelectorAll('[data-testid="segment"]');
  const a = segs[0];
  const b = segs[2];
  const range = document.createRange();
  range.setStart(a.firstChild.firstChild, 0);
  const bNode = b.firstChild.firstChild;
  range.setEnd(bNode, 10);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.querySelector('[data-testid="transcript-pane"]')
    .dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 300, clientY: 300 }));
});
await page.waitForSelector('[data-testid="highlight-button"]', { timeout: 10000 });
await page.click('[data-testid="highlight-button"]');
await page.waitForSelector('[data-testid="tray-card"]', { timeout: 10000 });
console.log("highlight created");

// 3. edit: tag + note
await page.fill('[data-testid="tag-input"]', "follow-up");
await page.press('[data-testid="tag-input"]', "Enter");
await page.waitForSelector('.card .chip');
await page.fill('[data-testid="note-input"]', "check this claim");
await page.waitForTimeout(900);
console.log("tag + note added");

// 4. persistence: full browser restart
await ctx.close();
const ctx2 = await chromium.launchPersistentContext(userDataDir, {
  args: ["--headless=new"],
});
const page2 = await ctx2.newPage();
page2.on("pageerror", (e) => console.error("PAGE ERROR:", e));
const fail2 = async (msg) => {
  console.error("E2E FAIL:", msg);
  await ctx2.close();
  server.close();
  process.exit(1);
};
await page2.goto("http://localhost:5200/", { waitUntil: "load" });
await page2.waitForSelector('[data-testid="tray-card"]', { timeout: 120000 });
const body2 = await page2.textContent("body");
if (!body2.includes("follow-up")) await fail2("tag did not persist across restart");
if (!body2.includes("Great, we're recording")) await fail2("transcript did not reload");
// note lives in the expanded editor; select the card to open it
await page2.click('[data-testid="tray-card"]');
await page2.waitForSelector('[data-testid="note-input"]');
const noteValue = await page2.inputValue('[data-testid="note-input"]');
if (noteValue !== "check this claim") await fail2(`note did not persist (got "${noteValue}")`);
console.log("persistence across restart: ok");

// 5. speaker rename persists
const speakerBtn = page2.locator('[data-testid^="speaker-"]').first();
await speakerBtn.click();
await page2.fill('.speaker-label input', "Alex D.");
await page2.keyboard.press("Enter");
await page2.waitForTimeout(400);
const renamed = (await page2.textContent("body")).includes("Alex D.");
if (!renamed) await fail2("rename did not apply");
await ctx2.close();

// 6. rename + export persist after another restart; export CSV
const ctx3 = await chromium.launchPersistentContext(userDataDir, {
  args: ["--headless=new"],
});
const page3 = await ctx3.newPage();
page3.on("pageerror", (e) => console.error("PAGE ERROR:", e));
const fail3 = async (msg) => {
  console.error("E2E FAIL:", msg);
  await ctx3.close();
  server.close();
  process.exit(1);
};
await page3.goto("http://localhost:5200/", { waitUntil: "load" });
await page3.waitForSelector('[data-testid="transcript-pane"]', { timeout: 120000 });
if (!(await page3.textContent("body")).includes("Alex D.")) {
  await fail3("speaker rename did not persist");
}
const downloadPromise = page3.waitForEvent("download", { timeout: 60000 });
await page3.click('[data-testid="export-button"]');
const download = await downloadPromise;
const csvPath = await download.path();
const csv = readFileSync(csvPath, "utf8");
if (!csv.includes("highlight_text")) await fail3("csv missing header");
if (!csv.includes("follow-up")) await fail3("csv missing tag");
if (!csv.includes("qda://transcript/")) await fail3("csv missing highlight_uri");
console.log(`export ok: ${download.suggestedFilename()}, ${csv.split("\n").length - 1} data rows`);
await ctx3.close();

server.close();
console.log("E2E PASS");
