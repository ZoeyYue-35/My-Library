# Front end

Browser-only interface files live here. `app.js` renders the app and calls the
same-origin `/api/...` endpoints; it never calls OpenAI directly and never
stores a full API key in browser storage.

The Python backend serves this directory for local development and the staging
container. A future CDN/static host can serve it separately once its API base
URL and authentication settings are configured.
