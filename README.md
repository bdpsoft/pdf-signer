pdf-signer

Simple PDF-signing demo app.

Setup (Gmail SMTP):

1) Create a `.env` file from `.env.example` and fill values.

Option A — Gmail App Password (recommended for personal accounts with 2FA)
- Enable 2-Step Verification on your Google account: https://myaccount.google.com/security
- Create an App Password (select Mail / Other) and copy the 16-character password.
- Set `EMAIL_USER` to your Gmail address and `EMAIL_PASS` to the generated App Password.

Option B — OAuth2 (recommended for production)
- Create OAuth 2.0 credentials in Google Cloud Console and obtain a refresh token.
- Set `EMAIL_USER`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and `OAUTH_REFRESH_TOKEN`.

Common error: "534-5.7.9 Application-specific password required"
- This means Gmail requires an application-specific password (App Password) because your account has 2FA or Google blocked basic auth. Use Option A or Option B above.

Run locally (PowerShell):

```powershell
cd /d d:\pdf-signer
npm install
node server.js
```

Publishing to GitHub (example steps)

1. Create a new repository on GitHub via the website. Copy the HTTPS remote URL (e.g. `https://github.com/<you>/pdf-signer.git`).
2. Push your code:

```powershell
cd /d d:\pdf-signer
git init
git add .
git commit -m "Initial import"
# Replace the url below with the one from your GitHub repo
git remote add origin https://github.com/<you>/pdf-signer.git
git branch -M main
git push -u origin main
```

Notes
- Never commit `.env` or secrets. Use `.env.example` to document which variables are required.
- If you want, I can add a GitHub Action to run lint/tests on push.
