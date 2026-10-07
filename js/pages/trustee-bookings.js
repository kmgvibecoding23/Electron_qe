(() => {
  const user = Auth.require(['trustee']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');

  app.innerHTML = `
    <div class="page-head"><div><h1>Мои брони</h1><p>${esc(user.organization)}</p></div>
      <a class="btn btn-primary" href="journal.html">+ Новая бронь</a></div>
    <div id="notice"></div>
    <div class="card">
      <div class="filters">
        <div><label>Статус</label><select id="fStatus">${UI.options(Object.entries(DB.BOOKING_STATUS), '', 'Все')}</select></div>
        <div><label>Период</label><select id="fWhen"><option value="future" selected>Сегодня и далее</option><option value="past">Прошедшие</option><option value="">Все</option></select></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Дата</th><th>Машина</th><th>Водитель</th><th>Продукт</th><th class="num">Объём</th><th>Пост</th><th>Статус</th><th>Въезд / выезд</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;

  UI.$('#fStatus').onchange = render;
  UI.$('#fWhen').onchange = render;

  function render() {
    const s = DB.sanctionInfo(user.id);
    UI.$('#notice').innerHTML = s.banned
      ? `<div class="alert alert-err"><b>Бронирование заблокировано до ${UI.date(s.until)} включительно</b> за неявки (${s.count}).</div>`
      : (s.count ? `<div class="alert alert-warn">Неявок за период: ${s.count} из ${s.limit}. При достижении порога бронирование будет временно заблокировано.</div>` : '');
    const today = DB.todayStr();
    const when = UI.$('#fWhen').value;
    const list = DB.listBookings({ trusteeId: user.id, status: UI.$('#fStatus').value || undefined })
      .filter((b) => !when || (when === 'future' ? b.date >= today : b.date < today))
      .sort((a, b) => (when === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.createdAt.localeCompare(b.createdAt));
    UI.$('#rows').innerHTML = list.length ? list.map((b) => `<tr>
      <td>${UI.date(b.date)}${b.date === today ? ' <span class="badge b-warn">сегодня</span>' : ''}</td>
      <td class="plate">${esc(b.truck.plate)}</td><td>${esc(b.truck.driverName)}</td><td>${esc(b.product.name)}</td>
      <td class="num">${UI.tons(b.volume)}</td><td><span class="post-badge">${b.post}</span></td>
      <td>${UI.statusBadge(b.status)}</td>
      <td>${b.enteredAt ? UI.time(b.enteredAt) : '—'} / ${b.exitedAt ? UI.time(b.exitedAt) : '—'}</td>
      <td>${b.status === 'booked' ? `<button class="btn btn-ghost btn-sm" data-cancel="${b.id}">Отменить</button>` : ''}</td></tr>`).join('')
      : UI.empty('Броней нет', 9);
  }

  app.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cancel]'); if (!c) return;
    const b = DB.getBooking(c.dataset.cancel);
    UI.confirm(`Отменить бронь ${b.truck.plate} на ${UI.date(b.date)} (${b.product.name}, ${UI.tons(b.volume)})? Объём вернётся в свободный остаток.`,
      () => { if (UI.act(() => DB.cancelBooking(b.id, user), 'Бронь отменена')) render(); }, { yes: 'Отменить бронь', danger: true });
  });
  render();
  UI.onDataChange(render);
})();
