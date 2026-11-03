// End-to-end test: runs the real app + worker locally with a fake Gemini, on an emulated Android phone.
// Run: node tests/e2e/run.mjs   (needs: npm i -D playwright && npx playwright install chromium)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { default: worker } = await import(path.join(root, "src/worker.js"));

// ---------- fake Gemini ----------
const CORRECTIONS = {
  "my name ali i from pakistan": ["My name is Ali and I am from Pakistan.", "اپنا نام بتانے کے لیے 'My name is' استعمال کریں۔"],
  "i am working here since two years": ["I have been working here for two years.", "مدت کے لیے 'for' استعمال کریں۔"],
  "i like read books": ["I like reading books.", "'like' کے بعد -ing لگائیں۔"],
};
let aiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes("generativelanguage")) return realFetch(url, opts);
  aiCalls++;
  const body = JSON.parse(opts.body);
  const sys = body.systemInstruction.parts[0].text;
  const lastUser = body.contents[body.contents.length - 1].parts[0].text.split("\n").pop().toLowerCase();
  let out;
  if (/^Translate/.test(sys)) out = { translation: "آپ کا نام کیا ہے؟" };
  else if (/reviewing a practice/.test(sys)) out = { takeaway: "Present perfect for duration", explanation: "مدت کے لیے have been + for", grammar: 66, fluency: 72, vocabulary: 60, praise: "Great effort!" };
  else if (/daily English practice pack/.test(sys))
    out = {
      challenge: { title: "My favourite food", task: "Tell me about your favourite food and why you like it.", example: "My favourite food is biryani." },
      words: ["delicious", "spicy", "recipe", "breakfast", "healthy"].map((w) => ({ word: w, meaning: "meaning of " + w, example: "This is " + w + ".", translation: "ترجمہ" })),
      quiz: [
        { q: "I ___ tea every morning.", options: ["drink", "drinks", "drinking", "drunk"], answer: 0, explain: "I کے ساتھ drink" },
        { q: "She ___ in Riyadh.", options: ["live", "lives", "living", "lived to"], answer: 1, explain: "She کے ساتھ -s" },
        { q: "This food is very ___.", options: ["spicy", "spice", "spicing", "spiced up"], answer: 0, explain: "adjective" },
      ],
    };
  else {
    const fix = CORRECTIONS[lastUser];
    out = { reply: "That's great! Tell me more.", correction: fix ? fix[0] : "", tip: fix ? fix[1] : "", hints: ["I like it.", "It is good."] };
  }
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
};

// ---------- local server (same as Cloudflare: worker + static assets) ----------
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const ASSETS = {
  fetch: async (req) => {
    let p = new URL(req.url).pathname;
    if (p === "/") p = "/index.html";
    const f = path.join(root, "public", path.normalize(p));
    if (!f.startsWith(path.join(root, "public")) || !fs.existsSync(f)) return new Response("not found", { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { "content-type": types[path.extname(f)] || "text/plain" } });
  },
};
const PORT = 8790;
const server = http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await worker.fetch(r, { GEMINI_API_KEY: "test-key", ASSETS });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  })
  .listen(PORT);

// ---------- browser (Android phone) ----------
const shots = process.env.SHOTS_DIR;
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"] });
// Fake speech recognition: "hears" whatever window.__say contains.
await context.addInitScript(() => {
  class FakeSR {
    start() {
      setTimeout(() => this.onstart && this.onstart(), 10);
      setTimeout(() => {
        const r = [{ transcript: window.__say || "" }];
        r.isFinal = true;
        this.onresult && this.onresult({ results: [r] });
        this.onend && this.onend();
      }, 60);
    }
    stop() {}
    abort() {}
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/fonts\.g|TUNNEL|ERR_/.test(m.text()) && errors.push(m.text()));
const shot = async (name) => shots && (await page.waitForTimeout(500), await page.screenshot({ path: path.join(shots, name + ".png") }));
const step = (name) => console.log("✓", name);

try {
  await page.goto(`http://localhost:${PORT}/`);

  // 1. Welcome & setup
  await page.click("#welcomeNext");
  await page.fill("#nameInput", "Muhammad");
  await page.selectOption("#langInput", "ur");
  await page.click("#levelPick button[data-level=beginner]");
  await page.click("#welcome2 button[type=submit]");
  await page.waitForSelector("#homeView:not(.hidden)");
  assert.equal(await page.textContent("#profileName"), "Muhammad");
  await shot("01-home");
  step("welcome setup → home");

  // 2. Lesson chat with correction highlights
  await page.click("#nextCard");
  await page.waitForSelector(".msg.coach");
  const send = async (text) => {
    const before = await page.locator(".msg.coach").count();
    await page.fill("#input", text);
    await page.click("#sendBtn");
    await page.waitForFunction((n) => document.querySelectorAll(".msg.coach").length > n, before);
  };
  await send("my name ali i from pakistan");
  await page.waitForSelector(".fix mark.good");
  assert.ok((await page.locator(".msg.me mark.miss").count()) > 0, "missing words marked in learner message");
  step("grammar correction with red/green highlights");

  // 3. Translate a tutor message
  await page.locator(".msg.coach").first().locator("text=Translate").click();
  await page.waitForSelector(".msg.coach .tr");
  step("translate to Urdu");

  // 4. Feedback sheet
  await page.locator(".msg.me.has-fix").first().click();
  await page.waitForSelector("#sheet:not(.hidden)");
  assert.match(await page.textContent("#sheetFix"), /My name is Ali/);
  await shot("02-feedback");
  await page.click("#sheetClose");
  await page.waitForSelector("#sheet.hidden", { state: "attached" });
  step("feedback sheet");

  // 5. Finish the lesson (6 learner messages) → scores + takeaway
  for (const t of ["i am working here since two years", "i like read books", "yes", "i work every day", "thank you"]) await send(t);
  await page.waitForSelector(".done-card .done-scores");
  await shot("03-lesson-complete");
  step("lesson complete with skill scores");

  // 6. Mic button fills the input (fake recognition)
  await page.evaluate(() => (window.__say = "i like cricket"));
  await page.click("#micBtn");
  await page.waitForFunction(() => document.querySelector("#input").value.includes("cricket"));
  step("voice input");

  // 7. Practice hub: daily pack
  await page.click("#backBtn");
  await page.click(".tab[data-view=practice]");
  await page.waitForSelector("#chBody h3");
  await page.waitForSelector(".flash .learn");
  await page.locator(".flash .learn").first().click();
  assert.match(await page.textContent(".flash .learn"), /Learned/);
  await shot("04-practice");
  step("daily challenge + words");

  // 8. Daily quiz
  await page.click("#quizBtn");
  await page.waitForSelector(".opt");
  for (let i = 0; i < 3; i++) {
    await page.locator(".opt").first().click();
    await page.waitForSelector(".explain");
    await page.click(".act-next");
  }
  await page.waitForSelector(".result .score-ring");
  await shot("05-quiz-result");
  await page.click("#actBody > .primary-btn");
  await page.waitForSelector("#practiceView:not(.hidden)");
  step("daily quiz");

  // 9. Mistakes quiz (from real corrections)
  await page.click("#mistakeQuizBtn");
  await page.waitForSelector(".opt");
  assert.equal(await page.locator(".opt").count(), 2);
  await page.locator(".opt").first().click();
  await page.waitForSelector(".explain");
  await page.click("#actBack");
  await page.waitForSelector("#practiceView:not(.hidden)");
  step("mistakes quiz");

  // 10. Pronunciation practice
  await page.click("#pronBtn");
  await page.waitForSelector(".pron-text");
  const target = await page.textContent(".pron-text");
  await page.evaluate((t) => (window.__say = t), target);
  await page.click('.pron-btns [data-a="mic"]');
  await page.waitForSelector(".pron-score.ok");
  assert.match(await page.textContent(".pron-score"), /100%/);
  await shot("06-pronunciation");
  await page.click("#actBack");
  step("pronunciation scoring");

  // 11. Job interview
  await page.click("#jobBtn");
  await page.waitForSelector("#jobSheet:not(.hidden) .job-grid button");
  await page.locator("#jobGrid button").first().click();
  await page.waitForSelector("#chatView:not(.hidden) .msg.coach");
  assert.match(await page.textContent("#chatTopic"), /Interview/);
  await page.click("#backBtn");
  step("job interview practice");

  // 12. Progress & recommendations, and data survives a reload
  await page.click(".tab[data-view=progress]");
  await page.waitForSelector(".skill .track");
  await shot("07-progress");
  await page.reload();
  await page.waitForSelector("#homeView:not(.hidden)");
  assert.ok(Number(await page.textContent("#tGems")) > 10, "gems saved after reload");
  assert.ok((await page.locator(".rec").count()) > 0, "recommendations shown");
  step("progress, recommendations, saved after reload");

  // 13. Settings
  await page.click(".tab[data-view=settings]");
  await page.selectOption("#helperLang", "ar");
  await page.reload();
  await page.click(".tab[data-view=settings]");
  assert.equal(await page.inputValue("#helperLang"), "ar");
  step("settings saved");

  // 14. Layout: nothing wider than the phone screen
  for (const v of ["home", "practice", "progress", "settings"]) {
    await page.click(`.tab[data-view=${v}]`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${v} fits the screen (overflow ${overflow}px)`);
  }
  step("no horizontal overflow on Android screen");

  assert.deepEqual(errors, [], "no JavaScript errors");
  console.log(`\nAll e2e checks passed (${aiCalls} fake AI calls).`);
} catch (err) {
  console.error("E2E FAILED:", err.message, "\nPage errors:", errors);
  if (shots) await page.screenshot({ path: path.join(shots, "failure.png") });
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
