const path = require('path');
const { fileExists, readJsonIfExists } = require('./script_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const { buildPageEntries } = require('./workspace_page_registry');
const {
  getTopLinkPlan,
  getProgressVisibleIds,
  getNavigationGovernance,
  classifyWorkbenchPage,
} = require('./workbench_governance');

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeFile(outputDir, targetPath) {
  if (!targetPath) return null;
  return path.relative(outputDir, targetPath);
}

function makeLink(label, href) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function makeLinkKey(label, href) {
  return `${String(href || '').trim()}::${String(label || '').trim()}`;
}

function workspaceChromeMapEntries(outputDir) {
  return buildPageEntries(outputDir).map((entry) => ({
    ...entry,
    href: fileExists(entry.file) ? relativeFile(outputDir, entry.file) : null,
    available: fileExists(entry.file),
  }));
}

function primaryWorkspaceChromeEntries(outputDir) {
  return workspaceChromeMapEntries(outputDir).filter((entry) => ['entry', 'mainline'].includes(entry.group));
}

function isCurrentWorkspaceChromeEntry(entry, currentPage) {
  return Boolean(currentPage) && (entry.href === currentPage || entry.file.endsWith(currentPage));
}

function resolveWorkspaceChromeActionHref(outputDir, action) {
  if (!action) return null;
  if (action.href) return String(action.href);
  if (action.file) {
    const absolutePath = path.isAbsolute(action.file) ? action.file : path.join(outputDir, action.file);
    if (fileExists(absolutePath)) return relativeFile(outputDir, absolutePath);
  }
  return null;
}

function loadWorkspaceState(outputDir) {
  return loadWorkbenchState(outputDir).workspaceState || null;
}

function resolveGovernanceForPage(outputDir, currentPage, governance) {
  if (governance) return governance;
  const workspaceState = loadWorkspaceState(outputDir);
  if (!workspaceState) return null;
  const pageKey = String(currentPage || '').trim();
  if (pageKey && workspaceState?.governanceByPage?.[pageKey]) {
    return workspaceState.governanceByPage[pageKey];
  }
  return workspaceState?.governance || null;
}

function renderWorkspaceChromeModeSwitch(options = {}) {
  const title = String(options.title || '浏览视图').trim();
  const copy = String(options.copy || '默认用简洁查看，想一次看到更多补充层时再切到进阶查看。').trim();
  const defaultMode = String(options.defaultMode || 'newcomer').trim() === 'pro' ? 'pro' : 'newcomer';
  const newcomerLabel = String(options.newcomerLabel || '简洁查看').trim();
  const proLabel = String(options.proLabel || '进阶查看').trim();
  return `
    <section class="workspace-chrome-mode-switch" data-default-user-mode="${escapeHtml(defaultMode)}">
      <div class="workspace-chrome-mode-copy">
        <div class="workspace-chrome-mode-title">${escapeHtml(title)}</div>
        <div class="workspace-chrome-mode-text">${escapeHtml(copy)}</div>
      </div>
      <div class="workspace-chrome-mode-buttons" role="tablist" aria-label="${escapeHtml(title)}">
        <button type="button" class="workspace-chrome-mode-button" data-workspace-mode-toggle="newcomer">${escapeHtml(newcomerLabel)}</button>
        <button type="button" class="workspace-chrome-mode-button" data-workspace-mode-toggle="pro">${escapeHtml(proLabel)}</button>
      </div>
    </section>
  `;
}

function renderWorkspaceChromeProgressRail(outputDir, options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const title = String(options.title || '主流程进度').trim();
  const copy = String(options.copy || '这里只保留你当前所在位置和接下来最相关的几站。').trim();
  const allEntries = workspaceChromeMapEntries(outputDir);
  const resolvedGovernance = resolveGovernanceForPage(outputDir, currentPage, options.governance);
  const governedProgress = Array.isArray(resolvedGovernance?.progressTrack) ? resolvedGovernance.progressTrack : [];
  const navigation = resolvedGovernance?.navigation && typeof resolvedGovernance.navigation === 'object'
    ? resolvedGovernance.navigation
    : getNavigationGovernance(currentPage, {});
  const visibleIds = Array.isArray(options.visibleIds) && options.visibleIds.length
    ? new Set(options.visibleIds.map((item) => String(item)))
    : governedProgress.length
      ? new Set(governedProgress.map((item) => String(item.id || item)))
      : new Set((navigation.progressTrackIds || getProgressVisibleIds()).map((item) => String(item)));
  const currentEntry = allEntries.find((entry) => isCurrentWorkspaceChromeEntry(entry, currentPage)) || null;
  const windowRadius = Number.isFinite(Number(options.windowRadius))
    ? Math.max(0, Number(options.windowRadius))
    : 1;
  const entries = (visibleIds
    ? allEntries.filter((entry) => visibleIds.has(entry.id))
    : primaryWorkspaceChromeEntries(outputDir))
    .concat(currentEntry && !visibleIds && !['entry', 'mainline'].includes(currentEntry.group) ? [currentEntry] : [])
    .filter((entry, index, list) => list.findIndex((item) => item.id === entry.id) === index);
  if (!entries.length) return '';

  const currentIndex = entries.findIndex((entry) => isCurrentWorkspaceChromeEntry(entry, currentPage));
  const fallbackIndex = currentIndex >= 0 ? currentIndex : entries.findIndex((entry) => entry.available);
  const activeIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
  const compactEntries = entries.filter((entry, index) => Math.abs(index - activeIndex) <= windowRadius || isCurrentWorkspaceChromeEntry(entry, currentPage));

  return `
    <section class="workspace-chrome-progress">
      <div class="workspace-chrome-progress-head">
        <div class="workspace-chrome-progress-title">${escapeHtml(title)}</div>
        <div class="workspace-chrome-progress-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="workspace-chrome-progress-track">
        ${compactEntries.map((entry, localIndex) => {
          const index = entries.findIndex((item) => item.id === entry.id);
          let stateClass = 'is-locked';
          let stateLabel = '未生成';
          if (index === activeIndex && isCurrentWorkspaceChromeEntry(entry, currentPage)) {
            stateClass = 'is-current';
            stateLabel = '当前';
          } else if (index < activeIndex && entry.available) {
            stateClass = 'is-done';
            stateLabel = '已过';
          } else if (index === activeIndex + 1 && entry.available) {
            stateClass = 'is-next';
            stateLabel = '下一站';
          } else if (entry.available) {
            stateClass = 'is-ready';
            stateLabel = '可直达';
          }
          return `
            <article class="workspace-chrome-progress-step ${stateClass}">
              <div class="workspace-chrome-progress-marker">${localIndex + 1}</div>
              <div class="workspace-chrome-progress-body">
                <div class="workspace-chrome-progress-state">${escapeHtml(stateLabel)}</div>
                <div class="workspace-chrome-progress-label">${escapeHtml(entry.label)}</div>
                <div class="workspace-chrome-progress-summary">${escapeHtml(entry.summary)}</div>
                <div class="workspace-chrome-progress-link">
                  ${stateClass === 'is-current'
                    ? '<span>当前所在页</span>'
                    : (entry.href ? `<a href="${escapeHtml(entry.href)}">打开这一站</a>` : '<span>本轮尚未生成</span>')}
                </div>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderWorkspaceChromeRouteCompass(outputDir, options = {}) {
  const title = String(options.title || '上一站 / 下一站').trim();
  const copy = String(options.copy || '这里只保留一个主跳转，避免你在这里再次分岔。').trim();
  const current = options.current || null;
  const previous = options.previous || null;
  const maxNextSteps = Number.isFinite(Number(options.maxNextSteps))
    ? Math.max(0, Number(options.maxNextSteps))
    : 1;
  const nextSteps = Array.isArray(options.nextSteps) ? options.nextSteps.filter(Boolean).slice(0, maxNextSteps) : [];
  if (!current && !previous && !nextSteps.length) return '';

  const currentHref = resolveWorkspaceChromeActionHref(outputDir, current);
  const previousHref = resolveWorkspaceChromeActionHref(outputDir, previous);
  return `
    <section class="workspace-chrome-route-compass">
      <div class="workspace-chrome-route-head">
        <div class="workspace-chrome-route-title">${escapeHtml(title)}</div>
        <div class="workspace-chrome-route-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="workspace-chrome-route-grid">
        ${current ? `
          <article class="workspace-chrome-route-card workspace-chrome-route-current workspace-audience-all">
            <div class="workspace-chrome-route-kicker">${escapeHtml(current.kicker || '当前判断')}</div>
            <div class="workspace-chrome-route-label">${escapeHtml(current.label || '')}</div>
            <div class="workspace-chrome-route-summary">${escapeHtml(current.summary || '')}</div>
            <div class="workspace-chrome-route-link">
              ${currentHref ? `<a href="${escapeHtml(currentHref)}">${escapeHtml(current.cta || '查看当前判断')}</a>` : `<span>${escapeHtml(current.pendingLabel || '当前就是这一步的统一判断')}</span>`}
            </div>
          </article>
        ` : ''}
        ${previous ? `
          <article class="workspace-chrome-route-card workspace-chrome-route-previous workspace-audience-all">
            <div class="workspace-chrome-route-kicker">上一站</div>
            <div class="workspace-chrome-route-label">${escapeHtml(previous.label || '返回上一步')}</div>
            <div class="workspace-chrome-route-summary">${escapeHtml(previous.summary || '')}</div>
            <div class="workspace-chrome-route-link">
              ${previousHref ? `<a href="${escapeHtml(previousHref)}">${escapeHtml(previous.cta || '回到这里')}</a>` : `<span>${escapeHtml(previous.pendingLabel || '上一站本轮不可用')}</span>`}
            </div>
          </article>
        ` : ''}
        ${nextSteps.map((step) => {
          const href = resolveWorkspaceChromeActionHref(outputDir, step);
          const audience = String(step.audience || 'all').trim();
          return `
            <article class="workspace-chrome-route-card workspace-chrome-route-next workspace-audience-${escapeHtml(audience)}">
              <div class="workspace-chrome-route-kicker">${escapeHtml(step.kicker || '下一站')}</div>
              <div class="workspace-chrome-route-label">${escapeHtml(step.label || '')}</div>
              <div class="workspace-chrome-route-summary">${escapeHtml(step.summary || '')}</div>
              <div class="workspace-chrome-route-link">
                ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(step.cta || '直接前往')}</a>` : `<span>${escapeHtml(step.pendingLabel || '本轮尚未生成')}</span>`}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderWorkspaceChromeJourney(outputDir, options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const title = String(options.title || '门户地图').trim();
  const copy = String(options.copy || '这块用于告诉用户当前在整条 DAOGE 路径中的位置，并提供跨阶段跳转。').trim();
  const entries = workspaceChromeMapEntries(outputDir);

  return `
    <section class="workspace-chrome-journey">
      <div class="workspace-chrome-journey-head">
        <div class="workspace-chrome-journey-title">${escapeHtml(title)}</div>
        <div class="workspace-chrome-journey-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="workspace-chrome-journey-grid">
        ${entries.map((entry) => {
          const isCurrent = isCurrentWorkspaceChromeEntry(entry, currentPage);
          const stateClass = isCurrent ? 'is-current' : (entry.available ? 'is-ready' : 'is-pending');
          const stageLabel = entry.stage === 'starter'
            ? '新手入口'
            : entry.stage === 'hub'
              ? '总入口'
              : entry.stage === 'prepare'
                ? '准备阶段'
                : entry.stage === 'run'
                  ? '执行阶段'
                  : entry.stage === 'result'
                    ? '结果阶段'
                    : '补跑阶段';
          return `
            <article class="journey-card ${stateClass}">
              <div class="journey-stage">${escapeHtml(stageLabel)}</div>
              <div class="journey-label">${escapeHtml(entry.label)}</div>
              <div class="journey-summary">${escapeHtml(entry.summary)}</div>
              <div class="journey-link">
                ${isCurrent ? '<span>当前所在页</span>' : (entry.href ? `<a href="${escapeHtml(entry.href)}">跳到这里</a>` : '<span>本轮尚未生成</span>')}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderWorkspaceChromeActionDeck(outputDir, options = {}) {
  const title = String(options.title || '如果你现在想做一件事').trim();
  const copy = String(options.copy || '按你的当前目标直接跳，不用先自己判断该开哪一页。').trim();
  const actions = Array.isArray(options.actions) ? options.actions.filter(Boolean) : [];
  if (!actions.length) return '';

  const cards = actions.map((action) => {
    const label = String(action.label || '').trim();
    if (!label) return '';
    let href = null;
    if (action.href) {
      href = String(action.href);
    } else if (action.file) {
      const absolutePath = path.isAbsolute(action.file) ? action.file : path.join(outputDir, action.file);
      if (fileExists(absolutePath)) href = relativeFile(outputDir, absolutePath);
    }
    const stateClass = href ? 'is-ready' : 'is-pending';
    const toneClass = String(action.tone || 'neutral').trim();
    const cta = href ? String(action.cta || '直接打开').trim() : String(action.pendingLabel || '本轮尚未生成').trim();
    return `
      <article class="workspace-chrome-action-card ${escapeHtml(stateClass)} workspace-chrome-action-${escapeHtml(toneClass)}">
        <div class="workspace-chrome-action-label">${escapeHtml(label)}</div>
        <div class="workspace-chrome-action-summary">${escapeHtml(action.summary || '')}</div>
        <div class="workspace-chrome-action-link">
          ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(cta)}</a>` : `<span>${escapeHtml(cta)}</span>`}
        </div>
      </article>
    `;
  }).filter(Boolean).join('');

  if (!cards) return '';

  return `
    <section class="workspace-chrome-actions">
      <div class="workspace-chrome-actions-head">
        <div class="workspace-chrome-actions-title">${escapeHtml(title)}</div>
        <div class="workspace-chrome-actions-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="workspace-chrome-actions-grid">
        ${cards}
      </div>
    </section>
  `;
}

function renderWorkspaceChromeWorkbench(outputDir, options = {}) {
  const title = String(options.title || '补充入口').trim();
  const copy = String(options.copy || '这里只保留按需入口，不再承担主动作分发。').trim();
  const cards = Array.isArray(options.cards) ? options.cards.filter(Boolean).slice(0, Number(options.maxCards || 2)) : [];
  if (!cards.length) return '';

  const renderedCards = cards.map((card) => {
    const label = String(card.label || '').trim();
    if (!label) return '';
    const value = String(card.value ?? '').trim();
    const summary = String(card.summary || '').trim();
    const tone = String(card.tone || 'neutral').trim();
    const audience = String(card.audience || 'all').trim();
    const href = resolveWorkspaceChromeActionHref(outputDir, card);
    const cta = href ? String(card.cta || '直接打开').trim() : String(card.pendingLabel || '本轮尚未生成').trim();
    const hideLinkIfMissing = Boolean(card.hideLinkIfMissing);
    return `
      <article class="workspace-chrome-workbench-card workspace-chrome-workbench-${escapeHtml(tone)} workspace-audience-${escapeHtml(audience)}">
        <div class="workspace-chrome-workbench-label">${escapeHtml(label)}</div>
        ${value ? `<div class="workspace-chrome-workbench-value">${escapeHtml(value)}</div>` : ''}
        ${summary ? `<div class="workspace-chrome-workbench-summary">${escapeHtml(summary)}</div>` : ''}
        ${hideLinkIfMissing && !href ? '' : `
        <div class="workspace-chrome-workbench-link">
          ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(cta)}</a>` : `<span>${escapeHtml(cta)}</span>`}
        </div>`}
      </article>
    `;
  }).filter(Boolean).join('');

  if (!renderedCards) return '';

  const visibleAudienceSet = new Set(
    cards.map((card) => String(card.audience || 'all').trim() || 'all')
  );
  const hideInNewcomer = !visibleAudienceSet.has('all') && !visibleAudienceSet.has('newcomer');

  return `
    <section class="workspace-chrome-workbench${hideInNewcomer ? ' workspace-hide-in-newcomer' : ''}">
      <div class="workspace-chrome-workbench-head">
        <div class="workspace-chrome-workbench-title">${escapeHtml(title)}</div>
        <div class="workspace-chrome-workbench-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="workspace-chrome-workbench-grid">
        ${renderedCards}
      </div>
    </section>
  `;
}

function renderWorkspaceChromeTopLinks(outputDir, options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const extraLinks = Array.isArray(options.extraLinks) ? options.extraLinks : [];
  const maxLinks = Number.isFinite(Number(options.maxLinks))
    ? Math.max(1, Number(options.maxLinks))
    : 3;
  const preferExtraLinks = Boolean(options.preferExtraLinks);
  const entries = workspaceChromeMapEntries(outputDir);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const resolvedGovernance = resolveGovernanceForPage(outputDir, currentPage, options.governance);
  const governanceTopLinks = Array.isArray(resolvedGovernance?.topLinks) ? resolvedGovernance.topLinks : [];
  const currentEntry = classifyWorkbenchPage(outputDir, currentPage)
    || entries.find((entry) => isCurrentWorkspaceChromeEntry(entry, currentPage))
    || null;
  const navigation = resolvedGovernance?.navigation && typeof resolvedGovernance.navigation === 'object'
    ? resolvedGovernance.navigation
    : getNavigationGovernance(currentPage, {
      currentEntryLevel: currentEntry?.level || currentEntry?.group || '',
    });
  const preferredIds = governanceTopLinks.length
    ? governanceTopLinks.map((entry) => entry.id)
    : (Array.isArray(navigation.topLinkIds) && navigation.topLinkIds.length
      ? navigation.topLinkIds
      : getTopLinkPlan(currentPage, {
        currentEntryLevel: currentEntry?.level || currentEntry?.group || '',
      }));
  const links = [];
  const seen = new Set();

  const appendGovernanceLink = (id) => {
    const entry = entryMap.get(id);
    if (!entry || !entry.href || !entry.available) return;
    if (!['entry', 'mainline', 'support'].includes(entry.group)) return;
    if (entry.href === currentPage || entry.file.endsWith(currentPage)) return;
    const key = makeLinkKey(entry.label, entry.href);
    if (seen.has(key)) return;
    seen.add(key);
    links.push(makeLink(entry.label, entry.href));
  };

  const appendExtraLink = (entry) => {
    if (!entry || !entry.label) return;
    let href = null;
    if (entry.href) {
      href = entry.href;
    } else if (entry.file) {
      const absolutePath = path.isAbsolute(entry.file) ? entry.file : path.join(outputDir, entry.file);
      if (!fileExists(absolutePath)) return;
      href = relativeFile(outputDir, absolutePath);
    }
    if (!href) return;
    const key = makeLinkKey(entry.label, href);
    if (seen.has(key)) return;
    seen.add(key);
    links.push(makeLink(entry.label, href));
  };

  if (preferExtraLinks) {
    extraLinks.forEach(appendExtraLink);
    preferredIds.forEach(appendGovernanceLink);
  } else {
    preferredIds.forEach(appendGovernanceLink);
    extraLinks.forEach(appendExtraLink);
  }

  return links.slice(0, maxLinks).join('\n        ');
}

function getGovernedProgressVisibleIds() {
  return getProgressVisibleIds();
}

function renderWorkspaceChromeContextBar(options = {}) {
  const runLabel = String(options.runLabel || '').trim();
  const boardLabel = String(options.boardLabel || '').trim();
  const phaseLabel = String(options.phaseLabel || '').trim();
  const flowLabel = String(options.flowLabel || '').trim();
  const counts = Array.isArray(options.counts) ? options.counts.filter(Boolean) : [];
  const hints = Array.isArray(options.hints) ? options.hints.filter(Boolean) : [];
  const contextItems = Array.isArray(options.items) && options.items.length
    ? options.items.filter(Boolean)
    : [
      runLabel ? { label: '当前任务', value: runLabel, audience: 'all' } : null,
      boardLabel ? { label: '当前 Board', value: boardLabel, audience: 'pro' } : null,
      phaseLabel ? { label: '当前阶段', value: phaseLabel, audience: 'all' } : null,
      flowLabel ? { label: '流程位置', value: flowLabel, audience: 'pro' } : null,
    ].filter(Boolean);

  if (!contextItems.length && !counts.length && !hints.length) return '';

  const countAudienceSet = new Set(counts.map((item) => String(item.audience || 'all').trim() || 'all'));
  const hintAudienceSet = new Set(hints.map((item) => typeof item === 'string' ? 'all' : (String(item.audience || 'all').trim() || 'all')));
  const hideCountsInNewcomer = counts.length && !countAudienceSet.has('all') && !countAudienceSet.has('newcomer');
  const hideHintsInNewcomer = hints.length && !hintAudienceSet.has('all') && !hintAudienceSet.has('newcomer');

  return `
    <section class="workspace-chrome-context-bar">
      <div class="workspace-chrome-context-main">
        ${contextItems.map((item) => `
          <div class="workspace-chrome-context-item workspace-audience-${escapeHtml(String(item.audience || 'all').trim() || 'all')}">
            <div class="workspace-chrome-context-label">${escapeHtml(item.label)}</div>
            <div class="workspace-chrome-context-value">${escapeHtml(item.value)}</div>
          </div>
        `).join('')}
      </div>
      ${counts.length ? `
        <div class="workspace-chrome-context-counts${hideCountsInNewcomer ? ' workspace-hide-in-newcomer' : ''}">
          ${counts.map((item) => `
            <span class="workspace-chrome-context-pill workspace-audience-${escapeHtml(String(item.audience || 'all').trim() || 'all')}">${escapeHtml(item.label)} ${escapeHtml(item.value ?? '')}</span>
          `).join('')}
        </div>
      ` : ''}
      ${hints.length ? `
        <div class="workspace-chrome-context-hints${hideHintsInNewcomer ? ' workspace-hide-in-newcomer' : ''}">
          ${hints.map((item) => {
            const text = typeof item === 'string' ? item : item?.text;
            const audience = typeof item === 'string' ? 'all' : (String(item.audience || 'all').trim() || 'all');
            return `<span class="workspace-audience-${escapeHtml(audience)}">${escapeHtml(text)}</span>`;
          }).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

module.exports = {
  escapeHtml,
  relativeFile,
  makeLink,
  workspaceChromeMapEntries,
  resolveGovernanceForPage,
  renderWorkspaceChromeActionDeck,
  renderWorkspaceChromeWorkbench,
  renderWorkspaceChromeModeSwitch,
  renderWorkspaceChromeProgressRail,
  renderWorkspaceChromeRouteCompass,
  renderWorkspaceChromeTopLinks,
  renderWorkspaceChromeContextBar,
  renderWorkspaceChromeJourney,
  getGovernedProgressVisibleIds,
};
