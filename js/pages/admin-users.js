(() => {
  const user = Auth.require(['admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');

  app.innerHTML = `
    <div class="page-head"><div><h1>Пользователи</h1><p>Регистрации нет — все учётные записи создаёт администратор. Одна организация — одно доверенное лицо.</p></div>
      <button class="btn btn-primary" id="addBtn">+ Создать пользователя</button></div>
    <div class="card">
      <div class="filters">
        <div class="grow"><label>Поиск</label><input id="fSearch" placeholder="Логин, ФИО, организация"></div>
        <div><label>Роль</label><select id="fRole">${UI.options(Object.entries(DB.ROLES), '', 'Все роли')}</select></div>
        <div><label>Статус</label><select id="fBlocked"><option value="">Все</option><option value="0">Активные</option><option value="1">Заблокированные</option></select></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Логин</th><th>ФИО</th><th>Роль</th><th>Организация</th><th>Телефон</th><th>Статус</th><th>Неявки / санкции</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;

  ['#fSearch', '#fRole', '#fBlocked'].forEach((s) => { UI.$(s).oninput = render; });

  function render() {
    const q = UI.$('#fSearch').value.trim().toLowerCase(), role = UI.$('#fRole').value, bl = UI.$('#fBlocked').value;
    const list = DB.listUsers().filter((u) => (!role || u.role === role) && (bl === '' || u.isBlocked === (bl === '1'))
      && (!q || [u.login, u.fullName, u.organization].some((x) => (x || '').toLowerCase().includes(q))));
    UI.$('#rows').innerHTML = list.length ? list.map((u) => {
      let sanc = '<span class="muted">—</span>';
      if (u.role === 'trustee') {
        const s = DB.sanctionInfo(u.id);
        sanc = s.banned ? `<span class="badge b-err">Бронь запрещена до ${UI.date(s.until)}</span>` : `<span class="muted">${s.count} из ${s.limit}</span>`;
      }
      return `<tr class="${u.isBlocked ? 'row-off' : ''}">
        <td><code>${esc(u.login)}</code></td><td>${esc(u.fullName)}</td><td>${esc(DB.ROLES[u.role])}</td>
        <td>${esc(u.organization || '—')}</td><td>${esc(u.phone || '—')}</td>
        <td>${u.isBlocked ? '<span class="badge b-err">Заблокирован</span>' : '<span class="badge b-ok">Активен</span>'}</td>
        <td>${sanc}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" data-edit="${u.id}">Изменить</button>
          <button class="btn btn-ghost btn-sm" data-pass="${u.id}">Сбросить пароль</button>
          <button class="btn btn-ghost btn-sm" data-block="${u.id}">${u.isBlocked ? 'Разблокировать' : 'Заблокировать'}</button>
          ${u.role === 'trustee' && DB.sanctionInfo(u.id).count ? `<button class="btn btn-ghost btn-sm" data-sanc="${u.id}">Снять санкции</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-del="${u.id}" title="Только если нет связанных данных">Удалить</button>
        </div></td></tr>`;
    }).join('') : UI.empty('Пользователи не найдены', 8);
  }

  function edit(id) {
    const u = id ? DB.getUser(id) : { role: 'trustee' };
    UI.modal({
      title: id ? `Пользователь ${u.login}` : 'Новый пользователь',
      body: `
        <div class="field-row">
          <div class="field"><label>Логин *</label><input name="login" value="${esc(u.login || '')}" autocomplete="off"></div>
          ${id ? '' : '<div class="field"><label>Пароль *</label><input name="password" type="text" autocomplete="off"></div>'}
        </div>
        <div class="field"><label>ФИО *</label><input name="fullName" value="${esc(u.fullName || '')}"></div>
        <div class="field-row">
          <div class="field"><label>Телефон</label><input name="phone" value="${esc(u.phone || '')}" placeholder="+7 ..."></div>
          <div class="field"><label>Роль *</label><select name="role">${UI.options(Object.entries(DB.ROLES), u.role)}</select></div>
        </div>
        <div class="field" id="orgField"><label>Организация *</label><input name="organization" value="${esc(u.organization || '')}" placeholder="ТОО «...»"><div class="hint">Обязательно для доверенного лица.</div></div>`,
      onOpen(root) {
        const f = UI.$('form', root);
        const upd = () => { UI.$('#orgField', root).style.display = f.role.value === 'trustee' ? '' : 'none'; };
        f.role.onchange = upd; upd();
      },
      onSubmit(f) {
        const d = UI.formData(f);
        if (d.role !== 'trustee') d.organization = '';
        if (id) DB.updateUser(id, d, user.id); else DB.createUser(d, user.id);
        UI.toast(id ? 'Изменения сохранены' : 'Пользователь создан'); render();
      },
    });
  }

  UI.$('#addBtn').onclick = () => edit(null);
  app.addEventListener('click', (e) => {
    const t = e.target.closest('button[data-edit],button[data-pass],button[data-block],button[data-del],button[data-sanc]');
    if (!t) return;
    const id = Object.values(t.dataset)[0];
    const u = DB.getUser(id);
    if (t.dataset.edit) edit(id);
    if (t.dataset.pass) {
      UI.modal({
        title: `Сброс пароля: ${u.login}`, submitText: 'Сохранить пароль',
        body: '<div class="field"><label>Новый пароль</label><input name="password" type="text" autocomplete="off"></div>',
        onSubmit(f) { DB.resetPassword(id, f.password.value, user.id); UI.toast('Пароль изменён'); },
      });
    }
    if (t.dataset.block) {
      if (u.isBlocked) { if (UI.act(() => DB.setBlocked(id, false, user.id), 'Пользователь разблокирован')) render(); }
      else UI.confirm(`Заблокировать ${u.fullName}? История сохранится, вход будет невозможен.`, () => { if (UI.act(() => DB.setBlocked(id, true, user.id), 'Пользователь заблокирован')) render(); }, { yes: 'Заблокировать', danger: true });
    }
    if (t.dataset.sanc) UI.confirm(`Снять санкции с ${u.organization}? Прошлые неявки перестанут учитываться.`, () => { if (UI.act(() => DB.clearSanction(id, user.id), 'Санкции сняты')) render(); }, { yes: 'Снять' });
    if (t.dataset.del) UI.confirm(`Удалить пользователя ${u.login}?`, () => { if (UI.act(() => DB.deleteUser(id, user.id), 'Пользователь удалён')) render(); }, { yes: 'Удалить', danger: true });
  });
  render();
  UI.onDataChange(render);
})();
