# Setup guide: put English Talk Coach online and on Google Play

You can do every step from your phone browser. Do them in order.

---

## Part 1: Get a free Gemini AI key (5 min)

1. Open **https://aistudio.google.com** and sign in with your Google account.
2. Tap **Get API key** → **Create API key**.
3. Copy the key (it starts with `AIza…`) and keep it somewhere private.
   Never share it or put it in the app code.

## Part 2: Create a free Cloudflare account (10 min)

1. Open **https://dash.cloudflare.com/sign-up** and create an account.
2. In the menu, open **Workers & Pages** once. If it asks you to choose a
   `workers.dev` subdomain, pick one (for example `muhammadsaleh`).
   Your app address will be `https://english-talk-coach.<your-subdomain>.workers.dev`.
3. **Account ID:** on the Workers & Pages page, find **Account ID** on the right side
   (or in the account home page). Copy it.
4. **API token:** open **https://dash.cloudflare.com/profile/api-tokens** →
   **Create Token** → find **Edit Cloudflare Workers** → **Use template** →
   choose your account under *Account Resources* and *All zones* under *Zone Resources* →
   **Continue to summary** → **Create Token**. Copy the token (it is shown only once).

## Part 3: Add the 3 secrets to GitHub (5 min)

1. Open **https://github.com/muhammadsaleh93/english-talk-coach**.
2. Tap **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
   (On a phone, use the browser menu → "Desktop site" if you can't see Settings.)
3. Add these three, one at a time. The name must match exactly:

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | your Gemini key from Part 1 |
| `CLOUDFLARE_ACCOUNT_ID` | your Account ID from Part 2 |
| `CLOUDFLARE_API_TOKEN` | your API token from Part 2 |

## Part 4: Deploy (2 min)

1. In the repository, tap **Actions** → **Deploy app to Cloudflare** → **Run workflow** → **Run workflow**.
2. Wait about 1 minute for the green ✓.
3. Open `https://english-talk-coach.<your-subdomain>.workers.dev` in Chrome on your phone.
   Try a lesson. Tap the 🎤 button and allow the microphone.
4. Every time code changes on GitHub, the app updates automatically.

## Part 5: Make the Play Store file with PWABuilder (10 min)

1. Open **https://www.pwabuilder.com** and paste your app address. Tap **Start**.
2. Tap **Package for stores** → **Android** → **Generate Package**. Before generating, open the options:
   - **Package ID:** `com.muhammadsaleh.englishtalkcoach`
   - **App name:** English Talk Coach
   - **Signing key:** *Create new*
3. Download the ZIP. It contains:
   - an **.aab** file → you upload this to Google Play
   - an **.apk** file → you can install this on your phone to test
   - **signing.keystore** and **signing-key-info.txt** → **keep these forever, safely** (Google Drive).
     Without them you can never update your app.
   - **assetlinks.json** → contains your **SHA-256 fingerprint**
4. Send the SHA-256 fingerprint to Claude (or paste it yourself into `wrangler.jsonc`,
   in `"ANDROID_SHA256": ""`). This removes the browser address bar from the Android app.
   If you use **Play App Signing** (default), also add the fingerprint from
   Play Console → *Test and release → App integrity → App signing key certificate*, separated by a comma.

## Part 6: Publish on Google Play

1. Create a developer account at **https://play.google.com/console** (one-time US$25 fee, identity check).
2. **Create app** → name *English Talk Coach* → App → Free.
3. Fill in the **App content** section:
   - **Privacy policy URL:** `https://english-talk-coach.<your-subdomain>.workers.dev/privacy.html`
   - **Ads:** No ads
   - **App access:** All functions available without login
   - **Content rating:** fill in the questionnaire (Education app, user talks to an AI)
   - **Target audience:** 13+ (do not choose children)
   - **Data safety:** Collects *App activity → Other user-generated content* (chat messages, sent for
     app functionality, not shared for ads, data encrypted in transit, not stored on a server).
     *Audio* is not collected by the app (Android's own voice typing turns speech into text).
4. **Store listing:** short description, full description, the icon in `store/play-icon-512.png`,
   at least 2 phone screenshots, and a feature graphic 1024×500 (Claude can make one).
5. **Testing:** new personal accounts must run a **closed test** first (usually 12 testers for 14 days)
   before production. Upload the `.aab` to the closed testing track and invite your testers by email.
6. After the test period, apply for **production access** and publish. 🎉

---

### AI content rules (already built in)
Google Play requires apps with AI chat to let users report offensive AI answers.
Every coach message has a **⚑ Report** button that emails you the message.
