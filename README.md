# CivicReport — Smart Routing Feature (CS194 Team 19 Demo)

A React Native / Expo app that implements the **Smart Automated Routing** feature from the Government Reporting Platform PRD.

## What it does

1. **Report screen** — User describes a civic issue (e.g. pothole, graffiti), optionally toggles device location and attaches a photo.
2. **AI routing** — The Gemini API identifies the most appropriate government department and drafts a professional email on the user's behalf.
3. **Email review** — User can manually edit the draft **or** type a natural-language suggestion (e.g. "make it more urgent") and the AI revises the draft.
4. **Mock send** — Tapping "Send Email" shows an animated confirmation. *(Actual Gmail send will be added in the full version.)*

## Setup

### Prerequisites

- Node.js ≥ 18
- Expo CLI (`npx expo` works out of the box)
- Expo Go app on your phone (iOS App Store / Google Play)
- A **free** Google Gemini API key → https://aistudio.google.com/apikey

### Steps

```bash
# 1. Open the project folder
cd civic-reporter

# 2. Install dependencies (if not already installed)
npm install

# 3. Add your Gemini API key
#    Open config.js and replace YOUR_GEMINI_API_KEY_HERE with your key

# 4. Start the Expo dev server
npx expo start
```

Scan the QR code with Expo Go on your phone. That's it!

## Project structure

```
civic-reporter/
├── App.js          # Main app — all screens (Report, Loading, Email, Sent modal)
├── gemini.js       # Gemini API calls (generateEmailDraft, reviseEmailDraft)
├── config.js       # ← PUT YOUR API KEY HERE
├── app.json        # Expo config with location + camera permissions
└── package.json
```

## Notes

- The app is scoped to **Palo Alto, CA** for the demo. Gemini will try to find real city/county department emails.
- Photo upload works on-device (camera + gallery) but the image is **not** sent to Gemini in this version — only a flag indicating a photo is attached.
- The "Send Email" button is a mock. In the full version, Gmail OAuth will be integrated to send the email on behalf of the user.
