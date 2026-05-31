const fs = require('fs');
const path = require('path');

const SHARED_CSS_FILE = 'portal_shared.css';
const SHARED_JS_FILE = 'portal_shared.js';

const SHARED_CSS = `:root {
  --portal-bg: #0e1318;
  --portal-panel: rgba(255,255,255,0.06);
  --portal-panel-border: rgba(255,255,255,0.1);
  --portal-text-main: #f3efe6;
  --portal-text-sub: rgba(243,239,230,0.68);
  --portal-accent: #d9b36d;
}

body[data-portal-page] {
  background:
    radial-gradient(circle at top left, rgba(217,179,109,0.18), transparent 26%),
    linear-gradient(135deg, #0a0f13 0%, #101720 45%, #0e1318 100%);
  color: var(--portal-text-main);
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
  color: var(--portal-text-main);
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
  color: var(--portal-accent);
}

.portal-return-bar {
  margin: 0 0 16px;
}

.portal-context-bar {
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

.portal-context-main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 8px;
}

.portal-context-item {
  min-width: 0;
  padding: 2px 0;
}

.portal-context-label {
  color: var(--portal-text-sub);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.portal-context-value {
  color: var(--portal-text-main);
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
  word-break: break-word;
}

.portal-context-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.portal-context-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--portal-text-sub);
  font-size: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
}

.portal-context-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--portal-text-sub);
  font-size: 10px;
  line-height: 1.4;
}

.portal-journey {
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

.portal-journey-head {
  display: grid;
  gap: 6px;
}

.portal-journey-title {
  color: var(--portal-accent);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.portal-journey-copy {
  color: var(--portal-text-sub);
  font-size: 13px;
  line-height: 1.6;
}

.portal-journey-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.portal-actions {
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

.portal-actions-head {
  display: grid;
  gap: 6px;
}

.portal-actions-title {
  color: var(--portal-accent);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.portal-actions-copy {
  color: var(--portal-text-sub);
  font-size: 12px;
  line-height: 1.55;
}

.portal-actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 9px;
}

.portal-mode-switch,
.portal-progress,
.portal-route-compass,
.portal-workbench {
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

.portal-workbench {
  opacity: 0.84;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.018)),
    rgba(255,255,255,0.022);
}

.workspace-command-deck .portal-mode-switch,
.workspace-command-deck .portal-progress,
.workspace-command-deck .portal-route-compass,
.workspace-command-deck .portal-workbench {
  margin-top: 0;
}

.portal-mode-switch {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.portal-mode-title,
.portal-progress-title,
.portal-route-title,
.portal-workbench-title {
  color: var(--portal-accent);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.portal-mode-text,
.portal-progress-copy,
.portal-route-copy,
.portal-workbench-copy {
  color: var(--portal-text-sub);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 4px;
}

.portal-mode-buttons {
  display: inline-flex;
  gap: 10px;
  flex-wrap: wrap;
}

.portal-mode-button {
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: var(--portal-text-sub);
  padding: 10px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 13px;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
}

.portal-mode-button.is-active {
  color: var(--portal-text-main);
  border-color: rgba(217,179,109,0.4);
  background: rgba(217,179,109,0.14);
}

.portal-mode-button:hover {
  transform: translateY(-1px);
}

.portal-progress-track {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}

.portal-progress-step {
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

.portal-progress-marker {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(255,255,255,0.12);
  color: var(--portal-text-main);
  background: rgba(255,255,255,0.06);
}

.portal-progress-step.is-done .portal-progress-marker {
  background: rgba(124,197,163,0.16);
  border-color: rgba(124,197,163,0.28);
  color: #7cc5a3;
}

.portal-progress-step.is-current .portal-progress-marker {
  background: rgba(217,179,109,0.16);
  border-color: rgba(217,179,109,0.32);
  color: var(--portal-accent);
}

.portal-progress-step.is-next .portal-progress-marker {
  background: rgba(136,185,255,0.16);
  border-color: rgba(136,185,255,0.28);
  color: #88b9ff;
}

.portal-progress-step.is-locked .portal-progress-marker {
  opacity: 0.5;
}

.portal-progress-state,
.portal-route-kicker {
  color: var(--portal-text-sub);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.portal-progress-label,
.portal-route-label {
  color: var(--portal-text-main);
  font-size: 14px;
  font-weight: 600;
}

.portal-progress-summary,
.portal-route-summary {
  color: var(--portal-text-sub);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 6px;
  min-height: 34px;
}

.portal-progress-link,
.portal-route-link {
  margin-top: 8px;
}

.portal-progress-link a,
.portal-route-link a {
  color: var(--portal-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 12px;
}

.portal-progress-link span,
.portal-route-link span {
  color: var(--portal-text-sub);
  font-size: 12px;
}

.portal-route-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.portal-workbench-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
}

.portal-route-card {
  border-radius: 16px;
  padding: 11px 11px 12px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  min-height: 100%;
}

.portal-route-current {
  background:
    linear-gradient(160deg, rgba(136,185,255,0.14), transparent 44%),
    rgba(255,255,255,0.055);
  border-color: rgba(136,185,255,0.14);
}

.portal-route-previous {
  box-shadow: inset 0 0 0 1px rgba(226,192,112,0.08);
}

.portal-route-next {
  box-shadow: inset 0 0 0 1px rgba(124,197,163,0.08);
}

.portal-workbench-card {
  border-radius: 15px;
  padding: 9px 10px 10px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.028);
  display: grid;
  gap: 5px;
  min-height: 100%;
}

.portal-workbench-review {
  box-shadow: inset 0 0 0 1px rgba(124,197,163,0.08);
}

.portal-workbench-report {
  box-shadow: inset 0 0 0 1px rgba(226,192,112,0.08);
}

.portal-workbench-prepare {
  box-shadow: inset 0 0 0 1px rgba(136,185,255,0.08);
}

.portal-workbench-rerun {
  box-shadow: inset 0 0 0 1px rgba(255,140,122,0.08);
}

.portal-workbench-status {
  box-shadow: inset 0 0 0 1px rgba(217,179,109,0.08);
}

.portal-workbench-label {
  color: rgba(243,239,230,0.58);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.portal-workbench-value {
  color: var(--portal-text-main);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.28;
}

.portal-workbench-summary {
  color: rgba(243,239,230,0.62);
  font-size: 10px;
  line-height: 1.4;
  min-height: 0;
}

.portal-workbench-link {
  margin-top: 2px;
}

.portal-workbench-link a {
  color: rgba(217,179,109,0.92);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.26);
  padding-bottom: 1px;
  font-size: 11px;
}

.portal-workbench-link span {
  color: rgba(243,239,230,0.48);
  font-size: 11px;
}

[data-portal-user-mode="newcomer"] .portal-audience-pro {
  display: none !important;
}

[data-portal-user-mode="pro"] .portal-audience-newcomer {
  display: none !important;
}

[data-portal-user-mode="pro"] .portal-hide-in-pro {
  display: none !important;
}

[data-portal-user-mode="newcomer"] .portal-hide-in-newcomer {
  display: none !important;
}

.portal-action-card {
  border-radius: 18px;
  padding: 11px 11px 13px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  display: grid;
  gap: 7px;
}

.portal-action-card.is-ready {
  border-color: rgba(255,255,255,0.12);
}

.portal-action-card.is-pending {
  opacity: 0.72;
}

.portal-action-prepare {
  box-shadow: inset 0 0 0 1px rgba(136,185,255,0.08);
}

.portal-action-result {
  box-shadow: inset 0 0 0 1px rgba(124,197,163,0.08);
}

.portal-action-rerun {
  box-shadow: inset 0 0 0 1px rgba(255,140,122,0.08);
}

.portal-action-report {
  box-shadow: inset 0 0 0 1px rgba(226,192,112,0.08);
}

.portal-action-label {
  color: var(--portal-text-main);
  font-size: 14px;
  font-weight: 600;
}

.portal-action-summary {
  color: var(--portal-text-sub);
  font-size: 12px;
  line-height: 1.5;
  min-height: 42px;
}

.portal-action-link a {
  color: var(--portal-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 12px;
}

.portal-action-link span {
  color: var(--portal-text-sub);
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
  color: var(--portal-accent);
}

.journey-label {
  color: var(--portal-text-main);
  font-size: 14px;
  font-weight: 600;
}

.journey-summary {
  color: var(--portal-text-sub);
  font-size: 12px;
  line-height: 1.55;
  min-height: 46px;
}

.journey-link a {
  color: var(--portal-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 12px;
}

.journey-link span {
  color: var(--portal-text-sub);
  font-size: 12px;
}

.section {
  padding: 20px 20px 22px;
  margin-top: 16px;
  border: 1px solid var(--portal-panel-border);
  background: var(--portal-panel);
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
  color: var(--portal-text-sub);
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
  color: var(--portal-text-sub);
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
  color: var(--portal-accent);
}

.info-list {
  margin: 0;
  padding-left: 18px;
  color: var(--portal-text-sub);
  line-height: 1.7;
}

.empty-state {
  color: var(--portal-text-sub);
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
  color: var(--portal-text-sub);
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
  color: var(--portal-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(217,179,109,0.35);
  padding-bottom: 1px;
  font-size: 13px;
}

@media (max-width: 720px) {
  .portal-context-bar {
    padding: 14px;
  }

  .portal-context-main {
    grid-template-columns: 1fr;
  }

  .portal-journey-grid {
    grid-template-columns: 1fr;
  }

  .portal-actions-grid {
    grid-template-columns: 1fr;
  }

  .portal-progress-track,
  .portal-route-grid,
  .portal-workbench-grid {
    grid-template-columns: 1fr;
  }

  .portal-mode-switch {
    grid-template-columns: 1fr;
  }

  .meta-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
`;

const SHARED_JS = `document.addEventListener('DOMContentLoaded', () => {
  const currentPage = document.body?.dataset?.portalPage || '';
  const links = document.querySelectorAll('.top-links a, .hero-links a');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#')) continue;
    if (href === currentPage || href.endsWith('/' + currentPage)) {
      link.classList.add('is-active');
    }
  }

  const switchRoot = document.querySelector('.portal-mode-switch');
  const defaultMode = switchRoot?.dataset?.defaultUserMode === 'pro' ? 'pro' : 'newcomer';
  const storageKey = 'daoge-portal-user-mode';
  const rememberedMode = (() => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  })();
  const mode = rememberedMode === 'pro' || rememberedMode === 'newcomer' ? rememberedMode : defaultMode;
  document.body.dataset.portalUserMode = mode;
  const modeButtons = document.querySelectorAll('[data-portal-mode-toggle]');
  for (const button of modeButtons) {
    const buttonMode = button.getAttribute('data-portal-mode-toggle');
    if (buttonMode === mode) button.classList.add('is-active');
    button.addEventListener('click', () => {
      document.body.dataset.portalUserMode = buttonMode;
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

function ensurePortalUiAssets(outputDir) {
  const cssPath = path.join(outputDir, SHARED_CSS_FILE);
  const jsPath = path.join(outputDir, SHARED_JS_FILE);
  fs.writeFileSync(cssPath, `${SHARED_CSS}\n`);
  fs.writeFileSync(jsPath, `${SHARED_JS}\n`);
  return { cssPath, jsPath };
}

function renderPortalHeadAssets() {
  return `  <link rel="stylesheet" href="${SHARED_CSS_FILE}" />\n  <script defer src="${SHARED_JS_FILE}"></script>`;
}

module.exports = {
  ensurePortalUiAssets,
  renderPortalHeadAssets,
  SHARED_CSS_FILE,
  SHARED_JS_FILE,
};
