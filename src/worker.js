// English Talk Coach — Cloudflare Worker
// Serves the app (from /public) and a small API that talks to Google Gemini.
// The Gemini key is stored as a Cloudflare secret (GEMINI_API_KEY), never in the app.

const LEVEL_GUIDE = {
  beginner:
    "The learner is a BEGINNER (CEFR A1-A2). Use very short, simple sentences (max 12 words each), common everyday words, present tense mostly. Ask only ONE simple question at a time. Be very patient and encouraging.",
  intermediate:
    "The learner is INTERMEDIATE (CEFR B1-B2). Use natural everyday English with some useful phrases and idioms, but explain nothing unless asked. Ask open questions that make the learner give longer answers.",
  advanced:
    "The learner is ADVANCED (CEFR C1-C2). Speak like a fluent native speaker: rich vocabulary, idioms, nuanced opinions. Challenge the learner with follow-up questions, ask for reasons and examples.",
};

const HELPER_LANGS = {
  en: "English",
  ur: "Urdu (in Urdu script)",
  hi: "Hindi (in Devanagari script)",
  ar: "Arabic",
  bn: "Bengali",
};

const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
const TUTOR_NAME = "Sara";
const VERSION = "2.0.0";

const MAX_TURNS = 20;
const MAX_CHARS = 800;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: {
      type: "STRING",
      description: "Your next spoken line in the conversation, in English. Keep the conversation going; usually end with a question.",
    },
    correction: {
      type: "STRING",
      description:
        "If the learner's LAST message had grammar, word-choice or spelling mistakes, the corrected natural version of that whole message. Empty string if it was fine or if there is no learner message.",
    },
    tip: {
      type: "STRING",
      description:
        "If there is a correction, ONE short explanation of the main mistake, written in the helper language. Empty string otherwise.",
    },
    hints: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "2 or 3 short example answers (in English) the learner could say next to your reply, at the learner's level. Max 10 words each.",
    },
  },
  required: ["reply", "correction", "tip", "hints"],
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function clean(text, max = MAX_CHARS) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildSystemPrompt({ level, topic, role, goal, helperLang }) {
  const levelText = LEVEL_GUIDE[level] || LEVEL_GUIDE.beginner;
  const helper = HELPER_LANGS[helperLang] || HELPER_LANGS.en;
  return [
    `You are ${TUTOR_NAME}, a friendly, patient English conversation tutor inside the English Talk Coach app.`,
    levelText,
    `Conversation topic: ${clean(topic, 120) || "Free conversation"}.`,
    role ? `Your role in this role-play: ${clean(role, 200)}.` : "You are a friendly conversation partner.",
    goal ? `The learner's goal: ${clean(goal, 200)}.` : "",
    "Rules:",
    "- Stay in the role-play and on the topic. Speak ONLY English in 'reply'.",
    "- Keep 'reply' short (1-3 sentences for beginners, up to 5 for advanced) so it feels like a real spoken conversation.",
    "- Never write the correction inside 'reply'. Put corrections only in 'correction' and 'tip'.",
    "- Only correct REAL mistakes (grammar, wrong word, wrong word order, spelling). If the learner's message is already correct English (ignoring punctuation and capital letters), 'correction' MUST be an empty string.",
    "- 'correction' must be perfect, natural English. Change as few words as possible: keep the learner's own words and order where they are correct, so the learner can see exactly what changed.",
    "- Ignore small punctuation or capital-letter issues; voice input has no punctuation.",
    `- Write 'tip' in ${helper}. Keep it to one short sentence.`,
    "- Keep everything friendly, respectful and suitable for all ages. Politely refuse anything harmful, sexual, hateful or dangerous and steer back to English practice.",
    "- If the learner writes in another language, gently ask them to try in English and give them a simple example sentence.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContents(history) {
  const turns = Array.isArray(history) ? history.slice(-MAX_TURNS) : [];
  const contents = [];
  for (const t of turns) {
    const text = clean(t && t.text);
    if (!text) continue;
    const role = t.role === "coach" ? "model" : "user";
    // Gemini needs alternating roles; merge consecutive same-role turns.
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + text;
    else contents.push({ role, parts: [{ text }] });
  }
  // Conversation must start with a user turn and end with a user turn.
  if (!contents.length || contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "(The learner opened this lesson. Greet them and start the conversation.)" }] });
  }
  if (contents[contents.length - 1].role !== "user") {
    contents.push({ role: "user", parts: [{ text: "(Continue the conversation.)" }] });
  }
  return contents;
}

async function callGemini(env, body) {
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...DEFAULT_MODELS] : DEFAULT_MODELS;
  let lastError = "unknown";
  for (const model of [...new Set(models)]) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      lastError = "timeout " + model + ": " + String(e && e.message);
      continue; // too slow: try the next model
    }
    if (res.ok) return { data: await res.json(), model };
    lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
    // Only try the next model if this one is missing/unsupported/overloaded.
    if (![400, 404, 500, 503].includes(res.status)) break;
  }
  throw new Error(lastError);
}

export function parseGemini(data) {
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || "").join("") : "";
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    return {
      reply: clean(obj.reply, 2000),
      correction: clean(obj.correction, 1000),
      tip: clean(obj.tip, 500),
      hints: Array.isArray(obj.hints) ? obj.hints.slice(0, 3).map((h) => clean(h, 120)).filter(Boolean) : [],
    };
  } catch {
    return { reply: clean(text, 2000), correction: "", tip: "", hints: [] };
  }
}

const TRANSLATE_SCHEMA = {
  type: "OBJECT",
  properties: { translation: { type: "STRING" } },
  required: ["translation"],
};

const SUMMARY_SCHEMA = {
  type: "OBJECT",
  properties: {
    takeaway: { type: "STRING", description: "Title of the ONE most useful grammar or vocabulary point for this learner, in English, max 6 words. Example: 'Past simple vs present perfect'." },
    explanation: { type: "STRING", description: "1-2 short sentences explaining the takeaway with one example, written in the helper language (examples stay in English)." },
    grammar: { type: "INTEGER", description: "0-100 score for grammar accuracy of the learner's messages." },
    fluency: { type: "INTEGER", description: "0-100 score for fluency: sentence length, natural flow, completeness of ideas." },
    vocabulary: { type: "INTEGER", description: "0-100 score for range and accuracy of vocabulary for their level." },
    praise: { type: "STRING", description: "One short encouraging sentence in English about what the learner did well." },
  },
  required: ["takeaway", "explanation", "grammar", "fluency", "vocabulary", "praise"],
};

const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function parseJsonReply(data) {
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || "").join("") : "";
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function chatMode(env, input) {
  const { data } = await callGemini(env, {
    systemInstruction: { parts: [{ text: buildSystemPrompt(input) }] },
    contents: buildContents(input.history),
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });
  const result = parseGemini(data);
  if (!result || !result.reply) {
    return { reply: "Sorry, I can't answer that. Let's keep practising English — can you tell me about your day?", correction: "", tip: "", hints: [] };
  }
  return result;
}

async function translateMode(env, input) {
  const lang = HELPER_LANGS[input.helperLang] || HELPER_LANGS.ur;
  const text = clean(input.text, 1500);
  if (!text) return { translation: "" };
  const { data } = await callGemini(env, {
    systemInstruction: { parts: [{ text: `Translate the user's English text into natural, simple ${lang} for a language learner. Return only the translation.` }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json", responseSchema: TRANSLATE_SCHEMA },
  });
  const obj = parseJsonReply(data);
  return { translation: clean(obj && obj.translation, 2000) };
}

async function summaryMode(env, input) {
  const helper = HELPER_LANGS[input.helperLang] || HELPER_LANGS.en;
  const levelText = LEVEL_GUIDE[input.level] || LEVEL_GUIDE.beginner;
  const turns = (Array.isArray(input.history) ? input.history.slice(-30) : [])
    .map((t) => (t && t.role === "coach" ? "Coach: " : "Learner: ") + clean(t && t.text))
    .join("\n");
  const { data } = await callGemini(env, {
    systemInstruction: {
      parts: [
        {
          text: [
            "You are an English teacher reviewing a practice conversation between an AI coach and a learner.",
            levelText,
            `Topic: ${clean(input.topic, 120) || "Free conversation"}.`,
            "Judge ONLY the learner's lines, fairly for their level (a good beginner can score high). Voice input has no punctuation: do not penalise punctuation or capitals.",
            "Every English example you write must be 100% grammatically correct, natural English.",
            `Write 'explanation' in ${helper}.`,
          ].join("\n"),
        },
      ],
    },
    contents: [{ role: "user", parts: [{ text: turns || "(empty)" }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024, responseMimeType: "application/json", responseSchema: SUMMARY_SCHEMA },
  });
  const o = parseJsonReply(data) || {};
  return {
    takeaway: clean(o.takeaway, 120),
    explanation: clean(o.explanation, 600),
    praise: clean(o.praise, 300),
    grammar: clampScore(o.grammar),
    fluency: clampScore(o.fluency),
    vocabulary: clampScore(o.vocabulary),
  };
}

// ---------------------------------------------------------------------------
// Daily pack: challenge + 5 words + 5-question quiz (one AI call per user per day)
// ---------------------------------------------------------------------------
const DAILY_SCHEMA = {
  type: "OBJECT",
  properties: {
    challenge: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", description: "Short fun title, max 6 words." },
        task: { type: "STRING", description: "A speaking task the learner completes by talking to the tutor, in simple English, 1-2 sentences." },
        example: { type: "STRING", description: "One example sentence the learner could say." },
      },
      required: ["title", "task", "example"],
    },
    words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          word: { type: "STRING" },
          meaning: { type: "STRING", description: "Simple English meaning." },
          example: { type: "STRING", description: "Natural example sentence." },
          translation: { type: "STRING", description: "Meaning in the helper language." },
        },
        required: ["word", "meaning", "example", "translation"],
      },
    },
    quiz: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          q: { type: "STRING", description: "Question in English (fill-the-gap with ___ or choose the correct sentence)." },
          options: { type: "ARRAY", items: { type: "STRING" } },
          answer: { type: "INTEGER", description: "Index (0-3) of the correct option." },
          explain: { type: "STRING", description: "One short explanation in the helper language." },
        },
        required: ["q", "options", "answer", "explain"],
      },
    },
  },
  required: ["challenge", "words", "quiz"],
};

export function validateDaily(o) {
  if (!o || typeof o !== "object") return null;
  const c = o.challenge || {};
  const challenge = { title: clean(c.title, 80), task: clean(c.task, 300), example: clean(c.example, 200) };
  const words = (Array.isArray(o.words) ? o.words : [])
    .map((w) => ({ word: clean(w && w.word, 40), meaning: clean(w && w.meaning, 200), example: clean(w && w.example, 200), translation: clean(w && w.translation, 120) }))
    .filter((w) => w.word && w.meaning)
    .slice(0, 5);
  const quiz = (Array.isArray(o.quiz) ? o.quiz : [])
    .map((q) => {
      const options = (Array.isArray(q && q.options) ? q.options : []).map((x) => clean(x, 120)).filter(Boolean).slice(0, 4);
      const answer = Number.isInteger(q && q.answer) ? q.answer : -1;
      return { q: clean(q && q.q, 240), options, answer, explain: clean(q && q.explain, 300) };
    })
    .filter((q) => q.q && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)
    .slice(0, 5);
  if (!challenge.task || words.length < 3 || quiz.length < 3) return null;
  return { challenge, words, quiz };
}

async function dailyMode(env, input) {
  const helper = HELPER_LANGS[input.helperLang] || HELPER_LANGS.en;
  const levelText = LEVEL_GUIDE[input.level] || LEVEL_GUIDE.beginner;
  const { data } = await callGemini(env, {
    systemInstruction: {
      parts: [
        {
          text: [
            "You create a short daily English practice pack for a language learning app used mostly by South Asian and Arab adults.",
            levelText,
            `Today's date is ${input.date}; use it to vary the theme (daily life, work, travel, shopping, health, family, technology, food...).`,
            "Return: 1 speaking challenge, exactly 5 useful words for this level, and exactly 5 multiple-choice quiz questions with 4 options each, mixing grammar and today's words.",
            `Write 'translation' and 'explain' in ${helper}. Everything else in English.`,
            "All English must be 100% correct. Exactly one option is correct. Keep everything friendly and suitable for all ages.",
          ].join("\n"),
        },
      ],
    },
    contents: [{ role: "user", parts: [{ text: "Create today's pack." }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: DAILY_SCHEMA },
  });
  const pack = validateDaily(parseJsonReply(data));
  if (!pack) throw new Error("bad-output daily pack");
  return pack;
}

// ---------------------------------------------------------------------------
// Security: input validation, origin check, rate limiting
// ---------------------------------------------------------------------------
const MODES = ["chat", "translate", "summary", "daily"];
const LEVELS = Object.keys(LEVEL_GUIDE);
const MAX_BODY_BYTES = 24 * 1024;

export function validateInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Bad request" };
  const mode = raw.mode === undefined ? "chat" : raw.mode;
  if (!MODES.includes(mode)) return { error: "Unknown mode" };
  const level = LEVELS.includes(raw.level) ? raw.level : "beginner";
  const helperLang = Object.prototype.hasOwnProperty.call(HELPER_LANGS, raw.helperLang) ? raw.helperLang : "en";
  const history = [];
  if (raw.history !== undefined) {
    if (!Array.isArray(raw.history) || raw.history.length > 60) return { error: "Bad history" };
    for (const t of raw.history.slice(-30)) {
      if (!t || typeof t !== "object" || (t.role !== "coach" && t.role !== "me")) return { error: "Bad history" };
      history.push({ role: t.role, text: clean(t.text, MAX_CHARS) });
    }
  }
  const out = { mode, level, helperLang, history, topic: clean(raw.topic, 120), role: clean(raw.role, 300), goal: clean(raw.goal, 300) };
  if (mode === "translate") {
    out.text = clean(raw.text, 1500);
    if (!out.text) return { error: "Nothing to translate" };
    if (helperLang === "en") return { error: "Choose a language to translate into" };
  }
  if (mode === "summary" && !history.some((t) => t.role === "me")) return { error: "Nothing to review yet" };
  if (mode === "daily") {
    const today = new Date();
    const ok = [-1, 0, 1].map((d) => new Date(today.getTime() + d * 864e5).toISOString().slice(0, 10));
    out.date = ok.includes(raw.date) ? raw.date : ok[1];
  }
  return { value: out };
}

export function originAllowed(request, env) {
  const self = new URL(request.url).origin;
  const allowed = [self, ...String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)];
  const origin = request.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || allowed.length > 1;
}

// Per-IP limits. Uses Cloudflare's Rate Limiting binding when configured,
// plus an in-memory fallback (per server instance) so limits always apply.
const memoryHits = new Map();
export function memoryLimit(key, limit, windowMs, now = Date.now()) {
  const list = (memoryHits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    memoryHits.set(key, list);
    return false;
  }
  list.push(now);
  memoryHits.set(key, list);
  if (memoryHits.size > 5000) memoryHits.delete(memoryHits.keys().next().value);
  return true;
}
const COST = { chat: 1, translate: 1, summary: 3, daily: 5 };

async function rateLimited(request, env, mode) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.RL_AI && typeof env.RL_AI.limit === "function") {
    try {
      const { success } = await env.RL_AI.limit({ key: ip });
      if (!success) return true;
    } catch (e) {
      console.error("rate limit binding error", String(e));
    }
  }
  // 30 "points" per minute and 400 per hour per IP (daily pack = 5 points, summary = 3).
  const cost = COST[mode] || 1;
  for (let i = 0; i < cost; i++) {
    if (!memoryLimit("m:" + ip, 30, 60_000) || !memoryLimit("h:" + ip, 400, 3_600_000)) return true;
  }
  return false;
}

async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!originAllowed(request, env)) return json({ error: "Forbidden" }, 403);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ error: "Use JSON" }, 415);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return json({ error: "Message too long" }, 413);
  if (!env.GEMINI_API_KEY) return json({ error: "The server is missing its AI key. Please try again later." }, 500);

  let raw;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "Message too long" }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const { value: input, error } = validateInput(raw);
  if (error) return json({ error }, 400);
  if (await rateLimited(request, env, input.mode)) {
    return json({ error: "You're sending messages very fast. Please wait a minute and try again." }, 429);
  }

  try {
    if (input.mode === "translate") return json(await translateMode(env, input));
    if (input.mode === "summary") return json(await summaryMode(env, input));
    if (input.mode === "daily") return json(await dailyMode(env, input));
    return json(await chatMode(env, input));
  } catch (err) {
    const msg = String(err && err.message);
    console.error("AI error:", input.mode, msg.slice(0, 500));
    if (/^timeout/i.test(msg)) return json({ error: "The tutor took too long to answer. Please try again.", detail: "timeout" }, 504);
    if (msg.startsWith("429")) return json({ error: "The tutor is busy right now. Please wait a minute and try again.", detail: "quota" }, 503);
    return json({ error: "The tutor could not answer. Please try again.", detail: "upstream " + msg.slice(0, 3) }, 502);
  }
}

function health(env) {
  return json({ ok: true, ai: Boolean(env.GEMINI_API_KEY), version: VERSION });
}

function assetLinks(env) {
  const fingerprints = String(env.ANDROID_SHA256 || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!fingerprints.length || !env.ANDROID_PACKAGE) return json([]);
  return json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: env.ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (url.pathname === "/api/health") return health(env);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    if (url.pathname === "/.well-known/assetlinks.json") return assetLinks(env);
    return env.ASSETS.fetch(request);
  },
};
