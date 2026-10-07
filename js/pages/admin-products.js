(() => {
  const user = Auth.require(['admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');

  app.innerHTML = `
    <div class="page-head"><div><h1>Справочник нефтепродуктов</h1><p>Учёт ведётся в тоннах. Неактивный продукт нельзя выбрать в новой партии.</p></div>
      <button class="btn btn-primary" id="addBtn">+ Добавить продукт</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Наименование</th><th>Ед. изм.</th><th class="num">Партий</th><th class="num">Свободно в открытых</th><th>Статус</th><th></th></tr></thead>
      <tbody id="rows"></tbody></table></div></div>`;

  function render() {
    const batches = DB.listBatches();
    UI.$('#rows').innerHTML = DB.listProducts().map((p) => {
      const bs = batches.filter((b) => b.productId === p.id);
      const free = bs.filter((b) => b.status === 'open').reduce((s, b) => s + b.free, 0);
      return `<tr class="${p.isActive ? '' : 'row-off'}"><td><b>${esc(p.name)}</b></td><td>${esc(p.unit)}</td>
        <td class="num">${bs.length}</td><td class="num">${UI.tons(free)}</td>
        <td>${p.isActive ? '<span class="badge b-ok">Активен</span>' : '<span class="badge b-off">Неактивен</span>'}</td>
        <td><div class="actions"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Изменить</button>
          <button class="btn btn-ghost btn-sm" data-toggle="${p.id}">${p.isActive ? 'Деактивировать' : 'Активировать'}</button></div></td></tr>`;
    }).join('') || UI.empty('Справочник пуст', 6);
  }

  function edit(id) {
    const p = id ? DB.getProduct(id) : { isActive: true };
    UI.modal({
      title: id ? 'Изменить продукт' : 'Новый продукт',
      body: `<div class="field"><label>Наименование *</label><input name="name" value="${esc(p.name || '')}" placeholder="АИ-98"></div>
        <div class="field"><label>Единица измерения</label><input value="т (тонны)" readonly></div>
        <label class="check"><input type="checkbox" name="isActive" ${p.isActive ? 'checked' : ''}> Активен</label>`,
      onSubmit(f) { DB.saveProduct({ id, name: f.elements.name.value, isActive: f.elements.isActive.checked }, user.id); UI.toast('Сохранено'); render(); },
    });
  }

  UI.$('#addBtn').onclick = () => edit(null);
  app.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'), tg = e.target.closest('[data-toggle]');
    if (ed) edit(ed.dataset.edit);
    if (tg) { const p = DB.getProduct(tg.dataset.toggle); if (UI.act(() => DB.saveProduct({ id: p.id, name: p.name, isActive: !p.isActive }, user.id), 'Сохранено')) render(); }
  });
  render();
  UI.onDataChange(render);
})();
