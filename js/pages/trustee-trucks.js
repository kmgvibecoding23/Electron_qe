(() => {
  const user = Auth.require(['trustee', 'admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const isAdmin = user.role === 'admin';
  const app = UI.$('#app');

  app.innerHTML = `
    <div class="page-head"><div><h1>${isAdmin ? 'Все машины' : 'Мои машины'}</h1>
      <p>Госномер хранится в нормализованном виде — охранник найдёт машину при любом написании.</p></div>
      <button class="btn btn-primary" id="addBtn">+ Добавить машину</button></div>
    <div class="card">
      <div class="filters">
        <div class="grow"><label>Поиск</label><input id="fSearch" placeholder="Госномер, водитель, марка"></div>
        ${isAdmin ? '<div><label>Владелец</label><select id="fOwner"></select></div>' : ''}
        <div><label>Статус</label><select id="fActive"><option value="">Все</option><option value="1" selected>Активные</option><option value="0">Неактивные</option></select></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Госномер</th><th>Прицеп</th><th>Марка</th><th class="num">Цистерна</th><th>Водитель</th>${isAdmin ? '<th>Организация</th>' : ''}<th>Брони</th><th>Статус</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;

  const trustees = () => DB.listUsers().filter((u) => u.role === 'trustee');
  if (isAdmin) { UI.$('#fOwner').innerHTML = UI.options(trustees().map((u) => [u.id, u.organization]), '', 'Все'); UI.$('#fOwner').onchange = render; }
  UI.$('#fSearch').oninput = render;
  UI.$('#fActive').onchange = render;

  function render() {
    const q = UI.$('#fSearch').value.trim().toLowerCase();
    const qn = DB.normalizePlate(q);
    const owner = isAdmin ? UI.$('#fOwner').value : '';
    const act = UI.$('#fActive').value;
    const users = Object.fromEntries(DB.listUsers().map((u) => [u.id, u]));
    const active = DB.listBookings({ status: DB.ACTIVE });
    const list = DB.listTrucks(isAdmin ? null : user.id).filter((t) =>
      (!owner || t.ownerId === owner) && (act === '' || t.isActive === (act === '1'))
      && (!q || t.plateNormalized.includes(qn) || t.trailerNormalized.includes(qn) || t.driverName.toLowerCase().includes(q) || t.model.toLowerCase().includes(q)))
      .sort((a, b) => a.plate.localeCompare(b.plate));
    UI.$('#rows').innerHTML = list.length ? list.map((t) => {
      const n = active.filter((b) => b.truckId === t.id).length;
      return `<tr class="${t.isActive ? '' : 'row-off'}">
        <td class="plate">${esc(t.plate)}</td><td class="plate">${esc(t.trailerPlate || '—')}</td><td>${esc(t.model)}</td>
        <td class="num">${UI.tons(t.tankVolume)}</td>
        <td>${esc(t.driverName)}<div class="muted" style="font-size:12.5px">${esc(t.driverPhone)}</div></td>
        ${isAdmin ? `<td>${esc((users[t.ownerId] || {}).organization)}</td>` : ''}
        <td>${n ? `<span class="badge st-booked">${n} активн.</span>` : '<span class="muted">—</span>'}</td>
        <td>${t.isActive ? '<span class="badge b-ok">Активна</span>' : '<span class="badge b-off">Неактивна</span>'}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" data-edit="${t.id}">Изменить</button>
          <button class="btn btn-ghost btn-sm" data-toggle="${t.id}">${t.isActive ? 'Деактивировать' : 'Активировать'}</button>
        </div></td></tr>`;
    }).join('') : UI.empty('Машин не найдено', isAdmin ? 9 : 8);
  }

  function edit(id) {
    const t = id ? DB.getTruck(id) : { isActive: true };
    UI.modal({
      title: id ? `Машина ${t.plate}` : 'Новая машина',
      body: `
        ${isAdmin ? `<div class="field"><label>Владелец (доверенное лицо)</label><select name="ownerId">${UI.options(trustees().map((u) => [u.id, `${u.organization} — ${u.fullName}`]), t.ownerId, '— выберите —')}</select></div>` : ''}
        <div class="field-row">
          <div class="field"><label>Госномер тягача *</label><input name="plate" value="${esc(t.plate || '')}" placeholder="А123ВС 77"></div>
          <div class="field"><label>Госномер прицепа</label><input name="trailerPlate" value="${esc(t.trailerPlate || '')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Марка</label><input name="model" value="${esc(t.model || '')}"></div>
          <div class="field"><label>Вместимость цистерны, т *</label><input name="tankVolume" type="number" step="0.1" min="0" value="${t.tankVolume || ''}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>ФИО водителя *</label><input name="driverName" value="${esc(t.driverName || '')}"></div>
          <div class="field"><label>Телефон водителя</label><input name="driverPhone" value="${esc(t.driverPhone || '')}" placeholder="+7 ..."></div>
        </div>`,
      onSubmit(f) { DB.saveTruck(Object.assign(UI.formData(f), { id }), user); UI.toast('Машина сохранена'); render(); },
    });
  }

  UI.$('#addBtn').onclick = () => edit(null);
  app.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'); const tg = e.target.closest('[data-toggle]');
    if (ed) edit(ed.dataset.edit);
    if (tg) { const t = DB.getTruck(tg.dataset.toggle); if (UI.act(() => DB.setTruckActive(t.id, !t.isActive, user), t.isActive ? 'Машина деактивирована' : 'Машина активирована')) render(); }
  });
  render();
  UI.onDataChange(render);
})();
