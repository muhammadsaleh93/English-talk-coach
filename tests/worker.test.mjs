import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { buildContents, buildSystemPrompt, parseGemini } from "../src/worker.js";

const assets = { fetch: async () => new Response("asset") };

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
    const req = new Request("https://x.dev/api/chat", { method: "POST", body: JSON.stringify({ level: "beginner", topic: "Intro", history: [] }) });
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
    const req = new Request("https://x.dev/api/chat", { method: "POST", body: "{}" });
    const res = await worker.fetch(req, { GEMINI_API_KEY: "k", ASSETS: assets });
    assert.equal(res.status, 200);
    assert.match(urls[1], /gemini-3\.8-flash/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("missing key gives a friendly error", async () => {
  const req = new Request("https://x.dev/api/chat", { method: "POST", body: "{}" });
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
    const req = new Request("https://x.dev/api/chat", { method: "POST", body: JSON.stringify({ mode: "translate", text: "What is your name?", helperLang: "ur" }) });
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
    const req = new Request("https://x.dev/api/chat", {
      method: "POST",
      body: JSON.stringify({ mode: "summary", level: "beginner", history: [{ role: "me", text: "my name ali" }] }),
    });
    const out = await (await worker.fetch(req, { GEMINI_API_KEY: "k", ASSETS: assets })).json();
    assert.deepEqual([out.grammar, out.fluency, out.vocabulary], [100, 70, 0]);
    assert.equal(out.takeaway, "Using 'is'");
  } finally {
    m.restore();
  }
});
