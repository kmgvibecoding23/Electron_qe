(() => {
  const user = Auth.require(['guard', 'admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');

  app.innerHTML = `
    <div class="page-head"><div><h1>Контроль въезда</h1><p>Сегодня ${UI.date(DB.todayStr())}. Введите госномер тягача или прицепа в любом написании.</p></div></div>
    <div class="card">
      <form class="guard-search" id="searchForm" autocomplete="off">
        <input id="plateInput" placeholder="А123ВС 77" aria-label="Госномер">
        <button class="btn btn-primary" type="submit">Проверить</button>
      </form>
      <div id="result"></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>На территории</h2><span class="muted" id="onSiteCount"></span></div><div id="onSite"></div></div>
      <div class="card"><div class="card-head"><h2>Ожидаются сегодня</h2><span class="muted" id="expectedCount"></span></div><div id="expected"></div></div>
    </div>`;

  const input = UI.$('#plateInput');
  let lastQuery = '';

  function truckDetails(b) {
    const t = b.truck;
    return `<dl>
      <dt>Госномер</dt><dd class="big-plate">${esc(t.plate)}</dd>
      <dt>Прицеп</dt><dd class="plate">${esc(t.trailerPlate || '—')}</dd>
      <dt>Водитель</dt><dd>${esc(t.driverName)}<div class="muted" style="font-size:14px;font-weight:400">${esc(t.driverPhone)}</div></dd>
      <dt>Организация</dt><dd>${esc(b.trustee.organization)}</dd>
      <dt>Продукт</dt><dd>${esc(b.product.name)}</dd>
      <dt>Объём</dt><dd>${UI.tons(b.volume)}</dd>
      <dt>Пост налива</dt><dd><span class="post-badge" style="font-size:18px;height:32px;min-width:40px">${b.post}</span></dd>
      <dt>Марка</dt><dd>${esc(t.model || '—')}</dd>
    </dl>`.replace(/<dt>/g, '<div><dt>').replace(/<\/dd>/g, '</dd></div>');
  }

  function check(q) {
    lastQuery = q;
    const res = UI.$('#result');
    if (!q) { res.innerHTML = ''; return; }
    const trucks = DB.findTrucksByPlate(q);
    const norm = DB.normalizePlate(q);
    if (!trucks.length) {
      res.innerHTML = `<div class="result result-err"><h2>⛔ Машина не зарегистрирована. Въезд запрещён</h2>
        <p style="margin:0">Номер <span class="plate">${esc(norm)}</span> не найден в системе.</p></div>`;
      return;
    }
    const ids = trucks.map((t) => t.id);
    const today = DB.todayStr();
    const todays = DB.listBookings({ date: today }).filter((b) => ids.includes(b.truckId));
    const booked = todays.find((b) => b.status === 'booked');
    const entered = DB.listBookings({ status: 'entered' }).find((b) => ids.includes(b.truckId));

    if (entered) {
      res.innerHTML = `<div class="result result-info"><h2>ℹ️ Машина уже на территории</h2>
        <p style="margin-top:0">Въехала в ${UI.time(entered.enteredAt)}${entered.date !== today ? ' ' + UI.date(entered.date) : ''}. Повторная отметка въезда невозможна.</p>
        ${truckDetails(entered)}
        <button class="btn btn-ok btn-lg" data-exit="${entered.id}">Выехала</button></div>`;
      return;
    }
    if (booked) {
      res.innerHTML = `<div class="result result-ok"><h2>✅ Бронь на сегодня найдена — въезд разрешён</h2>
        ${truckDetails(booked)}
        <button class="btn btn-ok btn-lg" data-enter="${booked.id}">Въехала</button></div>`;
      return;
    }
    const next = DB.listBookings({ status: 'booked' }).filter((b) => ids.includes(b.truckId) && b.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const done = todays.find((b) => b.status === 'exited');
    const t = trucks[0];
    res.innerHTML = `<div class="result result-warn"><h2>⚠️ Нет брони на сегодня. Въезд запрещён</h2>
      <p style="margin-top:0">Машина <span class="plate">${esc(t.plate)}</span> (${esc(t.model || '')}${t.trailerPlate ? ', прицеп ' + esc(t.trailerPlate) : ''}) зарегистрирована, но активной брони на ${UI.date(today)} нет.</p>
      ${done ? `<p>Сегодня уже отгружена: выехала в ${UI.time(done.exitedAt)}.</p>` : ''}
      <p style="margin-bottom:0">${next ? `Ближайшая бронь: <b>${UI.date(next.date)}</b>, ${esc(next.product.name)}, ${UI.tons(next.volume)}, пост ${next.post}.` : 'Ближайших броней нет.'}</p></div>`;
  }

  function renderLists() {
    const today = DB.todayStr();
    const onSite = DB.queueOnTerritory();
    UI.$('#onSiteCount').textContent = `${onSite.length} маш.`;
    UI.$('#onSite').innerHTML = onSite.length ? [1, 2].map((post) => {
      const list = onSite.filter((b) => b.post === post);
      return `<div class="post-title"><span class="post-badge">${post}</span> Пост ${post} <span class="muted" style="font-weight:400">— очередь по времени въезда</span></div>
        ${list.length ? `<ul class="guard-list">${list.map((b, i) => `
          <li><div style="display:flex;align-items:center"><span class="qnum">${i + 1}</span><div>
            <span class="plate">${esc(b.truck.plate)}</span> · ${esc(b.product.name)} ${UI.tons(b.volume)}
            <div class="muted" style="font-size:13px">${esc(b.trustee.organization)} · въехала ${UI.time(b.enteredAt)} · ${UI.duration((Date.now() - new Date(b.enteredAt)) / 60000)} на территории</div></div></div>
            <button class="btn btn-ok" data-exit="${b.id}">Выехала</button></li>`).join('')}</ul>` : '<p class="muted" style="margin:6px 0 10px">Нет машин</p>'}`;
    }).join('') : '<p class="muted">На территории нет машин.</p>';

    const expected = DB.listBookings({ date: today, status: 'booked' });
    UI.$('#expectedCount').textContent = `${expected.length} маш.`;
    UI.$('#expected').innerHTML = expected.length ? [1, 2].map((post) => {
      const list = expected.filter((b) => b.post === post);
      return `<div class="post-title"><span class="post-badge">${post}</span> Пост ${post}</div>
        ${list.length ? `<ul class="guard-list">${list.map((b) => `
          <li class="clickable" data-plate="${esc(b.truck.plate)}"><div><span class="plate">${esc(b.truck.plate)}</span>${b.truck.trailerPlate ? ` <span class="muted">/ ${esc(b.truck.trailerPlate)}</span>` : ''}
            <div class="muted" style="font-size:13px">${esc(b.trustee.organization)} · ${esc(b.product.name)} ${UI.tons(b.volume)} · ${esc(b.truck.driverName)}</div></div>
            <button class="btn btn-ghost" data-plate="${esc(b.truck.plate)}">Проверить</button></li>`).join('')}</ul>` : '<p class="muted" style="margin:6px 0 10px">Нет ожидаемых машин</p>'}`;
    }).join('') : '<p class="muted">Все записанные на сегодня машины уже прибыли.</p>';
  }

  function refresh() { renderLists(); if (lastQuery) check(lastQuery); }

  UI.$('#searchForm').onsubmit = (e) => { e.preventDefault(); check(input.value.trim()); };
  app.addEventListener('click', (e) => {
    const en = e.target.closest('[data-enter]');
    const ex = e.target.closest('[data-exit]');
    const pl = e.target.closest('[data-plate]');
    if (en) {
      if (UI.act(() => DB.markEntered(en.dataset.enter, user), 'Въезд зафиксирован')) refresh();
    } else if (ex) {
      const b = DB.getBooking(ex.dataset.exit);
      UI.confirm(`Отметить выезд машины ${b.truck.plate}? Объём ${UI.tons(b.volume)} будет учтён как отгруженный.`, () => {
        if (UI.act(() => DB.markExited(b.id, user), 'Выезд зафиксирован')) refresh();
      }, { title: 'Выезд с территории', yes: 'Выехала' });
    } else if (pl) {
      input.value = pl.dataset.plate; check(pl.dataset.plate); window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  renderLists();
  input.focus();
  UI.onDataChange(refresh);
  setInterval(renderLists, 60000);
})();
