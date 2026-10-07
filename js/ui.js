/* ui.js — общие компоненты: шапка и меню, модальные окна, уведомления, форматирование */
const UI = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- форматирование (ДД.ММ.ГГГГ, 24 ч) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function date(str) { if (!str) return '—'; const [y, m, d] = str.slice(0, 10).split('-'); return `${d}.${m}.${y}`; }
  function time(iso) { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function dateTime(iso) { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${time(iso)}`; }
  function num(n, digits = 1) { return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: digits }); }
  function tons(n) { return `${num(n)} т`; }
  function duration(min) { if (!isFinite(min)) return '—'; min = Math.round(min); const h = Math.floor(min / 60); return h ? `${h} ч ${pad(min % 60)} мин` : `${min} мин`; }

  function statusBadge(status) { return `<span class="badge st-${status}">${esc(DB.BOOKING_STATUS[status] || status)}</span>`; }

  /* ---------- шапка и меню ---------- */
  function renderHeader(user) {
    const page = location.pathname.split('/').pop() || 'index.html';
    const links = (Auth.NAV[user.role] || []).map(([href, title]) => `<a href="${href}" class="${href === page ? 'active' : ''}">${title}</a>`).join('');
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `
      <div class="topbar-inner">
        <a class="brand" href="${Auth.homeOf(user.role)}"><span class="brand-logo">⛽</span><span>Электронная очередь<small>налив нефтепродуктов</small></span></a>
        <button class="menu-toggle" aria-label="Меню" aria-expanded="false">☰</button>
        <nav class="nav">${links}</nav>
        <div class="userbox">
          <div class="userinfo"><b>${esc(user.fullName)}</b><span>${esc(DB.ROLES[user.role])}${user.organization ? ' · ' + esc(user.organization) : ''}</span></div>
          <button class="btn btn-ghost btn-sm" id="logoutBtn">Выход</button>
        </div>
      </div>`;
    document.body.prepend(header);
    $('#logoutBtn').onclick = () => Auth.logout();
    const tg = $('.menu-toggle', header);
    tg.onclick = () => { const open = header.classList.toggle('open'); tg.setAttribute('aria-expanded', open); };
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML = 'Демонстрационный прототип: данные хранятся в браузере (localStorage)';
    header.after(banner);
  }

  /* ---------- уведомления ---------- */
  function toast(msg, type = 'ok') {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('hide'), 3800);
    setTimeout(() => el.remove(), 4300);
  }

  /* ---------- модальные окна ---------- */
  // opts: {title, body (html), submitText, onSubmit(form) -> false чтобы не закрывать, onOpen(root), wide}
  function modal(opts) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <form class="modal ${opts.wide ? 'modal-wide' : ''}" novalidate>
        <div class="modal-head"><h3>${esc(opts.title)}</h3><button type="button" class="modal-x" aria-label="Закрыть">×</button></div>
        <div class="modal-body">${opts.body || ''}<div class="form-error" hidden></div></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost modal-cancel">${opts.onSubmit ? 'Отмена' : 'Закрыть'}</button>
          ${opts.onSubmit ? `<button type="submit" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}">${esc(opts.submitText || 'Сохранить')}</button>` : ''}
        </div>
      </form>`;
    document.body.appendChild(back);
    const form = $('form', back);
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('.modal-x', back).onclick = close;
    $('.modal-cancel', back).onclick = close;
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    form.onsubmit = (e) => {
      e.preventDefault();
      const errBox = $('.form-error', back);
      try {
        if (opts.onSubmit(form, back) !== false) close();
      } catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
    };
    if (opts.onOpen) opts.onOpen(back);
    const first = $('input:not([type=hidden]):not([readonly]), select, textarea', back);
    if (first) setTimeout(() => first.focus(), 30);
    return { root: back, close };
  }

  function confirm(text, onYes, { title = 'Подтверждение', yes = 'Да', danger = false } = {}) {
    modal({ title, body: `<p>${esc(text)}</p>`, submitText: yes, danger, onSubmit: () => { onYes(); } });
  }

  // Выполнить действие и показать ошибку тостом
  function act(fn, okMsg) {
    try { fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(e.message, 'err'); return false; }
  }

  function formData(form) { const o = {}; new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; }); return o; }

  function options(list, selected, placeholder) {
    return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '')
      + list.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
  }

  /* ---------- CSV (разделитель «;», BOM — открывается в Excel) ---------- */
  function downloadCsv(filename, headers, rows) {
    const cell = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Перерисовка при изменении данных в другой вкладке (FR-5.3)
  function onDataChange(cb) {
    window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith('eq_db')) { DB.reload(); cb(); } });
  }

  function empty(text, cols) { return `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`; }

  return { esc, $, $$, date, time, dateTime, num, tons, duration, statusBadge, renderHeader, toast, modal, confirm, act, formData, options, downloadCsv, onDataChange, empty };
})();
