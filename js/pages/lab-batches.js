(() => {
  const user = Auth.require(['lab', 'admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');

  app.innerHTML = `
    <div class="page-head"><div><h1>Партии продукта</h1><p>Свободно = Количество − Забронировано − Отгружено. Все объёмы в тоннах.</p></div>
      <button class="btn btn-primary" id="addBtn">+ Новая партия</button></div>
    <div class="kpis" id="kpis"></div>
    <div class="card">
      <div class="filters">
        <div><label>Продукт</label><select id="fProduct"></select></div>
        <div><label>Статус</label><select id="fStatus"><option value="open" selected>Открытые</option><option value="closed">Закрытые</option><option value="">Все</option></select></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Продукт</th><th class="num">Количество</th><th class="num">Забронировано</th><th class="num">Отгружено</th><th class="num">Свободно</th><th>Выдача с</th><th>Паспорт</th><th>Статус</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;

  UI.$('#fProduct').innerHTML = UI.options(DB.listProducts().map((p) => [p.id, p.name]), '', 'Все');
  UI.$('#fProduct').onchange = render;
  UI.$('#fStatus').onchange = render;

  function render() {
    const all = DB.listBatches();
    const open = all.filter((b) => b.status === 'open');
    const sum = (k) => open.reduce((s, b) => s + b[k], 0);
    UI.$('#kpis').innerHTML = [
      ['Открытых партий', open.length, ''], ['Всего в открытых', UI.tons(sum('quantity')), ''],
      ['Забронировано', UI.tons(sum('reserved')), 'ожидают налива'], ['Отгружено', UI.tons(sum('shipped')), 'из открытых партий'], ['Свободно', UI.tons(sum('free')), 'доступно для брони'],
    ].map(([l, v, s]) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value">${v}</div><div class="k-sub">${s}</div></div>`).join('');

    const p = UI.$('#fProduct').value, st = UI.$('#fStatus').value;
    const list = all.filter((b) => (!p || b.productId === p) && (!st || b.status === st)).sort((a, b) => b.availableFrom.localeCompare(a.availableFrom));
    UI.$('#rows').innerHTML = list.length ? list.map((b) => `<tr class="${b.status === 'closed' ? 'row-off' : ''}">
      <td><b>${esc(b.product.name)}</b><div class="muted" style="font-size:12.5px">${esc(b.comment || '')}</div></td>
      <td class="num">${UI.tons(b.quantity)}</td><td class="num">${UI.tons(b.reserved)}</td><td class="num">${UI.tons(b.shipped)}</td>
      <td class="num"><b>${UI.tons(b.free)}</b></td><td>${UI.date(b.availableFrom)}</td><td>${esc(b.qualityPassport || '—')}</td>
      <td>${b.status === 'open' ? '<span class="badge b-ok">Открыта</span>' : '<span class="badge b-off">Закрыта</span>'}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-sm" data-bookings="${b.id}">Брони</button>
        <button class="btn btn-ghost btn-sm" data-edit="${b.id}">Изменить</button>
        <button class="btn btn-ghost btn-sm" data-toggle="${b.id}">${b.status === 'open' ? 'Закрыть' : 'Открыть'}</button>
      </div></td></tr>`).join('') : UI.empty('Партий нет', 9);
  }

  function edit(id) {
    const b = id ? DB.getBatch(id) : { availableFrom: DB.todayStr() };
    const products = DB.listProducts().filter((p) => p.isActive || p.id === b.productId);
    UI.modal({
      title: id ? `Партия: ${b.product.name}` : 'Новая партия',
      body: `
        <div class="field"><label>Продукт *</label><select name="productId" ${id ? 'disabled' : ''}>${UI.options(products.map((p) => [p.id, p.name]), b.productId, '— выберите —')}</select>
          ${id ? '' : '<div class="hint">Неактивные продукты из справочника недоступны.</div>'}</div>
        <div class="field-row">
          <div class="field"><label>Количество, т *</label><input name="quantity" type="number" step="0.1" min="0" value="${b.quantity || ''}">
            ${id ? `<div class="hint">Не меньше ${UI.tons(b.reserved + b.shipped)} (забронировано + отгружено)</div>` : ''}</div>
          <div class="field"><label>Дата начала выдачи *</label><input name="availableFrom" type="date" value="${b.availableFrom || ''}"></div>
        </div>
        <div class="field"><label>Номер паспорта качества</label><input name="qualityPassport" value="${esc(b.qualityPassport || '')}"></div>
        <div class="field"><label>Комментарий</label><textarea name="comment" rows="2">${esc(b.comment || '')}</textarea></div>`,
      onSubmit(f) {
        const d = UI.formData(f);
        if (id) DB.updateBatch(id, d, user.id); else DB.createBatch(d, user.id);
        UI.toast(id ? 'Партия обновлена' : 'Партия добавлена в журнал'); render();
      },
    });
  }

  function showBookings(id) {
    const b = DB.getBatch(id);
    const list = DB.listBookings({ batchId: id }).sort((x, y) => y.date.localeCompare(x.date));
    UI.modal({
      title: `Брони партии: ${b.product.name}, ${UI.tons(b.quantity)}`, wide: true,
      body: `<div class="stat-line" style="margin-bottom:12px"><span>Забронировано: <b>${UI.tons(b.reserved)}</b></span><span>Отгружено: <b>${UI.tons(b.shipped)}</b></span><span>Свободно: <b>${UI.tons(b.free)}</b></span></div>
        <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Машина</th><th>Организация</th><th class="num">Объём</th><th>Статус</th></tr></thead><tbody>
        ${list.length ? list.map((k) => `<tr><td>${UI.date(k.date)}</td><td class="plate">${esc(k.truck.plate)}</td><td>${esc(k.trustee.organization)}</td><td class="num">${UI.tons(k.volume)}</td><td>${UI.statusBadge(k.status)}</td></tr>`).join('') : UI.empty('Броней нет', 5)}
        </tbody></table></div>`,
    });
  }

  UI.$('#addBtn').onclick = () => edit(null);
  app.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'), tg = e.target.closest('[data-toggle]'), bk = e.target.closest('[data-bookings]');
    if (ed) edit(ed.dataset.edit);
    if (bk) showBookings(bk.dataset.bookings);
    if (tg) {
      const b = DB.getBatch(tg.dataset.toggle);
      if (b.status === 'open') {
        UI.confirm(`Закрыть партию «${b.product.name}»? Бронировать её больше будет нельзя, существующие брони сохранятся.`,
          () => { if (UI.act(() => DB.setBatchStatus(b.id, 'closed', user.id), 'Партия закрыта')) render(); }, { yes: 'Закрыть партию' });
      } else if (UI.act(() => DB.setBatchStatus(b.id, 'open', user.id), 'Партия открыта')) render();
    }
  });
  render();
  UI.onDataChange(render);
})();
