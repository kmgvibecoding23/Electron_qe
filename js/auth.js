/* auth.js — сессия, права доступа, навигация по ролям */
const Auth = (() => {
  const KEY = 'eq_session';
  const TIMEOUT = 8 * 60 * 60 * 1000; // автовыход после 8 ч неактивности

  const HOME = { admin: 'admin-analytics.html', guard: 'guard.html', trustee: 'journal.html', lab: 'lab-batches.html' };

  const NAV = {
    admin: [
      ['admin-analytics.html', 'Аналитика'], ['admin-bookings.html', 'Все брони'], ['guard.html', 'Контроль въезда'],
      ['journal.html', 'Журнал продуктов'], ['lab-batches.html', 'Партии'], ['trustee-trucks.html', 'Машины'],
      ['admin-users.html', 'Пользователи'], ['admin-products.html', 'Продукты'], ['admin-settings.html', 'Настройки'],
    ],
    guard: [['guard.html', 'Контроль въезда']],
    trustee: [['journal.html', 'Журнал продуктов'], ['trustee-bookings.html', 'Мои брони'], ['trustee-trucks.html', 'Мои машины']],
    lab: [['lab-batches.html', 'Партии продукта'], ['journal.html', 'Журнал продуктов']],
  };

  function read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }

  function current() {
    const s = read();
    if (!s) return null;
    if (Date.now() - s.lastActivity > TIMEOUT) { logout(true); return null; }
    const u = DB.getUser(s.userId);
    if (!u || u.isBlocked) { localStorage.removeItem(KEY); return null; }
    return u;
  }
  function touch() { const s = read(); if (s) { s.lastActivity = Date.now(); localStorage.setItem(KEY, JSON.stringify(s)); } }

  function login(login, password) {
    const u = DB.authenticate(login, password);
    localStorage.setItem(KEY, JSON.stringify({ userId: u.id, lastActivity: Date.now() }));
    DB.processNoShows(); // FR-9.1: неявки при первом входе после окончания дня брони
    return u;
  }
  function logout(silent) { localStorage.removeItem(KEY); if (!silent) location.href = 'index.html'; }
  const homeOf = (role) => HOME[role] || 'index.html';

  // Проверка доступа к странице. Возвращает пользователя или делает редирект.
  function require(roles) {
    const u = current();
    if (!u) { location.replace('index.html'); throw new Error('redirect'); }
    if (roles && !roles.includes(u.role)) { location.replace(homeOf(u.role)); throw new Error('redirect'); }
    DB.processNoShows();
    touch();
    ['click', 'keydown'].forEach((ev) => document.addEventListener(ev, touch, { passive: true }));
    return u;
  }

  return { current, login, logout, require, homeOf, NAV };
})();
