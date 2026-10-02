import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync, rmSync } from "fs";
import { extname, join } from "path";
import { tmpdir } from "os";
import { mkdirSync, writeFileSync } from "fs";

// 2s of 8 kHz mono 16-bit silence; WAV plays in any browser engine
function makeWav(path) {
  const sampleRate = 8000, seconds = 70;
  const data = Buffer.alloc(sampleRate * seconds * 2);
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data.length, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([b, data]));
}
const wavPath = join(tmpdir(), "qta-e2e", "GMT20250115-140000_Recording.wav");
mkdirSync(join(tmpdir(), "qta-e2e"), { recursive: true });
makeWav(wavPath);

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
  ["../sample-data/GMT20250115-140000_Recording.transcript.vtt", wavPath]);
await page.waitForSelector('[data-testid="vtt-file-row"]');
const rowText = await page.textContent('[data-testid="vtt-file-row"]');
if (!rowText.includes("GMT20250115-140000_Recording.wav")) {
  await fail("media was not paired with the transcript");
}
await page.click('[data-testid="vtt-file-row"] button.primary');
await page.waitForSelector('[data-testid="transcript-pane"]', { timeout: 60000 });
await page.waitForSelector('[data-testid="media-bar"]', { timeout: 60000 });
console.log("media paired and bar visible");

// expand player, click a segment, expect seek + play
await page.click('[data-testid="media-expand"]');
await page.waitForSelector('audio, video', { state: 'attached' });
await page.waitForTimeout(300);
const before = await page.evaluate(() => document.querySelector('audio, video').currentTime);
await page.locator('[data-testid="segment"]').nth(5).click();
await page.waitForTimeout(700);
const after = await page.evaluate(() => document.querySelector('audio, video').currentTime);
console.log(`media time before/after segment click: ${before.toFixed(2)} -> ${after.toFixed(2)}`);
if (Math.abs(after - 40.1) > 2) await fail(`expected seek to ~40.1s (segment 6 start), got ${after}`);
// media toggle hides the bar entirely
await page.click('[data-testid="media-toggle"]');
if (await page.locator('[data-testid="media-bar"]').count() !== 0) await fail("media toggle did not hide bar");
await page.click('[data-testid="media-toggle"]');
if (await page.locator('[data-testid="media-bar"]').count() !== 1) await fail("media toggle did not restore bar");
console.log("media toggle ok");

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

// 3b. playback-mode control: second short highlight (segment 1, 10.36s-11.16s)
await page.evaluate(() => {
  const segs = document.querySelectorAll('[data-testid="segment"]');
  const node = segs[1].firstChild.firstChild;
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, node.length);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.querySelector('[data-testid="transcript-pane"]')
    .dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 300, clientY: 300 }));
});
await page.waitForSelector('[data-testid="highlight-button"]', { timeout: 10000 });
await page.click('[data-testid="highlight-button"]');
await page.waitForFunction(
  () => document.querySelectorAll('[data-testid="tray-card"]').length === 2,
  { timeout: 10000 },
);
console.log("second highlight created");

const mediaState = () =>
  page.evaluate(() => {
    const el = document.querySelector("audio, video");
    return { t: el.currentTime, paused: el.paused };
  });
// segment 1 spans 10.36s-11.16s in the sample data
const card2 = page.locator('[data-testid="tray-card"]').nth(1);

// default "play from selection": jumps and plays
await card2.click();
await page.waitForTimeout(900);
let m = await mediaState();
if (m.paused) await fail("play-from mode did not start playback");
if (Math.abs(m.t - 10.36) > 3) await fail(`play-from expected ~10.36s, got ${m.t}`);
// "go to selection": jumps without playing
await page.selectOption('[data-testid="playback-mode"]', "go-to");
await card2.click();
await page.waitForTimeout(900);
m = await mediaState();
if (!m.paused) await fail("go-to mode should not autoplay");
if (Math.abs(m.t - 10.36) > 3) await fail(`go-to expected ~10.36s, got ${m.t}`);
// "play only selection": plays, then stops at the highlight end
await page.selectOption('[data-testid="playback-mode"]', "play-only");
await card2.click();
await page.waitForTimeout(400);
m = await mediaState();
if (m.paused) await fail("play-only mode did not start playback");
const stopped = await page
  .waitForFunction(
    () => {
      const el = document.querySelector("audio, video");
      return el && el.paused && el.currentTime >= 10.0;
    },
    { timeout: 15000 },
  )
  .then(() => true)
  .catch(() => false);
if (!stopped) await fail("play-only mode did not stop at the highlight end");
m = await mediaState();
if (m.t > 20) await fail(`play-only stopped too late at ${m.t}s`);
console.log("playback modes ok");
// transcript clicks honor the mode too: segment 0 is covered only by the
// first highlight (starts 2.17s); go-to must seek there without playing
await page.selectOption('[data-testid="playback-mode"]', "go-to");
await page.locator('[data-testid="segment"]').nth(0).click();
await page.waitForTimeout(900);
m = await mediaState();
if (!m.paused) await fail("transcript click in go-to mode should not autoplay");
if (Math.abs(m.t - 2.17) > 2) await fail(`transcript go-to expected ~2.17s, got ${m.t}`);
console.log("transcript click mode ok");
// plain (unhighlighted) segment click also honors the mode: segment 4
// spans 31.39s-39.94s; go-to must seek there without playing
await page.locator('[data-testid="segment"]').nth(4).click();
await page.waitForTimeout(900);
m = await mediaState();
if (!m.paused) await fail("plain segment click in go-to mode should not autoplay");
if (Math.abs(m.t - 31.39) > 2) await fail(`plain segment go-to expected ~31.39s, got ${m.t}`);
console.log("plain segment click mode ok");

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
// media name persisted but the file handle did not; expect the attach affordance
await page2.waitForSelector('[data-testid="media-attach"]', { timeout: 60000 });
await page2.setInputFiles('[data-testid="media-file-input"]', wavPath);
await page2.waitForSelector('[data-testid="media-bar"] [data-testid="media-expand"]', { timeout: 60000 });
await page2.click('[data-testid="media-expand"]');
await page2.waitForSelector('audio, video', { state: 'attached' });
await page2.locator('[data-testid="segment"]').nth(3).click();
await page2.waitForTimeout(700);
const seeked = await page2.evaluate(() => document.querySelector('audio, video').currentTime);
if (Math.abs(seeked - 21.65) > 2) await fail2(`re-attached media did not seek to ~21.65s, got ${seeked}`);
console.log("media re-attach + seek after restart: ok");
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
page3.on("console", (m) => {
  if (["warning", "error"].includes(m.type()))
    console.log("[console]", m.type(), m.text().slice(0, 200));
});
page3.on("dialog", (d) => {
  console.log("[dialog]", d.type(), d.message().slice(0, 80));
  void d.accept();
});
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

// 7. library view: counts visible, delete removes the recording
await page3.click('[data-testid="tab-library"]');
await page3.waitForSelector('[data-testid="library-row"]', { timeout: 60000 });
await page3.waitForFunction(
  () => document.querySelector('[data-testid="library-counts"]')?.textContent.includes("2 highlights"),
  { timeout: 15000 },
);
const counts = await page3.textContent('[data-testid="library-counts"]');
if (!counts.includes("1 notes")) {
  await fail3(`library counts wrong: "${counts}"`);
}
await page3.click('[data-testid="library-delete"]');
await page3.waitForSelector('[data-testid="welcome-import"]', { timeout: 60000 });
const postDelete = await page3.textContent("body");
if (postDelete.includes("GMT20250115")) {
  const m = postDelete.match(/.{0,120}GMT20250115.{0,120}/s);
  console.error("STALE CONTEXT:", m && m[0]);
  await fail3("recording still listed after delete");
}
console.log("library view + delete: ok");
await ctx3.close();

server.close();
console.log("E2E PASS");
