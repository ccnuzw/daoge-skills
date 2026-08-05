document.addEventListener('DOMContentLoaded', () => {
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
