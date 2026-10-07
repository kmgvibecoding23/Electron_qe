(() => {
  const user = Auth.require(['admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');
  const today = DB.todayStr();

  app.innerHTML = `
    <div class="page-head"><div><h1>Все брони</h1><p>Просмотр, отмена и ручное переназначение поста.</p></div>
      <div class="toolbar-right"><a class="btn btn-primary" href="journal.html">+ Забронировать</a><button class="btn btn-ghost" id="csvBtn">Выгрузить CSV</button></div></div>
    <div class="card">
      <div class="filters">
        <div><label>С даты</label><input type="date" id="fFrom" value="${DB.addDays(today, -7)}"></div>
        <div><label>По дату</label><input type="date" id="fTo" value="${DB.addDays(today, 7)}"></div>
        <div><label>Статус</label><select id="fStatus">${UI.options(Object.entries(DB.BOOKING_STATUS), '', 'Все')}</select></div>
        <div><label>Продукт</label><select id="fProduct">${UI.options(DB.listProducts().map((p) => [p.id, p.name]), '', 'Все')}</select></div>
        <div><label>Организация</label><select id="fTrustee">${UI.options(DB.listUsers().filter((u) => u.role === 'trustee').map((u) => [u.id, u.organization]), '', 'Все')}</select></div>
        <div><label>Пост</label><select id="fPost"><option value="">Все</option><option>1</option><option>2</option></select></div>
        <div class="grow"><label>Госномер</label><input id="fPlate" placeholder="Любое написание"></div>
      </div>
      <div class="stat-line muted" id="summary" style="margin-bottom:10px"></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Дата</th><th>Машина</th><th>Организация</th><th>Продукт</th><th class="num">Объём</th><th>Пост</th><th>Статус</th><th>Въезд</th><th>Выезд</th><th>Создана</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;

  UI.$$('.filters input, .filters select').forEach((el) => { el.oninput = render; });
  let current = [];

  function render() {
    const f = (id) => UI.$(id).value;
    const plate = DB.normalizePlate(f('#fPlate'));
    current = DB.listBookings({ from: f('#fFrom') || undefined, to: f('#fTo') || undefined, status: f('#fStatus') || undefined, trusteeId: f('#fTrustee') || undefined })
      .filter((b) => (!f('#fProduct') || b.product.id === f('#fProduct')) && (!f('#fPost') || String(b.post) === f('#fPost'))
        && (!plate || b.truck.plateNormalized.includes(plate) || (b.truck.trailerNormalized || '').includes(plate)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.post - b.post || a.createdAt.localeCompare(b.createdAt));
    const vol = current.reduce((s, b) => s + b.volume, 0);
    UI.$('#summary').innerHTML = `<span>Найдено: <b>${current.length}</b></span><span>Объём: <b>${UI.tons(vol)}</b></span>`;
    UI.$('#rows').innerHTML = current.length ? current.slice(0, 500).map((b) => `<tr>
      <td>${UI.date(b.date)}</td><td class="plate">${esc(b.truck.plate)}</td><td>${esc(b.trustee.organization)}</td><td>${esc(b.product.name)}</td>
      <td class="num">${UI.tons(b.volume)}</td><td><span class="post-badge">${b.post}</span></td><td>${UI.statusBadge(b.status)}</td>
      <td>${UI.time(b.enteredAt)}</td><td>${UI.time(b.exitedAt)}</td><td class="muted">${UI.dateTime(b.createdAt)}</td>
      <td><div class="actions">
        ${['booked', 'entered'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-post="${b.id}" title="Переназначить пост">→ пост ${b.post === 1 ? 2 : 1}</button>` : ''}
        ${b.status === 'booked' ? `<button class="btn btn-ghost btn-sm" data-cancel="${b.id}">Отменить</button>` : ''}
      </div></td></tr>`).join('') : UI.empty('Броней не найдено', 11);
  }

  UI.$('#csvBtn').onclick = () => UI.downloadCsv(`broni_${today}.csv`,
    ['Дата', 'Госномер', 'Прицеп', 'Организация', 'Доверенное лицо', 'Водитель', 'Продукт', 'Объём, т', 'Пост', 'Статус', 'Въезд', 'Выезд', 'Создана'],
    current.map((b) => [UI.date(b.date), b.truck.plate, b.truck.trailerPlate, b.trustee.organization, b.trustee.fullName, b.truck.driverName, b.product.name,
      String(b.volume).replace('.', ','), b.post, DB.BOOKING_STATUS[b.status], b.enteredAt ? UI.dateTime(b.enteredAt) : '', b.exitedAt ? UI.dateTime(b.exitedAt) : '', UI.dateTime(b.createdAt)]));

  app.addEventListener('click', (e) => {
    const p = e.target.closest('[data-post]'), c = e.target.closest('[data-cancel]');
    if (p) { const b = DB.getBooking(p.dataset.post); if (UI.act(() => DB.reassignPost(b.id, b.post === 1 ? 2 : 1, user), 'Пост переназначен')) render(); }
    if (c) {
      const b = DB.getBooking(c.dataset.cancel);
      UI.confirm(`Отменить бронь ${b.truck.plate} на ${UI.date(b.date)}?`, () => { if (UI.act(() => DB.cancelBooking(b.id, user), 'Бронь отменена')) render(); }, { yes: 'Отменить бронь', danger: true });
    }
  });
  render();
  UI.onDataChange(render);
})();
