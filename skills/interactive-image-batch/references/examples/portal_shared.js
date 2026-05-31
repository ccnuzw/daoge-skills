document.addEventListener('DOMContentLoaded', () => {
  const currentPage = document.body?.dataset?.portalPage || '';
  const links = document.querySelectorAll('.top-links a, .hero-links a');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#')) continue;
    if (href === currentPage || href.endsWith('/' + currentPage)) {
      link.classList.add('is-active');
    }
  }
});
