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

function portalMapEntries(outputDir) {
  return buildPageEntries(outputDir).map((entry) => ({
    ...entry,
    href: fileExists(entry.file) ? relativeFile(outputDir, entry.file) : null,
    available: fileExists(entry.file),
  }));
}

function primaryPortalEntries(outputDir) {
  return portalMapEntries(outputDir).filter((entry) => ['entry', 'mainline'].includes(entry.group));
}

function isCurrentPortalEntry(entry, currentPage) {
  return Boolean(currentPage) && (entry.href === currentPage || entry.file.endsWith(currentPage));
}

function resolvePortalActionHref(outputDir, action) {
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

function renderPortalModeSwitch(options = {}) {
  const title = String(options.title || '浏览视图').trim();
  const copy = String(options.copy || '默认用简洁查看，想一次看到更多补充层时再切到进阶查看。').trim();
  const defaultMode = String(options.defaultMode || 'newcomer').trim() === 'pro' ? 'pro' : 'newcomer';
  const newcomerLabel = String(options.newcomerLabel || '简洁查看').trim();
  const proLabel = String(options.proLabel || '进阶查看').trim();
  return `
    <section class="portal-mode-switch" data-default-user-mode="${escapeHtml(defaultMode)}">
      <div class="portal-mode-copy">
        <div class="portal-mode-title">${escapeHtml(title)}</div>
        <div class="portal-mode-text">${escapeHtml(copy)}</div>
      </div>
      <div class="portal-mode-buttons" role="tablist" aria-label="${escapeHtml(title)}">
        <button type="button" class="portal-mode-button" data-portal-mode-toggle="newcomer">${escapeHtml(newcomerLabel)}</button>
        <button type="button" class="portal-mode-button" data-portal-mode-toggle="pro">${escapeHtml(proLabel)}</button>
      </div>
    </section>
  `;
}

function renderPortalProgressRail(outputDir, options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const title = String(options.title || '主流程进度').trim();
  const copy = String(options.copy || '这里只保留你当前所在位置和接下来最相关的几站。').trim();
  const allEntries = portalMapEntries(outputDir);
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
  const currentEntry = allEntries.find((entry) => isCurrentPortalEntry(entry, currentPage)) || null;
  const windowRadius = Number.isFinite(Number(options.windowRadius))
    ? Math.max(0, Number(options.windowRadius))
    : 1;
  const entries = (visibleIds
    ? allEntries.filter((entry) => visibleIds.has(entry.id))
    : primaryPortalEntries(outputDir))
    .concat(currentEntry && !visibleIds && !['entry', 'mainline'].includes(currentEntry.group) ? [currentEntry] : [])
    .filter((entry, index, list) => list.findIndex((item) => item.id === entry.id) === index);
  if (!entries.length) return '';

  const currentIndex = entries.findIndex((entry) => isCurrentPortalEntry(entry, currentPage));
  const fallbackIndex = currentIndex >= 0 ? currentIndex : entries.findIndex((entry) => entry.available);
  const activeIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
  const compactEntries = entries.filter((entry, index) => Math.abs(index - activeIndex) <= windowRadius || isCurrentPortalEntry(entry, currentPage));

  return `
    <section class="portal-progress">
      <div class="portal-progress-head">
        <div class="portal-progress-title">${escapeHtml(title)}</div>
        <div class="portal-progress-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="portal-progress-track">
        ${compactEntries.map((entry, localIndex) => {
          const index = entries.findIndex((item) => item.id === entry.id);
          let stateClass = 'is-locked';
          let stateLabel = '未生成';
          if (index === activeIndex && isCurrentPortalEntry(entry, currentPage)) {
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
            <article class="portal-progress-step ${stateClass}">
              <div class="portal-progress-marker">${localIndex + 1}</div>
              <div class="portal-progress-body">
                <div class="portal-progress-state">${escapeHtml(stateLabel)}</div>
                <div class="portal-progress-label">${escapeHtml(entry.label)}</div>
                <div class="portal-progress-summary">${escapeHtml(entry.summary)}</div>
                <div class="portal-progress-link">
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

function renderPortalRouteCompass(outputDir, options = {}) {
  const title = String(options.title || '上一站 / 下一站').trim();
  const copy = String(options.copy || '这里只保留一个主跳转，避免你在这里再次分岔。').trim();
  const current = options.current || null;
  const previous = options.previous || null;
  const maxNextSteps = Number.isFinite(Number(options.maxNextSteps))
    ? Math.max(0, Number(options.maxNextSteps))
    : 1;
  const nextSteps = Array.isArray(options.nextSteps) ? options.nextSteps.filter(Boolean).slice(0, maxNextSteps) : [];
  if (!current && !previous && !nextSteps.length) return '';

  const currentHref = resolvePortalActionHref(outputDir, current);
  const previousHref = resolvePortalActionHref(outputDir, previous);
  return `
    <section class="portal-route-compass">
      <div class="portal-route-head">
        <div class="portal-route-title">${escapeHtml(title)}</div>
        <div class="portal-route-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="portal-route-grid">
        ${current ? `
          <article class="portal-route-card portal-route-current portal-audience-all">
            <div class="portal-route-kicker">${escapeHtml(current.kicker || '当前判断')}</div>
            <div class="portal-route-label">${escapeHtml(current.label || '')}</div>
            <div class="portal-route-summary">${escapeHtml(current.summary || '')}</div>
            <div class="portal-route-link">
              ${currentHref ? `<a href="${escapeHtml(currentHref)}">${escapeHtml(current.cta || '查看当前判断')}</a>` : `<span>${escapeHtml(current.pendingLabel || '当前就是这一步的统一判断')}</span>`}
            </div>
          </article>
        ` : ''}
        ${previous ? `
          <article class="portal-route-card portal-route-previous portal-audience-all">
            <div class="portal-route-kicker">上一站</div>
            <div class="portal-route-label">${escapeHtml(previous.label || '返回上一步')}</div>
            <div class="portal-route-summary">${escapeHtml(previous.summary || '')}</div>
            <div class="portal-route-link">
              ${previousHref ? `<a href="${escapeHtml(previousHref)}">${escapeHtml(previous.cta || '回到这里')}</a>` : `<span>${escapeHtml(previous.pendingLabel || '上一站本轮不可用')}</span>`}
            </div>
          </article>
        ` : ''}
        ${nextSteps.map((step) => {
          const href = resolvePortalActionHref(outputDir, step);
          const audience = String(step.audience || 'all').trim();
          return `
            <article class="portal-route-card portal-route-next portal-audience-${escapeHtml(audience)}">
              <div class="portal-route-kicker">${escapeHtml(step.kicker || '下一站')}</div>
              <div class="portal-route-label">${escapeHtml(step.label || '')}</div>
              <div class="portal-route-summary">${escapeHtml(step.summary || '')}</div>
              <div class="portal-route-link">
                ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(step.cta || '直接前往')}</a>` : `<span>${escapeHtml(step.pendingLabel || '本轮尚未生成')}</span>`}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderPortalJourney(outputDir, options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const title = String(options.title || '门户地图').trim();
  const copy = String(options.copy || '这块用于告诉用户当前在整条 DAOGE 路径中的位置，并提供跨阶段跳转。').trim();
  const entries = portalMapEntries(outputDir);

  return `
    <section class="portal-journey">
      <div class="portal-journey-head">
        <div class="portal-journey-title">${escapeHtml(title)}</div>
        <div class="portal-journey-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="portal-journey-grid">
        ${entries.map((entry) => {
          const isCurrent = isCurrentPortalEntry(entry, currentPage);
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

function renderPortalActionDeck(outputDir, options = {}) {
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
      <article class="portal-action-card ${escapeHtml(stateClass)} portal-action-${escapeHtml(toneClass)}">
        <div class="portal-action-label">${escapeHtml(label)}</div>
        <div class="portal-action-summary">${escapeHtml(action.summary || '')}</div>
        <div class="portal-action-link">
          ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(cta)}</a>` : `<span>${escapeHtml(cta)}</span>`}
        </div>
      </article>
    `;
  }).filter(Boolean).join('');

  if (!cards) return '';

  return `
    <section class="portal-actions">
      <div class="portal-actions-head">
        <div class="portal-actions-title">${escapeHtml(title)}</div>
        <div class="portal-actions-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="portal-actions-grid">
        ${cards}
      </div>
    </section>
  `;
}

function renderPortalWorkbench(outputDir, options = {}) {
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
    const href = resolvePortalActionHref(outputDir, card);
    const cta = href ? String(card.cta || '直接打开').trim() : String(card.pendingLabel || '本轮尚未生成').trim();
    const hideLinkIfMissing = Boolean(card.hideLinkIfMissing);
    return `
      <article class="portal-workbench-card portal-workbench-${escapeHtml(tone)} portal-audience-${escapeHtml(audience)}">
        <div class="portal-workbench-label">${escapeHtml(label)}</div>
        ${value ? `<div class="portal-workbench-value">${escapeHtml(value)}</div>` : ''}
        ${summary ? `<div class="portal-workbench-summary">${escapeHtml(summary)}</div>` : ''}
        ${hideLinkIfMissing && !href ? '' : `
        <div class="portal-workbench-link">
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
    <section class="portal-workbench${hideInNewcomer ? ' portal-hide-in-newcomer' : ''}">
      <div class="portal-workbench-head">
        <div class="portal-workbench-title">${escapeHtml(title)}</div>
        <div class="portal-workbench-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="portal-workbench-grid">
        ${renderedCards}
      </div>
    </section>
  `;
}

function renderPortalTopLinks(outputDir, options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const extraLinks = Array.isArray(options.extraLinks) ? options.extraLinks : [];
  const maxLinks = Number.isFinite(Number(options.maxLinks))
    ? Math.max(1, Number(options.maxLinks))
    : 3;
  const preferExtraLinks = Boolean(options.preferExtraLinks);
  const entries = portalMapEntries(outputDir);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const resolvedGovernance = resolveGovernanceForPage(outputDir, currentPage, options.governance);
  const governanceTopLinks = Array.isArray(resolvedGovernance?.topLinks) ? resolvedGovernance.topLinks : [];
  const currentEntry = classifyWorkbenchPage(outputDir, currentPage)
    || entries.find((entry) => isCurrentPortalEntry(entry, currentPage))
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

function renderPortalContextBar(options = {}) {
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
    <section class="portal-context-bar">
      <div class="portal-context-main">
        ${contextItems.map((item) => `
          <div class="portal-context-item portal-audience-${escapeHtml(String(item.audience || 'all').trim() || 'all')}">
            <div class="portal-context-label">${escapeHtml(item.label)}</div>
            <div class="portal-context-value">${escapeHtml(item.value)}</div>
          </div>
        `).join('')}
      </div>
      ${counts.length ? `
        <div class="portal-context-counts${hideCountsInNewcomer ? ' portal-hide-in-newcomer' : ''}">
          ${counts.map((item) => `
            <span class="portal-context-pill portal-audience-${escapeHtml(String(item.audience || 'all').trim() || 'all')}">${escapeHtml(item.label)} ${escapeHtml(item.value ?? '')}</span>
          `).join('')}
        </div>
      ` : ''}
      ${hints.length ? `
        <div class="portal-context-hints${hideHintsInNewcomer ? ' portal-hide-in-newcomer' : ''}">
          ${hints.map((item) => {
            const text = typeof item === 'string' ? item : item?.text;
            const audience = typeof item === 'string' ? 'all' : (String(item.audience || 'all').trim() || 'all');
            return `<span class="portal-audience-${escapeHtml(audience)}">${escapeHtml(text)}</span>`;
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
  portalMapEntries,
  resolveGovernanceForPage,
  renderPortalActionDeck,
  renderPortalWorkbench,
  renderPortalModeSwitch,
  renderPortalProgressRail,
  renderPortalRouteCompass,
  renderPortalTopLinks,
  renderPortalContextBar,
  renderPortalJourney,
  getGovernedProgressVisibleIds,
};
