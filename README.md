# English Talk Coach 🎯

An English conversation practice app with a friendly AI coach, from beginner to advanced.

- **3 levels:** Beginner, Intermediate, Advanced, with 6 role-play lessons each, plus Free talk
- **AI coach** (Google Gemini) talks with you and stays in the role-play
- **Gentle corrections:** "Better way to say it", with a short tip in English, Urdu, Hindi, Arabic or Bengali
- **Speak and listen:** voice input 🎤 and coach replies read aloud 🔊
- **Progress** saved on your phone
- **⚑ Report** button on AI messages (Google Play AI-content rule)
- Works as a website, a home-screen app (PWA) and an Android app for Google Play (Trusted Web Activity)

👉 **Start here: [SETUP.md](SETUP.md)**. It's a step-by-step guide you can follow on your phone.

## How it works

```
Phone app (public/)  ──►  Cloudflare Worker (src/worker.js)  ──►  Google Gemini API
                          keeps the GEMINI_API_KEY secret
```

| Folder / file | What it is |
|---|---|
| `public/` | The app screens (HTML, CSS, JavaScript) |
| `public/topics.js` | All lessons. Edit this to add topics |
| `public/config.js` | Support email and app name |
| `src/worker.js` | Server: AI chat API and Android app link file |
| `wrangler.jsonc` | Cloudflare settings and Android package name/fingerprint |
| `.github/workflows/deploy.yml` | Auto-deploys to Cloudflare on every change |
| `store/` | Play Store icon |
