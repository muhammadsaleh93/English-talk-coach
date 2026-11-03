(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const LEVELS = ["beginner", "intermediate", "advanced"];
  const LEVEL_NAMES = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
  const TILE_COLORS = ["#fde68a", "#bfdbfe", "#fbcfe8", "#bbf7d0", "#ddd6fe", "#fed7aa"];

  // ---------- Storage (safe) ----------
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
    { level: "beginner", helperLang: "en", autoSpeak: true, showHints: true, rate: 0.9, dailyGoal: 10 },
    store.get("settings", {})
  );
  const stats = Object.assign({ messages: 0, corrections: 0, done: {}, days: {}, best: 0, reviews: [] }, store.get("stats", {}));
  const saveSettings = () => store.set("settings", settings);
  const saveStats = () => store.set("stats", stats);

  // ---------- Dates & streak ----------
  const dayKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  function streak() {
    const d = new Date();
    if (!stats.days[dayKey(d)]) d.setDate(d.getDate() - 1); // streak still alive if practised yesterday
    let n = 0;
    while (stats.days[dayKey(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  const todayCount = () => stats.days[dayKey()] || 0;

  // ---------- State ----------
  let current = null; // { level, topic, history: [{role, text, correction, tip}] }
  let busy = false;
  let view = "home";
  let lastHints = [];

  // ---------- Toast ----------
  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // ---------- Navigation ----------
  function show(name) {
    view = name;
    for (const v of ["home", "progress", "settings", "chat"]) $(v + "View").classList.toggle("hidden", v !== name);
    $("tabbar").classList.toggle("hidden", name === "chat");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if (name !== "chat") stopSpeaking();
    if (name === "home") renderHome();
    if (name === "progress") renderProgress();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  $("backBtn").addEventListener("click", () => (history.state && history.state.chat ? history.back() : show("home")));
  window.addEventListener("popstate", () => view === "chat" && show("home"));

  // ---------- Home ----------
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning 👋" : h < 17 ? "Good afternoon 👋" : "Good evening 👋";
  }

  function renderHome() {
    $("greet").textContent = greeting();

    const s = streak();
    $("streakNum").textContent = s;
    $("flame").classList.toggle("on", todayCount() > 0);
    const left = Math.max(0, settings.dailyGoal - todayCount());
    $("streakSub").textContent =
      todayCount() === 0 ? (s ? "Practise today to keep your streak" : "Practise today to start your streak") : left ? `${left} more messages to reach today's goal` : "Daily goal reached! Great job 🎉";
    const pct = Math.min(100, Math.round((todayCount() / settings.dailyGoal) * 100));
    $("goalRing").style.setProperty("--p", pct);
    $("goalText").textContent = `${Math.min(todayCount(), settings.dailyGoal)}/${settings.dailyGoal}`;

    const idx = LEVELS.indexOf(settings.level);
    document.querySelectorAll(".seg").forEach((b) => b.classList.toggle("active", b.dataset.level === settings.level));
    document.querySelector(".seg-pill").style.transform = `translateX(${idx * 100}%)`;

    const topics = window.TOPICS[settings.level];
    const doneCount = topics.filter((t) => stats.done[settings.level + ":" + t.id]).length;
    $("levelProgress").textContent = `${doneCount} of ${topics.length} done`;
    $("levelBar").style.width = Math.round((doneCount / topics.length) * 100) + "%";

    const list = $("topicList");
    list.innerHTML = "";
    topics.forEach((t, i) => {
      const done = stats.done[settings.level + ":" + t.id];
      const btn = document.createElement("button");
      btn.className = "topic";
      btn.style.animationDelay = i * 40 + "ms";
      btn.innerHTML = `<span class="topic-icon"></span><span class="topic-body"><div class="topic-title"></div><div class="topic-goal"></div></span><span class="topic-end"></span>`;
      const icon = btn.querySelector(".topic-icon");
      icon.textContent = t.icon;
      icon.style.background = TILE_COLORS[i % TILE_COLORS.length];
      btn.querySelector(".topic-title").textContent = t.title;
      btn.querySelector(".topic-goal").textContent = t.goal.charAt(0).toUpperCase() + t.goal.slice(1);
      btn.querySelector(".topic-end").innerHTML = done
        ? `<span class="check">✓</span>`
        : `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
  $("freeTalkBtn").addEventListener("click", () => openTopic(settings.level, window.FREE_TALK));

  // ---------- Progress ----------
  function renderProgress() {
    const lessons = Object.keys(stats.done).length;
    const s = streak();
    if (s > stats.best) {
      stats.best = s;
      saveStats();
    }
    const items = [
      ["🔥", s, "Day streak"],
      ["🏆", stats.best, "Best streak"],
      ["💬", stats.messages, "Messages sent"],
      ["✏️", stats.corrections, "Corrections"],
      ["📚", lessons, "Lessons practised"],
      ["📅", Object.keys(stats.days).length, "Days practised"],
    ];
    $("statGrid").innerHTML = "";
    for (const [em, num, lbl] of items) {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = `<div class="em"></div><div class="num"></div><div class="lbl"></div>`;
      d.querySelector(".em").textContent = em;
      d.querySelector(".num").textContent = num;
      d.querySelector(".lbl").textContent = lbl;
      $("statGrid").appendChild(d);
    }

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

    const list = $("reviewList");
    list.innerHTML = "";
    if (!stats.reviews.length) {
      list.innerHTML = `<div class="empty">Your corrected sentences will appear here so you can review them.</div>`;
    }
    for (const r of stats.reviews.slice(0, 15)) {
      const d = document.createElement("div");
      d.className = "review";
      d.innerHTML = `<div class="wrong"></div><div class="right"></div>`;
      d.querySelector(".wrong").textContent = r.wrong;
      d.querySelector(".right").textContent = "✓ " + r.right;
      d.addEventListener("click", () => speak(r.right));
      list.appendChild(d);
    }
  }

  // ---------- Chat ----------
  const convKey = (level, topicId) => "conv." + level + "." + topicId;

  function openTopic(level, topic) {
    const saved = store.get(convKey(level, topic.id), null);
    current = { level, topic, history: Array.isArray(saved) ? saved : [] };
    $("chatGoal").innerHTML = `🎯 <b></b> · <span></span>`;
    $("chatGoal").querySelector("b").textContent = topic.title;
    $("chatGoal").querySelector("span").textContent = topic.goal;
    lastHints = [];
    history.pushState({ chat: true }, "");
    show("chat");
    renderMessages();
    renderHints();
    if (!current.history.length) askCoach();
  }

  function restart() {
    if (!current || busy) return;
    current.history = [];
    store.remove(convKey(current.level, current.topic.id));
    lastHints = [];
    renderMessages();
    renderHints();
    askCoach();
  }
  $("newChatBtn").addEventListener("click", restart);

  const saveConv = () => current && store.set(convKey(current.level, current.topic.id), current.history.slice(-40));
  const isRtl = (lang) => lang === "ur" || lang === "ar";
  const scrollDown = () => {
    const box = $("messages");
    box.scrollTop = box.scrollHeight;
  };

  function renderMessages() {
    const box = $("messages");
    box.innerHTML = "";
    current.history.forEach((m) => box.appendChild(messageEl(m)));
    scrollDown();
  }

  function coachAvatar() {
    const img = document.createElement("img");
    img.src = "/coach.svg";
    img.alt = "";
    img.className = "avatar";
    return img;
  }

  function messageEl(m) {
    const frag = document.createDocumentFragment();
    const row = document.createElement("div");
    row.className = "msg-row " + (m.role === "coach" ? "coach" : "me");
    const el = document.createElement("div");
    el.className = "msg " + (m.role === "coach" ? "coach" : "me");
    const text = document.createElement("div");
    text.textContent = m.text;
    el.appendChild(text);

    if (m.role === "coach") {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const speakBtn = document.createElement("button");
      speakBtn.textContent = "🔊 Listen";
      speakBtn.addEventListener("click", () => speak(m.text));
      const reportBtn = document.createElement("button");
      reportBtn.textContent = "⚑ Report";
      reportBtn.addEventListener("click", () => report(m.text));
      actions.append(speakBtn, reportBtn);
      el.appendChild(actions);
      row.append(coachAvatar(), el);
    } else {
      row.appendChild(el);
    }
    frag.appendChild(row);

    if (m.role === "me" && m.correction) {
      const fix = document.createElement("div");
      fix.className = "fix";
      fix.innerHTML = `<div class="label">✨ Better way to say it</div><div class="better"></div>`;
      fix.querySelector(".better").textContent = m.correction;
      if (m.tip) {
        const tip = document.createElement("div");
        tip.className = "tip";
        tip.textContent = "💡 " + m.tip;
        if (isRtl(settings.helperLang)) tip.setAttribute("dir", "rtl");
        fix.appendChild(tip);
      }
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const b = document.createElement("button");
      b.textContent = "🔊 Listen";
      b.addEventListener("click", () => speak(m.correction));
      actions.appendChild(b);
      fix.appendChild(actions);
      frag.appendChild(fix);
    }
    return frag;
  }

  function addToChat(m) {
    current.history.push(m);
    $("messages").appendChild(messageEl(m));
    scrollDown();
    saveConv();
  }

  function renderHints() {
    const box = $("hints");
    box.innerHTML = "";
    if (!settings.showHints || busy) return;
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

  function setBusy(on) {
    busy = on;
    $("sendBtn").disabled = on;
    $("coachStatus").textContent = on ? "typing…" : "Online";
    const old = $("messages").querySelector(".typing-row");
    if (old) old.remove();
    if (on) {
      const row = document.createElement("div");
      row.className = "msg-row coach typing-row";
      const bubble = document.createElement("div");
      bubble.className = "msg coach typing";
      bubble.innerHTML = "<i></i><i></i><i></i>";
      row.append(coachAvatar(), bubble);
      $("messages").appendChild(row);
      scrollDown();
    }
    renderHints();
  }

  function showError(text) {
    const e = document.createElement("div");
    e.className = "error";
    e.textContent = text;
    const retry = document.createElement("button");
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      e.remove();
      askCoach();
    });
    e.appendChild(retry);
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
      const res = await fetch(CFG.API_URL, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(50000) : undefined,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          level: conv.level,
          topic: conv.topic.title,
          role: conv.topic.role,
          goal: conv.topic.goal,
          helperLang: settings.helperLang,
          history: conv.history.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (conv !== current) return;
      setBusy(false);
      if (!res.ok || data.error) {
        showError(((data && data.error) || "Something went wrong (code " + res.status + ").") + (data && data.detail ? "\n[" + data.detail.slice(0, 160) + "]" : ""));
        return;
      }
      const lastMe = [...conv.history].reverse().find((m) => m.role === "me");
      if (lastMe && data.correction && !lastMe.correction && normalise(data.correction) !== normalise(lastMe.text)) {
        lastMe.correction = data.correction;
        lastMe.tip = data.tip || "";
        stats.corrections++;
        stats.reviews.unshift({ wrong: lastMe.text, right: data.correction });
        stats.reviews = stats.reviews.slice(0, 30);
        saveStats();
        renderMessages();
      }
      addToChat({ role: "coach", text: data.reply });
      lastHints = Array.isArray(data.hints) ? data.hints.slice(0, 3) : [];
      renderHints();
      if (settings.autoSpeak) speak(data.reply);
    } catch {
      if (conv !== current) return;
      setBusy(false);
      showError(navigator.onLine ? "The coach did not answer in time. Please try again." : "You are offline. Please connect to the internet.");
    }
  }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("input").value.trim();
    if (!text || busy) return;
    $("input").value = "";
    stopSpeaking();
    addToChat({ role: "me", text });
    stats.messages++;
    stats.days[dayKey()] = todayCount() + 1;
    const key = current.level + ":" + current.topic.id;
    if (current.history.filter((m) => m.role === "me").length === 3) stats.done[key] = (stats.done[key] || 0) + 1;
    const s = streak();
    if (s > stats.best) stats.best = s;
    if (todayCount() === settings.dailyGoal) toast("🎉 Daily goal reached!");
    saveStats();
    askCoach();
  });

  function report(text) {
    const subject = encodeURIComponent(CFG.APP_NAME + " — Report AI message");
    const body = encodeURIComponent(
      'I want to report this AI message:\n\n"' + text + '"\n\nTopic: ' + (current ? current.level + " / " + current.topic.title : "") + "\n\nReason: "
    );
    window.location.href = `mailto:${CFG.SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }

  // ---------- Text to speech ----------
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    voice =
      voices.find((v) => /en[-_]US/i.test(v.lang) && /google/i.test(v.name)) ||
      voices.find((v) => /en[-_](US|GB)/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    if (voice) u.voice = voice;
    u.rate = Number(settings.rate) || 0.9;
    speechSynthesis.speak(u);
  }
  function stopSpeaking() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  // ---------- Speech to text ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;
  $("micBtn").addEventListener("click", () => {
    if (!SR) {
      toast("Voice input needs Google Chrome. Please open the app in Chrome.");
      return;
    }
    if (listening) {
      recognizer && recognizer.stop();
      return;
    }
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
      $("input").placeholder = "Type your answer…";
      if ($("input").value.trim()) $("input").focus();
    };
    try {
      recognizer.start();
    } catch {
      toast("Could not start the microphone.");
    }
  });

  // ---------- Settings ----------
  const rateName = (r) => (r <= 0.7 ? "Slow" : r <= 0.9 ? "Relaxed" : r <= 1.0 ? "Normal" : "Fast");
  $("helperLang").value = settings.helperLang;
  $("autoSpeak").checked = !!settings.autoSpeak;
  $("showHints").checked = !!settings.showHints;
  $("rate").value = settings.rate;
  $("rateLabel").textContent = rateName(settings.rate);
  $("dailyGoal").value = String(settings.dailyGoal);
  $("helperLang").addEventListener("change", (e) => {
    settings.helperLang = e.target.value;
    saveSettings();
  });
  $("autoSpeak").addEventListener("change", (e) => {
    settings.autoSpeak = e.target.checked;
    saveSettings();
  });
  $("showHints").addEventListener("change", (e) => {
    settings.showHints = e.target.checked;
    saveSettings();
  });
  $("dailyGoal").addEventListener("change", (e) => {
    settings.dailyGoal = Number(e.target.value);
    saveSettings();
  });
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
      toast("Tap again to reset all progress.");
      return;
    }
    Object.assign(stats, { messages: 0, corrections: 0, done: {}, days: {}, best: 0, reviews: [] });
    saveStats();
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("etc.conv."))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
    toast("Progress reset.");
  });

  // ---------- Offline support ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  show("home");
})();
