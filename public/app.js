(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const LEVELS = ["beginner", "intermediate", "advanced"];
  const LEVEL_NAMES = { beginner: "🌱 Beginner", intermediate: "🌿 Intermediate", advanced: "🌳 Advanced" };
  const TILE_COLORS = ["#ffe8d6", "#dbe7ff", "#fde2f3", "#d7f7e3", "#ece4ff", "#fff3c7"];
  const LESSON_TURNS = 6; // learner messages to complete a lesson
  const TUTOR = window.TUTOR_NAME;

  // ---------- Storage ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("etc." + key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("etc." + key, JSON.stringify(value));
        return true;
      } catch {
        // Storage full: drop old conversations (progress is more important), then retry once.
        try {
          Object.keys(localStorage).filter((k) => k.startsWith("etc.conv.") || k.startsWith("etc.daily.")).forEach((k) => localStorage.removeItem(k));
          localStorage.setItem("etc." + key, JSON.stringify(value));
          return true;
        } catch {
          if (!store.warned) {
            store.warned = true;
            setTimeout(() => toast("⚠️ Could not save progress. Please free some phone storage."), 0);
          }
          return false;
        }
      }
    },
    remove(key) {
      try {
        localStorage.removeItem("etc." + key);
      } catch {}
    },
  };

  const settings = Object.assign(
    { name: "", onboarded: false, level: "beginner", helperLang: "ur", autoSpeak: true, showHints: true, rate: 0.9, dailyGoal: 10 },
    store.get("settings", {})
  );
  const freshStats = () => ({ messages: 0, corrections: 0, done: {}, days: {}, best: 0, reviews: [], gems: 0, stars: 0, words: {}, wordDays: {}, scores: [], takeaways: [], quiz: { taken: 0, correct: 0, total: 0 }, pron: { n: 0, sum: 0 }, learned: {}, challenges: {}, lastMistakeQuiz: "" });
  const stats = Object.assign(freshStats(), store.get("stats", {}));
  // Make sure every field exists (older versions saved fewer fields).
  for (const [k, v] of Object.entries(freshStats())) if (typeof stats[k] !== typeof v || Array.isArray(v) !== Array.isArray(stats[k])) stats[k] = v;
  stats.v = 2;
  // Ask the browser not to clear our data when the phone is low on space.
  try {
    navigator.storage && navigator.storage.persist && navigator.storage.persist();
  } catch {}
  const saveSettings = () => store.set("settings", settings);
  const saveStats = () => store.set("stats", stats);

  // ---------- Dates ----------
  const dayKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };
  function streak() {
    const d = new Date();
    if (!stats.days[dayKey(d)]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (stats.days[dayKey(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  const todayCount = () => stats.days[dayKey()] || 0;
  const isRtl = (lang) => lang === "ur" || lang === "ar";

  // ---------- Word diff (shows exactly what changed) ----------
  const tokenize = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);
  const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
  function diff(a, b) {
    const A = tokenize(a), B = tokenize(b);
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const keepA = new Array(n).fill(false), keepB = new Array(m).fill(false);
    const missA = new Set(); // positions in A where the correction adds words
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (norm(A[i]) === norm(B[j])) {
        keepA[i++] = true;
        keepB[j++] = true;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else {
        if (i === 0 || keepA[i - 1]) missA.add(i);
        j++;
      }
    }
    if (j < m && (n === 0 || keepA[n - 1])) missA.add(n);
    return { A, B, keepA, keepB, missA };
  }
  function highlighted(tokens, keep, cls, miss) {
    const frag = document.createDocumentFragment();
    const caret = () => {
      const c = document.createElement("mark");
      c.className = "miss";
      c.title = "Missing word";
      c.textContent = "+";
      return c;
    };
    tokens.forEach((t, k) => {
      if (k) frag.appendChild(document.createTextNode(" "));
      if (miss && miss.has(k)) frag.appendChild(caret());
      if (keep[k]) frag.appendChild(document.createTextNode(t));
      else {
        const mk = document.createElement("mark");
        mk.className = cls;
        mk.textContent = t;
        frag.appendChild(mk);
      }
    });
    if (miss && miss.has(tokens.length)) frag.append(" ", caret());
    return frag;
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // ---------- API ----------
  async function api(payload, timeout = 50000) {
    const res = await fetch(CFG.API_URL, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const err = new Error((data && data.error) || "Something went wrong (code " + res.status + ").");
      err.detail = data && data.detail;
      throw err;
    }
    return data;
  }

  // ---------- Navigation ----------
  let view = "home";
  function show(name) {
    view = name;
    for (const v of ["welcome", "home", "practice", "progress", "settings", "chat", "activity"]) $(v + "View").classList.toggle("hidden", v !== name);
    $("tabbar").classList.toggle("hidden", name === "chat" || name === "welcome" || name === "activity");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if (name !== "chat") stopSpeaking();
    if (name === "home") renderHome();
    if (name === "progress") renderProgress();
    if (name === "practice") renderPractice();
    if (name !== "activity") stopActivityListening();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => (t.dataset.view === "talk" ? openTopic(settings.level, window.FREE_TALK) : show(t.dataset.view)))
  );
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
  let returnView = "home";
  $("backBtn").addEventListener("click", () => (history.state && history.state.chat ? history.back() : show(returnView)));
  window.addEventListener("popstate", () => {
    if (!$("sheet").classList.contains("hidden")) return closeSheet();
    if (!$("jobSheet").classList.contains("hidden")) return $("jobSheet").classList.add("hidden");
    if (view === "chat") show(returnView || "home");
    else if (view === "activity") show("practice");
  });
  document.querySelectorAll(".tutor-name").forEach((el) => (el.textContent = TUTOR));

  // ---------- Welcome ----------
  $("heroAvatar").innerHTML = tutorSVG({ round: false, bg: false });
  $("welcomeNext").addEventListener("click", () => {
    $("welcome1").classList.add("hidden");
    $("welcome2").classList.remove("hidden");
    $("nameInput").focus();
  });
  let pickedLevel = settings.level;
  const markLevel = () => document.querySelectorAll("#levelPick button").forEach((b) => b.classList.toggle("on", b.dataset.level === pickedLevel));
  document.querySelectorAll("#levelPick button").forEach((b) =>
    b.addEventListener("click", () => {
      pickedLevel = b.dataset.level;
      markLevel();
    })
  );
  markLevel();
  $("langInput").value = settings.helperLang;
  $("welcome2").addEventListener("submit", (e) => {
    e.preventDefault();
    settings.name = $("nameInput").value.trim().slice(0, 30) || "Learner";
    settings.helperLang = $("langInput").value;
    settings.level = pickedLevel;
    settings.onboarded = true;
    saveSettings();
    syncSettingsForm();
    show("home");
  });

  // ---------- Home ----------
  function nextTopic() {
    const topics = window.TOPICS[settings.level];
    return topics.find((t) => !stats.done[settings.level + ":" + t.id]) || null;
  }

  function renderHome() {
    const name = settings.name || "Learner";
    $("profileName").textContent = name;
    $("profilePic").textContent = name.charAt(0).toUpperCase();
    $("profileLessons").textContent = `🏆 ${Object.keys(stats.done).length} lesson${Object.keys(stats.done).length === 1 ? "" : "s"}`;
    $("profileLevel").textContent = LEVEL_NAMES[settings.level];

    $("tStreak").textContent = streak();
    $("tGems").textContent = stats.gems;
    $("tStars").textContent = stats.stars;

    const today = todayCount();
    $("goalSub").textContent = today >= settings.dailyGoal ? "Goal reached! 🎉" : `${today} / ${settings.dailyGoal} messages`;
    $("goalBar").style.width = Math.min(100, Math.round((today / settings.dailyGoal) * 100)) + "%";

    const next = nextTopic();
    const topics = window.TOPICS[settings.level];
    $("nextLabel").textContent = next ? "Next lesson" : "All lessons done 🎉 Practise again";
    $("nextTitle").textContent = (next || topics[0]).icon + " " + (next || topics[0]).title;
    if (!$("nextAvatar").firstChild) $("nextAvatar").innerHTML = tutorSVG();

    renderRecs();

    const idx = LEVELS.indexOf(settings.level);
    document.querySelectorAll(".seg").forEach((b) => b.classList.toggle("active", b.dataset.level === settings.level));
    document.querySelector(".seg-pill").style.transform = `translateX(${idx * 100}%)`;
    const doneCount = topics.filter((t) => stats.done[settings.level + ":" + t.id]).length;
    $("levelProgress").textContent = `${doneCount} of ${topics.length} done`;

    const list = $("topicList");
    list.innerHTML = "";
    topics.forEach((t, i) => {
      const done = stats.done[settings.level + ":" + t.id];
      const btn = document.createElement("button");
      btn.className = "topic";
      btn.style.animationDelay = i * 40 + "ms";
      btn.innerHTML = `<span class="topic-icon"></span><span class="topic-body"><div class="topic-title"></div><div class="topic-goal"></div></span>`;
      const icon = btn.querySelector(".topic-icon");
      icon.textContent = t.icon;
      icon.style.background = TILE_COLORS[i % TILE_COLORS.length];
      btn.querySelector(".topic-title").textContent = t.title;
      btn.querySelector(".topic-goal").textContent = t.goal.charAt(0).toUpperCase() + t.goal.slice(1);
      if (done) {
        const meta = document.createElement("div");
        meta.className = "topic-meta";
        meta.textContent = `★ Completed ${done}×`;
        btn.querySelector(".topic-body").appendChild(meta);
        btn.insertAdjacentHTML("beforeend", `<span class="check">✓</span>`);
      } else {
        btn.insertAdjacentHTML("beforeend", `<svg class="chev" viewBox="0 0 24 24" width="22" height="22"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
      }
      btn.addEventListener("click", () => openTopic(settings.level, t));
      list.appendChild(btn);
    });
  }
  document.querySelectorAll(".seg").forEach((b) =>
    b.addEventListener("click", () => {
      settings.level = b.dataset.level;
      saveSettings();
      renderHome();
    })
  );
  $("nextCard").addEventListener("click", () => openTopic(settings.level, nextTopic() || window.TOPICS[settings.level][0]));
  $("freeTalkBtn").addEventListener("click", () => openTopic(settings.level, window.FREE_TALK));

  // ---------- Progress ----------
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const fmt = (d) => d.toLocaleDateString("en", { month: "short", day: "numeric" });

  function renderProgress() {
    // Skills
    const weekAgo = dayKey(daysAgo(7)), twoWeeks = dayKey(daysAgo(14));
    const thisWeek = stats.scores.filter((s) => s.d > weekAgo);
    const lastWeek = stats.scores.filter((s) => s.d > twoWeeks && s.d <= weekAgo);
    const body = $("skillsBody");
    body.innerHTML = "";
    const base = thisWeek.length ? thisWeek : stats.scores.slice(-5);
    if (!base.length) {
      body.innerHTML = `<p class="skills-empty">Finish your first lesson (${LESSON_TURNS} messages) and ${TUTOR} will score your <b>grammar</b>, <b>fluency</b> and <b>vocabulary</b>. Then watch them grow every week! 📈</p>`;
    } else {
      for (const [key, label] of [["g", "Grammar"], ["f", "Fluency"], ["v", "Vocabulary"]]) {
        const now = avg(base.map((s) => s[key]));
        const before = avg(lastWeek.map((s) => s[key]));
        const row = document.createElement("div");
        row.className = "skill";
        row.innerHTML = `<div class="top"><span></span><em></em></div><div class="track"><span></span></div>`;
        row.querySelector(".top span").textContent = label;
        row.querySelector("em").textContent = now + "%";
        if (before !== null && before !== now) {
          const ch = document.createElement("span");
          ch.className = now > before ? "up" : "down";
          ch.textContent = (now > before ? "↑ +" : "↓ ") + (now - before);
          row.querySelector("em").appendChild(ch);
        }
        body.appendChild(row);
        requestAnimationFrame(() => (row.querySelector(".track span").style.width = now + "%"));
      }
      const t = stats.takeaways[0];
      if (t) {
        const box = document.createElement("div");
        box.className = "takeaway";
        box.innerHTML = `<small>Latest grammar takeaway</small><b></b>`;
        box.querySelector("b").textContent = t.title;
        body.appendChild(box);
      }
    }
    $("skillsNote").textContent = thisWeek.length ? `${thisWeek.length} lesson${thisWeek.length === 1 ? "" : "s"} this week` : "Last 7 days";

    // Vocabulary chart: words spoken per week (last 4 weeks)
    $("wordTotal").textContent = Object.keys(stats.words).length;
    const chart = $("wordChart");
    chart.innerHTML = "";
    const weeks = [];
    for (let w = 3; w >= 0; w--) {
      let total = 0;
      for (let d = 0; d < 7; d++) total += stats.wordDays[dayKey(daysAgo(w * 7 + d))] || 0;
      weeks.push({ total, label: (() => {
          const a = daysAgo(w * 7 + 6), b = daysAgo(w * 7);
          return a.getMonth() === b.getMonth() ? `${fmt(a)}–${b.getDate()}` : `${fmt(a)}–${fmt(b)}`;
        })(), now: w === 0 });
    }
    const max = Math.max(10, ...weeks.map((w) => w.total));
    for (const w of weeks) {
      const col = document.createElement("div");
      col.className = "col" + (w.now ? " now" : "");
      col.innerHTML = `<b></b><i></i><small></small>`;
      col.querySelector("b").textContent = w.total;
      col.querySelector("small").textContent = w.label;
      chart.appendChild(col);
      requestAnimationFrame(() => (col.querySelector("i").style.height = Math.max(4, Math.round((w.total / max) * 100)) + "%"));
    }

    // Today's new words
    const today = dayKey();
    const newWords = Object.keys(stats.words).filter((w) => stats.words[w] === today);
    $("todayWordsCount").textContent = newWords.length;
    const grid = $("todayWords");
    grid.innerHTML = "";
    if (!newWords.length) grid.innerHTML = `<div class="empty">Words you use for the first time today will appear here.</div>`;
    newWords.slice(-24).forEach((w) => {
      const s = document.createElement("span");
      s.textContent = w;
      grid.appendChild(s);
    });

    // Mistakes review
    const list = $("reviewList");
    list.innerHTML = "";
    if (!stats.reviews.length) list.innerHTML = `<div class="empty">Your corrected sentences will appear here, with the changes highlighted.</div>`;
    for (const r of stats.reviews.slice(0, 15)) {
      const { A, B, keepA, keepB, missA } = diff(r.wrong, r.right);
      const d = document.createElement("div");
      d.className = "review";
      const w = document.createElement("div");
      w.className = "wrong";
      w.appendChild(highlighted(A, keepA, "bad", missA));
      const ri = document.createElement("div");
      ri.className = "right";
      ri.appendChild(highlighted(B, keepB, "good"));
      d.append(w, ri);
      d.addEventListener("click", () => speak(r.right));
      list.appendChild(d);
    }

    // Levels
    $("levelBars").innerHTML = "";
    for (const lvl of LEVELS) {
      const topics = window.TOPICS[lvl];
      const done = topics.filter((t) => stats.done[lvl + ":" + t.id]).length;
      const row = document.createElement("div");
      row.className = "lvl-row";
      row.innerHTML = `<div class="top"><span></span><span></span></div><div class="bar"><span></span></div>`;
      row.querySelector(".top span:first-child").textContent = LEVEL_NAMES[lvl];
      row.querySelector(".top span:last-child").textContent = `${done}/${topics.length}`;
      row.querySelector(".bar span").style.width = Math.round((done / topics.length) * 100) + "%";
      $("levelBars").appendChild(row);
    }
  }

  // ---------- Chat ----------
  let current = null; // { level, topic, history, completed }
  let busy = false;
  let lastHints = [];
  const convKey = (level, topicId) => "conv." + level + "." + topicId;

  $("stageAvatar").innerHTML = tutorSVG({ round: false, bg: false });
  // Make room for the keyboard while typing.
  $("input").addEventListener("focus", () => $("stage").classList.add("compact"));
  $("input").addEventListener("blur", () => setTimeout(() => $("stage").classList.remove("compact"), 150));
  function stageState(state) {
    const st = $("stage");
    st.classList.remove("speaking", "thinking", "listening");
    if (state !== "online") st.classList.add(state);
    $("stageAvatar").classList.toggle("talking", state === "speaking");
    const labels = { online: "Online", speaking: "Speaking…", thinking: "Thinking…", listening: "Listening…" };
    $("stageStatus").lastChild.textContent = labels[state] || "Online";
  }
  $("stageToggle").addEventListener("click", () => {
    $("stage").classList.toggle("small");
    store.set("stageSmall", $("stage").classList.contains("small"));
  });
  if (store.get("stageSmall", false)) $("stage").classList.add("small");

  function openTopic(level, topic) {
    const saved = store.get(convKey(level, topic.id), null);
    const h = Array.isArray(saved) ? saved : saved && Array.isArray(saved.h) ? saved.h : [];
    current = { level, topic, history: h, completed: !!(saved && saved.done) };
    $("chatTopic").textContent = topic.icon + " " + topic.title;
    $("chatGoal").textContent = "Goal: " + topic.goal;
    lastHints = [];
    returnView = view === "chat" ? returnView : view === "practice" ? "practice" : "home";
    history.pushState({ chat: true }, "");
    show("chat");
    stageState("online");
    renderMessages();
    renderHints();
    if (!current.history.length) askCoach();
  }
  $("newChatBtn").addEventListener("click", () => {
    if (!current || busy) return;
    current.history = [];
    current.completed = false;
    store.remove(convKey(current.level, current.topic.id));
    lastHints = [];
    renderMessages();
    renderHints();
    askCoach();
  });

  const saveConv = () => current && store.set(convKey(current.level, current.topic.id), { h: current.history.slice(-40), done: current.completed });
  const scrollDown = () => {
    const box = $("messages");
    requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
  };

  function renderMessages() {
    const box = $("messages");
    box.innerHTML = "";
    current.history.forEach((m) => box.appendChild(messageEl(m)));
    scrollDown();
  }

  function actionBtn(label, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn(b);
    });
    return b;
  }

  function messageEl(m) {
    const frag = document.createDocumentFragment();
    const el = document.createElement("div");
    el.className = "msg " + (m.role === "coach" ? "coach" : "me");
    const text = document.createElement("div");

    if (m.role === "me" && m.correction) {
      const { A, keepA, missA } = diff(m.text, m.correction);
      text.appendChild(highlighted(A, keepA, "bad", missA));
      el.classList.add("has-fix");
      el.addEventListener("click", () => openSheet(m));
    } else text.textContent = m.text;
    el.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    if (m.role === "coach") {
      if (m.tr && m.trLang === settings.helperLang) appendTranslation(el, m.tr);
      actions.append(
        actionBtn("🔊", () => speak(m.text)),
        ...(settings.helperLang !== "en" ? [actionBtn("文A Translate", (b) => translate(m, el, b))] : []),
        actionBtn("⚑", () => report(m.text))
      );
    } else {
      actions.append(actionBtn("▶ Listen", () => speak(m.text)));
      if (m.correction) actions.append(actionBtn("🔍 Feedback", () => openSheet(m)));
    }
    el.appendChild(actions);
    frag.appendChild(el);

    if (m.role === "me" && m.correction) {
      const { B, keepB } = diff(m.text, m.correction);
      const fix = document.createElement("div");
      fix.className = "fix";
      fix.innerHTML = `<div class="label">It's better to say:</div><div class="better"></div>`;
      fix.querySelector(".better").appendChild(highlighted(B, keepB, "good"));
      if (m.tip) {
        const tip = document.createElement("div");
        tip.className = "tip";
        tip.textContent = "💡 " + m.tip;
        if (isRtl(settings.helperLang)) tip.setAttribute("dir", "rtl");
        fix.appendChild(tip);
      }
      const fa = document.createElement("div");
      fa.className = "msg-actions";
      fa.append(actionBtn("🔊 Listen", () => speak(m.correction)), actionBtn("🎙️ Say it", () => practise(m.correction)));
      fix.appendChild(fa);
      frag.appendChild(fix);
    }
    return frag;
  }

  function appendTranslation(el, tr) {
    const d = document.createElement("div");
    d.className = "tr";
    d.textContent = tr;
    if (isRtl(settings.helperLang)) d.setAttribute("dir", "rtl");
    el.insertBefore(d, el.querySelector(".msg-actions"));
  }

  async function translate(m, el, btn) {
    if (m.tr && m.trLang === settings.helperLang) {
      const old = el.querySelector(".tr");
      if (old) old.remove();
      else appendTranslation(el, m.tr);
      return;
    }
    btn.textContent = "…";
    try {
      const data = await api({ mode: "translate", text: m.text, helperLang: settings.helperLang }, 30000);
      m.tr = data.translation;
      m.trLang = settings.helperLang;
      appendTranslation(el, m.tr);
      saveConv();
    } catch {
      toast("Could not translate. Try again.");
    }
    btn.textContent = "文A Translate";
  }

  function practise(sentence) {
    $("input").value = "";
    toast("Now say: " + sentence);
    startListening();
  }

  function addToChat(m) {
    current.history.push(m);
    $("messages").appendChild(messageEl(m));
    scrollDown();
    saveConv();
  }

  function renderHints(force) {
    const box = $("hints");
    box.innerHTML = "";
    if ((!settings.showHints && !force) || busy) return;
    for (const h of lastHints) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hint";
      b.textContent = h;
      b.addEventListener("click", () => {
        $("input").value = h;
        $("input").focus();
      });
      box.appendChild(b);
    }
  }
  $("hintBtn").addEventListener("click", () => {
    if (!lastHints.length) return toast("Answer ideas appear after " + TUTOR + " asks you something.");
    $("hints").childElementCount ? ($("hints").innerHTML = "") : renderHints(true);
  });

  function setBusy(on) {
    busy = on;
    $("sendBtn").disabled = on;
    if (on) stageState("thinking");
    else if ($("stage").classList.contains("thinking")) stageState("online");
    const old = $("messages").querySelector(".typing");
    if (old) old.remove();
    if (on) {
      const t = document.createElement("div");
      t.className = "typing";
      t.innerHTML = "<i></i><i></i><i></i>";
      $("messages").appendChild(t);
      scrollDown();
    }
    renderHints();
  }

  function showError(err, retry) {
    const e = document.createElement("div");
    e.className = "error";
    e.textContent = err.message + (err.detail ? "\n[" + String(err.detail).slice(0, 160) + "]" : "");
    const b = document.createElement("button");
    b.textContent = "Try again";
    b.addEventListener("click", () => {
      e.remove();
      retry();
    });
    e.appendChild(b);
    $("messages").appendChild(e);
    scrollDown();
  }

  const normalise = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

  async function askCoach() {
    if (busy || !current) return;
    const conv = current;
    lastHints = [];
    setBusy(true);
    try {
      const data = await api({
        level: conv.level,
        topic: conv.topic.title,
        role: conv.topic.role,
        goal: conv.topic.goal,
        helperLang: settings.helperLang,
        history: conv.history.map((m) => ({ role: m.role, text: m.text })),
      });
      if (conv !== current) return;
      setBusy(false);
      const lastMe = [...conv.history].reverse().find((m) => m.role === "me");
      if (lastMe && !lastMe.checked) {
        lastMe.checked = true;
        if (data.correction && normalise(data.correction) !== normalise(lastMe.text)) {
          lastMe.correction = data.correction;
          lastMe.tip = data.tip || "";
          stats.corrections++;
          stats.reviews.unshift({ wrong: lastMe.text, right: data.correction });
          stats.reviews = stats.reviews.slice(0, 30);
        } else {
          stats.stars++;
        }
        saveStats();
        renderMessages();
      }
      addToChat({ role: "coach", text: data.reply });
      lastHints = Array.isArray(data.hints) ? data.hints.slice(0, 3) : [];
      renderHints();
      if (settings.autoSpeak) speak(data.reply);
      maybeFinishLesson();
    } catch (err) {
      if (conv !== current) return;
      setBusy(false);
      showError(navigator.onLine ? err : new Error("You are offline. Please connect to the internet."), askCoach);
    }
  }

  async function maybeFinishLesson() {
    const conv = current;
    if (!conv || conv.completed) return;
    if (conv.history.filter((m) => m.role === "me").length < LESSON_TURNS) return;
    conv.completed = true;
    saveConv();
    const key = conv.level + ":" + conv.topic.id;
    stats.done[key] = (stats.done[key] || 0) + 1;
    stats.gems += 10;
    if (conv.topic.id.startsWith("daily-")) {
      stats.challenges[conv.topic.id.slice(6)] = true;
      stats.gems += 15;
      toast("🏅 Daily challenge complete! +15 gems");
    }
    saveStats();
    let summary = null;
    try {
      summary = await api({ mode: "summary", level: conv.level, topic: conv.topic.title, helperLang: settings.helperLang, history: conv.history.map((m) => ({ role: m.role, text: m.text })) }, 40000);
      stats.scores.push({ d: dayKey(), g: summary.grammar, f: summary.fluency, v: summary.vocabulary });
      stats.scores = stats.scores.slice(-60);
      if (summary.takeaway) stats.takeaways.unshift({ title: summary.takeaway, text: summary.explanation, d: dayKey() });
      stats.takeaways = stats.takeaways.slice(0, 20);
      saveStats();
    } catch {}
    if (conv !== current) return;
    $("messages").appendChild(doneCard(summary));
    scrollDown();
  }

  function doneCard(s) {
    const card = document.createElement("div");
    card.className = "done-card";
    card.innerHTML = `<div style="font-size:2rem">🎉</div><h3>Lesson complete!</h3><div class="reward"><span>💎 +10 gems</span><span>⭐ ${stats.stars} stars</span></div>`;
    if (s) {
      const p = document.createElement("p");
      p.className = "praise";
      p.textContent = s.praise;
      card.appendChild(p);
      const sc = document.createElement("div");
      sc.className = "done-scores";
      for (const [v, l] of [[s.grammar, "Grammar"], [s.fluency, "Fluency"], [s.vocabulary, "Vocabulary"]]) {
        const d = document.createElement("div");
        d.innerHTML = `<b></b><small></small>`;
        d.querySelector("b").textContent = v + "%";
        d.querySelector("small").textContent = l;
        sc.appendChild(d);
      }
      card.appendChild(sc);
      if (s.takeaway) {
        const t = document.createElement("div");
        t.className = "done-take";
        t.innerHTML = `<small>📋 Grammar takeaway</small><b></b><p></p>`;
        t.querySelector("b").textContent = s.takeaway;
        t.querySelector("p").textContent = s.explanation;
        if (isRtl(settings.helperLang)) t.querySelector("p").setAttribute("dir", "rtl");
        card.appendChild(t);
      }
    }
    const btns = document.createElement("div");
    btns.className = "done-btns";
    btns.style.marginTop = "12px";
    const keep = actionBtn("Keep talking", () => card.remove());
    const next = actionBtn("Next lesson →", () => {
      const n = nextTopic();
      n ? openTopic(settings.level, n) : show("progress");
    });
    next.className = "blue";
    btns.append(keep, next);
    card.appendChild(btns);
    return card;
  }

  function trackWords(text) {
    const words = (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []).filter((w) => w.length > 1 || w === "a" || w === "i");
    const today = dayKey();
    stats.wordDays[today] = (stats.wordDays[today] || 0) + words.length;
    for (const w of words) if (!stats.words[w] && Object.keys(stats.words).length < 5000) stats.words[w] = today;
    // keep wordDays small
    const cutoff = dayKey(daysAgo(60));
    for (const k of Object.keys(stats.wordDays)) if (k < cutoff) delete stats.wordDays[k];
  }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("input").value.trim();
    if (!text || busy) return;
    $("input").value = "";
    $("hints").innerHTML = "";
    stopSpeaking();
    if (listening && recognizer) recognizer.stop();
    addToChat({ role: "me", text });
    stats.messages++;
    stats.gems += 1;
    stats.days[dayKey()] = todayCount() + 1;
    trackWords(text);
    const s = streak();
    if (s > stats.best) stats.best = s;
    if (todayCount() === settings.dailyGoal) toast("🎉 Daily goal reached! +5 gems");
    if (todayCount() === settings.dailyGoal) stats.gems += 5;
    saveStats();
    askCoach();
  });

  function report(text) {
    const subject = encodeURIComponent(CFG.APP_NAME + " — Report AI message");
    const body = encodeURIComponent('I want to report this AI message:\n\n"' + text + '"\n\nTopic: ' + (current ? current.level + " / " + current.topic.title : "") + "\n\nReason: ");
    window.location.href = `mailto:${CFG.SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }

  // ---------- Feedback sheet ----------
  let sheetMsg = null;
  function openSheet(m) {
    sheetMsg = m;
    const { A, B, keepA, keepB, missA } = diff(m.text, m.correction);
    $("sheetMine").innerHTML = "";
    $("sheetMine").appendChild(highlighted(A, keepA, "bad", missA));
    $("sheetFix").innerHTML = "";
    $("sheetFix").appendChild(highlighted(B, keepB, "good"));
    $("sheetTip").textContent = m.tip ? "💡 " + m.tip : "";
    if (isRtl(settings.helperLang)) $("sheetTip").setAttribute("dir", "rtl");
    else $("sheetTip").removeAttribute("dir");
    $("sheet").classList.remove("hidden");
    history.pushState({ sheet: true }, "");
  }
  function closeSheet() {
    $("sheet").classList.add("hidden");
  }
  $("sheetClose").addEventListener("click", () => (history.state && history.state.sheet ? history.back() : closeSheet()));
  $("sheet").addEventListener("click", (e) => e.target === $("sheet") && $("sheetClose").click());
  $("sheetListen").addEventListener("click", () => sheetMsg && speak(sheetMsg.correction));
  $("sheetPractice").addEventListener("click", () => {
    const s = sheetMsg && sheetMsg.correction;
    $("sheetClose").click();
    if (s) setTimeout(() => practise(s), 250);
  });
  document.querySelectorAll(".helpful button").forEach((b) => b.addEventListener("click", () => toast("Thanks for your feedback!")));

  // ---------- Text to speech (with talking avatar) ----------
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const v = speechSynthesis.getVoices();
    voice =
      v.find((x) => /en[-_]US/i.test(x.lang) && /female|samantha|google us english/i.test(x.name)) ||
      v.find((x) => /en[-_]US/i.test(x.lang) && /google/i.test(x.name)) ||
      v.find((x) => /en[-_](US|GB)/i.test(x.lang)) ||
      v.find((x) => /^en/i.test(x.lang)) ||
      null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  let talkTimer;
  let speakToken = 0;
  // Split long text into short sentences: Android Chrome stops speaking after ~15 seconds.
  const chunksOf = (text) => (String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)]).map((c) => c.trim()).filter(Boolean);
  function speak(text, opts = {}) {
    if (!text || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const token = ++speakToken;
    const parts = chunksOf(text);
    const rate = opts.rate || Number(settings.rate) || 0.9;
    const done = () => {
      clearTimeout(talkTimer);
      if (token === speakToken && $("stage").classList.contains("speaking")) stageState("online");
    };
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = "en-US";
      if (voice) u.voice = voice;
      u.rate = rate;
      if (i === 0) u.onstart = () => token === speakToken && view === "chat" && stageState("speaking");
      if (i === parts.length - 1) u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
    // Safety: stop the mouth if the browser never fires onend.
    clearTimeout(talkTimer);
    talkTimer = setTimeout(done, 2000 + (text.length * 90) / rate);
  }
  function stopSpeaking() {
    speakToken++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if ($("stage").classList.contains("speaking")) stageState("online");
  }

  // ---------- Speech to text ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;
  function startListening() {
    if (!SR) return toast("Voice input needs Google Chrome. Please open the app in Chrome.");
    if (listening) return recognizer && recognizer.stop();
    stopSpeaking();
    recognizer = new SR();
    recognizer.lang = "en-US";
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;
    const before = $("input").value ? $("input").value.trim() + " " : "";
    recognizer.onstart = () => {
      listening = true;
      $("micBtn").classList.add("listening");
      $("input").placeholder = "Listening… speak now";
      stageState("listening");
    };
    recognizer.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      $("input").value = before + text;
    };
    recognizer.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Please allow microphone access to speak.");
      else if (e.error === "no-speech") toast("I didn't hear anything. Try again.");
    };
    recognizer.onend = () => {
      listening = false;
      $("micBtn").classList.remove("listening");
      $("input").placeholder = "Type or tap the mic…";
      if ($("stage").classList.contains("listening")) stageState("online");
      if ($("input").value.trim()) $("input").focus();
    };
    try {
      recognizer.start();
    } catch {
      toast("Could not start the microphone.");
    }
  }
  $("micBtn").addEventListener("click", startListening);

  // ---------- Settings ----------
  const rateName = (r) => (r <= 0.7 ? "Slow" : r <= 0.9 ? "Relaxed" : r <= 1.0 ? "Normal" : "Fast");
  function syncSettingsForm() {
    $("nameSetting").value = settings.name;
    $("helperLang").value = settings.helperLang;
    $("autoSpeak").checked = !!settings.autoSpeak;
    $("showHints").checked = !!settings.showHints;
    $("rate").value = settings.rate;
    $("rateLabel").textContent = rateName(settings.rate);
    $("dailyGoal").value = String(settings.dailyGoal);
  }
  syncSettingsForm();
  const bind = (id, key, get) =>
    $(id).addEventListener("change", (e) => {
      settings[key] = get(e.target);
      saveSettings();
    });
  bind("nameSetting", "name", (t) => t.value.trim().slice(0, 30) || "Learner");
  bind("helperLang", "helperLang", (t) => t.value);
  bind("autoSpeak", "autoSpeak", (t) => t.checked);
  bind("showHints", "showHints", (t) => t.checked);
  bind("dailyGoal", "dailyGoal", (t) => Number(t.value));
  $("rate").addEventListener("input", (e) => ($("rateLabel").textContent = rateName(Number(e.target.value))));
  $("rate").addEventListener("change", (e) => {
    settings.rate = Number(e.target.value);
    saveSettings();
    speak("This is my new speaking speed.");
  });

  let resetArmed = 0;
  $("resetBtn").addEventListener("click", () => {
    if (Date.now() - resetArmed > 4000) {
      resetArmed = Date.now();
      return toast("Tap again to reset all progress.");
    }
    Object.assign(stats, freshStats());
    saveStats();
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("etc.conv.")).forEach((k) => localStorage.removeItem(k));
    } catch {}
    toast("Progress reset.");
  });


  // =====================================================================
  // Recommendations (personalised, rule-based — no extra AI cost)
  // =====================================================================
  function recommendations() {
    const recs = [];
    const today = dayKey();
    const lastScore = stats.scores[stats.scores.length - 1];
    if (!stats.challenges[today]) recs.push({ ic: "🏅", bg: "#ffe8d6", title: "Today's speaking challenge", sub: "New every day · +15 gems", why: "Daily", go: () => show("practice") });
    const toReview = stats.reviews.length;
    if (toReview >= 2 && stats.lastMistakeQuiz !== today) recs.push({ ic: "✏️", bg: "#fde2f3", title: "Fix your mistakes", sub: `Quiz from your ${Math.min(toReview, 8)} latest corrections`, why: "Your mistakes", go: startMistakeQuiz });
    if (lastScore) {
      const weakest = [["g", lastScore.g], ["f", lastScore.f], ["v", lastScore.v]].sort((a, b) => a[1] - b[1])[0][0];
      if (weakest === "g") recs.push({ ic: "🧠", bg: "#dbe7ff", title: "Grammar quiz", sub: `Grammar is your lowest skill (${lastScore.g}%)`, why: "Weakest skill", go: startDailyQuiz });
      if (weakest === "f") recs.push({ ic: "🎙️", bg: "#d7f7e3", title: "Free talk for 5 minutes", sub: `Build fluency (${lastScore.f}%) by speaking more`, why: "Weakest skill", go: () => openTopic(settings.level, window.FREE_TALK) });
      if (weakest === "v") recs.push({ ic: "📘", bg: "#fff3c7", title: "Learn today's 5 words", sub: `Grow your vocabulary (${lastScore.v}%)`, why: "Weakest skill", go: () => show("practice") });
    }
    if (!stats.pron.n) recs.push({ ic: "🗣️", bg: "#d7f7e3", title: "Try pronunciation practice", sub: "Say a sentence and get a score", why: "New", go: startPronunciation });
    const next = nextTopic();
    if (next && !recs.length) recs.push({ ic: next.icon, bg: "#dbe7ff", title: next.title, sub: "Your next lesson", why: "Next step", go: () => openTopic(settings.level, next) });
    return recs.slice(0, 3);
  }
  function renderRecs() {
    const list = $("recList");
    list.innerHTML = "";
    const recs = recommendations();
    $("recs").classList.toggle("hidden", !recs.length);
    recs.forEach((r, i) => {
      const b = document.createElement("button");
      b.className = "rec";
      b.style.animationDelay = i * 60 + "ms";
      b.innerHTML = `<span class="rec-ic"></span><span class="rec-body"><span class="why"></span><b></b><small></small></span><svg class="chev" viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      b.querySelector(".rec-ic").textContent = r.ic;
      b.querySelector(".rec-ic").style.background = r.bg;
      b.querySelector(".why").textContent = r.why;
      b.querySelector("b").textContent = r.title;
      b.querySelector("small").textContent = r.sub;
      b.addEventListener("click", r.go);
      list.appendChild(b);
    });
  }

  // =====================================================================
  // Daily pack: challenge + words + quiz (one AI call per day, cached)
  // =====================================================================
  let dailyLoading = null;
  const dailyKey = () => `daily.${dayKey()}.${settings.level}.${settings.helperLang}`;
  function loadDaily() {
    const cached = store.get(dailyKey(), null);
    if (cached) return Promise.resolve(cached);
    if (dailyLoading) return dailyLoading;
    dailyLoading = api({ mode: "daily", level: settings.level, helperLang: settings.helperLang, date: dayKey() }, 45000)
      .then((pack) => {
        // Remove older packs, keep today's.
        try {
          Object.keys(localStorage).filter((k) => k.startsWith("etc.daily.") && !k.includes(dayKey())).forEach((k) => localStorage.removeItem(k));
        } catch {}
        store.set(dailyKey(), pack);
        return pack;
      })
      .finally(() => (dailyLoading = null));
    return dailyLoading;
  }

  function renderPractice() {
    $("chDate").textContent = new Date().toLocaleDateString("en", { weekday: "long", month: "short", day: "numeric" });
    const learnedCount = Object.keys(stats.learned).length;
    $("wordsLearned").textContent = learnedCount ? `${learnedCount} learned` : "";
    $("quizSub").textContent = stats.quiz.taken ? `Best habit: ${Math.round((stats.quiz.correct / Math.max(1, stats.quiz.total)) * 100)}% correct` : "5 questions";
    $("mistakeSub").textContent = stats.reviews.length >= 2 ? `${Math.min(stats.reviews.length, 8)} sentences to fix` : "Make a few mistakes first 🙂";
    $("pronSub").textContent = stats.pron.n ? `Average ${Math.round(stats.pron.sum / stats.pron.n)}%` : "Say it, get a score";

    const cached = store.get(dailyKey(), null);
    if (cached) return fillDaily(cached);
    $("chBody").innerHTML = `<div class="skeleton line w70"></div><div class="skeleton line"></div><div class="skeleton line w50"></div>`;
    $("flashRow").innerHTML = `<div class="flash skeleton-card"></div><div class="flash skeleton-card"></div>`;
    loadDaily()
      .then((pack) => view === "practice" && fillDaily(pack))
      .catch((err) => {
        if (view !== "practice") return;
        $("chBody").innerHTML = `<div class="ch-err"><p></p><button type="button">Try again</button></div>`;
        $("chBody").querySelector("p").textContent = "Could not load today's challenge. " + (err.message || "");
        $("chBody").querySelector("button").addEventListener("click", renderPractice);
        $("flashRow").innerHTML = "";
      });
  }

  function fillDaily(pack) {
    const c = pack.challenge;
    const body = $("chBody");
    body.innerHTML = `<h3></h3><p></p><p class="ex"></p>`;
    body.querySelector("h3").textContent = c.title;
    body.querySelector("p").textContent = c.task;
    body.querySelector(".ex").textContent = "e.g. “" + c.example + "”";
    if (stats.challenges[dayKey()]) {
      body.insertAdjacentHTML("beforeend", `<span class="ch-done">✓ Completed today · come back tomorrow</span>`);
    } else {
      const b = document.createElement("button");
      b.className = "ch-btn";
      b.textContent = "Start challenge →";
      b.addEventListener("click", () => startChallenge(pack));
      body.appendChild(b);
    }

    const row = $("flashRow");
    row.innerHTML = "";
    pack.words.forEach((w, i) => {
      const card = document.createElement("div");
      card.className = "flash";
      card.style.animationDelay = i * 60 + "ms";
      card.innerHTML = `<div class="fw"><b></b><button type="button" aria-label="Listen">🔊</button></div><div class="fm"></div><div class="ft"></div><div class="fe"></div><button type="button" class="learn"></button>`;
      card.querySelector("b").textContent = w.word;
      card.querySelector(".fm").textContent = w.meaning;
      const ft = card.querySelector(".ft");
      ft.textContent = settings.helperLang !== "en" ? w.translation : "";
      if (isRtl(settings.helperLang)) ft.setAttribute("dir", "rtl");
      card.querySelector(".fe").textContent = w.example;
      card.querySelector(".fw button").addEventListener("click", () => speak(w.word + ". " + w.example, { rate: 0.85 }));
      const learn = card.querySelector(".learn");
      const key = w.word.toLowerCase();
      const paint = () => {
        const on = !!stats.learned[key];
        learn.classList.toggle("on", on);
        learn.textContent = on ? "✓ Learned" : "I know this word";
      };
      paint();
      learn.addEventListener("click", () => {
        if (stats.learned[key]) delete stats.learned[key];
        else {
          stats.learned[key] = dayKey();
          stats.gems += 1;
        }
        saveStats();
        paint();
        $("wordsLearned").textContent = `${Object.keys(stats.learned).length} learned`;
      });
      row.appendChild(card);
    });
  }

  function startChallenge(pack) {
    const c = pack.challenge;
    openTopic(settings.level, {
      id: "daily-" + dayKey(),
      icon: "🏅",
      title: c.title,
      role: "a friendly tutor running today's speaking challenge. Give the learner the challenge, encourage them, and ask follow-up questions about it. Challenge: " + c.task,
      goal: c.task,
    });
  }

  // =====================================================================
  // Activities: quiz engine and pronunciation practice
  // =====================================================================
  let act = null;
  function openActivity() {
    history.pushState({ activity: true }, "");
    show("activity");
  }
  $("actBack").addEventListener("click", () => (history.state && history.state.activity ? history.back() : show("practice")));
  const setActProgress = (i, n) => {
    $("actBar").style.width = Math.round((i / n) * 100) + "%";
    $("actCount").textContent = `${Math.min(i + 1, n)}/${n}`;
  };

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startQuiz(questions, kind) {
    act = { type: "quiz", kind, questions, i: 0, correct: 0 };
    openActivity();
    renderQuestion();
  }

  async function startDailyQuiz() {
    let pack = store.get(dailyKey(), null);
    if (!pack) {
      toast("Loading today's quiz…");
      try {
        pack = await loadDaily();
      } catch (err) {
        return toast("Could not load the quiz. " + err.message);
      }
    }
    startQuiz(pack.quiz.map((q) => ({ ...q, kind: "Daily quiz" })), "daily");
  }

  function startMistakeQuiz() {
    const items = stats.reviews.filter((r) => r.wrong && r.right && r.wrong.toLowerCase() !== r.right.toLowerCase()).slice(0, 8);
    if (items.length < 2) return toast("Talk with " + TUTOR + " first — your corrected sentences become your quiz.");
    const qs = items.map((r) => {
      const options = shuffle([r.right, r.wrong]);
      return { kind: "Which sentence is correct?", q: "Choose the correct English:", options, answer: options.indexOf(r.right), explain: "", right: r.right, wrong: r.wrong };
    });
    stats.lastMistakeQuiz = dayKey();
    saveStats();
    startQuiz(shuffle(qs).slice(0, 6), "mistakes");
  }

  function renderQuestion() {
    const q = act.questions[act.i];
    setActProgress(act.i, act.questions.length);
    const body = $("actBody");
    body.innerHTML = `<div class="q-kind"></div><div class="q-text"></div><div class="options"></div>`;
    body.style.animation = "none";
    void body.offsetWidth;
    body.style.animation = "";
    body.querySelector(".q-kind").textContent = q.kind || "Quiz";
    body.querySelector(".q-text").textContent = q.q;
    const box = body.querySelector(".options");
    q.options.forEach((o, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.textContent = o;
      b.addEventListener("click", () => answer(idx, b));
      box.appendChild(b);
    });
  }

  function answer(idx, btn) {
    const q = act.questions[act.i];
    if (act.answered === act.i) return;
    act.answered = act.i;
    const ok = idx === q.answer;
    if (ok) act.correct++;
    const opts = $("actBody").querySelectorAll(".opt");
    opts[q.answer].classList.add("right");
    if (!ok) btn.classList.add("wrong");
    const ex = document.createElement("div");
    ex.className = "explain";
    ex.innerHTML = `<b></b><p></p>`;
    ex.querySelector("b").textContent = ok ? "✅ Correct! +2 gems" : "❌ Not quite";
    const p = ex.querySelector("p");
    if (q.explain) {
      p.textContent = q.explain;
      if (isRtl(settings.helperLang)) p.setAttribute("dir", "rtl");
    } else if (q.right) {
      $("actBody").querySelectorAll(".opt").forEach((o) => {
        if (o.textContent === q.right) {
          o.textContent = "";
          const { B, keepB } = diff(q.wrong, q.right);
          o.appendChild(highlighted(B, keepB, "good"));
        }
      });
      p.textContent = "The green words are the fix.";
    }
    $("actBody").appendChild(ex);
    if (ok) stats.gems += 2;
    if (q.right) speak(q.right);
    const next = document.createElement("button");
    next.className = "primary-btn act-next";
    next.textContent = act.i + 1 < act.questions.length ? "Continue" : "See results";
    next.addEventListener("click", () => {
      act.i++;
      if (act.i < act.questions.length) renderQuestion();
      else finishQuiz();
    });
    $("actBody").appendChild(next);
    next.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function finishQuiz() {
    const n = act.questions.length;
    stats.quiz.taken++;
    stats.quiz.correct += act.correct;
    stats.quiz.total += n;
    if (!stats.days[dayKey()]) stats.days[dayKey()] = 1; // a quiz counts as practice for the streak
    const pct = Math.round((act.correct / n) * 100);
    if (pct === 100) stats.stars += 3;
    saveStats();
    setActProgress(n, n);
    $("actCount").textContent = "";
    const body = $("actBody");
    body.innerHTML = `<div class="result"><div class="big"></div><h2></h2><div class="score-ring"><b></b></div><p></p></div>`;
    body.querySelector(".big").textContent = pct >= 80 ? "🏆" : pct >= 50 ? "👏" : "💪";
    body.querySelector("h2").textContent = pct >= 80 ? "Excellent!" : pct >= 50 ? "Good job!" : "Keep practising!";
    body.querySelector(".score-ring").style.setProperty("--p", pct);
    body.querySelector(".score-ring b").textContent = `${act.correct}/${n}`;
    body.querySelector("p").textContent = `You earned ${act.correct * 2} gems${pct === 100 ? " and 3 stars ⭐" : ""}.`;
    const again = document.createElement("button");
    again.className = "primary-btn";
    again.textContent = "Back to practice";
    again.addEventListener("click", () => $("actBack").click());
    body.appendChild(again);
  }

  // ---------- Pronunciation ----------
  function pronSentences() {
    const mine = stats.reviews.map((r) => r.right).filter((t) => t && t.split(/\s+/).length <= 14);
    const pack = store.get(dailyKey(), null);
    const daily = pack ? pack.words.map((w) => w.example) : [];
    const preset = (window.PRON_PHRASES && window.PRON_PHRASES[settings.level]) || [];
    const all = [...new Set([...mine.slice(0, 4), ...daily.slice(0, 3), ...shuffle(preset)])];
    return all.slice(0, 6);
  }

  function startPronunciation() {
    if (!SR) return toast("Pronunciation practice needs Google Chrome on Android. Please open the app in Chrome.");
    act = { type: "pron", items: pronSentences(), i: 0, scores: [] };
    openActivity();
    renderPron();
  }

  function renderPron() {
    const target = act.items[act.i];
    setActProgress(act.i, act.items.length);
    const body = $("actBody");
    body.innerHTML = `<div class="q-kind">Pronunciation · say this sentence</div>
      <div class="pron-card"><div class="pron-text"></div>
        <div class="pron-btns"><button type="button" class="round" data-a="slow" aria-label="Listen slowly">🐢</button>
        <button type="button" class="mic-btn" data-a="mic" aria-label="Speak"><svg viewBox="0 0 24 24" width="30" height="30"><rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button type="button" class="round" data-a="listen" aria-label="Listen">🔊</button></div>
        <div class="heard">Tap 🔊 to listen, then tap the mic and read it aloud.</div><div class="pron-score"></div></div>`;
    body.querySelector(".pron-text").textContent = target;
    body.querySelector('[data-a="listen"]').addEventListener("click", () => speak(target));
    body.querySelector('[data-a="slow"]').addEventListener("click", () => speak(target, { rate: 0.6 }));
    body.querySelector('[data-a="mic"]').addEventListener("click", (e) => listenPron(target, e.currentTarget));
  }

  let pronRec = null;
  function stopActivityListening() {
    try {
      pronRec && pronRec.abort();
    } catch {}
    pronRec = null;
  }
  function listenPron(target, btn) {
    if (pronRec) return stopActivityListening();
    stopSpeaking();
    const rec = new SR();
    pronRec = rec;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    let heard = "";
    let best = "";
    const heardEl = $("actBody").querySelector(".heard");
    rec.onstart = () => {
      btn.classList.add("listening");
      heardEl.textContent = "Listening… read the sentence now";
    };
    rec.onresult = (e) => {
      heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript + " ";
      heardEl.textContent = "I heard: “" + heard.trim() + "”";
      // Pick the alternative that matches best on the final result.
      const last = e.results[e.results.length - 1];
      if (last.isFinal) {
        best = heard;
        for (let a = 0; a < last.length; a++) {
          const alt = heard.replace(last[0].transcript, last[a].transcript);
          if (pronScore(target, alt).pct > pronScore(target, best).pct) best = alt;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Please allow microphone access.");
      else if (e.error === "no-speech") heardEl.textContent = "I didn't hear anything. Tap the mic and try again.";
    };
    rec.onend = () => {
      btn.classList.remove("listening");
      if (pronRec === rec) pronRec = null;
      const said = (best || heard).trim();
      if (!said || view !== "activity") return;
      showPronResult(target, said);
    };
    try {
      rec.start();
    } catch {
      toast("Could not start the microphone.");
    }
  }

  function pronScore(target, said) {
    const { A, keepA } = diff(target, said);
    const words = A.filter((w) => norm(w));
    const matched = A.filter((w, i) => keepA[i] && norm(w)).length;
    return { A, keepA, pct: words.length ? Math.round((matched / words.length) * 100) : 0 };
  }

  function showPronResult(target, said) {
    const { A, keepA, pct } = pronScore(target, said);
    const text = $("actBody").querySelector(".pron-text");
    text.textContent = "";
    A.forEach((w, i) => {
      if (i) text.appendChild(document.createTextNode(" "));
      const m = document.createElement("mark");
      m.className = keepA[i] ? "good" : "bad";
      m.textContent = w;
      text.appendChild(m);
    });
    const sc = $("actBody").querySelector(".pron-score");
    sc.className = "pron-score " + (pct >= 80 ? "ok" : pct >= 50 ? "meh" : "low");
    sc.textContent = (pct >= 80 ? "🎉 Great! " : pct >= 50 ? "👍 Almost! " : "💪 Try again. ") + pct + "% clear" + (pct < 100 ? " · red words need practice" : "");
    act.scores[act.i] = Math.max(act.scores[act.i] || 0, pct);
    let next = $("actBody").querySelector(".act-next");
    if (!next) {
      next = document.createElement("button");
      next.className = "primary-btn act-next";
      $("actBody").appendChild(next);
      next.addEventListener("click", () => {
        act.i++;
        if (act.i < act.items.length) renderPron();
        else finishPron();
      });
    }
    next.textContent = act.i + 1 < act.items.length ? "Next sentence" : "See results";
  }

  function finishPron() {
    const done = act.scores.filter((x) => typeof x === "number");
    const avgPct = done.length ? Math.round(done.reduce((a, b) => a + b, 0) / done.length) : 0;
    stats.pron.n += done.length;
    stats.pron.sum += done.reduce((a, b) => a + b, 0);
    const stars = done.filter((x) => x >= 80).length;
    stats.stars += stars;
    if (done.length && !stats.days[dayKey()]) stats.days[dayKey()] = 1;
    saveStats();
    setActProgress(1, 1);
    $("actCount").textContent = "";
    const body = $("actBody");
    body.innerHTML = `<div class="result"><div class="big"></div><h2></h2><div class="score-ring"><b></b></div><p></p></div>`;
    body.querySelector(".big").textContent = avgPct >= 80 ? "🗣️" : "💪";
    body.querySelector("h2").textContent = avgPct >= 80 ? "Very clear speaking!" : "Good practice!";
    body.querySelector(".score-ring").style.setProperty("--p", avgPct);
    body.querySelector(".score-ring b").textContent = avgPct + "%";
    body.querySelector("p").textContent = `You earned ${stars} star${stars === 1 ? "" : "s"} ⭐. Practise the red words again tomorrow.`;
    const again = document.createElement("button");
    again.className = "primary-btn";
    again.textContent = "Back to practice";
    again.addEventListener("click", () => $("actBack").click());
    body.appendChild(again);
  }

  // ---------- Job interview ----------
  function startInterview(job) {
    const name = String(job || "").trim().slice(0, 40);
    if (!name) return;
    $("jobSheet").classList.add("hidden");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job";
    openTopic(settings.level, {
      id: "job-" + slug,
      icon: "💼",
      title: "Interview: " + name,
      role:
        "a professional, friendly HR manager interviewing the learner for a " +
        name +
        " job. Ask ONE realistic interview question at a time (about experience, skills, strengths, weaknesses, a difficult situation, why this job, availability, questions for you). React briefly and naturally to each answer before the next question",
      goal: "answer job interview questions clearly and confidently",
    });
  }
  function openJobSheet() {
    const grid = $("jobGrid");
    if (!grid.childElementCount) {
      for (const j of window.JOBS || []) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = j.icon + " " + j.name;
        b.addEventListener("click", () => startInterview(j.name));
        grid.appendChild(b);
      }
    }
    $("jobSheet").classList.remove("hidden");
  }
  $("jobBtn").addEventListener("click", openJobSheet);
  $("jobClose").addEventListener("click", () => $("jobSheet").classList.add("hidden"));
  $("jobSheet").addEventListener("click", (e) => e.target === $("jobSheet") && $("jobSheet").classList.add("hidden"));
  $("jobForm").addEventListener("submit", (e) => {
    e.preventDefault();
    startInterview($("jobInput").value);
  });
  $("quizBtn").addEventListener("click", startDailyQuiz);
  $("mistakeQuizBtn").addEventListener("click", startMistakeQuiz);
  $("pronBtn").addEventListener("click", startPronunciation);

  // ---------- Backup & restore ----------
  $("backupBtn").addEventListener("click", () => {
    const data = { app: "english-talk-coach", v: 2, date: new Date().toISOString(), settings, stats };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `english-talk-coach-backup-${dayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
    toast("Backup saved to your Downloads.");
  });
  $("restoreInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("too big");
      const data = JSON.parse(await file.text());
      if (!data || data.app !== "english-talk-coach" || typeof data.stats !== "object" || typeof data.settings !== "object") throw new Error("bad");
      const base = freshStats();
      for (const k of Object.keys(base)) if (typeof data.stats[k] === typeof base[k] && Array.isArray(data.stats[k]) === Array.isArray(base[k])) stats[k] = data.stats[k];
      for (const k of ["name", "level", "helperLang", "autoSpeak", "showHints", "rate", "dailyGoal"]) if (k in data.settings && typeof data.settings[k] === typeof settings[k]) settings[k] = data.settings[k];
      if (!LEVELS.includes(settings.level)) settings.level = "beginner";
      saveStats();
      saveSettings();
      syncSettingsForm();
      toast("✅ Progress restored!");
    } catch {
      toast("This is not a valid English Talk Coach backup file.");
    }
  });

  // ---------- Start ----------
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  show(settings.onboarded ? "home" : "welcome");
})();
