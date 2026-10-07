(() => {
  const user = Auth.require(['admin']);
  UI.renderHeader(user);
  const { esc } = UI;
  const app = UI.$('#app');
  const today = DB.todayStr();

  app.innerHTML = `
    <div class="page-head"><div><h1>Аналитика</h1><p>Показатели считаются по дате брони.</p></div></div>
    <div class="card">
      <div class="filters" style="margin:0">
        <div><label>Период</label><select id="fPeriod"><option value="today">Сегодня</option><option value="week" selected>Неделя</option><option value="month">Месяц</option><option value="custom">Произвольный</option></select></div>
        <div class="custom"><label>С</label><input type="date" id="fFrom"></div>
        <div class="custom"><label>По</label><input type="date" id="fTo"></div>
      </div>
    </div>
    <div class="kpis" id="kpis"></div>
    <div class="grid-2">
      <div class="card"><h2>Въезды по дням</h2><div class="chart" id="chDays"></div></div>
      <div class="card"><h2>Отгрузка по продуктам, т</h2><div id="chProducts"></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h2>Загрузка по часам суток (въезды)</h2><div class="chart" id="chHours"></div></div>
      <div class="card"><h2>Загрузка постов</h2><div id="posts"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Рейтинг доверенных лиц</h2><button class="btn btn-ghost btn-sm" id="csvRating">CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Организация</th><th>Доверенное лицо</th><th class="num">Броней</th><th class="num">Отгружено</th><th class="num">Неявок</th><th class="num">% неявок</th><th>Санкции</th></tr></thead><tbody id="rating"></tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Журнал событий</h2><button class="btn btn-ghost btn-sm" id="csvEvents">CSV</button></div>
      <div class="filters">
        <div><label>Пользователь</label><select id="eUser"></select></div>
        <div class="grow"><label>Машина (госномер)</label><input id="ePlate"></div>
        <div><label>Новый статус брони</label><select id="eStatus">${UI.options(Object.entries(DB.BOOKING_STATUS), '', 'Все')}</select></div>
      </div>
      <div class="table-wrap" style="max-height:480px;overflow:auto"><table><thead><tr><th>Время</th><th>Пользователь</th><th>Объект</th><th>Событие</th></tr></thead><tbody id="events"></tbody></table></div>
      <p class="hint" id="eventsHint"></p>
    </div>`;

  const users = DB.listUsers();
  UI.$('#eUser').innerHTML = UI.options([['system', 'Система'], ...users.map((u) => [u.id, `${u.fullName} (${DB.ROLES[u.role]})`])], '', 'Все');

  const period = () => {
    const p = UI.$('#fPeriod').value;
    UI.$$('.custom').forEach((el) => { el.style.display = p === 'custom' ? '' : 'none'; });
    if (p === 'today') return [today, today];
    if (p === 'week') return [DB.addDays(today, -6), today];
    if (p === 'month') return [DB.addDays(today, -29), today];
    return [UI.$('#fFrom').value || today, UI.$('#fTo').value || today];
  };
  UI.$('#fFrom').value = DB.addDays(today, -13); UI.$('#fTo').value = today;

  /* ------------ мини-библиотека графиков (SVG, без зависимостей) ------------ */
  function vbars(el, items, fmt = (v) => UI.num(v)) {
    const W = 640, H = 220, L = 34, B = 26, T = 14;
    const max = Math.max(1, ...items.map((i) => i.value));
    const nice = Math.ceil(max / 4) * 4 || 4;
    const bw = (W - L) / Math.max(items.length, 1);
    const y = (v) => T + (H - T - B) * (1 - v / nice);
    const ticks = [0, 1, 2, 3, 4].map((i) => (nice / 4) * i);
    const every = Math.ceil(items.length / 14);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">
      <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${UI.num(t, 0)}</text>`).join('')}</g>
      ${items.map((it, i) => {
        const x = L + i * bw, w = Math.max(2, Math.min(36, bw - 4)), cx = x + bw / 2, h = H - B - y(it.value);
        return `<g data-tip="${esc(it.tip || `${it.label}: ${fmt(it.value)}`)}" data-x="${cx}" data-y="${y(it.value)}">
          <rect x="${x}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>
          ${it.value ? `<path class="bar" d="M${cx - w / 2},${H - B} v${-(h - Math.min(4, h))} q0,-${Math.min(4, h)} ${Math.min(4, w / 2)},-${Math.min(4, h)} h${w - 2 * Math.min(4, w / 2)} q${Math.min(4, w / 2)},0 ${Math.min(4, w / 2)},${Math.min(4, h)} V${H - B} z"/>` : ''}
          ${items.length <= 16 && it.value ? `<text class="val" x="${cx}" y="${y(it.value) - 4}" text-anchor="middle">${fmt(it.value)}</text>` : ''}
          ${i % every === 0 ? `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>` : ''}
        </g>`;
      }).join('')}
      <line x1="${L}" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="#c5ced8"/>
    </svg><div class="chart-tip"></div>`;
    const tip = UI.$('.chart-tip', el), svg = UI.$('svg', el);
    svg.onmousemove = (e) => {
      const g = e.target.closest('g[data-tip]'); if (!g) { tip.style.display = 'none'; return; }
      const k = svg.getBoundingClientRect().width / W;
      tip.textContent = g.dataset.tip; tip.style.display = 'block';
      tip.style.left = `${g.dataset.x * k}px`; tip.style.top = `${g.dataset.y * k}px`;
    };
    svg.onmouseleave = () => { tip.style.display = 'none'; };
  }

  function hbars(el, items) {
    const max = Math.max(1, ...items.map((i) => i.value));
    el.innerHTML = items.length ? items.map((i) => `
      <div style="display:grid;grid-template-columns:130px 1fr 80px;gap:10px;align-items:center;margin:9px 0" title="${esc(i.label)}: ${UI.tons(i.value)}">
        <span>${esc(i.label)}</span>
        <div style="background:#edf0f4;border-radius:4px;height:22px"><div style="width:${(i.value / max) * 100}%;height:100%;background:var(--chart);border-radius:0 4px 4px 0"></div></div>
        <b style="text-align:right;font-variant-numeric:tabular-nums">${UI.num(i.value)}</b>
      </div>`).join('') : '<p class="muted">Нет отгрузок за период</p>';
  }

  /* ------------------------------ расчёт ------------------------------ */
  let ratingRows = [], eventRows = [];

  function render() {
    const [from, to] = period();
    const s = DB.getSettings();
    const list = DB.listBookings({ from, to });
    const entered = list.filter((b) => ['entered', 'exited'].includes(b.status));
    const exited = list.filter((b) => b.status === 'exited');
    const noShow = list.filter((b) => b.status === 'no_show');
    const decided = entered.length + noShow.length;
    const shippedTotal = exited.reduce((a, b) => a + b.volume, 0);
    const stay = exited.filter((b) => b.enteredAt && b.exitedAt).map((b) => (new Date(b.exitedAt) - new Date(b.enteredAt)) / 60000);
    const avgStay = stay.length ? stay.reduce((a, b) => a + b, 0) / stay.length : NaN;
    const days = Math.round((DB.parseDate(to) - DB.parseDate(from)) / 86400000) + 1;
    const capacity = days * s.trucksPerPostPerDay;
    const postStat = [1, 2].map((p) => {
      const occ = list.filter((b) => b.post === p && ['booked', 'entered', 'exited', 'no_show'].includes(b.status)).length;
      return { p, cars: entered.filter((b) => b.post === p).length, occ, pct: capacity ? (occ / capacity) * 100 : 0 };
    });

    const byProduct = {};
    exited.forEach((b) => { byProduct[b.product.name] = (byProduct[b.product.name] || 0) + b.volume; });

    UI.$('#kpis').innerHTML = [
      ['Въездов', entered.length, `${UI.date(from)} — ${UI.date(to)}`],
      ['Отгружено', UI.tons(shippedTotal), `${exited.length} машин выехало`],
      ['Неявок', noShow.length, decided ? `${UI.num((noShow.length / decided) * 100)}% от явившихся и неявок` : '—'],
      ['Среднее время на территории', UI.duration(avgStay), 'Въехала → Выехала'],
      ['Пост 1', `${postStat[0].cars} маш.`, `занято ${UI.num(postStat[0].pct, 0)}% мест`],
      ['Пост 2', `${postStat[1].cars} маш.`, `занято ${UI.num(postStat[1].pct, 0)}% мест`],
      ...Object.entries(byProduct).sort((a, b) => b[1] - a[1]).map(([n, v]) => [`Отгружено: ${n}`, UI.tons(v), '']),
    ].map(([l, v, sub]) => `<div class="kpi"><div class="k-label">${esc(l)}</div><div class="k-value">${v}</div><div class="k-sub">${sub}</div></div>`).join('');

    // Въезды по дням
    const dayItems = [];
    for (let d = from; d <= to; d = DB.addDays(d, 1)) {
      const n = entered.filter((b) => b.date === d).length;
      dayItems.push({ label: UI.date(d).slice(0, 5), value: n, tip: `${UI.date(d)}: ${n} въезд.` });
      if (dayItems.length > 400) break;
    }
    vbars(UI.$('#chDays'), dayItems);
    hbars(UI.$('#chProducts'), Object.entries(byProduct).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })));

    // По часам
    const h0 = parseInt(s.workdayStart, 10), h1 = parseInt(s.workdayEnd, 10);
    const hours = [];
    for (let h = Math.min(h0, 6); h <= Math.max(h1, 21); h++) {
      const n = entered.filter((b) => b.enteredAt && new Date(b.enteredAt).getHours() === h).length;
      hours.push({ label: String(h).padStart(2, '0'), value: n, tip: `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00: ${n} въезд.` });
    }
    vbars(UI.$('#chHours'), hours);

    UI.$('#posts').innerHTML = postStat.map((x) => `
      <div style="margin:12px 0 18px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px"><b><span class="post-badge">${x.p}</span> Пост ${x.p}</b>
          <span>${x.cars} въездов · занято ${x.occ} из ${capacity} мест (<b>${UI.num(x.pct, 0)}%</b>)</span></div>
        <div class="progress" style="height:14px"><i style="width:${Math.min(100, x.pct)}%"></i></div>
      </div>`).join('') + `<p class="hint">Вместимость: ${s.trucksPerPostPerDay} машин на пост в день × ${days} дн. Занятое место — бронь, кроме отменённых.</p>`;

    // Рейтинг
    ratingRows = users.filter((u) => u.role === 'trustee').map((u) => {
      const mine = list.filter((b) => b.trusteeId === u.id && b.status !== 'cancelled');
      const ns = mine.filter((b) => b.status === 'no_show').length;
      const dec = mine.filter((b) => ['entered', 'exited', 'no_show'].includes(b.status)).length;
      return { u, count: mine.length, shipped: mine.filter((b) => b.status === 'exited').reduce((a, b) => a + b.volume, 0), ns, pct: dec ? (ns / dec) * 100 : 0, sanc: DB.sanctionInfo(u.id) };
    }).sort((a, b) => b.shipped - a.shipped);
    UI.$('#rating').innerHTML = ratingRows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.u.organization)}</b></td><td>${esc(r.u.fullName)}</td>
      <td class="num">${r.count}</td><td class="num">${UI.tons(r.shipped)}</td><td class="num">${r.ns}</td>
      <td class="num">${r.pct >= 20 ? `<span class="badge b-err">${UI.num(r.pct)}%</span>` : UI.num(r.pct) + '%'}</td>
      <td>${r.sanc.banned ? `<span class="badge b-err">до ${UI.date(r.sanc.until)}</span>` : '—'}</td></tr>`).join('') || UI.empty('Нет данных', 8);

    renderEvents(from, to);
  }

  function describe(e) {
    const st = (x) => DB.BOOKING_STATUS[x] || x;
    if (e.entity === 'booking') {
      const b = DB.getBooking(e.entityId);
      const obj = b ? `Бронь ${b.truck.plate}, ${UI.date(b.date)}, ${b.product.name}` : `Бронь ${e.entityId}`;
      if (e.action === 'post') return [obj, `Пост ${e.oldValue} → ${e.newValue}`];
      return [obj, e.oldValue ? `${st(e.oldValue)} → ${st(e.newValue)}` : `Создана (${st(e.newValue)})`];
    }
    const A = { create: 'Создание', update: 'Изменение', block: 'Блокировка', unblock: 'Разблокировка', reset_password: 'Сброс пароля', sanction_cleared: 'Снятие санкций', activate: 'Активация', deactivate: 'Деактивация', quantity: 'Изменение количества', status: 'Смена статуса' };
    const E = { user: 'Пользователь', truck: 'Машина', batch: 'Партия', product: 'Продукт', settings: 'Настройки' };
    let obj = E[e.entity] || e.entity;
    if (e.entity === 'user') { const u = DB.getUser(e.entityId); obj += ` ${u ? u.login : e.entityId}`; }
    if (e.entity === 'truck') { const t = DB.getTruck(e.entityId); obj += ` ${t ? t.plate : ''}`; }
    if (e.entity === 'batch') { const b = DB.getBatch(e.entityId); obj += b ? ` ${b.product.name}` : ''; }
    let act = A[e.action] || e.action;
    if (e.action === 'quantity') act += `: ${e.oldValue} → ${e.newValue} т`;
    else if (e.action === 'status' && e.entity === 'batch') act += `: ${e.oldValue === 'open' ? 'открыта' : 'закрыта'} → ${e.newValue === 'open' ? 'открыта' : 'закрыта'}`;
    else if (e.newValue && e.entity !== 'settings') act += ` (${e.newValue})`;
    return [obj, act];
  }

  function renderEvents(from, to) {
    const uid = UI.$('#eUser').value, plate = DB.normalizePlate(UI.$('#ePlate').value), status = UI.$('#eStatus').value;
    const umap = Object.fromEntries(users.map((u) => [u.id, u]));
    const toEnd = DB.addDays(to, 1);
    eventRows = DB.listEvents().filter((e) => {
      const d = UI.dateTime(e.timestamp).slice(0, 10).split('.').reverse().join('-');
      if (d < from || d >= toEnd) return false;
      if (uid && e.userId !== uid) return false;
      if (status && !(e.entity === 'booking' && e.newValue === status)) return false;
      if (plate) {
        if (e.entity === 'booking') { const b = DB.getBooking(e.entityId); if (!b || !b.truck.plateNormalized.includes(plate)) return false; }
        else if (e.entity === 'truck') { const t = DB.getTruck(e.entityId); if (!t || !t.plateNormalized.includes(plate)) return false; }
        else return false;
      }
      return true;
    }).map((e) => { const [obj, act] = describe(e); return { e, who: e.userId === 'system' ? 'Система' : (umap[e.userId] || {}).fullName || e.userId, obj, act }; });
    UI.$('#events').innerHTML = eventRows.length ? eventRows.slice(0, 300).map((r) => `<tr><td class="muted" style="white-space:nowrap">${UI.dateTime(r.e.timestamp)}</td><td>${esc(r.who)}</td><td>${esc(r.obj)}</td><td>${esc(r.act)}</td></tr>`).join('') : UI.empty('Событий нет', 4);
    UI.$('#eventsHint').textContent = eventRows.length > 300 ? `Показаны 300 из ${eventRows.length}. Полный список — в CSV.` : `Событий: ${eventRows.length}`;
  }

  UI.$('#csvRating').onclick = () => UI.downloadCsv(`reiting_${today}.csv`, ['Организация', 'Доверенное лицо', 'Броней', 'Отгружено, т', 'Неявок', '% неявок'],
    ratingRows.map((r) => [r.u.organization, r.u.fullName, r.count, UI.num(r.shipped), r.ns, UI.num(r.pct)]));
  UI.$('#csvEvents').onclick = () => UI.downloadCsv(`zhurnal_${today}.csv`, ['Время', 'Пользователь', 'Объект', 'Событие'], eventRows.map((r) => [UI.dateTime(r.e.timestamp), r.who, r.obj, r.act]));

  ['#fPeriod', '#fFrom', '#fTo'].forEach((s) => { UI.$(s).onchange = render; });
  ['#eUser', '#ePlate', '#eStatus'].forEach((s) => { UI.$(s).oninput = () => renderEvents(...period()); });
  render();
  UI.onDataChange(render);
})();
