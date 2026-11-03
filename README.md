# English Talk Coach 🎯

An English conversation practice app with a friendly AI coach, from beginner to advanced.

- **3 levels** with 6 role-play lessons each, plus Free talk, daily challenges and **job interview practice** for 10+ jobs
- **AI tutor "Sara"** (Google Gemini): an animated avatar that talks with you and stays in the role-play
- **Accurate grammar feedback:** wrong words in red, missing words marked with **+**, fixes in green, and tips in **Urdu, Arabic, Hindi or Bengali**
- **Translate** any tutor message into your language
- **Pronunciation practice:** read a sentence aloud and get a word-by-word score
- **Vocabulary:** 5 new words every day, a "words I used" chart and a list of learned words
- **Quizzes:** a daily AI quiz, plus a quiz built from your own mistakes
- **Lesson reports:** Grammar, Fluency and Vocabulary scores, plus a grammar takeaway
- **Motivation:** streaks, daily goal, gems, stars, and personal recommendations
- **Progress saved on the phone**, with backup and restore
- **Report button** on AI messages (Google Play AI-content rule)
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
| `public/topics.js` | Lessons, pronunciation sentences and interview jobs. Edit this to add more |
| `public/tutor.js` | The animated tutor avatar |
| `public/_headers` | Security headers (CSP etc.) |
| `public/config.js` | Support email and app name |
| `src/worker.js` | Server: AI API (chat, translate, lesson summary, daily pack), security checks, rate limits |
| `wrangler.jsonc` | Cloudflare settings and Android package name/fingerprint |
| `.github/workflows/deploy.yml` | Auto-deploys to Cloudflare on every change |
| `store/` | Play Store icon |
| `tests/` | Server unit tests and the Android end-to-end test (run automatically on GitHub) |

## Security

- The Gemini key is a Cloudflare **secret**. It is never sent to the phone.
- The AI API only accepts requests from the app's own website (Origin check), as JSON, up to 24 KB.
- Every field is validated (mode, level, language, message length, history).
- Rate limits per user (IP): 25 AI requests per minute (Cloudflare rate limiting), plus 30 points per minute and 400 per hour inside the worker.
- Google's error messages are not shown to users; they go to the Cloudflare logs.
- Security headers: Content-Security-Policy, X-Frame-Options, Permissions-Policy (mic only for this site), HSTS.

## Tests

```
npm test          # server unit tests (security, validation, AI modes)
npm run test:e2e  # whole app on an emulated Android phone (needs Playwright)
```
GitHub runs both before every deploy, then a live smoke test checks the real site.
