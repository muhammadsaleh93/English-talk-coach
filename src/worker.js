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
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function clean(text, max = MAX_CHARS) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildSystemPrompt({ level, topic, role, goal, helperLang }) {
  const levelText = LEVEL_GUIDE[level] || LEVEL_GUIDE.beginner;
  const helper = HELPER_LANGS[helperLang] || HELPER_LANGS.en;
  return [
    "You are 'Coach', a friendly English conversation tutor inside the English Talk Coach app.",
    levelText,
    `Conversation topic: ${clean(topic, 120) || "Free conversation"}.`,
    role ? `Your role in this role-play: ${clean(role, 200)}.` : "You are a friendly conversation partner.",
    goal ? `The learner's goal: ${clean(goal, 200)}.` : "",
    "Rules:",
    "- Stay in the role-play and on the topic. Speak ONLY English in 'reply'.",
    "- Keep 'reply' short (1-3 sentences for beginners, up to 5 for advanced) so it feels like a real spoken conversation.",
    "- Never write the correction inside 'reply'. Put corrections only in 'correction' and 'tip'.",
    "- In 'correction', change as few words as possible: keep the learner's own words and order where they are correct, so the learner can see exactly what changed.",
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
    generationConfig: { temperature: 0.8, maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
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

async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!env.GEMINI_API_KEY) return json({ error: "The server is missing its AI key. Please try again later." }, 500);

  let input;
  try {
    input = (await request.json()) || {};
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  try {
    if (input.mode === "translate") return json(await translateMode(env, input));
    if (input.mode === "summary") return json(await summaryMode(env, input));
    return json(await chatMode(env, input));
  } catch (err) {
    const msg = String(err && err.message);
    if (/^timeout/i.test(msg)) {
      return json({ error: "The coach took too long to answer. Please try again.", detail: msg.slice(0, 200) }, 504);
    }
    if (msg.startsWith("429")) {
      return json({ error: "The coach is busy right now. Please wait a minute and try again." }, 429);
    }
    console.error("Gemini error:", msg);
    return json({ error: "The coach could not answer. Please try again.", detail: msg.slice(0, 300) }, 502);
  }
}

// Diagnostic: /api/health?check shows whether Gemini answers (never shows the key).
async function health(env, check) {
  const out = { ok: true, ai: Boolean(env.GEMINI_API_KEY) };
  if (!check || !env.GEMINI_API_KEY) return json(out);
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...DEFAULT_MODELS] : DEFAULT_MODELS;
  out.models = {};
  for (const model of [...new Set(models)]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Say hi" }] }], generationConfig: { maxOutputTokens: 256 } }),
          signal: AbortSignal.timeout(20000),
        }
      );
      out.models[model] = res.ok ? "OK" : `${res.status} ${(await res.text()).slice(0, 300)}`;
    } catch (e) {
      out.models[model] = "fetch failed: " + String(e && e.message);
    }
  }
  return json(out);
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
    if (url.pathname === "/api/health") return health(env, url.searchParams.has("check"));
    if (url.pathname === "/.well-known/assetlinks.json") return assetLinks(env);
    return env.ASSETS.fetch(request);
  },
};
