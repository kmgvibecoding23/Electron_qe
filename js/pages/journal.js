(() => {
  const user = Auth.require(['trustee', 'lab', 'admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');
  const canBook = ['trustee', 'admin'].includes(user.role);

  app.innerHTML = `
    <div class="page-head"><div><h1>Журнал доступных нефтепродуктов</h1>
      <p>Открытые партии со свободным остатком. ${canBook ? 'Бронь — на день, внутри дня живая очередь по факту приезда.' : ''}</p></div></div>
    <div id="notice"></div>
    <div class="card">
      <div class="filters"><div class="grow"><label>Продукт</label><select id="fProduct"></select></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Продукт</th><th class="num">Свободно</th><th>Заполненность партии</th><th>Выдача с</th><th>Паспорт качества</th><th>Комментарий</th>${canBook ? '<th></th>' : ''}</tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;

  const fProduct = UI.$('#fProduct');
  fProduct.innerHTML = UI.options(DB.listProducts().map((p) => [p.id, p.name]), '', 'Все продукты');
  fProduct.onchange = render;

  function renderNotice() {
    if (user.role !== 'trustee') { UI.$('#notice').innerHTML = ''; return; }
    const s = DB.sanctionInfo(user.id);
    const lim = DB.trusteeLimitInfo(user.id, DB.todayStr());
    const set = DB.getSettings();
    UI.$('#notice').innerHTML = s.banned
      ? `<div class="alert alert-err"><b>Бронирование заблокировано до ${UI.date(s.until)} включительно</b> — ${s.count} неявки за последние ${set.noShowPeriodDays} дн. (порог — ${s.limit}). Для досрочного снятия обратитесь к администратору.</div>`
      : `<div class="alert alert-info">Суточный лимит: <b>${UI.tons(set.dailyLimitPerTrustee)}</b> на доверенное лицо (на сегодня свободно ${UI.tons(lim.left)}).
         Неявок за ${set.noShowPeriodDays} дн.: <b>${s.count}</b> из ${s.limit} допустимых до блокировки бронирования на ${set.banDays} дн.</div>`;
  }

  function render() {
    renderNotice();
    const list = DB.listAvailableBatches().filter((b) => !fProduct.value || b.productId === fProduct.value);
    UI.$('#rows').innerHTML = list.length ? list.map((b) => {
      const used = ((b.quantity - b.free) / b.quantity) * 100;
      return `<tr>
        <td><b>${esc(b.product.name)}</b></td>
        <td class="num"><b>${UI.tons(b.free)}</b> <span class="muted">из ${UI.num(b.quantity)}</span></td>
        <td><div class="progress" title="Забронировано и отгружено ${UI.num(used, 0)}%"><i style="width:${used}%"></i></div></td>
        <td>${UI.date(b.availableFrom)}${b.availableFrom > DB.todayStr() ? ' <span class="badge b-warn">скоро</span>' : ''}</td>
        <td>${esc(b.qualityPassport || '—')}</td>
        <td class="muted">${esc(b.comment || '')}</td>
        ${canBook ? `<td><button class="btn btn-primary btn-sm" data-book="${b.id}">Забронировать</button></td>` : ''}
      </tr>`;
    }).join('') : UI.empty('Нет доступных партий', canBook ? 7 : 6);
  }

  function openBooking(batchId) {
    const batch = DB.getBatch(batchId);
    const trucks = DB.listTrucks(user.role === 'admin' ? null : user.id).filter((t) => t.isActive);
    if (!trucks.length) { UI.toast('Нет активных машин. Сначала добавьте машину в разделе «Мои машины»', 'err'); return; }
    const owners = Object.fromEntries(DB.listUsers().map((u) => [u.id, u]));
    const minDate = batch.availableFrom > DB.todayStr() ? batch.availableFrom : DB.todayStr();
    UI.modal({
      title: `Бронирование: ${batch.product.name}`,
      submitText: 'Забронировать',
      body: `
        <div class="alert alert-info" style="margin-bottom:12px">Свободно в партии: <b>${UI.tons(batch.free)}</b>. Выдача с ${UI.date(batch.availableFrom)}.</div>
        <div class="field"><label>Машина</label><select name="truckId" required>${UI.options(trucks.map((t) => [t.id,
          `${t.plate} · ${t.model} · ${UI.num(t.tankVolume)} т${user.role === 'admin' ? ' · ' + (owners[t.ownerId] || {}).organization : ''}`]), '', '— выберите машину —')}</select></div>
        <div class="field-row">
          <div class="field"><label>Объём, т</label><input name="volume" type="number" step="0.1" min="0.1" required></div>
          <div class="field"><label>Дата приезда</label><input name="date" type="date" min="${minDate}" value="${minDate}" required></div>
        </div>
        <div id="bkInfo" class="hint"></div>`,
      onOpen(root) {
        const f = UI.$('form', root);
        const upd = () => {
          const t = trucks.find((x) => x.id === f.truckId.value);
          const date = f.date.value;
          const parts = [];
          if (t) {
            const max = Math.min(t.tankVolume, batch.free);
            f.volume.max = max;
            if (!f.volume.value) f.volume.value = max;
            parts.push(`Вместимость цистерны: ${UI.tons(t.tankVolume)}.`);
            if (date) {
              const lim = DB.trusteeLimitInfo(t.ownerId, date);
              parts.push(`Лимит ${UI.tons(lim.limit)}/сутки: на ${UI.date(date)} уже ${UI.tons(lim.used)}, доступно <b>${UI.tons(lim.left)}</b>.`);
            }
          }
          if (date) {
            const a = DB.dayAvailability(date);
            parts.push(`Загрузка на ${UI.date(date)}: пост 1 — ${a.post1}/${a.capacity}, пост 2 — ${a.post2}/${a.capacity}.${a.free ? '' : ' <b style="color:var(--err)">День заполнен.</b>'} Пост будет назначен автоматически.`);
          }
          UI.$('#bkInfo', root).innerHTML = parts.join('<br>');
        };
        f.truckId.onchange = () => { f.volume.value = ''; upd(); };
        f.date.onchange = upd;
        if (trucks.length === 1) f.truckId.value = trucks[0].id;
        upd();
      },
      onSubmit(f) {
        const d = UI.formData(f);
        const b = DB.createBooking({ batchId, truckId: d.truckId, volume: d.volume, date: d.date }, user);
        UI.toast(`Бронь создана: ${b.truck.plate}, ${UI.date(b.date)}, пост ${b.post}`);
        render();
      },
    });
  }

  app.addEventListener('click', (e) => { const b = e.target.closest('[data-book]'); if (b) openBooking(b.dataset.book); });
  render();
  UI.onDataChange(render);
})();
