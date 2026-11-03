import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { buildContents, buildSystemPrompt, parseGemini, validateInput, validateDaily, originAllowed, memoryLimit } from "../src/worker.js";

const assets = { fetch: async () => new Response("asset") };
let ipCounter = 0;
// A same-origin JSON POST, like the app sends. Each test uses a fresh IP so rate limits don't interfere.
function apiReq(body, extraHeaders = {}) {
  return new Request("https://x.dev/api/chat", {
    method: "POST",
    headers: { origin: "https://x.dev", "content-type": "application/json", "cf-connecting-ip": "10.0.0." + ipCounter++, ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("conversation always starts and ends with a learner turn", () => {
  const c = buildContents([]);
  assert.equal(c[0].role, "user");
  const c2 = buildContents([{ role: "coach", text: "Hi! What's your name?" }]);
  assert.deepEqual(c2.map((x) => x.role), ["user", "model", "user"]);
  const c3 = buildContents([
    { role: "coach", text: "Hi" },
    { role: "me", text: "hello" },
    { role: "me", text: "my name Ali" },
  ]);
  assert.deepEqual(c3.map((x) => x.role), ["user", "model", "user"]);
  assert.match(c3[2].parts[0].text, /hello\nmy name Ali/);
});

test("system prompt uses level and helper language", () => {
  const p = buildSystemPrompt({ level: "advanced", topic: "Debate", helperLang: "ur" });
  assert.match(p, /ADVANCED/);
  assert.match(p, /Urdu/);
});

test("parses Gemini JSON reply", () => {
  const r = parseGemini({ candidates: [{ content: { parts: [{ text: '{"reply":"Nice!","correction":"My name is Ali.","tip":"Use is.","hints":["I am from Lahore.","I live in Jubail."]}' }] } }] });
  assert.deepEqual(r, { reply: "Nice!", correction: "My name is Ali.", tip: "Use is.", hints: ["I am from Lahore.", "I live in Jubail."] });
  assert.equal(parseGemini({ candidates: [] }), null);
});

test("chat endpoint calls Gemini and returns reply", async () => {
  const realFetch = globalThis.fetch;
  let called;
  globalThis.fetch = async (url, opts) => {
    called = { url, body: JSON.parse(opts.body), key: opts.headers["x-goog-api-key"] };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"Hello!","correction":"","tip":""}' }] } }] }));
  };
  try {
    const req = apiReq({ level: "beginner", topic: "Intro", history: [] });
    const res = await worker.fetch(req, { GEMINI_API_KEY: "k", ASSETS: assets });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).reply, "Hello!");
    assert.equal(called.key, "k");
    assert.match(called.url, /gemini-3\.5-flash-lite:generateContent/);
    assert.equal(called.body.generationConfig.responseMimeType, "application/json");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("falls back to next model when first is not found", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (urls.length === 1) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"Hi","correction":"","tip":""}' }] } }] }));
  };
  try {
    const req = apiReq({});
    const res = await worker.fetch(req, { GEMINI_API_KEY: "k", ASSETS: assets });
    assert.equal(res.status, 200);
    assert.match(urls[1], /gemini-3\.8-flash/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("missing key gives a friendly error", async () => {
  const req = apiReq({});
  const res = await worker.fetch(req, { ASSETS: assets });
  assert.equal(res.status, 500);
});

test("assetlinks uses configured fingerprint", async () => {
  const res = await worker.fetch(new Request("https://x.dev/.well-known/assetlinks.json"), {
    ASSETS: assets,
    ANDROID_PACKAGE: "com.a.b",
    ANDROID_SHA256: "AA:BB",
  });
  const data = await res.json();
  assert.equal(data[0].target.package_name, "com.a.b");
  assert.deepEqual(data[0].target.sha256_cert_fingerprints, ["AA:BB"]);
});

test("other paths are served from static assets", async () => {
  const res = await worker.fetch(new Request("https://x.dev/"), { ASSETS: assets });
  assert.equal(await res.text(), "asset");
});

function mockGemini(obj) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }));
  };
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

test("translate mode returns translation", async () => {
  const m = mockGemini({ translation: "آپ کا نام کیا ہے؟" });
  try {
    const req = apiReq({ mode: "translate", text: "What is your name?", helperLang: "ur" });
    const res = await worker.fetch(req, { GEMINI_API_KEY: "k", ASSETS: assets });
    assert.equal((await res.json()).translation, "آپ کا نام کیا ہے؟");
    assert.match(m.calls[0].systemInstruction.parts[0].text, /Urdu/);
  } finally {
    m.restore();
  }
});

test("summary mode clamps scores", async () => {
  const m = mockGemini({ takeaway: "Using 'is'", explanation: "x", praise: "Good!", grammar: 140, fluency: "70", vocabulary: -5 });
  try {
    const req = apiReq({ mode: "summary", level: "beginner", history: [{ role: "me", text: "my name ali" }] });
    const out = await (await worker.fetch(req, { GEMINI_API_KEY: "k", ASSETS: assets })).json();
    assert.deepEqual([out.grammar, out.fluency, out.vocabulary], [100, 70, 0]);
    assert.equal(out.takeaway, "Using 'is'");
  } finally {
    m.restore();
  }
});

// ---------------- security ----------------
test("rejects requests from other websites", async () => {
  const res = await worker.fetch(apiReq({}, { origin: "https://evil.example" }), { GEMINI_API_KEY: "k", ASSETS: assets });
  assert.equal(res.status, 403);
  const noOrigin = new Request("https://x.dev/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal((await worker.fetch(noOrigin, { GEMINI_API_KEY: "k", ASSETS: assets })).status, 403);
});

test("rejects cross-site fetch even with spoofed origin header", () => {
  const req = new Request("https://x.dev/api/chat", { method: "POST", headers: { origin: "https://x.dev", "sec-fetch-site": "cross-site" } });
  assert.equal(originAllowed(req, {}), false);
  assert.equal(originAllowed(new Request("https://x.dev/api/chat", { headers: { origin: "https://x.dev", "sec-fetch-site": "same-origin" } }), {}), true);
});

test("rejects GET, non-JSON and oversized bodies", async () => {
  const env = { GEMINI_API_KEY: "k", ASSETS: assets };
  assert.equal((await worker.fetch(new Request("https://x.dev/api/chat"), env)).status, 405);
  assert.equal((await worker.fetch(apiReq("{}", { "content-type": "text/plain" }), env)).status, 415);
  assert.equal((await worker.fetch(apiReq({ text: "a".repeat(30000) }), env)).status, 413);
  assert.equal((await worker.fetch(apiReq("not json"), env)).status, 400);
});

test("validates input fields", () => {
  assert.equal(validateInput({ mode: "hack" }).error, "Unknown mode");
  assert.equal(validateInput({ history: [{ role: "system", text: "x" }] }).error, "Bad history");
  assert.equal(validateInput({ history: "x" }).error, "Bad history");
  assert.ok(validateInput({ mode: "translate", text: "", helperLang: "ur" }).error);
  assert.ok(validateInput({ mode: "translate", text: "hi", helperLang: "en" }).error);
  assert.ok(validateInput({ mode: "summary", history: [] }).error);
  const v = validateInput({ level: "pro", helperLang: "xx", history: [{ role: "me", text: "x".repeat(5000) }] }).value;
  assert.equal(v.level, "beginner");
  assert.equal(v.helperLang, "en");
  assert.equal(v.history[0].text.length, 800);
  const d = validateInput({ mode: "daily", date: "1999-01-01" }).value;
  assert.equal(d.date, new Date().toISOString().slice(0, 10));
});

test("rate limit blocks a flood from one IP", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"Hi","correction":"","tip":"","hints":[]}' }] } }] }));
  try {
    const env = { GEMINI_API_KEY: "k", ASSETS: assets };
    let blocked = 0;
    for (let i = 0; i < 40; i++) {
      const res = await worker.fetch(apiReq({}, { "cf-connecting-ip": "203.0.113.9" }), env);
      if (res.status === 429) blocked++;
    }
    assert.equal(blocked, 10);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rate limit binding is used when configured", async () => {
  const env = { GEMINI_API_KEY: "k", ASSETS: assets, RL_AI: { limit: async () => ({ success: false }) } };
  assert.equal((await worker.fetch(apiReq({}), env)).status, 429);
});

test("memory limiter window expires", () => {
  for (let i = 0; i < 3; i++) assert.equal(memoryLimit("t", 3, 1000, 0), true);
  assert.equal(memoryLimit("t", 3, 1000, 10), false);
  assert.equal(memoryLimit("t", 3, 1000, 2000), true);
});

test("upstream error details are not leaked", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("secret upstream message with internal info", { status: 403 });
  try {
    const out = await (await worker.fetch(apiReq({}), { GEMINI_API_KEY: "k", ASSETS: assets })).json();
    assert.ok(!JSON.stringify(out).includes("secret upstream"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("health never calls the AI", async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => ((called = true), new Response("{}"));
  try {
    const res = await worker.fetch(new Request("https://x.dev/api/health?check=1"), { GEMINI_API_KEY: "k", ASSETS: assets });
    assert.equal((await res.json()).ai, true);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------- daily pack ----------------
test("daily pack is validated and cleaned", () => {
  const good = {
    challenge: { title: "Morning", task: "Tell me about your morning.", example: "I woke up at 6." },
    words: [1, 2, 3, 4, 5, 6].map((i) => ({ word: "w" + i, meaning: "m", example: "e", translation: "t" })),
    quiz: [
      { q: "I ___ tea.", options: ["drink", "drinks", "drinking", "drunk"], answer: 0, explain: "x" },
      { q: "She ___ here.", options: ["live", "lives"], answer: 1, explain: "x" },
      { q: "We ___ late.", options: ["was", "were", "is", "be"], answer: 1, explain: "x" },
      { q: "bad", options: ["a", "b"], answer: 7, explain: "x" },
    ],
  };
  const v = validateDaily(good);
  assert.equal(v.words.length, 5);
  assert.equal(v.quiz.length, 3);
  assert.equal(validateDaily({ challenge: {}, words: [], quiz: [] }), null);
});

test("daily mode returns a pack", async () => {
  const pack = {
    challenge: { title: "Shopping", task: "Tell me what you bought.", example: "I bought rice." },
    words: [1, 2, 3].map((i) => ({ word: "w" + i, meaning: "m", example: "e", translation: "t" })),
    quiz: [0, 1, 2].map(() => ({ q: "q", options: ["a", "b", "c", "d"], answer: 2, explain: "e" })),
  };
  const m = mockGemini(pack);
  try {
    const out = await (await worker.fetch(apiReq({ mode: "daily", level: "beginner", helperLang: "ar" }), { GEMINI_API_KEY: "k", ASSETS: assets })).json();
    assert.equal(out.quiz[0].answer, 2);
    assert.match(m.calls[0].systemInstruction.parts[0].text, /Arabic/);
  } finally {
    m.restore();
  }
});

test("unknown api paths return 404 json", async () => {
  const res = await worker.fetch(new Request("https://x.dev/api/nope"), { ASSETS: assets });
  assert.equal(res.status, 404);
});
