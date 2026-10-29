# My Library — Clean local release

**Release:** 2026-10-28 · clean local release with a cloud-ready source layout. It includes Resume Studio, Knowledge Library, STAR Story Builder, Mock Interview, voice-to-text, role-track add/delete, resume version control, Mock history, confirmed Mock sessions, and a first-run quick tour.

This is a clean distribution for a new user. It deliberately contains **no** existing accounts, resumes, uploaded documents, API keys, interview stories, or Mock history. On first launch, the app creates an empty `storage/` folder locally for that specific user.

> Do not open `index.html` directly. My Library has a local Python server for account registration, uploads, local storage, AI calls, and Mock history. Launch it using the instructions below, then open the `http://127.0.0.1:8011` address in a browser.

My Library is a local-first Knowledge Library for career materials. It starts with **no accounts and no personal content**, so another user can create their own workspace and upload their own files.

## What it includes

- Local account creation and sign-in. Passwords are stored as salted PBKDF2 hashes in the local project data.
- A three-step first-run guide for newly created accounts. It highlights Story Builder, then the STAR Story and Mock Interview workflows; users can proceed with **Next** or **Skip guide**. It is recorded as complete for that account so it does not return at later sign-in.
- Signed-in users can change their local password from Settings. This is useful if they initially accepted a browser-generated password.
- Uploads for DOCX, PDF, PPTX, XLSX, CSV, TXT, MD, JSON, and image files.
- Local text extraction from DOCX, PDF, PPTX, XLSX, and text files where possible. A scanned or protected PDF stays available as an original file even when text extraction fails.
- Separate role tracks. New accounts begin with no preset directions; each user creates their own tracks directly in Resume Studio. Existing accounts retain their saved tracks.
- Resume version history per track. Every upload stays in history; a user explicitly chooses the current version.
- Story Builder has two modes: evidence-grounded STAR answers and Mock Interview. Mock Interview creates five JD-aware behavioral questions, asks one at a time, and can make 0–2 response-specific follow-ups. **Live Coach** gives feedback, an optimized spoken answer, and retry/next choices after each completed question; **Full-session Coach** gives one overall review after all five questions. A completed Mock Interview automatically saves its questions, answers, follow-ups, scorecards, and final review to Mock history; if that save fails, the completed page offers a retry button without discarding the session. A user can then explicitly **Confirm to answers library**, which adds a `MOCK` entry to Confirmed answers that reopens the complete session. Feedback scores relevance, STAR logic, personal action and judgment, result/evidence, and clarity—missing metrics alone do not trigger a penalty. Each signed-in user can optionally connect their own OpenAI Platform API key in Settings; without one, only Story Builder is paused. My Library automatically uses `gpt-5-mini`, so users do not need to choose a model. An optional target job description guides which supported experience it selects, but never becomes evidence itself. It uses the selected track's current resume and factual library sources only; CV templates are excluded. Drafts can be edited manually or revised through a follow-up chat request before the user confirms them in Stories Library.
- Optional in-browser answer recording for Mock Interview. When a user stops recording, the audio is sent directly to OpenAI's `gpt-transcribe` endpoint using that account's key, returned as editable text, and never saved in this project's storage or database. Microphone permission is requested by the browser only when the user presses **Record answer**.
- Background experience matching. Resume uploads can generate reviewable experience candidates and aliases to help the library recognize the same experience across versions; it is not a top-level user workflow.
- Clear source boundaries: CV templates are stored as visual references and never treated as factual evidence.

## Run locally

### Recommended on macOS

Double-click `START_MY_LIBRARY.command` in Finder, or run it from Terminal. It starts this clean release at [http://127.0.0.1:8011](http://127.0.0.1:8011), deliberately avoiding an older project that may already be using port 8010.

### Manual start

From this folder:

```bash
python3 -m pip install -r requirements.txt
MY_LIBRARY_PORT=8011 python3 server.py
```

Then open [http://127.0.0.1:8011](http://127.0.0.1:8011).

If you intentionally want to use port 8010 instead, first stop any older My Library server in its Terminal with `Control + C`, then run `python3 server.py` from this clean-release folder.

### Optional: enable Story Builder AI per account

After creating or signing in to a local account, open **Settings → Your OpenAI connection** and paste an OpenAI Platform API key. My Library verifies it with OpenAI before saving it, then encrypts it in local account data. The verification makes one tiny, fixed Responses API request with no personal content—never a resume, job description, or library item. Only a masked last-four-character hint returns to the browser; the key is never stored in localStorage, returned by the API, printed by the app, or committed to Git. Users can replace or disconnect a saved key at any time.

No account key is required for Resume Studio, version history, source uploads, or Knowledge Library. Story Builder is the only feature that remains unavailable until that account connects a key.

For a local demo, the server creates a private encryption key in the ignored `storage/` folder. For a hosted deployment, serve the app over HTTPS and set `MY_LIBRARY_ENCRYPTION_KEY` on the server from a real secret manager **before** accepting user API keys. Do not put an API key in a source file, `.env` committed to Git, or chat message. The browser is deliberately sent only an API-key hint such as `••••abcd`, never the full key.

The STAR mode uses the project's server-side factual STAR template on every request. Mock Interview mode uses the provided hiring-manager question template and the response/follow-up/feedback template in `server.py`; both remain server-side so users cannot accidentally overwrite the standard behavior from the browser.

To stop the app, focus the terminal running the server and press `Control + C`.

## Privacy and reset behavior

The `storage/` folder is created only when the server first runs. It contains local accounts, password hashes, uploads, extracted text, version history, and encrypted (not plaintext) account AI connections. It is intentionally ignored by Git, so a new clone opens blank.

If you need a clean demo again, stop the server and remove only this project’s `storage/` folder. This permanently removes this project’s accounts and uploads; it does not affect Career OS or any other folder.

## Project structure

```text
MyLibrary-clean-release/
├── frontend/                 # Browser interface, styles, and API client
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── backend/                  # Python source for accounts, uploads, and AI
│   ├── server.py
│   └── requirements.txt
├── migrations/               # PostgreSQL schema applied by hosted startup
│   └── 001_initial_schema.sql
├── cloud/                    # Hosted container and deployment checklist
│   ├── Dockerfile
│   └── README.md
├── .github/workflows/        # Source verification when pushed to GitHub
├── server.py                 # Compatibility launcher → backend/server.py
├── requirements.txt          # Compatibility dependency entry point
├── START_MY_LIBRARY.command  # Starts this release on port 8011
└── storage/                  # Created at runtime; private and untracked
```

`server.pyc` is a Python-generated cache file, not the backend source. It is
ignored by Git and should never be edited or treated as a deployment file.

## Cloud-readiness status

The normal launcher remains local-first. The hosted container can use managed
PostgreSQL, private S3-compatible object storage, database-backed sessions, and
a host-injected encryption key when all required environment variables are
configured. No cloud account or public URL is configured in this repository;
follow [cloud/README.md](cloud/README.md) before deploying.

Hosted deployment starts with an empty database and bucket. It does not import
or upload an existing `storage/` directory. Keep that folder out of GitHub and
plan any data import separately.
