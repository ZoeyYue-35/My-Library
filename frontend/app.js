(function () {
  "use strict";

  const app = document.getElementById("app");
  const toast = document.getElementById("toast");
  const state = {
    token: localStorage.getItem("my-library-session") || "",
    isCloud: false,
    account: null,
    items: [],
    stories: [],
    mockHistories: [],
    aiStatus: null,
    view: "studio",
    knowledgeTab: "sources",
    studioTrack: "",
    selectedVersion: null,
    storyTrack: "",
    storyJobDescription: "",
    storyChat: [],
    storyPending: "",
    storyTool: "star",
    storyLaunchMenu: false,
    mockInterview: null,
    selectedMockHistory: null,
    mockAnswerDraft: "",
    mockRecorder: null,
    mockRecordingStream: null,
    mockRecordingChunks: [],
    mockRecordingTimer: null,
    mockRecordingSeconds: 0,
    selectedStory: null,
    authMode: "register",
    authFeedback: "",
    modalItem: null,
    onboardingStep: -1,
  };
  let workspaceStateSaveTimer = 0;
  let workspaceStateSaveQueue = Promise.resolve();

  const categoryMeta = {
    resume: { tab: "sources", eyebrow: "ORIGINAL RESUME SOURCE", label: "Resume source", description: "DOCX/PDF text was extracted locally. This source stays reviewable and is available to your Resume Studio history." },
    template: { tab: "templates", eyebrow: "CV TEMPLATE REFERENCE", label: "CV template", description: "Presentation-only reference. It can guide formatting, but is never used as factual interview evidence." },
    supporting: { tab: "materials", eyebrow: "SUPPORTING MATERIAL", label: "Supporting material", description: "Supporting source stored locally. Review the extracted text before relying on it in a story." },
    evidence: { tab: "evidence", eyebrow: "VERIFIED KNOWLEDGE", label: "Evidence", description: "A factual note you entered directly. Keep its source note so it remains easy to verify." },
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function fileTitle(filename) {
    return String(filename || "Untitled source").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled source";
  }

  function showToast(message, error) {
    toast.textContent = message;
    toast.classList.toggle("error", Boolean(error));
    toast.classList.add("visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () { toast.classList.remove("visible"); }, 4300);
  }

  function setAuthFeedback(message) {
    state.authFeedback = message || "";
    const feedback = document.getElementById("auth-feedback");
    if (!feedback) return;
    feedback.textContent = state.authFeedback;
    feedback.hidden = !state.authFeedback;
  }

  async function api(path, options) {
    const config = Object.assign({ headers: {} }, options || {});
    config.headers = Object.assign({ "Content-Type": "application/json" }, config.headers || {});
    if (state.token) config.headers["X-Session-Token"] = state.token;
    const response = await fetch(path, config);
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.ok === false) {
      if (response.status === 401) signOut(false);
      throw new Error(payload.error || "My Library could not complete that action.");
    }
    return payload;
  }

  async function refreshAll() {
    const results = await Promise.all([api("/api/library"), api("/api/stories"), api("/api/ai-status"), api("/api/mock/history")]);
    state.items = results[0].items || [];
    state.stories = results[1].stories || [];
    state.aiStatus = results[2] || null;
    state.mockHistories = results[3].histories || [];
    const tracks = state.account.tracks || [];
    if (!tracks.some(function (track) { return track.id === state.studioTrack; })) state.studioTrack = tracks[0] ? tracks[0].id : "";
    if (state.storyTrack && !tracks.some(function (track) { return track.id === state.storyTrack; })) state.storyTrack = "";
  }

  async function boot() {
    try {
      const healthResponse = await fetch("/api/health");
      const health = await healthResponse.json();
      state.isCloud = health.mode === "cloud";
    } catch (_) { /* Sign-in still explains that the service could not be reached. */ }
    if (state.isCloud) {
      localStorage.removeItem("my-library-session");
      state.token = "";
    }
    if (state.token) {
      try {
        const session = await api("/api/session");
        if (session.account) {
          state.account = session.account;
          loadStoryJobDescription();
          await refreshAll();
          await restoreCloudWorkspaceState();
          state.onboardingStep = state.account.showOnboarding ? 0 : -1;
          render();
          return;
        }
      } catch (_) { /* Fall through to local sign in. */ }
    }
    state.token = "";
    renderAuth();
  }

  function trackById(trackId) {
    return (state.account && state.account.tracks || []).find(function (track) { return track.id === trackId; });
  }

  function trackName(trackId) {
    const track = trackById(trackId);
    return track ? track.name : "All directions";
  }

  function storyJobStorageKey() {
    return state.account ? "my-library-story-jd-" + state.account.id : "my-library-story-jd";
  }

  function loadStoryJobDescription() {
    if (state.isCloud) {
      state.storyJobDescription = "";
      if (state.account) localStorage.removeItem(storyJobStorageKey());
      return;
    }
    state.storyJobDescription = localStorage.getItem(storyJobStorageKey()) || "";
  }

  function saveStoryJobDescription(value) {
    state.storyJobDescription = String(value || "").slice(0, 16000);
    if (state.isCloud) queueWorkspaceStateSave();
    else localStorage.setItem(storyJobStorageKey(), state.storyJobDescription);
  }

  function workspaceStatePayload() {
    return {
      storyJobDescription: state.storyJobDescription,
      workspaceState: {
        storyChat: state.storyChat,
        mockInterview: state.mockInterview,
        mockAnswerDraft: state.mockAnswerDraft,
      },
    };
  }

  function queueWorkspaceStateSave() {
    if (!state.isCloud || !state.account) return;
    window.clearTimeout(workspaceStateSaveTimer);
    workspaceStateSaveTimer = window.setTimeout(function () {
      const payload = workspaceStatePayload();
      workspaceStateSaveQueue = workspaceStateSaveQueue.catch(function () {}).then(function () {
        return api("/api/user-state", { method: "POST", body: JSON.stringify(payload) });
      }).catch(function (error) {
        showToast("Your latest draft could not be saved to your account. " + error.message, true);
      });
    }, 400);
  }

  async function restoreCloudWorkspaceState() {
    if (!state.isCloud) return;
    const saved = await api("/api/user-state");
    state.storyJobDescription = saved.storyJobDescription || "";
    const workspace = saved.workspaceState || {};
    state.storyChat = Array.isArray(workspace.storyChat) ? workspace.storyChat : [];
    state.mockInterview = workspace.mockInterview && typeof workspace.mockInterview === "object" ? workspace.mockInterview : null;
    state.mockAnswerDraft = String(workspace.mockAnswerDraft || "");
  }

  window.addEventListener("pagehide", function () {
    if (!state.isCloud || !state.account) return;
    window.clearTimeout(workspaceStateSaveTimer);
    fetch("/api/user-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspaceStatePayload()),
      keepalive: true,
    });
  });

  function trackOptions(selected, includeAll) {
    const first = includeAll
      ? '<option value=""' + (!selected ? " selected" : "") + '>All resume directions</option>'
      : '<option value=""' + (!selected ? " selected" : "") + '>General / no track</option>';
    return first + (state.account.tracks || []).map(function (track) {
      return '<option value="' + escapeHtml(track.id) + '"' + (selected === track.id ? " selected" : "") + '>' + escapeHtml(track.name) + "</option>";
    }).join("");
  }

  function navButton(view, icon, label) {
    return '<button type="button" class="' + (state.view === view ? "active" : "") + '" data-nav="' + view + '"><span class="nav-icon">' + icon + "</span>" + label + "</button>";
  }

  function pageHeader(eyebrow, title, subtitle) {
    return '<header class="topbar"><div><p class="eyebrow">' + eyebrow + '</p><h1 class="page-title">' + title + '</h1>' + (subtitle ? '<p class="page-subtitle">' + subtitle + '</p>' : "") + '</div><details class="account-control"><summary>' + escapeHtml(state.account.name) + '</summary><form id="signout-form"><span class="fine-print">' + escapeHtml(state.account.email) + '</span><button class="secondary" type="button" data-nav="settings">Settings</button><button class="secondary" type="submit">Sign out</button></form></details></header>';
  }

  function renderShell(content) {
    app.innerHTML = '<div class="app-shell"><aside class="sidebar"><div class="wordmark"><span class="wordmark-mark">M</span><strong>My<span>Library</span></strong></div><p class="side-section-title">PERSONAL WORKSPACE</p><nav class="nav">' +
      navButton("studio", "⌘", "Resume studio") +
      navButton("library", "◇", "Knowledge library") +
      navButton("story", "✦", "Story builder") +
      '</nav><div class="side-note"><span class="online-dot"></span><strong>Saved on this browser</strong><p>Nothing becomes your current resume or a reusable story without your confirmation.</p></div></aside><section class="content">' + content + '</section></div>' + onboardingOverlay();
    const targetSelector = onboardingTargetSelector();
    const target = targetSelector ? document.querySelector(targetSelector) : null;
    if (target) {
      target.classList.add("onboarding-target");
      window.requestAnimationFrame(function () {
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      });
    }
    bindShell();
  }

  function onboardingTargetSelector() {
    if (state.onboardingStep === 1) return "#studio-track-form";
    if (state.onboardingStep === 2) return ".studio-upload";
    if (state.onboardingStep === 3) return document.querySelector("[data-make-current]") ? "[data-make-current]" : ".studio-main";
    if (state.onboardingStep === 4) return ".knowledge-heading";
    if (state.onboardingStep === 5) return '[data-launch-story="star"]';
    if (state.onboardingStep === 6) return '[data-story-tool="star"]';
    if (state.onboardingStep === 7) return '[data-story-tool="mock"]';
    return "";
  }

  function onboardingOverlay() {
    if (!state.account || state.onboardingStep < 0 || !state.account.showOnboarding) return "";
    const steps = [
      { number: "01", title: "Welcome to My Library", body: "Are you ready to add your resume and career experience, build your stories, and practice with a mock interview coach? This quick tour will show you where to begin.", action: "Next" },
      { number: "02", title: "Create your resume tracks", body: "Start by creating separate tracks for different roles or career directions. Each track keeps its own resume versions and current resume.", action: "Next" },
      { number: "03", title: "Upload resume versions", body: "Upload different versions of your resume into the selected track. They stay in your version history so older drafts are not overwritten.", action: "Next" },
      { number: "04", title: "Choose a current resume", body: "Select one version and set it as current. Story Builder uses that resume as a reference alongside your Knowledge Library.", action: "Next" },
      { number: "05", title: "Build your Knowledge Library", body: "Organize materials from your work and career across tracks. My Library reads supported files so Story Builder can use them as a factual source library.", action: "Next" },
      { number: "06", title: "Start a Story", body: "In Story Builder, begin with a behavioral question. The coach uses your current resume and Knowledge Library to prepare a draft you can review.", action: "Next" },
      { number: "07", title: "Coach: build a STAR answer", body: "The STAR coach finds relevant evidence and drafts an answer. You can edit it, ask for a revision, and confirm it when it is ready.", action: "Next" },
      { number: "08", title: "Coach: practice a mock interview", body: "Mock Interview asks role-aware questions, supports typed or recorded answers, and saves completed sessions to your history.", action: "Next" },
    ];
    const step = steps[state.onboardingStep] || steps[0];
    const dots = steps.map(function (_, index) { return '<i class="' + (state.onboardingStep === index ? "active" : "") + '"></i>'; }).join("");
    const progressTitle = state.onboardingStep === 0 ? "WELCOME TO MY LIBRARY" : "GETTING STARTED";
    return '<div class="onboarding-backdrop" role="presentation"></div><section class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><div class="onboarding-progress"><span>' + progressTitle + '</span><strong>' + step.number + ' / ' + String(steps.length).padStart(2, "0") + '</strong></div><div class="onboarding-dots" aria-hidden="true">' + dots + '</div><h2 id="onboarding-title">' + escapeHtml(step.title) + '</h2><p>' + escapeHtml(step.body) + '</p><div class="onboarding-actions"><button class="link-action" type="button" data-skip-onboarding>Skip</button><button class="primary" type="button" data-next-onboarding>Next</button></div></section>';
  }

  function bindShell() {
    document.querySelectorAll("[data-nav]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (state.onboardingStep >= 0) return;
        if (state.view === "story" && button.dataset.nav !== "story" && state.mockRecorder) stopMockRecording(true);
        state.view = button.dataset.nav; state.modalItem = null; render();
      });
    });
    const signout = document.getElementById("signout-form");
    if (signout) signout.addEventListener("submit", function (event) { event.preventDefault(); signOut(true); });
    const nextOnboarding = document.querySelector("[data-next-onboarding]");
    if (nextOnboarding) nextOnboarding.addEventListener("click", advanceOnboarding);
    const skipOnboarding = document.querySelector("[data-skip-onboarding]");
    if (skipOnboarding) skipOnboarding.addEventListener("click", finishOnboarding);
  }

  function renderAuth() {
    const isRegister = state.authMode === "register";
    app.innerHTML = '<section class="auth-shell"><div><p class="brand-kicker">MY LIBRARY / LOCAL-FIRST</p><h1 class="auth-title">Your source<br/>of truth.</h1><p class="auth-copy">A private workspace for resume versions, supporting material, and the stories you want to tell with confidence.</p><ul class="promise-list"><li>Keep original files and a traceable version history.</li><li>Separate templates from factual evidence.</li><li>Build STAR answers from your own verified material.</li></ul></div><section class="auth-card"><div class="auth-tabs"><button class="auth-tab ' + (isRegister ? "active" : "") + '" type="button" data-auth-mode="register">Create account</button><button class="auth-tab ' + (!isRegister ? "active" : "") + '" type="button" data-auth-mode="login">Sign in</button></div><form class="auth-form" id="auth-form"><h2>' + (isRegister ? "Create your local workspace" : "Welcome back") + '</h2>' + (isRegister ? '<label>Name<input name="name" autocomplete="name" required /></label>' : "") + '<label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" required /></label><label>Local password<input name="password" type="password" autocomplete="' + (isRegister ? "new-password" : "current-password") + '" minlength="8" placeholder="At least 8 characters" required /></label>' + (isRegister ? '<label>Confirm local password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label>' : "") + '<button class="primary" type="submit">' + (isRegister ? "Create local account" : "Sign in") + '</button><p id="auth-feedback" class="auth-feedback" role="alert"' + (state.authFeedback ? "" : " hidden") + '>' + escapeHtml(state.authFeedback) + '</p><p class="fine-print">This password is for My Library only. Any password with 8+ characters works; browser-generated passwords are optional.</p></form></section></section>';
    if (state.isCloud) {
      app.innerHTML = app.innerHTML
        .replace("MY LIBRARY / LOCAL-FIRST", "MY LIBRARY / PRIVATE WORKSPACE")
        .replace("Create your local workspace", "Create your account workspace")
        .replaceAll("Local password", "Account password")
        .replaceAll("local password", "account password")
        .replaceAll("local account", "account");
    }
    document.querySelectorAll("[data-auth-mode]").forEach(function (button) { button.addEventListener("click", function () { state.authMode = button.dataset.authMode; state.authFeedback = ""; renderAuth(); }); });
    document.getElementById("auth-form").addEventListener("submit", submitAuth);
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (state.authMode === "register" && form.get("password") !== form.get("confirmPassword")) {
      setAuthFeedback("The two local passwords do not match. Please type the same password in both boxes.");
      return;
    }
    const payload = { email: form.get("email"), password: form.get("password") };
    if (state.authMode === "register") payload.name = form.get("name");
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const response = await api("/api/auth/" + (state.authMode === "register" ? "register" : "login"), { method: "POST", body: JSON.stringify(payload) });
      state.token = response.token || "";
      state.account = response.account;
      if (state.token) localStorage.setItem("my-library-session", state.token);
      else localStorage.removeItem("my-library-session");
      loadStoryJobDescription();
      await refreshAll();
      await restoreCloudWorkspaceState();
      state.view = "studio";
      state.onboardingStep = state.account.showOnboarding ? 0 : -1;
      render();
      showToast("Your My Library workspace is ready.");
    } catch (error) { setAuthFeedback(error.message); showToast(error.message, true); button.disabled = false; }
  }

  async function signOut(showMessage) {
    try { if (state.token || state.isCloud) await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) { /* Local cleanup continues. */ }
    stopMockRecording(true);
    localStorage.removeItem("my-library-session");
    state.token = ""; state.account = null; state.items = []; state.stories = []; state.mockHistories = []; state.storyChat = []; state.mockInterview = null; state.selectedMockHistory = null; state.mockAnswerDraft = ""; state.selectedVersion = null; state.storyJobDescription = ""; state.onboardingStep = -1;
    renderAuth();
    if (showMessage) showToast(state.isCloud ? "Signed out. Your saved workspace remains in your account." : "Signed out. Your local library remains on this computer.");
  }

  function resumeItems(trackId) {
    return state.items.filter(function (item) { return item.category === "resume" && item.trackId === trackId; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  function selectedResume() {
    const list = resumeItems(state.studioTrack);
    const selected = list.find(function (item) { return item.id === state.selectedVersion; });
    return selected || list.find(function (item) { return item.isCurrent; }) || list[0] || null;
  }

  function resumePreview(item) {
    if (!item || !String(item.text || "").trim()) return '<div class="resume-paper-empty"><span>↑</span><h3>No resume version selected</h3><p>Upload a DOCX or PDF at left. It will be stored as a draft and will not replace your current version until you choose it.</p></div>';
    const lines = String(item.text).replace(/\r/g, "").split("\n").map(function (line) { return line.trim(); }).filter(Boolean);
    const isHeader = function (line) { return line.length > 3 && line.length < 50 && line === line.toUpperCase(); };
    const sections = lines.filter(isHeader).slice(0, 6);
    const visibleLines = lines.slice(0, 14);
    const documentType = String(item.filename || "").toLowerCase().endsWith(".pdf") ? "PDF document" : "DOCX document";
    return '<article class="resume-page-overview"><div class="resume-page-top"><div><span class="draft-label">DOCUMENT OVERVIEW</span><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(documentType) + ' · ' + lines.length + ' extracted lines</p></div><span class="page-count">1 page view</span></div><div class="resume-page-sheet"><div class="resume-page-name">' + escapeHtml(lines[0] || item.title) + '</div><div class="resume-page-contact">' + escapeHtml(lines[1] || "Resume document") + '</div><div class="resume-page-lines">' + visibleLines.slice(2).map(function (line) { return isHeader(line) ? '<p class="resume-page-section">' + escapeHtml(line) + '</p>' : '<p>' + escapeHtml(line) + '</p>'; }).join("") + '</div><div class="resume-page-fade"><strong>One-page overview</strong><span>Open “Review source” for the complete extracted text, or download the original document.</span></div></div><div class="resume-overview-meta"><span>' + sections.length + ' detected sections</span><span>' + escapeHtml(sections.join(" · ") || "Document structure is available in Review source") + '</span></div></article>';
  }

  function renderStudio() {
    const selected = selectedResume();
    const tracks = state.account.tracks || [];
    const versions = resumeItems(state.studioTrack);
    const branches = tracks.map(function (track) {
      const count = resumeItems(track.id).length;
      return '<div class="studio-track-row"><button class="studio-track ' + (track.id === state.studioTrack ? "active" : "") + '" data-studio-track="' + escapeHtml(track.id) + '"><span class="track-dot ' + escapeHtml(track.color) + '"></span><strong>' + escapeHtml(track.name) + '</strong><small>' + count + ' version' + (count === 1 ? "" : "s") + '</small></button><button class="delete-track" type="button" data-delete-track="' + escapeHtml(track.id) + '" aria-label="Delete ' + escapeHtml(track.name) + ' direction" title="Delete this direction">×</button></div>';
    }).join("") || '<div class="studio-track-empty"><strong>Your workspace starts here.</strong><span>Create a direction such as Finance, Product, Design, or Research. Resume versions stay separate inside each one.</span></div>';
    const history = versions.length ? versions.map(function (item) {
      return '<button class="version-row ' + (selected && item.id === selected.id ? "selected" : "") + '" data-select-version="' + escapeHtml(item.id) + '"><span class="version-node"></span><span><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(formatDate(item.createdAt)) + (item.isCurrent ? " · Current version" : " · Saved draft") + '</small></span></button>';
    }).join("") : '<div class="studio-empty-list">' + (tracks.length ? 'No saved versions in this direction yet.' : 'Create a direction first, then upload its first version.') + '</div>';
    const overview = !tracks.length
      ? '<div class="studio-overview-head studio-welcome"><div><span class="draft-label">SET UP YOUR VERSION LIBRARY</span><h2>Create your first direction</h2><p>Choose labels that match your own goals. Each direction gets an independent version history, current resume, and Story Builder evidence scope.</p></div></div><div class="resume-paper-empty"><span>⌘</span><h3>No default tracks</h3><p>Start by creating one in the panel at left. You can add as many as you need later.</p></div>'
      : selected
      ? '<div class="studio-overview-head"><div><span class="draft-label">' + (selected.isCurrent ? "CURRENT VERSION" : "SAVED VERSION") + '</span><h2>' + escapeHtml(selected.title) + '</h2><p>' + escapeHtml(trackName(selected.trackId)) + ' · imported ' + escapeHtml(formatDate(selected.createdAt)) + '</p></div><div class="studio-overview-actions">' + (selected.isCurrent ? '<span class="tiny-status confirmed">CURRENT</span>' : '<button class="primary" data-make-current="' + escapeHtml(selected.id) + '">Set as current</button>') + '<button class="secondary" data-open-item="' + escapeHtml(selected.id) + '">Review source</button></div></div>' + resumePreview(selected)
      : '<div class="studio-overview-head"><div><span class="draft-label">START HERE</span><h2>Build a version history</h2><p>Import an original DOCX or PDF. It will become a reviewable Resume Source without changing anything else.</p></div></div>' + resumePreview(null);
    const upload = tracks.length
      ? '<div class="studio-upload"><span class="draft-label">ADD A RESUME VERSION</span><p>Upload DOCX or PDF into <strong>' + escapeHtml(trackName(state.studioTrack)) + '</strong>. It stays a draft until you set it as current.</p><label class="upload-cta"><input id="studio-file" type="file" accept=".docx,.pdf" />↑<strong>Upload new version</strong><small>It will also appear in Resume Sources.</small></label></div>'
      : '<div class="studio-upload is-disabled"><span class="draft-label">ADD A RESUME VERSION</span><p>Create a direction before adding a resume version.</p></div>';
    const trackCreator = '<form id="studio-track-form" class="studio-track-form"><span class="draft-label">NEW DIRECTION</span><label>What should this track be called?<input name="name" placeholder="e.g. Product management" required /></label><button class="secondary" type="submit">Add new track</button></form>';
    const content = pageHeader("MY LIBRARY / VERSION CONTROL", "Resume studio", "Keep independent resume directions and their full version history. Only a version you explicitly confirm becomes current.") + '<div class="studio-layout"><aside class="section-card studio-sidebar"><div class="card-head"><div><h2>Resume directions</h2><p>Choose a track, then review its saved versions.</p></div></div><div class="studio-track-list">' + branches + '</div>' + trackCreator + upload + '<div class="card-head compact"><div><h3>Version history</h3><p>Older versions are never overwritten.</p></div></div><div class="version-stack">' + history + '</div></aside><main class="section-card studio-main">' + overview + '</main></div>';
    renderShell(state.isCloud ? content.replace("Saved locally for this account.", "Saved to your cloud account.") : content);
    document.querySelectorAll("[data-studio-track]").forEach(function (button) { button.addEventListener("click", function () { state.studioTrack = button.dataset.studioTrack; state.selectedVersion = null; render(); }); });
    document.querySelectorAll("[data-delete-track]").forEach(function (button) { button.addEventListener("click", function () { deleteTrack(button.dataset.deleteTrack); }); });
    document.querySelectorAll("[data-select-version]").forEach(function (button) { button.addEventListener("click", function () { state.selectedVersion = button.dataset.selectVersion; render(); }); });
    const picker = document.getElementById("studio-file");
    if (picker) picker.addEventListener("change", function () { if (picker.files[0]) uploadStudioResume(picker.files[0]); });
    document.getElementById("studio-track-form").addEventListener("submit", addTrack);
    document.querySelectorAll("[data-make-current]").forEach(function (button) { button.addEventListener("click", function () { makeCurrent(button.dataset.makeCurrent); }); });
    document.querySelectorAll("[data-open-item]").forEach(function (button) { button.addEventListener("click", function () { openItem(button.dataset.openItem); }); });
  }

  function itemsForKnowledgeTab() {
    const category = { sources: "resume", templates: "template", materials: "supporting", evidence: "evidence" }[state.knowledgeTab];
    return state.items.filter(function (item) { return item.category === category; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  function knowledgeTab(id, label, count) {
    return '<button class="knowledge-tab ' + (state.knowledgeTab === id ? "active" : "") + '" data-knowledge-tab="' + id + '">' + label + '<span>' + count + '</span></button>';
  }

  function knowledgeCard(item) {
    const meta = categoryMeta[item.category] || categoryMeta.supporting;
    const track = item.trackId ? trackName(item.trackId) : "All directions";
    const detail = item.note || meta.description;
    return '<article class="knowledge-card"><span class="knowledge-type">' + meta.eyebrow + '</span><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(detail) + '</p><div class="knowledge-footer"><div class="tag-row"><span class="tag">' + escapeHtml(track) + '</span>' + (item.isCurrent ? '<span class="tag mint">Current version</span>' : "") + '</div><div class="card-actions"><button class="link-action" data-open-item="' + escapeHtml(item.id) + '">Review</button><button class="link-action danger-link" data-delete-item="' + escapeHtml(item.id) + '">Delete file</button></div></div></article>';
  }

  function knowledgeIntake() {
    if (state.knowledgeTab === "sources") {
      return '<aside class="section-card knowledge-intake source-note"><h2>Original resume sources</h2><p>These are source documents, not automatically verified claims.</p><div><strong>Import from Resume Studio</strong><p>Each DOCX/PDF is parsed locally, saved as a deletable source, and added to your version history.</p><button class="secondary" data-nav="studio">Go to Resume Studio</button></div></aside>';
    }
    if (state.knowledgeTab === "templates") {
      return '<aside class="section-card knowledge-intake"><h2>CV template reference</h2><p>Used for formatting, narrative style, and language only.</p><label class="template-drop"><input id="knowledge-file" type="file" accept=".docx,.pdf" />↑<strong>Upload a CV template</strong><small>DOCX is best for a reusable style reference; PDF remains a layout reference.</small></label><div class="boundary-note">Templates are never added to the factual evidence pool or used for STAR stories.</div></aside>';
    }
    if (state.knowledgeTab === "materials") {
      return '<aside class="section-card knowledge-intake"><h2>Supporting material</h2><p>Upload project notes, work samples, decks, certificates, or other factual context.</p><label>Role direction<select id="knowledge-track">' + trackOptions("", false) + '</select></label><label class="template-drop"><input id="knowledge-file" type="file" accept=".docx,.pdf,.pptx,.xlsx,.xls,.csv,.tsv,.txt,.md,.rtf,.json,.png,.jpg,.jpeg" />↑<strong>Upload supporting material</strong><small>DOCX, PDF, PPTX, XLSX, CSV, TXT, or image reference · 20 MB max</small></label></aside>';
    }
    return '<aside class="section-card knowledge-intake"><h2>Evidence library</h2><p>Add a source-linked fact, project context, or small story fragment you want the agent to be able to verify later.</p><form id="evidence-form" class="evidence-form"><label>Fact title<input name="title" placeholder="e.g. Project result" required /></label><label>Role direction<select name="trackId">' + trackOptions("", false) + '</select></label><label>Factual detail<textarea name="text" placeholder="Add a concrete, reviewable fact. Include metrics, tools, outcome, or a caveat." required></textarea></label><label>Source note<input name="note" placeholder="Where did this come from?" /></label><button class="primary" type="submit">Add factual note</button></form></aside>';
  }

  function renderKnowledge() {
    const counts = {
      evidence: state.items.filter(function (item) { return item.category === "evidence"; }).length,
      sources: state.items.filter(function (item) { return item.category === "resume"; }).length,
      templates: state.items.filter(function (item) { return item.category === "template"; }).length,
      materials: state.items.filter(function (item) { return item.category === "supporting"; }).length,
    };
    const items = itemsForKnowledgeTab();
    const cards = items.length ? items.map(knowledgeCard).join("") : '<div class="knowledge-empty"><h3>No items here yet</h3><p>' + (state.knowledgeTab === "sources" ? "Upload a resume version in Resume Studio and it will appear here." : state.knowledgeTab === "templates" ? "Upload a DOCX or PDF template to keep its formatting reference separate." : state.knowledgeTab === "materials" ? "Upload a supporting document to build your evidence base." : "Add a factual note with clear context or a source." ) + '</p></div>';
    const content = pageHeader("MY LIBRARY / SOURCE BOUNDARIES", "Knowledge library", "Original resumes and supporting files are source material. Templates influence presentation only. Only reviewable evidence is used to support a story.") + '<div class="knowledge-heading"><div><h2>Four distinct knowledge boundaries</h2><p>Keep your resume versions, templates, supporting material, and factual notes separate so every later story remains traceable.</p></div><span class="cloud-badge">' + state.items.length + ' items saved</span></div><div class="knowledge-tabs">' + knowledgeTab("evidence", "Evidence library", counts.evidence) + knowledgeTab("sources", "Resume sources", counts.sources) + knowledgeTab("templates", "CV templates", counts.templates) + knowledgeTab("materials", "Supporting materials", counts.materials) + '</div><div class="knowledge-layout">' + knowledgeIntake() + '<section class="knowledge-grid">' + cards + '</section></div>';
    renderShell(content);
    document.querySelectorAll("[data-knowledge-tab]").forEach(function (button) { button.addEventListener("click", function () { state.knowledgeTab = button.dataset.knowledgeTab; render(); }); });
    document.querySelectorAll("[data-open-item]").forEach(function (button) { button.addEventListener("click", function () { openItem(button.dataset.openItem); }); });
    document.querySelectorAll("[data-delete-item]").forEach(function (button) { button.addEventListener("click", function () { deleteItem(button.dataset.deleteItem); }); });
    const file = document.getElementById("knowledge-file");
    if (file) file.addEventListener("change", function () { if (file.files[0]) uploadKnowledgeFile(file.files[0], state.knowledgeTab === "templates" ? "template" : "supporting"); });
    const evidence = document.getElementById("evidence-form");
    if (evidence) evidence.addEventListener("submit", addEvidence);
  }

  function starBlocks(star) {
    const value = star || {};
    const actions = Array.isArray(value.action) ? value.action : [];
    return '<div class="star-grid"><section><span>S · Situation</span><p>' + escapeHtml(value.situation || "Not specified") + '</p></section><section><span>T · Task</span><p>' + escapeHtml(value.task || "Not specified") + '</p></section><section class="star-action"><span>A · Action</span>' + (actions.length ? '<ul>' + actions.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join("") + '</ul>' : '<p>Not specified</p>') + '</section><section><span>R · Result</span><p>' + escapeHtml(value.result || "Not specified") + '</p></section></div>';
  }

  function storyDraft(draft, message) {
    const used = draft.evidenceUsed && draft.evidenceUsed.length ? '<p class="story-evidence"><strong>Evidence used</strong>' + escapeHtml(draft.evidenceUsed.join(" · ")) + '</p>' : "";
    const jobAlignment = draft.jobAlignment ? '<div class="story-job-alignment"><strong>JD alignment</strong><span>' + escapeHtml(draft.jobAlignment) + '</span>' + (draft.jobKeywords && draft.jobKeywords.length ? '<div class="tag-row">' + draft.jobKeywords.map(function (keyword) { return '<span class="tag">' + escapeHtml(keyword) + '</span>'; }).join("") + '</div>' : "") + '</div>' : "";
    const gaps = draft.evidenceGaps && draft.evidenceGaps.length ? '<div class="story-gap"><strong>Verify before saying</strong><span>' + escapeHtml(draft.evidenceGaps.join(" · ")) + '</span></div>' : "";
    const notes = draft.coachNotes && draft.coachNotes.length ? '<details class="story-details"><summary>Coaching notes</summary><ul>' + draft.coachNotes.map(function (note) { return '<li>' + escapeHtml(note) + '</li>'; }).join("") + '</ul></details>' : "";
    const followups = draft.followUps && draft.followUps.length ? '<details class="story-details"><summary>Likely follow-up questions</summary><ul>' + draft.followUps.map(function (note) { return '<li>' + escapeHtml(note) + '</li>'; }).join("") + '</ul></details>' : "";
    const confirmed = message.confirmedStoryId;
    const star = draft.star || {};
    const actionText = Array.isArray(star.action) ? star.action.join("\n") : "";
    const editor = '<details class="story-edit" open><summary>Edit this draft</summary><p>You can directly revise this draft before saving it. Keep factual claims aligned with your source material.</p><form class="story-edit-form" data-edit-draft="' + escapeHtml(message.id) + '"><label>Story title<input name="title" value="' + escapeHtml(draft.title || "") + '" required /></label><label>Spoken answer<textarea name="answer" required>' + escapeHtml(draft.answer || "") + '</textarea></label><div class="story-edit-grid"><label>Situation<textarea name="situation">' + escapeHtml(star.situation || "") + '</textarea></label><label>Task<textarea name="task">' + escapeHtml(star.task || "") + '</textarea></label><label>Actions <small>One action per line</small><textarea name="action">' + escapeHtml(actionText) + '</textarea></label><label>Result<textarea name="result">' + escapeHtml(star.result || "") + '</textarea></label></div><button class="secondary" type="submit">Keep manual edits</button></form></details>';
    const revise = '<form class="story-revision-form" data-revise-story="' + escapeHtml(message.id) + '"><label>Coach follow-up / revision request<textarea name="instruction" placeholder="e.g. Make the opening more concise; emphasize stakeholder alignment; use less technical language."></textarea></label><div><span>The coach will re-check every factual claim against your Knowledge Library before revising.</span><button class="secondary" type="submit">Revise with coach</button></div></form>';
    const actions = confirmed ? '<p class="story-confirmed-note">This answer is in your Stories library.</p>' : editor + revise + '<div class="story-answer-actions"><button class="primary" data-confirm-story="' + escapeHtml(message.id) + '">Confirm & save to library</button><button class="secondary" data-copy-draft="' + escapeHtml(message.id) + '">Copy answer</button></div>';
    return '<article class="story-answer"><div class="story-answer-head"><div><span class="draft-label">' + (draft.mode === "mock" ? "MOCK INTERVIEW" : "STAR ANSWER") + '</span><h3>' + escapeHtml(draft.title || "Interview story") + '</h3></div><span class="tiny-status ' + (confirmed ? 'confirmed">Saved' : 'draft">Review needed') + '</span></div><p class="story-spoken-answer">' + escapeHtml(draft.answer || "Review the STAR blocks below.") + '</p>' + jobAlignment + starBlocks(draft.star) + used + gaps + notes + followups + actions + '</article>';
  }

  function renderStoryChat() {
    const messages = !state.storyChat.length ? '<article class="story-chat-message assistant welcome"><div class="story-avatar">✦</div><div><strong>My Library STAR coach</strong><p>Ask one behavioral question. I will search your current resume versions and selected Knowledge Library material, then create an evidence-backed STAR draft for your review.</p></div></article>' : state.storyChat.map(function (message) {
      if (message.role === "user") return '<article class="story-chat-message user"><div><span>YOU</span><p>' + escapeHtml(message.content) + '</p></div></article>';
      return '<article class="story-chat-message assistant"><div class="story-avatar">✦</div><div class="story-assistant-content"><span>MY LIBRARY INTERVIEW COACH</span><p class="story-chat-summary">' + escapeHtml(message.summary || "Here is the strongest evidence-backed answer I found.") + '</p>' + storyDraft(message.draft, message) + '</div></article>';
    }).join("");
    if (!state.storyPending) return messages;
    const detail = state.storyPending === "revision"
      ? "Re-checking your draft against the source material you saved."
      : "Searching your selected resume, Knowledge Library material, and target job description.";
    return messages + '<article class="story-working" role="status" aria-live="polite"><span class="story-spinner" aria-hidden="true"></span><div><strong>Working on your evidence-backed story</strong><p>' + detail + '</p></div></article>';
  }

  function storyRows() {
    if (!state.stories.length) return '<div class="stories-empty"><div class="paper-symbol">✦</div><h3>No confirmed answers yet</h3><p>Confirm a STAR answer, or a completed mock interview, to keep it in this reusable library.</p></div>';
    const active = state.stories.find(function (story) { return story.id === state.selectedStory; }) || state.stories[0];
    return '<div class="story-library-list">' + state.stories.map(function (story) { const isMock = story.kind === "mock"; return '<button class="story-library-row ' + (story.id === active.id ? "selected" : "") + '" data-select-story="' + escapeHtml(story.id) + '"><span>' + (isMock ? 'MOCK' : 'STAR') + '</span><strong>' + escapeHtml(story.title) + '</strong><small>' + escapeHtml((story.question || "Confirmed interview answer").slice(0, 76)) + '</small></button>'; }).join("") + '</div>';
  }

  function mockHistoryRows() {
    if (!state.mockHistories.length) return '<div class="stories-empty mock-history-empty"><div class="paper-symbol">◌</div><h3>No saved mock yet</h3><p>Finish a practice session, then choose Save to mock history.</p></div>';
    return '<div class="story-library-list mock-history-list">' + state.mockHistories.map(function (history) {
      const active = history.id === state.selectedMockHistory ? ' selected' : '';
      const mode = history.mode === "live" ? "LIVE" : "5-Q";
      const rounds = Array.isArray(history.rounds) ? history.rounds.length : 0;
      return '<button class="story-library-row' + active + '" data-open-mock-history="' + escapeHtml(history.id) + '"><span>' + mode + '</span><strong>' + escapeHtml(history.title || "Mock interview") + '</strong><small>' + rounds + ' question' + (rounds === 1 ? '' : 's') + ' · ' + escapeHtml(formatDate(history.savedAt)) + '</small></button>';
    }).join("") + '</div>';
  }

  function mockHistoryRoundCards(rounds) {
    return rounds.map(function (round, index) {
      const turns = Array.isArray(round.turns) ? round.turns : [];
      return '<details class="saved-mock-round" open><summary><span>QUESTION ' + (index + 1) + '</span>' + escapeHtml(round.question || "Interview question") + '</summary><div class="saved-mock-turns">' + turns.map(function (turn, turnIndex) { return '<article><strong>' + (turnIndex ? 'Follow-up answer' : 'Your answer') + '</strong><p><em>' + escapeHtml(turn.question || "") + '</em></p><p>' + escapeHtml(turn.answer || "") + '</p></article>'; }).join("") + '</div>' + mockFeedbackCard(round.feedback || {}, "QUESTION SCORECARD") + '</details>';
    }).join("");
  }

  function renderSavedMockHistory(history) {
    if (!history) return '';
    const rounds = Array.isArray(history.rounds) ? history.rounds : [];
    const modeName = history.mode === "live" ? "Live coach" : "Full-session coach";
    const roundCards = mockHistoryRoundCards(rounds);
    const summary = history.mode === "coach" && history.summary && Object.keys(history.summary).length ? mockSummaryCard(history.summary, rounds) : '';
    const jd = history.jobDescription ? '<details class="saved-mock-jd"><summary>View saved target job description</summary><p>' + escapeHtml(history.jobDescription) + '</p></details>' : '';
    return '<section class="section-card mock-panel saved-mock-history"><div class="story-chat-head"><div><span class="draft-label">SAVED MOCK HISTORY</span><h2>' + escapeHtml(history.title || "Mock interview") + '</h2><p>' + escapeHtml(modeName) + ' · ' + rounds.length + ' completed question' + (rounds.length === 1 ? '' : 's') + ' · saved ' + escapeHtml(formatDate(history.savedAt)) + '</p></div><button class="secondary compact-button" type="button" data-close-mock-history>Back to Mock Interview</button></div>' + jd + '<div class="saved-mock-rounds">' + roundCards + '</div>' + summary + '<div class="saved-mock-actions"><button class="link-action danger-link" type="button" data-delete-mock-history="' + escapeHtml(history.id) + '">Delete saved mock</button></div></section>';
  }

  function jobDescriptionPanel() {
    const count = state.storyJobDescription.length;
    return '<section class="section-card jd-target-card"><div class="card-head"><div><span class="draft-label">TARGET JOB</span><h2>Use a job description</h2><p>The AI uses the JD to choose relevant, evidence-backed stories; it never treats the JD as proof of your experience.</p></div><span class="jd-count">' + count + '/16000</span></div><label>Job description<textarea id="story-jd" maxlength="16000" placeholder="Paste the role responsibilities, skills, and qualities here. The field stays compact and scrolls for long JDs.">' + escapeHtml(state.storyJobDescription) + '</textarea></label><div class="jd-actions"><span>' + (count ? 'Saved locally for this account. It will be considered in the next story.' : 'Optional, but useful for tailoring your story selection.') + '</span><button type="button" class="link-action" data-clear-jd' + (count ? "" : " disabled") + '>Clear JD</button></div></section>';
  }

  function storyDetail() {
    const story = state.stories.find(function (item) { return item.id === state.selectedStory; }) || state.stories[0];
    if (!story) return "";
    if (story.kind === "mock") {
      const history = state.mockHistories.find(function (item) { return item.id === story.mockHistoryId; });
      if (!history) return '<section class="section-card story-library-detail"><div class="card-head"><div><span class="draft-label">CONFIRMED MOCK</span><h3>' + escapeHtml(story.title) + '</h3><p>The linked Mock history is no longer available.</p></div><button class="link-action danger-link" data-delete-story="' + escapeHtml(story.id) + '">Remove</button></div></section>';
      const rounds = Array.isArray(history.rounds) ? history.rounds : [];
      const modeName = history.mode === "live" ? "Live coach" : "Full-session coach";
      const summary = history.mode === "coach" && history.summary && Object.keys(history.summary).length ? mockSummaryCard(history.summary, rounds) : '';
      return '<section class="section-card story-library-detail saved-mock-history"><div class="card-head"><div><span class="draft-label">CONFIRMED MOCK INTERVIEW</span><h3>' + escapeHtml(story.title) + '</h3><p>' + escapeHtml(modeName) + ' · ' + rounds.length + ' completed question' + (rounds.length === 1 ? '' : 's') + ' · confirmed ' + escapeHtml(formatDate(story.confirmedAt)) + '</p></div><button class="link-action danger-link" data-delete-story="' + escapeHtml(story.id) + '">Remove from confirmed answers</button></div><p class="panel-copy">This confirmed record preserves the complete session: each question, your response, scorecard, suggested answer, and practice feedback.</p><div class="saved-mock-rounds">' + mockHistoryRoundCards(rounds) + '</div>' + summary + '</section>';
    }
    const alignment = story.jobAlignment ? '<div class="story-job-alignment"><strong>JD alignment</strong><span>' + escapeHtml(story.jobAlignment) + '</span></div>' : "";
    return '<section class="section-card story-library-detail"><div class="card-head"><div><span class="draft-label">CONFIRMED STORY</span><h3>' + escapeHtml(story.title) + '</h3><p>Saved ' + escapeHtml(formatDate(story.confirmedAt)) + ' · ' + escapeHtml(trackName(story.trackId)) + '</p></div><button class="link-action danger-link" data-delete-story="' + escapeHtml(story.id) + '">Delete</button></div><div class="story-question"><strong>Question</strong><p>' + escapeHtml(story.question) + '</p></div><p class="story-spoken-answer">' + escapeHtml(story.answer) + '</p>' + alignment + starBlocks(story.star) + '<div class="story-answer-actions"><button class="secondary" data-copy-saved="' + escapeHtml(story.id) + '">Copy answer</button></div></section>';
  }

  function storyToolTabs() {
    const starClass = state.storyTool === "star" ? "active" : "";
    const mockClass = state.storyTool === "mock" ? "active" : "";
    return '<div class="story-tool-tabs" role="tablist" aria-label="Story Builder tools"><button type="button" role="tab" aria-selected="' + (state.storyTool === "star" ? "true" : "false") + '" class="' + starClass + '" data-story-tool="star"><strong>Build a STAR answer</strong><span>Turn one real experience into a reviewable story.</span></button><button type="button" role="tab" aria-selected="' + (state.storyTool === "mock" ? "true" : "false") + '" class="' + mockClass + '" data-story-tool="mock"><strong>Mock interview</strong><span>Practice adaptive questions, follow-ups, and feedback.</span></button></div>';
  }

  function renderStoryLauncher(aiReady) {
    const disabled = aiReady ? "" : " disabled";
    return '<section class="section-card story-launcher"><div class="story-launcher-intro"><span class="draft-label">NEW CONVERSATION</span><h2>What would you like to practice?</h2><p>Choose one clear workflow. Both use your selected job description and your factual Knowledge Library materials.</p></div><div class="story-launch-options"><button type="button" data-launch-story="star"' + disabled + '><span class="story-launch-icon">✦</span><strong>Start a STAR Story</strong><small>Bring one behavioral question. The coach creates an editable, evidence-backed STAR answer.</small><em>Open STAR Builder →</em></button><button type="button" data-launch-story="mock"' + disabled + '><span class="story-launch-icon mock">◌</span><strong>Go to Mock Interview</strong><small>Practice five adaptive JD-aware questions, follow-ups, feedback, and optional voice transcription.</small><em>Open Mock Interview →</em></button></div>' + (!aiReady ? '<p class="story-launch-note">Connect your own OpenAI key in Settings to start either activity. Your saved resumes and library still remain available.</p>' : '') + '</section>';
  }

  function interviewStatus(aiReady) {
    return aiReady
      ? '<div class="ai-status ready"><div><strong>OpenAI is connected for this account</strong><span>gpt-5-mini' + (state.aiStatus.keyHint ? ' · ' + escapeHtml(state.aiStatus.keyHint) : '') + '</span></div><button class="link-action ai-status-action" type="button" data-nav="settings">Manage key</button></div>'
      : '<div class="ai-status"><div><strong>' + (state.aiStatus && state.aiStatus.needsReconnect ? 'Reconnect your OpenAI key' : 'Story Builder needs your OpenAI key') + '</strong><span>' + (state.aiStatus && state.aiStatus.needsReconnect ? 'This account’s encrypted connection cannot be read. Replace the key in Settings; your library is unchanged.' : 'Connect your own OpenAI Platform API key in Settings. Resume Studio and Knowledge Library continue to work without one.') + '</span></div><button class="link-action ai-status-action" type="button" data-nav="settings">Open Settings</button></div>';
  }

  function storyWorking(label, detail) {
    return '<article class="story-working" role="status" aria-live="polite"><span class="story-spinner" aria-hidden="true"></span><div><strong>' + escapeHtml(label) + '</strong><p>' + escapeHtml(detail) + '</p></div></article>';
  }

  function renderStarWorkspace(aiReady, storyBusy) {
    const disabled = aiReady && !storyBusy ? '' : ' disabled';
    return '<section class="section-card story-chat-card"><div class="story-chat-head"><div><span class="draft-label">STAR STORY BUILDER</span><h2>Build one supported answer</h2><p>Start with a behavioral question. The STAR coach selects a relevant experience from your current resume and factual Knowledge Library material, then makes the answer editable and reviewable.</p></div><button class="secondary compact-button" type="button" data-open-story-launcher' + (storyBusy ? ' disabled' : '') + '>New chat</button></div>' + interviewStatus(aiReady) + '<div class="story-chat-history">' + renderStoryChat() + '</div><form id="story-question-form" class="story-composer"><div class="story-composer-controls"><label>Evidence scope<select name="trackId"' + disabled + '>' + trackOptions(state.storyTrack, true) + '</select></label><div class="story-mode-note"><span>RESPONSE TYPE</span><strong>Evidence-backed STAR answer</strong></div></div><label>Behavioral question<textarea name="question"' + disabled + ' placeholder="e.g. Tell me about a time you had to influence stakeholders using data."></textarea></label><div class="story-composer-actions"><span>' + (storyBusy ? 'Your coach is working. Your source material remains unchanged while this draft is prepared.' : aiReady ? 'OpenAI is ready. Every response remains editable and stays a draft until you confirm it.' : 'Connect an AI key in Settings to start a chat. Your saved stories remain available.') + '</span><button class="primary" type="submit"' + disabled + '>' + (storyBusy ? 'Building your story…' : 'Build STAR story') + '</button></div></form></section>';
  }

  function mockQuestion(session) {
    return session.currentQuestion || session.questions[session.index] || "";
  }

  function mockFeedbackCard(feedback, label) {
    if (!feedback) return "";
    const scores = feedback.scores || {};
    const scoreRow = [["JD relevance", scores.relevance], ["STAR logic", scores.starLogic], ["Personal action", scores.personalAction], ["Result & evidence", scores.resultEvidence], ["Clarity", scores.clarity]].map(function (entry) { return '<div><span>' + escapeHtml(entry[0]) + '</span><strong>' + escapeHtml(entry[1] || 0) + '/5</strong></div>'; }).join("");
    const improvements = (feedback.improvements || []).map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join("");
    const gaps = feedback.evidenceGaps && feedback.evidenceGaps.length ? '<p class="mock-evidence-gap"><strong>Verify before reusing:</strong> ' + escapeHtml(feedback.evidenceGaps.join(" · ")) + '</p>' : "";
    const optimized = feedback.optimizedAnswer ? '<details class="mock-optimized" open><summary>Suggested spoken answer</summary><p>' + escapeHtml(feedback.optimizedAnswer) + '</p></details>' : "";
    return '<section class="mock-feedback"><div class="mock-feedback-head"><div><span class="draft-label">' + escapeHtml(label || "LIVE COACH SCORECARD") + '</span><h3>' + escapeHtml(feedback.total || 0) + '/25</h3></div><p>' + escapeHtml(feedback.reason || "Review the specific feedback below before moving on.") + '</p></div><div class="mock-score-grid">' + scoreRow + '</div><div class="mock-feedback-columns"><div><strong>What worked</strong><p>' + escapeHtml(feedback.strength || "You gave the coach enough detail to review this answer.") + '</p></div><div><strong>Improve next</strong><ol>' + improvements + '</ol></div></div>' + gaps + optimized + '</section>';
  }

  function mockSummaryCard(summary, rounds) {
    if (!summary) return "";
    const list = function (title, values, type) { return '<section class="mock-summary-column ' + type + '"><h3>' + escapeHtml(title) + '</h3><ul>' + (values && values.length ? values.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join("") : '<li>Not enough completed answers to identify a pattern yet.</li>') + '</ul></section>'; };
    const totals = (rounds || []).map(function (round) { return Number(round && round.feedback && round.feedback.total); }).filter(function (value) { return Number.isFinite(value) && value > 0; });
    const average = totals.length ? (totals.reduce(function (sum, value) { return sum + value; }, 0) / totals.length / 5).toFixed(1) : "";
    const score = average ? '<div class="mock-overall-score"><span>OVERALL PRACTICE SCORE</span><strong>' + average + '/5</strong><small>Average of the completed-question scorecards</small></div>' : '';
    return '<section class="mock-summary"><span class="draft-label">FULL-SESSION COACH REVIEW</span><h2>What to keep practicing</h2>' + score + '<p>' + escapeHtml(summary.summary || "Your completed answers are ready for review.") + '</p><div class="mock-summary-grid">' + list("Strengths", summary.strengths, "strength") + list("Patterns to improve", summary.gaps, "gap") + list("Next practice", summary.practice, "practice") + '</div></section>';
  }

  function mockHistorySaveAction(session, busy) {
    if (session.historyId) {
      const confirmed = state.stories.some(function (story) { return story.kind === "mock" && story.mockHistoryId === session.historyId; });
      return '<div class="mock-history-save saved"><span class="tiny-status confirmed">SAVED</span><p>This session is in Mock history and can be reopened any time.</p>' + (confirmed ? '<p class="mock-confirmed-note">It is also in Confirmed answers.</p>' : '<button class="secondary" type="button" data-confirm-mock-history="' + escapeHtml(session.historyId) + '"' + (busy ? ' disabled' : '') + '>Confirm to answers library</button>') + '</div>';
    }
    return '<div class="mock-history-save"><div><span class="draft-label">KEEP THIS PRACTICE</span><p>This session normally saves automatically after completion. If automatic saving did not finish, use this button to retry without losing your completed answers.</p></div><button class="primary" type="button" data-save-mock-history' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving session…' : 'Retry save to mock history') + '</button></div>';
  }

  function mockRecorderControls(disabled) {
    const recording = Boolean(state.mockRecorder);
    return '<div class="mock-recorder"><button class="secondary record-button ' + (recording ? 'recording' : '') + '" type="button" id="record-mock-answer"' + (disabled ? ' disabled' : '') + '><span aria-hidden="true">' + (recording ? '■' : '●') + '</span>' + (recording ? 'Stop & transcribe' : 'Record answer') + '</button><div id="mock-recording-status">' + (recording ? recordingClock() + ' remaining · auto-transcribes at 0:00.' : 'Speak for up to 2 minutes. Audio is sent to OpenAI only when you stop and transcribe; it is not saved by My Library.') + '</div></div>';
  }

  function renderMockWorkspace(aiReady, storyBusy) {
    const disabled = aiReady && !storyBusy ? '' : ' disabled';
    const session = state.mockInterview;
    if (!session) {
      return '<section class="section-card mock-panel"><div class="story-chat-head"><div><span class="draft-label">MOCK INTERVIEW</span><h2>Practice a realistic interview</h2><p>The coach will build five JD-aware behavioral questions, ask one at a time, then adapt follow-ups to what you actually say.</p></div></div>' + interviewStatus(aiReady) + '<form id="mock-setup-form" class="mock-setup"><div class="story-composer-controls"><label>Evidence scope<select name="trackId"' + disabled + '>' + trackOptions(state.storyTrack, true) + '</select></label><label>Question language<select name="language"' + disabled + '><option value="English">English</option><option value="Chinese">中文</option></select></label></div><fieldset' + disabled + '><legend>Practice style</legend><label><input type="radio" name="interviewMode" value="live" checked /> Live coach <span>After each completed question, receive a 1–5 score, answer analysis, and a source-bound suggested answer.</span></label><label><input type="radio" name="interviewMode" value="coach" /> Full-session coach <span>Complete all five questions first, then receive one overall practice review.</span></label></fieldset><div class="mock-setup-actions"><p>Uses the JD at left as a relevance lens and your selected Knowledge Library materials as factual grounding.</p><button class="primary" type="submit"' + disabled + '>' + (storyBusy ? 'Preparing questions…' : 'Start mock interview') + '</button></div></form></section>';
    }
    if (session.status === "complete") {
      const completedReview = session.mode === "live"
        ? '<section class="mock-summary"><span class="draft-label">LIVE COACH COMPLETE</span><h2>Your live scorecards are complete</h2><p>You completed ' + session.rounds.length + ' question' + (session.rounds.length === 1 ? '' : 's') + ' with immediate 1–5 feedback after each one. Start a Full-session coach session when you want a five-question overall review.</p></section>'
        : mockSummaryCard(session.summary, session.rounds) + (!session.summary && storyBusy ? storyWorking("Reviewing your interview", "Summarizing your completed answers and practice patterns.") : "");
      return '<section class="section-card mock-panel mock-complete"><div class="story-chat-head"><div><span class="draft-label">MOCK INTERVIEW COMPLETE</span><h2>Review your practice session</h2><p>You completed ' + session.rounds.length + ' of ' + session.questions.length + ' planned questions. The original sources and audio remain unchanged.</p></div><button class="secondary compact-button" type="button" data-open-story-launcher>Choose activity</button></div>' + completedReview + mockHistorySaveAction(session, storyBusy) + '</section>';
    }
    const question = mockQuestion(session);
    const isFeedback = session.status === "feedback";
    const turnHistory = session.turns.length ? '<div class="mock-turn-history">' + session.turns.map(function (turn, index) { return '<article><span>' + (index ? 'FOLLOW-UP RESPONSE' : 'YOUR ANSWER') + '</span><p>' + escapeHtml(turn.answer) + '</p></article>'; }).join("") + '</div>' : "";
    const progress = 'Question ' + (session.index + 1) + ' of ' + session.questions.length + (session.followUpCount ? ' · follow-up ' + session.followUpCount + ' of 2' : '');
    const feedbackActions = isFeedback ? '<div class="mock-feedback-actions"><button class="secondary" type="button" data-mock-retry>Retry this question</button><button class="secondary" type="button" data-mock-next>' + (session.index + 1 < session.questions.length ? 'Next question' : session.mode === "live" ? 'Finish & save mock' : 'Finish & review') + '</button><button class="link-action" type="button" data-mock-end>End interview</button></div>' : "";
    const skipFollowUp = !isFeedback && session.followUpCount > 0 ? '<button class="link-action mock-skip-followup" type="button" data-skip-mock-followup' + disabled + '>Skip this follow-up</button>' : '';
    const answerForm = isFeedback ? "" : '<section class="mock-answer-box"><label>Your answer<textarea id="mock-answer" maxlength="8000" placeholder="Type your response, or record it below. You can edit any transcript before submitting."' + (disabled ? ' disabled' : '') + '>' + escapeHtml(state.mockAnswerDraft) + '</textarea></label>' + mockRecorderControls(Boolean(disabled)) + '<div class="mock-answer-actions"><button class="secondary" type="button" data-mock-hint' + disabled + '>Give me a hint</button>' + skipFollowUp + '<button class="primary" type="button" data-submit-mock-answer' + disabled + '>' + (storyBusy ? 'Coach is reviewing…' : 'Submit answer') + '</button></div></section>';
    const hint = session.hint ? '<div class="mock-hint"><strong>Hint</strong><p>' + escapeHtml(session.hint) + '</p></div>' : "";
    const recordingCountdown = state.mockRecorder ? '<aside class="mock-recording-countdown" role="status" aria-live="assertive"><span>RECORDING</span><strong id="mock-recording-countdown">' + recordingClock() + '</strong><p>Time remaining<br />Auto-transcribes at 0:00</p></aside>' : '';
    return '<section class="section-card mock-panel"><div class="story-chat-head"><div><span class="draft-label">' + (session.mode === "live" ? 'LIVE COACH' : 'FULL-SESSION COACH') + '</span><h2>Interview in progress</h2><p>' + (session.mode === "live" ? 'After this question and any chosen follow-ups, receive a standardized 1–5 score and answer analysis before you continue.' : 'Complete all five questions first. Your detailed overall review will arrive at the end, without per-question scoring interruptions.') + '</p></div><button class="secondary compact-button" type="button" data-open-story-launcher' + (storyBusy ? ' disabled' : '') + '>Choose activity</button></div>' + interviewStatus(aiReady) + '<div class="mock-progress"><span>' + escapeHtml(progress) + '</span><strong>' + escapeHtml(question) + '</strong></div>' + turnHistory + (storyBusy ? storyWorking(state.storyPending === "mock-transcribe" ? "Transcribing your answer" : state.storyPending === "mock-hint" ? "Preparing a focused hint" : "Reviewing your interview answer", state.storyPending === "mock-transcribe" ? "Your recording is being converted to editable text. It is not stored by My Library." : "The coach is grounding the next step in your response, Knowledge Library, and target JD.") : "") + hint + answerForm + (isFeedback ? mockFeedbackCard(session.feedback) + feedbackActions : "") + recordingCountdown + '</section>';
  }

  function renderStory() {
    const aiReady = state.aiStatus && state.aiStatus.available;
    const storyBusy = Boolean(state.storyPending);
    const selectedHistory = state.mockHistories.find(function (history) { return history.id === state.selectedMockHistory; }) || null;
    if (!selectedHistory) state.selectedMockHistory = null;
    const workspace = selectedHistory ? renderSavedMockHistory(selectedHistory) : (state.storyLaunchMenu ? renderStoryLauncher(aiReady) : (state.storyTool === "mock" ? renderMockWorkspace(aiReady, storyBusy) : renderStarWorkspace(aiReady, storyBusy)));
    const content = pageHeader("MY LIBRARY / INTERVIEW PRACTICE", "Story builder", "Use your own source material for a polished STAR answer or a realistic, JD-aware mock interview.") + storyToolTabs() + '<div class="stories-layout"><aside class="story-side-column">' + jobDescriptionPanel() + '<section class="section-card stories-library"><div class="card-head"><div><span class="draft-label">STORIES LIBRARY</span><h2>Confirmed answers</h2><p>Reusable answers you have reviewed and approved.</p></div><span class="story-count">' + state.stories.length + '</span></div>' + storyRows() + '</section><section class="section-card stories-library mock-history-card"><div class="card-head"><div><span class="draft-label">MOCK HISTORY</span><h2>Saved sessions</h2><p>Reopen past interview questions, answers, and feedback.</p></div><span class="story-count">' + state.mockHistories.length + '</span></div>' + mockHistoryRows() + '</section></aside><main class="stories-workspace">' + workspace + (state.storyTool === "star" && !selectedHistory ? storyDetail() : "") + '</main></div>';
    renderShell(content);
    queueWorkspaceStateSave();
    document.querySelectorAll("[data-story-tool]").forEach(function (button) { button.addEventListener("click", function () {
      if (state.storyPending) return;
      if (state.onboardingStep === 6 && button.dataset.storyTool === "star") { advanceOnboarding(); return; }
      if (state.onboardingStep === 7 && button.dataset.storyTool === "mock") { finishOnboarding(); return; }
      if (state.onboardingStep >= 0) return;
      state.selectedMockHistory = null; state.storyTool = button.dataset.storyTool; state.storyLaunchMenu = false; render();
    }); });
    document.querySelectorAll("[data-open-story-launcher]").forEach(function (button) { button.addEventListener("click", openStoryLauncher); });
    document.querySelectorAll("[data-launch-story]").forEach(function (button) { button.addEventListener("click", function () {
      if (state.storyPending) return;
      if (state.onboardingStep === 5 && button.dataset.launchStory === "star") { advanceOnboarding(); return; }
      if (state.onboardingStep >= 0) return;
      state.selectedMockHistory = null; state.storyTool = button.dataset.launchStory; state.storyLaunchMenu = false; render();
    }); });
    const jdField = document.getElementById("story-jd");
    if (jdField) jdField.addEventListener("input", function () { saveStoryJobDescription(jdField.value); });
    const clearJd = document.querySelector("[data-clear-jd]");
    if (clearJd) clearJd.addEventListener("click", function () { saveStoryJobDescription(""); render(); showToast("Target job description cleared."); });
    document.querySelectorAll("[data-select-story]").forEach(function (button) { button.addEventListener("click", function () { state.selectedStory = button.dataset.selectStory; render(); }); });
    document.querySelectorAll("[data-delete-story]").forEach(function (button) { button.addEventListener("click", function () { deleteStory(button.dataset.deleteStory); }); });
    document.querySelectorAll("[data-copy-saved]").forEach(function (button) { button.addEventListener("click", function () { const story = state.stories.find(function (entry) { return entry.id === button.dataset.copySaved; }); if (story) copyText(story.answer); }); });
    document.querySelectorAll("[data-open-mock-history]").forEach(function (button) { button.addEventListener("click", function () { state.selectedMockHistory = button.dataset.openMockHistory; state.storyTool = "mock"; state.storyLaunchMenu = false; render(); }); });
    document.querySelectorAll("[data-delete-mock-history]").forEach(function (button) { button.addEventListener("click", function () { deleteMockHistory(button.dataset.deleteMockHistory); }); });
    const closeHistory = document.querySelector("[data-close-mock-history]");
    if (closeHistory) closeHistory.addEventListener("click", function () { state.selectedMockHistory = null; state.storyTool = "mock"; render(); });
    const saveHistory = document.querySelector("[data-save-mock-history]");
    if (saveHistory) saveHistory.addEventListener("click", saveMockHistory);
    const confirmMock = document.querySelector("[data-confirm-mock-history]");
    if (confirmMock) confirmMock.addEventListener("click", function () { confirmMockHistory(confirmMock.dataset.confirmMockHistory); });
    if (!state.storyLaunchMenu) {
      if (state.storyTool === "mock") bindMockInterview();
      else bindStarWorkspace();
    }
  }

  function advanceOnboarding() {
    const nextStep = state.onboardingStep + 1;
    if (nextStep >= 8) {
      finishOnboarding();
      return;
    }
    state.onboardingStep = nextStep;
    if (nextStep <= 3) {
      state.view = "studio";
      state.storyLaunchMenu = false;
    } else if (nextStep === 4) {
      state.view = "library";
      state.knowledgeTab = "materials";
      state.storyLaunchMenu = false;
    } else {
      state.view = "story";
      state.storyTool = "star";
      state.storyLaunchMenu = nextStep === 5;
      state.selectedMockHistory = null;
      if (nextStep === 7) state.storyTool = "mock";
    }
    render();
  }

  async function finishOnboarding() {
    if (!state.account || state.onboardingStep < 0) return;
    state.onboardingStep = -1;
    state.account.showOnboarding = false;
    render();
    try {
      const response = await api("/api/onboarding/complete", { method: "POST", body: "{}" });
      if (response.account) state.account = response.account;
    } catch (error) {
      showToast("The tour is closed, but could not be marked complete. It may reappear after refresh. " + error.message, true);
    }
  }

  function bindStarWorkspace() {
    document.getElementById("story-question-form").addEventListener("submit", submitStory);
    document.querySelectorAll("[data-edit-draft]").forEach(function (form) { form.addEventListener("submit", editStoryDraft); });
    document.querySelectorAll("[data-revise-story]").forEach(function (form) { form.addEventListener("submit", reviseStory); });
    document.querySelectorAll("[data-confirm-story]").forEach(function (button) { button.addEventListener("click", function () { confirmStory(button.dataset.confirmStory); }); });
    document.querySelectorAll("[data-copy-draft]").forEach(function (button) { button.addEventListener("click", function () { const message = state.storyChat.find(function (entry) { return entry.id === button.dataset.copyDraft; }); if (message) copyText(message.draft.answer); }); });
  }

  function bindMockInterview() {
    const setup = document.getElementById("mock-setup-form");
    if (setup) setup.addEventListener("submit", startMockInterview);
    const answerField = document.getElementById("mock-answer");
    if (answerField) answerField.addEventListener("input", function () {
      state.mockAnswerDraft = answerField.value;
      queueWorkspaceStateSave();
    });
    const answer = document.querySelector("[data-submit-mock-answer]");
    if (answer) answer.addEventListener("click", submitMockAnswer);
    const hint = document.querySelector("[data-mock-hint]");
    if (hint) hint.addEventListener("click", requestMockHint);
    const skip = document.querySelector("[data-skip-mock-followup]");
    if (skip) skip.addEventListener("click", skipMockFollowUp);
    const record = document.getElementById("record-mock-answer");
    if (record) record.addEventListener("click", toggleMockRecording);
    const retry = document.querySelector("[data-mock-retry]");
    if (retry) retry.addEventListener("click", retryMockQuestion);
    const next = document.querySelector("[data-mock-next]");
    if (next) next.addEventListener("click", nextMockQuestion);
    const end = document.querySelector("[data-mock-end]");
    if (end) end.addEventListener("click", finishMockInterview);
    document.querySelectorAll("[data-reset-mock]").forEach(function (button) { button.addEventListener("click", resetMockInterview); });
  }

  function openStoryLauncher() {
    if (state.storyPending) return;
    stopMockRecording(true);
    state.storyChat = [];
    state.mockInterview = null;
    state.selectedMockHistory = null;
    state.mockAnswerDraft = "";
    state.storyLaunchMenu = true;
    render();
  }

  function renderSettings() {
    const tracks = state.account.tracks || [];
    const connection = state.account.aiConnection || {};
    const configured = Boolean(connection.configured);
    const connectionCard = '<section class="section-card ai-connection-card"><div class="card-head"><div><span class="draft-label">STORY BUILDER</span><h2>Your OpenAI connection</h2><p>Each My Library account can supply its own OpenAI Platform API key. A saved key is encrypted locally and never returned to the browser.</p></div><span class="connection-state ' + (configured ? 'connected' : 'not-connected') + '">' + (configured ? 'Connected' : 'Not connected') + '</span></div>' + (configured ? '<div class="connection-summary"><strong>OpenAI</strong><span>gpt-5-mini · ' + escapeHtml(connection.keyHint || "Masked key") + '</span><small>Updated ' + escapeHtml(formatDate(connection.updatedAt) || "recently") + '</small></div>' : '<p class="connection-empty">Story Builder stays off until this account connects a key. Resume versions, source uploads, and confirmed stories are still available.</p>') + '<form id="ai-connection-form" class="settings-form"><label>' + (configured ? 'Replace OpenAI API key' : 'OpenAI API key') + '<input name="apiKey" type="password" minlength="12" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Paste your OpenAI API key here" /></label><p class="api-key-note">My Library uses gpt-5-mini automatically, so there is no provider or model to choose. When you save, it validates the key with OpenAI before encrypting it under this account. That validation sends no resume, JD, or library content.</p><div class="connection-actions"><button class="primary" type="submit">' + (configured ? 'Replace key' : 'Connect key') + '</button>' + (configured ? '<button class="secondary danger-outline" type="button" id="disconnect-ai">Disconnect key</button>' : '') + '</div></form></section>';
    const content = pageHeader("MY LIBRARY / LOCAL SETTINGS", "Workspace settings", "Role directions organize your resume history and limit which materials a Story Builder request will use.") + '<div class="settings-layout">' + connectionCard + '<section class="section-card"><h2>Role directions</h2><p class="panel-copy">New accounts begin empty so you can define your own directions. Existing directions stay unchanged. You can also add one directly in Resume Studio.</p>' + (tracks.length ? tracks.map(function (track) { return '<div class="setting-row"><div><h3><span class="track-dot ' + escapeHtml(track.color) + '"></span> ' + escapeHtml(track.name) + '</h3><p>' + state.items.filter(function (item) { return item.trackId === track.id; }).length + ' linked source(s)</p></div></div>'; }).join("") : '<div class="studio-empty-list">No directions yet. Create one here or in Resume Studio.</div>') + '<form id="track-form" class="form-actions"><label>New direction<input name="name" placeholder="e.g. Consulting" required /></label><button class="secondary" type="submit">Add direction</button></form></section><section class="section-card"><h2>Local password</h2><p class="panel-copy">Use this after signing in if you originally accepted a browser-generated password.</p><form id="password-form" class="settings-form"><label>Current local password<input name="currentPassword" type="password" autocomplete="current-password" required /></label><label>New local password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required /></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label><button class="secondary" type="submit">Change local password</button></form></section></div>';
    const settingsContent = state.isCloud
      ? content.replace("A saved key is encrypted locally and never returned to the browser.", "Your key is encrypted before it is stored in the managed database and is never returned to the browser.").replace("MY LIBRARY / LOCAL SETTINGS", "MY LIBRARY / ACCOUNT SETTINGS").replaceAll("Local password", "Account password").replaceAll("local password", "account password")
      : content;
    renderShell(settingsContent);
    const deleteCard = document.createElement("section");
    deleteCard.className = "section-card account-danger-zone";
    deleteCard.innerHTML = '<h2>Delete account</h2><p>This permanently removes your account, saved stories, interview history, uploaded files, and connected API key.</p><form id="delete-account-form" class="settings-form"><label>Current password<input name="password" type="password" autocomplete="current-password" required /></label><label>Type DELETE to confirm<input name="confirmation" required autocomplete="off" /></label><button class="secondary danger-outline" type="submit">Delete my account and data</button></form>';
    document.querySelector(".settings-layout").appendChild(deleteCard);
    document.getElementById("ai-connection-form").addEventListener("submit", saveAiConnection);
    const disconnect = document.getElementById("disconnect-ai");
    if (disconnect) disconnect.addEventListener("click", deleteAiConnection);
    document.getElementById("track-form").addEventListener("submit", addTrack);
    document.getElementById("password-form").addEventListener("submit", changePassword);
    document.getElementById("delete-account-form").addEventListener("submit", deleteAccount);
  }

  async function deleteAccount(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("confirmation") !== "DELETE") {
      showToast("Type DELETE exactly to confirm account removal.", true);
      return;
    }
    if (!window.confirm("Permanently delete this account and all saved data? This cannot be undone.")) return;
    try {
      await api("/api/auth/account", { method: "POST", body: JSON.stringify({ password: form.get("password") }) });
      localStorage.removeItem("my-library-session");
      state.token = "";
      state.account = null;
      state.items = [];
      state.stories = [];
      state.mockHistories = [];
      state.storyChat = [];
      state.mockInterview = null;
      state.mockAnswerDraft = "";
      state.storyJobDescription = "";
      renderAuth();
      showToast("Your account and saved data have been deleted.");
    } catch (error) { showToast(error.message, true); }
  }

  function fileBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = function () { reject(new Error("This file could not be read.")); };
      reader.readAsDataURL(file);
    });
  }

  async function uploadItem(file, category, trackId, note) {
    const payload = { filename: file.name, data: await fileBase64(file), category: category, trackId: trackId || "", title: fileTitle(file.name), note: note || "" };
    return api("/api/library/upload", { method: "POST", body: JSON.stringify(payload) });
  }

  async function uploadStudioResume(file) {
    try {
      showToast("Reading this resume version locally…");
      const response = await uploadItem(file, "resume", state.studioTrack, "Imported from Resume Studio. Review it before setting it current.");
      state.selectedVersion = response.item.id;
      await refreshAll(); render();
      showToast("Resume version saved. It is also in Knowledge Library → Resume Sources.");
    } catch (error) { showToast(error.message, true); }
  }

  async function uploadKnowledgeFile(file, category) {
    const direction = document.getElementById("knowledge-track");
    try {
      showToast("Reading this source locally…");
      await uploadItem(file, category, direction ? direction.value : "", category === "template" ? "Formatting reference only; excluded from factual Story Builder context." : "Supporting material uploaded from Knowledge Library.");
      await refreshAll(); render();
      showToast(category === "template" ? "Template stored separately from factual evidence." : "Supporting material saved to your Knowledge Library.");
    } catch (error) { showToast(error.message, true); }
  }

  async function addEvidence(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/library/text", { method: "POST", body: JSON.stringify({ title: form.get("title"), text: form.get("text"), note: form.get("note"), trackId: form.get("trackId") }) });
      await refreshAll(); render(); showToast("Factual note saved to your Evidence Library.");
    } catch (error) { showToast(error.message, true); }
  }

  async function makeCurrent(id) {
    const item = state.items.find(function (entry) { return entry.id === id; });
    if (!item || !window.confirm("Make “" + item.title + "” your current " + trackName(item.trackId) + " resume? Older versions remain saved.")) return;
    try {
      const response = await api("/api/library/current", { method: "POST", body: JSON.stringify({ itemId: id }) });
      state.account = response.account;
      await refreshAll(); render(); showToast("Current resume updated. Your earlier versions are still intact.");
    } catch (error) { showToast(error.message, true); }
  }

  function openItem(id) { state.modalItem = state.items.find(function (item) { return item.id === id; }) || null; renderModal(); }

  function renderModal() {
    const item = state.modalItem;
    if (!item) return;
    const meta = categoryMeta[item.category] || categoryMeta.supporting;
    const editableText = item.category === "evidence" ? '<label>Factual detail<textarea name="text">' + escapeHtml(item.text || "") + '</textarea></label>' : '<h3 class="modal-subhead">Extracted text</h3><pre class="extracted-text">' + escapeHtml(item.text || "No text could be extracted; the original file is still retained.") + '</pre>';
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal" role="dialog" aria-modal="true"><div class="modal-top"><div><span class="knowledge-type">' + meta.eyebrow + '</span><h2>' + escapeHtml(item.title) + '</h2><p class="modal-meta">' + escapeHtml(item.filename || "Entered directly") + ' · ' + escapeHtml(item.extractionStatus || "stored") + ' · ' + escapeHtml(formatDate(item.createdAt)) + '</p></div><button class="link-action" type="button" data-close-modal>Close</button></div><form id="item-edit-form" class="settings-form"><label>Display name<input name="title" value="' + escapeHtml(item.title) + '" required /></label><label>Role direction<select name="trackId">' + trackOptions(item.trackId, false) + '</select></label><label>Context note<input name="note" value="' + escapeHtml(item.note || "") + '" /></label>' + editableText + '<div class="modal-actions"><button class="primary" type="submit">Save labels</button>' + (item.filename ? '<button class="secondary" type="button" data-download-item>Download original</button>' : "") + '<button class="danger" type="button" data-delete-modal>Delete source</button></div></form></section>';
    document.body.appendChild(modal);
    modal.addEventListener("click", function (event) { if (event.target === modal) closeModal(); });
    modal.querySelector("[data-close-modal]").addEventListener("click", closeModal);
    modal.querySelector("#item-edit-form").addEventListener("submit", updateItem);
    const download = modal.querySelector("[data-download-item]");
    if (download) download.addEventListener("click", function () { downloadItem(item.id, item.filename); });
    modal.querySelector("[data-delete-modal]").addEventListener("click", function () { deleteItem(item.id); });
  }

  function closeModal() { state.modalItem = null; const modal = document.querySelector(".modal-backdrop"); if (modal) modal.remove(); }

  async function updateItem(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await api("/api/library/" + encodeURIComponent(state.modalItem.id), { method: "PATCH", body: JSON.stringify(Object.fromEntries(form.entries())) }); await refreshAll(); closeModal(); render(); showToast("Knowledge source updated."); } catch (error) { showToast(error.message, true); }
  }

  async function deleteItem(id) {
    const item = state.items.find(function (entry) { return entry.id === id; });
    if (!item || !window.confirm("Delete “" + item.title + "” and its local source file? This cannot be undone.")) return;
    try { await api("/api/library/" + encodeURIComponent(id), { method: "DELETE", body: "{}" }); closeModal(); await refreshAll(); render(); showToast("Source deleted from My Library."); } catch (error) { showToast(error.message, true); }
  }

  async function downloadItem(id, filename) {
    try {
      const response = await fetch("/api/files/" + encodeURIComponent(id), { headers: { "X-Session-Token": state.token } });
      if (!response.ok) throw new Error("Could not download the original file.");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename || "source"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (error) { showToast(error.message, true); }
  }

  function localId() { return "chat_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  async function submitStory(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const question = String(form.get("question") || "").trim();
    if (state.storyPending) return;
    if (!question) { showToast("Ask a behavioral question before building a story.", true); return; }
    state.storyTrack = String(form.get("trackId") || "");
    const jdField = document.getElementById("story-jd");
    if (jdField) saveStoryJobDescription(jdField.value);
    state.storyChat.push({ id: localId(), role: "user", content: question });
    state.storyPending = "building";
    render();
    try {
      const response = await api("/api/story", { method: "POST", body: JSON.stringify({ question: question, trackId: state.storyTrack, mode: "answer", jobDescription: state.storyJobDescription }) });
      state.storyChat.push({ id: localId(), role: "assistant", summary: response.draft.summary, mode: "answer", draft: response.draft });
      showToast("STAR draft is ready. Confirm it only after checking the wording and evidence.");
    } catch (error) { state.storyChat.pop(); showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  function stopMockRecording(discard) {
    window.clearInterval(state.mockRecordingTimer);
    state.mockRecordingTimer = null;
    const recorder = state.mockRecorder;
    if (recorder && recorder.state !== "inactive") {
      if (discard) recorder.onstop = null;
      try { recorder.stop(); } catch (_) { /* Recording has already stopped. */ }
    }
    if (state.mockRecordingStream) {
      state.mockRecordingStream.getTracks().forEach(function (track) { track.stop(); });
    }
    state.mockRecordingStream = null;
    if (discard) {
      state.mockRecorder = null;
      state.mockRecordingChunks = [];
      state.mockRecordingSeconds = 0;
    }
  }

  function recordingClock() {
    const seconds = Math.max(0, 120 - (state.mockRecordingSeconds || 0));
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function updateRecordingDisplay() {
    const button = document.getElementById("record-mock-answer");
    const label = document.getElementById("mock-recording-status");
    if (button) {
      button.classList.toggle("recording", Boolean(state.mockRecorder));
      button.innerHTML = '<span aria-hidden="true">' + (state.mockRecorder ? "■" : "●") + "</span>" + (state.mockRecorder ? "Stop & transcribe" : "Record answer");
    }
    if (label) label.textContent = state.mockRecorder ? recordingClock() + " remaining · auto-transcribes at 0:00." : "Speak for up to 2 minutes. Audio is sent to OpenAI only when you stop and transcribe; it is not saved by My Library.";
    const countdown = document.getElementById("mock-recording-countdown");
    if (countdown) countdown.textContent = recordingClock();
  }

  function blobBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = function () { reject(new Error("Your recording could not be read.")); };
      reader.readAsDataURL(blob);
    });
  }

  function resetMockRound(session) {
    session.currentQuestion = session.questions[session.index] || "";
    session.turns = [];
    session.followUpCount = 0;
    session.feedback = null;
    session.hint = "";
    session.status = "answer";
    state.mockAnswerDraft = "";
  }

  async function startMockInterview(event) {
    event.preventDefault();
    if (state.storyPending) return;
    const form = new FormData(event.currentTarget);
    state.storyTrack = String(form.get("trackId") || "");
    const jdField = document.getElementById("story-jd");
    if (jdField) saveStoryJobDescription(jdField.value);
    state.storyPending = "mock-start";
    render();
    try {
      const response = await api("/api/mock/start", { method: "POST", body: JSON.stringify({ trackId: state.storyTrack, jobDescription: state.storyJobDescription, language: form.get("language") }) });
      const questions = Array.isArray(response.questions) ? response.questions.filter(Boolean) : [];
      if (!questions.length) throw new Error("The interview coach did not return any usable questions. Please try again.");
      state.mockInterview = {
        questions: questions,
        index: 0,
        currentQuestion: questions[0],
        mode: String(form.get("interviewMode") || "live") === "live" ? "live" : "coach",
        language: response.language || form.get("language") || "English",
        trackId: state.storyTrack,
        jobDescription: state.storyJobDescription,
        followUpCount: 0,
        turns: [],
        rounds: [],
        feedback: null,
        hint: "",
        status: "answer",
        summary: null,
      };
      state.mockAnswerDraft = "";
      showToast("Your mock interview is ready. Start with the first question.");
    } catch (error) { showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  async function submitMockAnswer() {
    const session = state.mockInterview;
    if (!session || state.storyPending || session.status === "feedback") return;
    const field = document.getElementById("mock-answer");
    const answer = String(field ? field.value : state.mockAnswerDraft || "").trim();
    if (!answer) { showToast("Answer the current question before continuing.", true); return; }
    state.mockAnswerDraft = answer;
    state.storyPending = "mock-answer";
    render();
    try {
      const currentQuestion = mockQuestion(session);
      const response = await api("/api/mock/answer", { method: "POST", body: JSON.stringify({
        rootQuestion: session.questions[session.index],
        currentQuestion: currentQuestion,
        answer: answer,
        trackId: session.trackId,
        jobDescription: session.jobDescription,
        interviewMode: session.mode,
        followUpCount: session.followUpCount,
        turns: session.turns,
      }) });
      const turn = response.turn || {};
      const allTurns = session.turns.concat([{ question: currentQuestion, answer: answer }]);
      state.mockAnswerDraft = "";
      session.hint = "";
      if (turn.nextAction === "follow_up" && turn.followUpQuestion && session.followUpCount < 2) {
        session.turns = allTurns;
        session.currentQuestion = turn.followUpQuestion;
        session.followUpCount += 1;
        session.status = "answer";
        showToast("The coach has one focused follow-up.");
      } else {
        session.turns = allTurns;
        session.feedback = turn.feedback || null;
        session.rounds.push({ question: session.questions[session.index], turns: allTurns, feedback: turn.feedback || {} });
        if (session.mode === "coach") {
          if (session.index + 1 < session.questions.length) {
            session.index += 1;
            resetMockRound(session);
          } else {
            state.storyPending = "";
            await finishMockInterview();
            return;
          }
        } else {
          session.status = "feedback";
          showToast("Live coach feedback is ready. You can retry, continue, or end the session.");
        }
      }
    } catch (error) { showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  async function skipMockFollowUp() {
    const session = state.mockInterview;
    if (!session || state.storyPending || session.status === "feedback" || session.followUpCount < 1) return;
    state.mockAnswerDraft = "";
    state.storyPending = "mock-skip-followup";
    render();
    try {
      const response = await api("/api/mock/answer", { method: "POST", body: JSON.stringify({
        rootQuestion: session.questions[session.index],
        currentQuestion: mockQuestion(session),
        answer: "",
        skipFollowUp: true,
        trackId: session.trackId,
        jobDescription: session.jobDescription,
        interviewMode: session.mode,
        followUpCount: session.followUpCount,
        turns: session.turns,
      }) });
      const turn = response.turn || {};
      session.hint = "";
      session.feedback = turn.feedback || null;
      session.rounds.push({ question: session.questions[session.index], turns: session.turns.slice(), feedback: turn.feedback || {} });
      if (session.mode === "coach") {
        if (session.index + 1 < session.questions.length) {
          session.index += 1;
          resetMockRound(session);
          showToast("Follow-up skipped. Moving to the next question.");
        } else {
          state.storyPending = "";
          await finishMockInterview();
          return;
        }
      } else {
        session.status = "feedback";
        showToast("Follow-up skipped. Live coach feedback is based on your answers so far.");
      }
    } catch (error) { showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  async function requestMockHint() {
    const session = state.mockInterview;
    if (!session || state.storyPending) return;
    state.storyPending = "mock-hint";
    render();
    try {
      const response = await api("/api/mock/hint", { method: "POST", body: JSON.stringify({ question: mockQuestion(session), trackId: session.trackId, jobDescription: session.jobDescription }) });
      session.hint = response.hint || "";
    } catch (error) { showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  function retryMockQuestion() {
    const session = state.mockInterview;
    if (!session || state.storyPending) return;
    resetMockRound(session);
    render();
    showToast("Retry mode: give the same question another answer.");
  }

  async function nextMockQuestion() {
    const session = state.mockInterview;
    if (!session || state.storyPending) return;
    if (session.index + 1 < session.questions.length) {
      session.index += 1;
      resetMockRound(session);
      render();
      return;
    }
    if (session.mode === "live") {
      completeLiveInterview();
      return;
    }
    await finishMockInterview();
  }

  function completeLiveInterview() {
    const session = state.mockInterview;
    if (!session) return;
    stopMockRecording(true);
    session.summary = null;
    session.status = "complete";
    autoSaveCompletedMock(session);
  }

  async function finishMockInterview() {
    const session = state.mockInterview;
    if (!session || state.storyPending === "mock-summary") return;
    if (session.mode === "live") {
      completeLiveInterview();
      return;
    }
    if (!session.rounds.length) { showToast("Complete at least one question before ending the mock interview.", true); return; }
    stopMockRecording(true);
    state.storyPending = "mock-summary";
    render();
    try {
      const response = await api("/api/mock/summary", { method: "POST", body: JSON.stringify({ rounds: session.rounds }) });
      session.summary = response.summary || null;
      session.status = "complete";
      state.storyPending = "";
      render();
      await autoSaveCompletedMock(session);
      return;
    } catch (error) {
      session.status = "feedback";
      showToast(error.message, true);
    }
    state.storyPending = "";
    render();
  }

  function resetMockInterview() {
    if (state.storyPending) return;
    stopMockRecording(true);
    state.mockInterview = null;
    state.mockAnswerDraft = "";
    render();
  }

  async function toggleMockRecording() {
    if (state.storyPending) return;
    if (state.mockRecorder) {
      try { state.mockRecorder.stop(); } catch (_) { stopMockRecording(true); render(); }
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      showToast("This browser does not support recording. You can still type your answer.", true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      state.mockRecordingStream = stream;
      state.mockRecorder = recorder;
      state.mockRecordingChunks = [];
      state.mockRecordingSeconds = 0;
      recorder.ondataavailable = function (event) { if (event.data && event.data.size) state.mockRecordingChunks.push(event.data); };
      recorder.onstop = async function () {
        window.clearInterval(state.mockRecordingTimer);
        state.mockRecordingTimer = null;
        if (state.mockRecordingStream) state.mockRecordingStream.getTracks().forEach(function (track) { track.stop(); });
        state.mockRecordingStream = null;
        const chunks = state.mockRecordingChunks.slice();
        state.mockRecorder = null;
        state.mockRecordingChunks = [];
        state.mockRecordingSeconds = 0;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) { render(); showToast("No audio was captured. Please try again.", true); return; }
        state.storyPending = "mock-transcribe";
        render();
        try {
          const transcript = await api("/api/mock/transcribe", { method: "POST", body: JSON.stringify({ audioBase64: await blobBase64(blob), filename: "mock-answer.webm", mimeType: blob.type || "audio/webm" }) });
          state.mockAnswerDraft = transcript.transcript || "";
          showToast("Transcription is ready. You can edit it before submitting.");
        } catch (error) { showToast(error.message, true); }
        state.storyPending = "";
        render();
      };
      recorder.start();
      state.mockRecordingTimer = window.setInterval(function () {
        state.mockRecordingSeconds += 1;
        updateRecordingDisplay();
        if (state.mockRecordingSeconds >= 120 && state.mockRecorder) {
          showToast("Two minutes are up — transcribing your answer now.");
          try { state.mockRecorder.stop(); } catch (_) { stopMockRecording(true); render(); }
        }
      }, 1000);
      render();
    } catch (error) {
      stopMockRecording(true);
      showToast(error && error.name === "NotAllowedError" ? "Microphone permission was not granted. You can still type your answer." : "My Library could not access your microphone. You can still type your answer.", true);
    }
  }

  function editStoryDraft(event) {
    event.preventDefault();
    const message = state.storyChat.find(function (entry) { return entry.id === event.currentTarget.dataset.editDraft; });
    if (!message || !message.draft || message.confirmedStoryId) return;
    const form = new FormData(event.currentTarget);
    const action = String(form.get("action") || "").split("\n").map(function (line) { return line.trim(); }).filter(Boolean);
    message.draft.title = String(form.get("title") || "").trim().slice(0, 160) || "Interview story";
    message.draft.answer = String(form.get("answer") || "").trim().slice(0, 7000);
    message.draft.star = {
      situation: String(form.get("situation") || "").trim().slice(0, 2000),
      task: String(form.get("task") || "").trim().slice(0, 2000),
      action: action.slice(0, 5).map(function (line) { return line.slice(0, 1000); }),
      result: String(form.get("result") || "").trim().slice(0, 2000),
    };
    message.draft.summary = "Manually edited draft. Confirm only after checking every factual claim.";
    message.summary = message.draft.summary;
    render(); showToast("Manual edits kept locally. You can still ask the coach for another revision.");
  }

  async function reviseStory(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const instruction = String(form.get("instruction") || "").trim();
    const message = state.storyChat.find(function (entry) { return entry.id === event.currentTarget.dataset.reviseStory; });
    if (state.storyPending) return;
    if (!instruction) { showToast("Write a follow-up or revision request first.", true); return; }
    if (!message || !message.draft || message.confirmedStoryId) return;
    const requestMessage = { id: localId(), role: "user", content: "Revision request: " + instruction };
    state.storyChat.push(requestMessage);
    state.storyPending = "revision";
    render();
    try {
      const response = await api("/api/story/revise", { method: "POST", body: JSON.stringify({
        question: message.draft.question,
        trackId: message.draft.trackId || state.storyTrack,
        mode: message.draft.mode || message.mode || "answer",
        jobDescription: state.storyJobDescription || message.draft.jobDescription || "",
        instruction: instruction,
        draft: message.draft,
      }) });
      state.storyChat.push({ id: localId(), role: "assistant", summary: response.draft.summary, mode: response.draft.mode, draft: response.draft });
      showToast("The coach revised the draft using the same verified source boundary.");
    } catch (error) { state.storyChat = state.storyChat.filter(function (entry) { return entry.id !== requestMessage.id; }); showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  async function confirmStory(messageId) {
    const message = state.storyChat.find(function (entry) { return entry.id === messageId; });
    if (!message || !message.draft || message.confirmedStoryId) return;
    try {
      const response = await api("/api/stories/confirm", { method: "POST", body: JSON.stringify(message.draft) });
      message.confirmedStoryId = response.story.id; state.selectedStory = response.story.id;
      await refreshAll(); render(); showToast("Story confirmed and saved to Stories Library.");
    } catch (error) { showToast(error.message, true); }
  }

  async function deleteStory(id) {
    const story = state.stories.find(function (entry) { return entry.id === id; });
    const message = story && story.kind === "mock"
      ? "Remove this mock interview from Confirmed answers? Its Mock history will stay available."
      : "Delete this confirmed STAR story? Your source material will stay untouched.";
    if (!window.confirm(message)) return;
    try { await api("/api/stories/" + encodeURIComponent(id), { method: "DELETE", body: "{}" }); state.selectedStory = null; await refreshAll(); render(); showToast("Confirmed story deleted."); } catch (error) { showToast(error.message, true); }
  }

  async function saveMockHistory() {
    const session = state.mockInterview;
    if (!session || session.status !== "complete" || session.historyId || state.storyPending) return;
    state.storyPending = "mock-save";
    render();
    try {
      await persistMockHistory(session);
      showToast("Mock interview saved. Open it later from Mock history.");
    } catch (error) { showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  async function confirmMockHistory(historyId) {
    if (!historyId || state.storyPending) return;
    state.storyPending = "mock-confirm";
    render();
    try {
      const response = await api("/api/mock/history/" + encodeURIComponent(historyId) + "/confirm", { method: "POST", body: "{}" });
      state.selectedStory = response.story && response.story.id ? response.story.id : state.selectedStory;
      await refreshAll();
      showToast(response.alreadyConfirmed ? "This mock is already in Confirmed answers." : "Mock interview confirmed and added to your answers library.");
    } catch (error) { showToast(error.message, true); }
    state.storyPending = "";
    render();
  }

  function mockHistoryPayload(session) {
    const direction = session.trackId ? trackName(session.trackId) : "General";
    return {
      title: (session.mode === "live" ? "Live coach" : "Full-session coach") + " · " + direction,
      mode: session.mode,
      language: session.language,
      trackId: session.trackId || "",
      jobDescription: session.jobDescription || "",
      questions: session.questions,
      rounds: session.rounds,
      summary: session.summary,
    };
  }

  async function persistMockHistory(session) {
    const response = await api("/api/mock/history", { method: "POST", body: JSON.stringify(mockHistoryPayload(session)) });
    session.historyId = response.history.id;
    await refreshAll();
    return response.history;
  }

  async function autoSaveCompletedMock(session) {
    if (!session || session.status !== "complete" || session.historyId) return;
    state.storyPending = "mock-save";
    render();
    try {
      await persistMockHistory(session);
      showToast("Completed mock saved automatically. Open it any time from Mock history.");
    } catch (error) {
      showToast("Your completed mock is still on this page, but automatic saving failed. Use Save to mock history to retry. " + error.message, true);
    }
    state.storyPending = "";
    render();
  }

  async function deleteMockHistory(id) {
    if (!window.confirm("Delete this saved mock interview? This only removes the history copy, not your resumes, stories, or source files.")) return;
    try {
      await api("/api/mock/history/" + encodeURIComponent(id), { method: "DELETE", body: "{}" });
      if (state.selectedMockHistory === id) state.selectedMockHistory = null;
      await refreshAll();
      render();
      showToast("Saved mock interview deleted.");
    } catch (error) { showToast(error.message, true); }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text || ""); showToast("Copied to clipboard."); } catch (_) { showToast("Could not copy automatically. Please select the text manually.", true); }
  }

  async function addTrack(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const response = await api("/api/tracks", { method: "POST", body: JSON.stringify({ name: form.get("name") }) });
      state.account = response.account;
      const tracks = state.account.tracks || [];
      state.studioTrack = tracks.length ? tracks[tracks.length - 1].id : "";
      state.selectedVersion = null;
      await refreshAll(); render(); showToast("New role direction added. You can now upload its first version.");
    } catch (error) { showToast(error.message, true); }
  }

  async function deleteTrack(id) {
    const track = (state.account.tracks || []).find(function (entry) { return entry.id === id; });
    if (!track) return;
    const linked = state.items.filter(function (item) { return item.trackId === id; }).length;
    const message = 'Delete the “' + track.name + '” direction? Its ' + linked + ' linked source' + (linked === 1 ? '' : 's') + ' will be kept, but moved to General / no direction. This cannot be undone automatically.';
    if (!window.confirm(message)) return;
    try {
      const response = await api('/api/tracks/' + encodeURIComponent(id), { method: 'DELETE', body: '{}' });
      state.account = response.account;
      state.studioTrack = (state.account.tracks || [])[0] ? state.account.tracks[0].id : '';
      state.selectedVersion = null;
      if (state.storyTrack === id) state.storyTrack = '';
      await refreshAll();
      render();
      showToast('Direction deleted. Your resume sources and history were kept as unassigned files.');
    } catch (error) { showToast(error.message, true); }
  }

  async function changePassword(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (form.get("newPassword") !== form.get("confirmPassword")) { showToast("The two new passwords do not match.", true); return; }
    try { await api("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }) }); event.currentTarget.reset(); showToast("Your My Library password has been updated."); } catch (error) { showToast(error.message, true); }
  }

  async function saveAiConnection(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const apiKey = String(form.get("apiKey") || "").trim();
    if (apiKey.length < 12) { showToast("Paste a complete API key before connecting it.", true); return; }
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true; button.textContent = "Checking key securely…";
    try {
      const response = await api("/api/ai/connection", { method: "POST", body: JSON.stringify({ apiKey: apiKey }) });
      state.account = response.account;
      await refreshAll(); render();
      showToast("OpenAI key verified and saved. The full key is no longer shown.");
    } catch (error) {
      button.disabled = false; button.textContent = state.account && state.account.aiConnection && state.account.aiConnection.configured ? "Replace key" : "Connect key";
      showToast(error.message, true);
    }
  }

  async function deleteAiConnection() {
    if (!window.confirm("Disconnect this account’s saved AI key? Story Builder will pause, while your resumes, library, and confirmed stories remain.") ) return;
    try {
      const response = await api("/api/ai/connection", { method: "DELETE", body: "{}" });
      state.account = response.account;
      await refreshAll(); render();
      showToast("AI key disconnected from this account.");
    } catch (error) { showToast(error.message, true); }
  }

  function render() {
    if (!state.account) { renderAuth(); return; }
    if (state.view === "library") renderKnowledge();
    else if (state.view === "story") renderStory();
    else if (state.view === "settings") renderSettings();
    else renderStudio();
  }

  boot().catch(function (error) { renderAuth(); showToast(error.message || "Could not start My Library.", true); });
})();
