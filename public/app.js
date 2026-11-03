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
      } catch {}
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
  const freshStats = () => ({ messages: 0, corrections: 0, done: {}, days: {}, best: 0, reviews: [], gems: 0, stars: 0, words: {}, wordDays: {}, scores: [], takeaways: [] });
  const stats = Object.assign(freshStats(), store.get("stats", {}));
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
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (norm(A[i]) === norm(B[j])) {
        keepA[i++] = true;
        keepB[j++] = true;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return { A, B, keepA, keepB };
  }
  function highlighted(tokens, keep, cls) {
    const frag = document.createDocumentFragment();
    tokens.forEach((t, k) => {
      if (k) frag.appendChild(document.createTextNode(" "));
      if (keep[k]) frag.appendChild(document.createTextNode(t));
      else {
        const mk = document.createElement("mark");
        mk.className = cls;
        mk.textContent = t;
        frag.appendChild(mk);
      }
    });
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
    for (const v of ["welcome", "home", "progress", "settings", "chat"]) $(v + "View").classList.toggle("hidden", v !== name);
    $("tabbar").classList.toggle("hidden", name === "chat" || name === "welcome");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if (name !== "chat") stopSpeaking();
    if (name === "home") renderHome();
    if (name === "progress") renderProgress();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => (t.dataset.view === "talk" ? openTopic(settings.level, window.FREE_TALK) : show(t.dataset.view)))
  );
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
  $("backBtn").addEventListener("click", () => (history.state && history.state.chat ? history.back() : show("home")));
  window.addEventListener("popstate", () => {
    if (!$("sheet").classList.contains("hidden")) return closeSheet();
    if (view === "chat") show("home");
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
      const { A, B, keepA, keepB } = diff(r.wrong, r.right);
      const d = document.createElement("div");
      d.className = "review";
      const w = document.createElement("div");
      w.className = "wrong";
      w.appendChild(highlighted(A, keepA, "bad"));
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
      const { A, keepA } = diff(m.text, m.correction);
      text.appendChild(highlighted(A, keepA, "bad"));
      el.classList.add("has-fix");
      el.addEventListener("click", () => openSheet(m));
    } else text.textContent = m.text;
    el.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    if (m.role === "coach") {
      if (m.tr) appendTranslation(el, m.tr);
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
    if (m.tr) {
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
    const { A, B, keepA, keepB } = diff(m.text, m.correction);
    $("sheetMine").innerHTML = "";
    $("sheetMine").appendChild(highlighted(A, keepA, "bad"));
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
  function speak(text) {
    if (!text) return;
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    if (voice) u.voice = voice;
    u.rate = Number(settings.rate) || 0.9;
    u.onstart = () => view === "chat" && stageState("speaking");
    u.onend = u.onerror = () => {
      clearTimeout(talkTimer);
      if ($("stage").classList.contains("speaking")) stageState("online");
    };
    // Safety: stop the mouth if the browser never fires onend.
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => $("stage").classList.contains("speaking") && stageState("online"), 1500 + text.length * 90);
    speechSynthesis.speak(u);
  }
  function stopSpeaking() {
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

  // ---------- Start ----------
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  show(settings.onboarded ? "home" : "welcome");
})();
