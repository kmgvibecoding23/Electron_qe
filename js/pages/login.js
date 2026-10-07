(() => {
  const u = Auth.current();
  if (u) { location.replace(Auth.homeOf(u.role)); return; }

  const DEMO = [
    ['Администратор', 'admin', 'admin123', 'Полный доступ, аналитика, пользователи'],
    ['Охранник', 'guard', 'guard123', 'Контроль въезда/выезда на КПП'],
    ['Товарная лаборатория', 'lab', 'lab123', 'Партии готового продукта'],
    ['Доверенное лицо', 'trustee1', 'trust123', 'ТОО «Транзит Ойл», 3 машины'],
    ['Доверенное лицо', 'trustee2', 'trust123', 'ТОО «КазТрансАвто», 3 машины'],
    ['Доверенное лицо', 'trustee3', 'trust123', 'ТОО «Степной перевозчик» — санкции за неявки'],
    ['Охранник', 'guard2', 'guard123', 'Заблокирован — пример отказа во входе'],
  ];
  const tbody = UI.$('#demoUsers');
  tbody.innerHTML = DEMO.map(([role, login, pass, note]) =>
    `<tr data-l="${login}" data-p="${pass}"><td>${role}</td><td><code>${login}</code></td><td><code>${pass}</code></td><td class="muted">${note}</td></tr>`).join('');
  tbody.onclick = (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    UI.$('#login').value = tr.dataset.l; UI.$('#password').value = tr.dataset.p; UI.$('#password').focus();
  };

  UI.$('#loginForm').onsubmit = (e) => {
    e.preventDefault();
    const err = UI.$('#err');
    try {
      const user = Auth.login(UI.$('#login').value, UI.$('#password').value);
      location.href = Auth.homeOf(user.role);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
})();
