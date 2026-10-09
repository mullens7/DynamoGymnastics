/* Keep responsive tables labelled after asynchronous page updates. */
(() => {
 function labelTables() {
  document.querySelectorAll('dialog').forEach(dialog=>{const heading=dialog.querySelector('h2');if(heading&&dialog.getAttribute('aria-label')!==heading.textContent)dialog.setAttribute('aria-label',heading.textContent);});
  document.querySelectorAll('table').forEach(table => {
   const headings = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
   table.querySelectorAll('tbody tr').forEach(row => Array.from(row.children).forEach((cell, index) => {
    if (cell.colSpan > 1) return;
    const label = headings[index] || 'Actions';
    if (cell.dataset.label !== label) cell.dataset.label = label;
   }));
  });
 }
 labelTables();
 new MutationObserver(labelTables).observe(document.body, {childList: true, subtree: true});
 const toggle = document.getElementById('menu-toggle');
 if (toggle) {
  const sidebar = toggle.closest('aside');
  const close = () => { sidebar.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => {
   const open = sidebar.classList.toggle('menu-open');
   toggle.setAttribute('aria-expanded', String(open));
  });
  sidebar.querySelector('nav').addEventListener('click', event => { if (event.target.closest('button')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
 }
})();
