(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

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

  const settings = Object.assign({ level: "beginner", helperLang: "en", autoSpeak: true, rate: 0.9 }, store.get("settings", {}));
  const stats = Object.assign({ messages: 0, corrections: 0, done: {} }, store.get("stats", {}));
  const saveSettings = () => store.set("settings", settings);
  const saveStats = () => store.set("stats", stats);

  // ---------- State ----------
  let current = null; // { level, topic, history: [{role, text, correction, tip}] }
  let busy = false;
  let view = "home";

  // ---------- Toast ----------
  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // ---------- Views ----------
  function show(name) {
    view = name;
    for (const v of ["home", "chat", "settings"]) $(v + "View").classList.toggle("hidden", v !== name);
    $("backBtn").classList.toggle("hidden", name === "home");
    $("settingsBtn").classList.toggle("hidden", name === "settings");
    if (name === "home") {
      $("title").textContent = CFG.APP_NAME;
      stopSpeaking();
      renderHome();
    }
    if (name === "settings") $("title").textContent = "Settings";
  }

  $("backBtn").addEventListener("click", () => {
    if (view === "settings" && current) show("chat");
    else if (view === "chat" && history.state && history.state.chat) history.back();
    else show("home");
  });
  $("settingsBtn").addEventListener("click", () => show("settings"));
  window.addEventListener("popstate", () => view !== "home" && show("home"));

  // ---------- Home ----------
  function renderHome() {
    document.querySelectorAll(".level-tab").forEach((b) => b.classList.toggle("active", b.dataset.level === settings.level));
    const grid = $("topicGrid");
    grid.innerHTML = "";
    const topics = [...window.TOPICS[settings.level], window.FREE_TALK];
    for (const t of topics) {
      const btn = document.createElement("button");
      btn.className = "topic" + (t.id === "free" ? " free" : "");
      const key = settings.level + ":" + t.id;
      btn.innerHTML = `<div class="icon"></div><div class="name"></div><div class="goal"></div>`;
      btn.querySelector(".icon").textContent = t.icon;
      btn.querySelector(".name").textContent = t.title;
      btn.querySelector(".goal").textContent = t.goal.charAt(0).toUpperCase() + t.goal.slice(1);
      if (stats.done[key]) {
        const d = document.createElement("div");
        d.className = "done";
        d.textContent = `✓ Practised ${stats.done[key]}×`;
        btn.appendChild(d);
      }
      btn.addEventListener("click", () => openTopic(settings.level, t));
      grid.appendChild(btn);
    }
    const lessons = Object.keys(stats.done).length;
    $("stats").innerHTML = "";
    for (const text of [`💬 ${stats.messages} messages`, `✏️ ${stats.corrections} corrections`, `📚 ${lessons} lessons`]) {
      const s = document.createElement("span");
      s.className = "stat";
      s.textContent = text;
      $("stats").appendChild(s);
    }
  }

  document.querySelectorAll(".level-tab").forEach((b) =>
    b.addEventListener("click", () => {
      settings.level = b.dataset.level;
      saveSettings();
      renderHome();
    })
  );

  // ---------- Chat ----------
  function convKey(level, topicId) {
    return "conv." + level + "." + topicId;
  }

  function openTopic(level, topic) {
    const saved = store.get(convKey(level, topic.id), null);
    current = { level, topic, history: Array.isArray(saved) ? saved : [] };
    $("title").textContent = topic.icon + " " + topic.title;
    $("chatGoal").textContent = "🎯 Goal: " + topic.goal + ".";
    history.pushState({ chat: true }, "");
    show("chat");
    renderMessages();
    if (!current.history.length) askCoach();
    else {
      const startOver = document.createElement("button");
      startOver.textContent = "↻ Start a new conversation";
      startOver.className = "ghost-btn";
      startOver.style.alignSelf = "center";
      startOver.style.borderColor = "var(--brand-2)";
      startOver.style.color = "var(--brand-2)";
      startOver.addEventListener("click", () => {
        current.history = [];
        store.remove(convKey(level, topic.id));
        renderMessages();
        askCoach();
      });
      $("messages").prepend(startOver);
    }
  }

  function saveConv() {
    if (current) store.set(convKey(current.level, current.topic.id), current.history.slice(-40));
  }

  function isRtl(lang) {
    return lang === "ur" || lang === "ar";
  }

  function renderMessages() {
    const box = $("messages");
    box.innerHTML = "";
    current.history.forEach((m) => box.appendChild(messageEl(m)));
    box.scrollTop = box.scrollHeight;
  }

  function messageEl(m) {
    const frag = document.createDocumentFragment();
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
    }
    frag.appendChild(el);

    if (m.role === "me" && m.correction) {
      const fix = document.createElement("div");
      fix.className = "fix";
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = "✏️ Better way to say it";
      const better = document.createElement("div");
      better.textContent = m.correction;
      fix.append(label, better);
      if (m.tip) {
        const tip = document.createElement("div");
        tip.className = "tip";
        tip.textContent = m.tip;
        if (isRtl(settings.helperLang)) tip.setAttribute("dir", "rtl");
        fix.appendChild(tip);
      }
      const listen = document.createElement("div");
      listen.className = "msg-actions";
      const b = document.createElement("button");
      b.textContent = "🔊 Listen";
      b.addEventListener("click", () => speak(m.correction));
      listen.appendChild(b);
      fix.appendChild(listen);
      frag.appendChild(fix);
    }
    return frag;
  }

  function addToChat(m) {
    current.history.push(m);
    const box = $("messages");
    box.appendChild(messageEl(m));
    box.scrollTop = box.scrollHeight;
    saveConv();
  }

  function setBusy(on) {
    busy = on;
    $("sendBtn").disabled = on;
    const box = $("messages");
    const old = box.querySelector(".typing");
    if (old) old.remove();
    if (on) {
      const t = document.createElement("div");
      t.className = "typing";
      t.textContent = "Coach is typing…";
      box.appendChild(t);
      box.scrollTop = box.scrollHeight;
    }
  }

  function showError(text) {
    const box = $("messages");
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
    box.appendChild(e);
    box.scrollTop = box.scrollHeight;
  }

  async function askCoach() {
    if (busy || !current) return;
    const conv = current;
    setBusy(true);
    try {
      const res = await fetch(CFG.API_URL, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
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
      if (conv !== current) return; // user left this chat
      setBusy(false);
      if (!res.ok || data.error) {
        showError(((data && data.error) || "Something went wrong (code " + res.status + ").") + (data && data.detail ? "\n[" + data.detail.slice(0, 160) + "]" : ""));
        return;
      }
      // Attach the correction to the learner's last message.
      const lastMe = [...conv.history].reverse().find((m) => m.role === "me");
      if (lastMe && data.correction && !lastMe.correction && normalise(data.correction) !== normalise(lastMe.text)) {
        lastMe.correction = data.correction;
        lastMe.tip = data.tip || "";
        stats.corrections++;
        saveStats();
        renderMessages();
      }
      addToChat({ role: "coach", text: data.reply });
      if (settings.autoSpeak) speak(data.reply);
    } catch {
      if (conv !== current) return;
      setBusy(false);
      showError(navigator.onLine ? "The coach did not answer in time. Please try again." : "You are offline. Please connect to the internet.");
    }
  }

  function normalise(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("input").value.trim();
    if (!text || busy) return;
    $("input").value = "";
    stopSpeaking();
    addToChat({ role: "me", text });
    stats.messages++;
    const key = current.level + ":" + current.topic.id;
    if (current.history.filter((m) => m.role === "me").length === 3) stats.done[key] = (stats.done[key] || 0) + 1;
    saveStats();
    askCoach();
  });

  function report(text) {
    const subject = encodeURIComponent(CFG.APP_NAME + " — Report AI message");
    const body = encodeURIComponent(
      "I want to report this AI message:\n\n\"" + text + "\"\n\nTopic: " + (current ? current.level + " / " + current.topic.title : "") + "\n\nReason: "
    );
    window.location.href = `mailto:${CFG.SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }

  // ---------- Text to speech ----------
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    voice = voices.find((v) => /en[-_]US/i.test(v.lang) && /google/i.test(v.name)) || voices.find((v) => /en[-_](US|GB)/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
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
  if (!SR) {
    $("micBtn").addEventListener("click", () => toast("Voice input is not available in this browser. Please open the app in Google Chrome."));
  } else {
    $("micBtn").addEventListener("click", () => {
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
        if ($("input").value.trim()) $("input").focus();
      };
      try {
        recognizer.start();
      } catch {
        toast("Could not start the microphone.");
      }
    });
  }

  // ---------- Settings ----------
  $("helperLang").value = settings.helperLang;
  $("autoSpeak").checked = !!settings.autoSpeak;
  $("rate").value = settings.rate;
  $("helperLang").addEventListener("change", (e) => {
    settings.helperLang = e.target.value;
    saveSettings();
  });
  $("autoSpeak").addEventListener("change", (e) => {
    settings.autoSpeak = e.target.checked;
    saveSettings();
  });
  $("rate").addEventListener("change", (e) => {
    settings.rate = Number(e.target.value);
    saveSettings();
    speak("This is my new speaking speed.");
  });
  $("resetBtn").addEventListener("click", () => {
    if (!confirmReset()) return;
    stats.messages = 0;
    stats.corrections = 0;
    stats.done = {};
    saveStats();
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("etc.conv."))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
    toast("Progress reset.");
  });
  let resetArmed = 0;
  function confirmReset() {
    // Two taps instead of a blocking confirm() dialog.
    if (Date.now() - resetArmed < 4000) return true;
    resetArmed = Date.now();
    toast("Tap again to reset all progress.");
    return false;
  }

  // ---------- Offline support ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  show("home");
})();
