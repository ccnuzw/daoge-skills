const fs = require('fs');
const path = require('path');

const SHARED_CSS_FILE = 'workspace_chrome.css';
const SHARED_JS_FILE = 'workspace_chrome.js';

const SHARED_CSS = `:root {
  --workspace-chrome-bg: #0e1318;
  --workspace-chrome-panel: rgba(255,255,255,0.06);
  --workspace-chrome-panel-border: rgba(255,255,255,0.1);
  --workspace-chrome-text-main: #f3efe6;
  --workspace-chrome-text-sub: rgba(243,239,230,0.68);
  --workspace-chrome-accent: #d9b36d;
}

body[data-workspace-chrome-page] {
  background:
    radial-gradient(circle at top left, rgba(217,179,109,0.18), transparent 26%),
    linear-gradient(135deg, #0a0f13 0%, #101720 45%, #0e1318 100%);
  color: var(--workspace-chrome-text-main);
  font-family: "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
}

.shell,
.board-shell {
  position: relative;
}

.top-links,
.hero-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.top-links a,
.hero-links a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--workspace-chrome-text-main);
  text-decoration: none;
  padding: 10px 14px;
  min-height: 40px;
  border-radius: 14px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  font-size: 13px;
  line-height: 1;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.top-links a:hover,
.hero-links a:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.16);
  transform: translateY(-1px);
}

.top-links a.is-active,
.hero-links a.is-active {
  border-color: rgba(217,179,109,0.34);
  box-shadow: inset 0 0 0 1px rgba(217,179,109,0.18);
  color: var(--workspace-chrome-accent);
}

.workspace-chrome-return-bar {
  margin: 0 0 16px;
}

.workspace-chrome-context-bar {
  margin: 14px 0 0;
  padding: 12px 13px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.08);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
    rgba(255,255,255,0.03);
  display: grid;
  gap: 10px;
}

.workspace-chrome-context-main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 8px;
}

.workspace-chrome-context-item {
  min-width: 0;
  padding: 2px 0;
}

.workspace-chrome-context-label {
  color: var(--workspace-chrome-text-sub);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.workspace-chrome-context-value {
  color: var(--workspace-chrome-text-main);
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
  word-break: break-word;
}

.workspace-chrome-context-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.workspace-chrome-context-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--workspace-chrome-text-sub);
  font-size: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
}

.workspace-chrome-context-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--workspace-chrome-text-sub);
  font-size: 10px;
  line-height: 1.4;
}

.workspace-chrome-journey {
  margin: 18px 0 0;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.08);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
    rgba(255,255,255,0.03);
  display: grid;
  gap: 14px;
}

.workspace-chrome-journey-head {
  display: grid;
  gap: 6px;
}

.workspace-chrome-journey-title {
  color: var(--workspace-chrome-accent);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workspace-chrome-journey-copy {
  color: var(--workspace-chrome-text-sub);
  font-size: 13px;
  line-height: 1.6;
}

.workspace-chrome-journey-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.workspace-chrome-actions {
  margin: 18px 0 0;
  padding: 15px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.08);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
    rgba(255,255,255,0.03);
  display: grid;
  gap: 14px;
}

.workspace-chrome-actions-head {
  display: grid;
  gap: 6px;
}

.workspace-chrome-actions-title {
  color: var(--workspace-chrome-accent);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workspace-chrome-actions-copy {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
  line-height: 1.55;
}

.workspace-chrome-actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 9px;
}

.workspace-chrome-mode-switch,
.workspace-chrome-progress,
.workspace-chrome-route-compass,
.workspace-chrome-workbench {
  margin: 16px 0 0;
  padding: 13px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.08);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
    rgba(255,255,255,0.03);
  display: grid;
  gap: 11px;
}

.workspace-chrome-workbench {
  opacity: 0.84;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.018)),
    rgba(255,255,255,0.022);
}

.workspace-command-deck .workspace-chrome-mode-switch,
.workspace-command-deck .workspace-chrome-progress,
.workspace-command-deck .workspace-chrome-route-compass,
.workspace-command-deck .workspace-chrome-workbench {
  margin-top: 0;
}

.workspace-chrome-mode-switch {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.workspace-chrome-mode-title,
.workspace-chrome-progress-title,
.workspace-chrome-route-title,
.workspace-chrome-workbench-title {
  color: var(--workspace-chrome-accent);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workspace-chrome-mode-text,
.workspace-chrome-progress-copy,
.workspace-chrome-route-copy,
.workspace-chrome-workbench-copy {
  color: var(--workspace-chrome-text-sub);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 4px;
}

.workspace-chrome-mode-buttons {
  display: inline-flex;
  gap: 10px;
  flex-wrap: wrap;
}

.workspace-chrome-mode-button {
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: var(--workspace-chrome-text-sub);
  padding: 10px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 13px;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
}

.workspace-chrome-mode-button.is-active {
  color: var(--workspace-chrome-text-main);
  border-color: rgba(217,179,109,0.4);
  background: rgba(217,179,109,0.14);
}

.workspace-chrome-mode-button:hover {
  transform: translateY(-1px);
}

.workspace-chrome-progress-track {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}

.workspace-chrome-progress-step {
  border-radius: 16px;
  padding: 11px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  min-height: 100%;
}

.workspace-chrome-progress-marker {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(255,255,255,0.12);
  color: var(--workspace-chrome-text-main);
  background: rgba(255,255,255,0.06);
}

.workspace-chrome-progress-step.is-done .workspace-chrome-progress-marker {
  background: rgba(124,197,163,0.16);
  border-color: rgba(124,197,163,0.28);
  color: #7cc5a3;
}

.workspace-chrome-progress-step.is-current .workspace-chrome-progress-marker {
  background: rgba(217,179,109,0.16);
  border-color: rgba(217,179,109,0.32);
  color: var(--workspace-chrome-accent);
}

.workspace-chrome-progress-step.is-next .workspace-chrome-progress-marker {
  background: rgba(136,185,255,0.16);
  border-color: rgba(136,185,255,0.28);
  color: #88b9ff;
}

.workspace-chrome-progress-step.is-locked .workspace-chrome-progress-marker {
  opacity: 0.5;
}

.workspace-chrome-progress-state,
.workspace-chrome-route-kicker {
  color: var(--workspace-chrome-text-sub);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.workspace-chrome-progress-label,
.workspace-chrome-route-label {
  color: var(--workspace-chrome-text-main);
  font-size: 14px;
  font-weight: 600;
}

.workspace-chrome-progress-summary,
.workspace-chrome-route-summary {
  color: var(--workspace-chrome-text-sub);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 6px;
  min-height: 34px;
}

.workspace-chrome-progress-link,
.workspace-chrome-route-link {
  margin-top: 8px;
}

.workspace-chrome-progress-link a,
.workspace-chrome-route-link a {
  color: var(--workspace-chrome-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 12px;
}

.workspace-chrome-progress-link span,
.workspace-chrome-route-link span {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
}

.workspace-chrome-route-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.workspace-chrome-workbench-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
}

.workspace-chrome-route-card {
  border-radius: 16px;
  padding: 11px 11px 12px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  min-height: 100%;
}

.workspace-chrome-route-current {
  background:
    linear-gradient(160deg, rgba(136,185,255,0.14), transparent 44%),
    rgba(255,255,255,0.055);
  border-color: rgba(136,185,255,0.14);
}

.workspace-chrome-route-previous {
  box-shadow: inset 0 0 0 1px rgba(226,192,112,0.08);
}

.workspace-chrome-route-next {
  box-shadow: inset 0 0 0 1px rgba(124,197,163,0.08);
}

.workspace-chrome-workbench-card {
  border-radius: 15px;
  padding: 9px 10px 10px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.028);
  display: grid;
  gap: 5px;
  min-height: 100%;
}

.workspace-chrome-workbench-review {
  box-shadow: inset 0 0 0 1px rgba(124,197,163,0.08);
}

.workspace-chrome-workbench-report {
  box-shadow: inset 0 0 0 1px rgba(226,192,112,0.08);
}

.workspace-chrome-workbench-prepare {
  box-shadow: inset 0 0 0 1px rgba(136,185,255,0.08);
}

.workspace-chrome-workbench-rerun {
  box-shadow: inset 0 0 0 1px rgba(255,140,122,0.08);
}

.workspace-chrome-workbench-status {
  box-shadow: inset 0 0 0 1px rgba(217,179,109,0.08);
}

.workspace-chrome-workbench-label {
  color: rgba(243,239,230,0.58);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workspace-chrome-workbench-value {
  color: var(--workspace-chrome-text-main);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.28;
}

.workspace-chrome-workbench-summary {
  color: rgba(243,239,230,0.62);
  font-size: 10px;
  line-height: 1.4;
  min-height: 0;
}

.workspace-chrome-workbench-link {
  margin-top: 2px;
}

.workspace-chrome-workbench-link a {
  color: rgba(217,179,109,0.92);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.26);
  padding-bottom: 1px;
  font-size: 11px;
}

.workspace-chrome-workbench-link span {
  color: rgba(243,239,230,0.48);
  font-size: 11px;
}

[data-workspace-user-mode="newcomer"] .workspace-audience-pro {
  display: none !important;
}

[data-workspace-user-mode="pro"] .workspace-audience-newcomer {
  display: none !important;
}

[data-workspace-user-mode="pro"] .workspace-hide-in-pro {
  display: none !important;
}

[data-workspace-user-mode="newcomer"] .workspace-hide-in-newcomer {
  display: none !important;
}

.workspace-chrome-action-card {
  border-radius: 18px;
  padding: 11px 11px 13px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  display: grid;
  gap: 7px;
}

.workspace-chrome-action-card.is-ready {
  border-color: rgba(255,255,255,0.12);
}

.workspace-chrome-action-card.is-pending {
  opacity: 0.72;
}

.workspace-chrome-action-prepare {
  box-shadow: inset 0 0 0 1px rgba(136,185,255,0.08);
}

.workspace-chrome-action-result {
  box-shadow: inset 0 0 0 1px rgba(124,197,163,0.08);
}

.workspace-chrome-action-rerun {
  box-shadow: inset 0 0 0 1px rgba(255,140,122,0.08);
}

.workspace-chrome-action-report {
  box-shadow: inset 0 0 0 1px rgba(226,192,112,0.08);
}

.workspace-chrome-action-label {
  color: var(--workspace-chrome-text-main);
  font-size: 14px;
  font-weight: 600;
}

.workspace-chrome-action-summary {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
  line-height: 1.5;
  min-height: 42px;
}

.workspace-chrome-action-link a {
  color: var(--workspace-chrome-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 12px;
}

.workspace-chrome-action-link span {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
}

.journey-card {
  border-radius: 18px;
  padding: 12px 12px 14px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  display: grid;
  gap: 7px;
}

.journey-card.is-current {
  border-color: rgba(217,179,109,0.36);
  box-shadow: inset 0 0 0 1px rgba(217,179,109,0.14);
}

.journey-card.is-ready .journey-stage {
  color: #7cc5a3;
}

.journey-card.is-pending .journey-stage {
  color: rgba(243,239,230,0.46);
}

.journey-stage {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--workspace-chrome-accent);
}

.journey-label {
  color: var(--workspace-chrome-text-main);
  font-size: 14px;
  font-weight: 600;
}

.journey-summary {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
  line-height: 1.55;
  min-height: 46px;
}

.journey-link a {
  color: var(--workspace-chrome-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 12px;
}

.journey-link span {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
}

.section {
  padding: 20px 20px 22px;
  margin-top: 16px;
  border: 1px solid var(--workspace-chrome-panel-border);
  background: var(--workspace-chrome-panel);
  backdrop-filter: blur(12px);
  border-radius: 24px;
  box-shadow: 0 18px 48px rgba(0,0,0,0.24);
}

.section h2 {
  margin: 0 0 8px;
  font-size: 19px;
}

.section-copy {
  margin: 0 0 12px;
  color: var(--workspace-chrome-text-sub);
  line-height: 1.55;
}

.metric-card,
.info-card {
  border-radius: 20px;
  padding: 18px 18px 20px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
}

.metric-label,
.info-card h3 {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
  margin-bottom: 10px;
}

.metric-value {
  font-size: 30px;
  font-weight: 700;
}

.info-card h3 {
  margin-top: 0;
  font-size: 18px;
  color: var(--workspace-chrome-accent);
}

.info-list {
  margin: 0;
  padding-left: 18px;
  color: var(--workspace-chrome-text-sub);
  line-height: 1.7;
}

.empty-state {
  color: var(--workspace-chrome-text-sub);
  line-height: 1.6;
}

.meta-list {
  display: grid;
  gap: 10px;
}

.meta-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.meta-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.meta-label {
  color: var(--workspace-chrome-text-sub);
  font-size: 12px;
}

.meta-value {
  font-size: 13px;
  line-height: 1.6;
}

.link-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.link-row a {
  color: var(--workspace-chrome-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 13px;
}

@media (max-width: 720px) {
  .workspace-chrome-context-bar {
    padding: 14px;
  }

  .workspace-chrome-context-main {
    grid-template-columns: 1fr;
  }

  .workspace-chrome-journey-grid {
    grid-template-columns: 1fr;
  }

  .workspace-chrome-actions-grid {
    grid-template-columns: 1fr;
  }

  .workspace-chrome-progress-track,
  .workspace-chrome-route-grid,
  .workspace-chrome-workbench-grid {
    grid-template-columns: 1fr;
  }

  .workspace-chrome-mode-switch {
    grid-template-columns: 1fr;
  }

  .meta-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
`;

const SHARED_JS = `document.addEventListener('DOMContentLoaded', () => {
  const currentPage = document.body?.dataset?.workspaceChromePage || '';
  const links = document.querySelectorAll('.top-links a, .hero-links a');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#')) continue;
    if (href === currentPage || href.endsWith('/' + currentPage)) {
      link.classList.add('is-active');
    }
  }

  const switchRoot = document.querySelector('.workspace-chrome-mode-switch');
  const defaultMode = switchRoot?.dataset?.defaultUserMode === 'pro' ? 'pro' : 'newcomer';
  const storageKey = 'daoge-workspace-chrome-user-mode';
  const rememberedMode = (() => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  })();
  const mode = rememberedMode === 'pro' || rememberedMode === 'newcomer' ? rememberedMode : defaultMode;
  document.body.dataset.workspaceUserMode = mode;
  const modeButtons = document.querySelectorAll('[data-workspace-mode-toggle]');
  for (const button of modeButtons) {
    const buttonMode = button.getAttribute('data-workspace-mode-toggle');
    if (buttonMode === mode) button.classList.add('is-active');
    button.addEventListener('click', () => {
      document.body.dataset.workspaceUserMode = buttonMode;
      for (const peer of modeButtons) {
        peer.classList.toggle('is-active', peer === button);
      }
      try {
        window.localStorage.setItem(storageKey, buttonMode);
      } catch {}
    });
  }

  const copyButtons = document.querySelectorAll('[data-copy-text]');
  for (const button of copyButtons) {
    button.addEventListener('click', async () => {
      const text = button.getAttribute('data-copy-text') || '';
      if (!text) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', 'readonly');
          textarea.style.position = 'absolute';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        const originalLabel = button.textContent;
        button.textContent = '已复制';
        button.classList.add('is-copied');
        window.setTimeout(() => {
          button.textContent = originalLabel;
          button.classList.remove('is-copied');
        }, 1400);
      } catch {}
    });
  }
});
`;

function ensureWorkspaceChromeAssets(outputDir) {
  const cssPath = path.join(outputDir, SHARED_CSS_FILE);
  const jsPath = path.join(outputDir, SHARED_JS_FILE);
  fs.writeFileSync(cssPath, `${SHARED_CSS}\n`);
  fs.writeFileSync(jsPath, `${SHARED_JS}\n`);
  return { cssPath, jsPath };
}

function renderWorkspaceChromeHeadAssets() {
  return `  <link rel="stylesheet" href="${SHARED_CSS_FILE}" />\n  <script defer src="${SHARED_JS_FILE}"></script>`;
}

module.exports = {
  ensureWorkspaceChromeAssets,
  renderWorkspaceChromeHeadAssets,
  SHARED_CSS_FILE,
  SHARED_JS_FILE,
};
