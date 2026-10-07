(() => {
  const user = Auth.require(['admin']);
  UI.renderHeader(user);
  const app = UI.$('#app');

  function render() {
    const s = DB.getSettings();
    app.innerHTML = `
      <div class="page-head"><div><h1>Настройки</h1><p>Параметры очереди, лимитов и санкций.</p></div></div>
      <form class="card" id="setForm" novalidate>
        <div class="grid-3">
          <div>
            <h2>Очередь</h2>
            <div class="field"><label>Машин на пост в день</label><input name="trucksPerPostPerDay" type="number" min="1" value="${s.trucksPerPostPerDay}">
              <div class="hint">Постов — 2, оба наливают любой продукт. Бронь на день, внутри дня — живая очередь.</div></div>
            <div class="field-row">
              <div class="field"><label>Начало дня</label><input name="workdayStart" type="time" value="${s.workdayStart}"></div>
              <div class="field"><label>Окончание дня</label><input name="workdayEnd" type="time" value="${s.workdayEnd}"></div>
            </div>
          </div>
          <div>
            <h2>Лимиты</h2>
            <div class="field"><label>Лимит на доверенное лицо в сутки, т</label><input name="dailyLimitPerTrustee" type="number" min="1" step="0.1" value="${s.dailyLimitPerTrustee}">
              <div class="hint">Суммарный объём броней одной организации на одну дату.</div></div>
          </div>
          <div>
            <h2>Санкции за неявки</h2>
            <div class="field-row">
              <div class="field"><label>Неявок (порог)</label><input name="noShowLimit" type="number" min="1" value="${s.noShowLimit}"></div>
              <div class="field"><label>За период, дней</label><input name="noShowPeriodDays" type="number" min="1" value="${s.noShowPeriodDays}"></div>
            </div>
            <div class="field"><label>Блокировка бронирования, дней</label><input name="banDays" type="number" min="1" value="${s.banDays}">
              <div class="hint">Считается от даты последней неявки. Администратор может снять санкции досрочно.</div></div>
          </div>
        </div>
        <div class="form-error" id="err" hidden></div>
        <button class="btn btn-primary" type="submit">Сохранить настройки</button>
      </form>
      <div class="card">
        <h2>Демонстрационные данные</h2>
        <p class="muted">Вернуть систему к исходному демо-набору: пользователи, продукты, партии, машины, история броней за 20 дней. Все изменения будут потеряны.</p>
        <button class="btn btn-danger" id="resetBtn">Сбросить демо-данные</button>
      </div>`;

    UI.$('#setForm').onsubmit = (e) => {
      e.preventDefault();
      try { DB.updateSettings(UI.formData(e.target), user.id); UI.toast('Настройки сохранены'); UI.$('#err').hidden = true; }
      catch (ex) { UI.$('#err').textContent = ex.message; UI.$('#err').hidden = false; }
    };
    UI.$('#resetBtn').onclick = () => UI.confirm('Сбросить все данные к демонстрационным? Текущие изменения будут потеряны.', () => {
      DB.resetDemo(); Auth.logout();
    }, { yes: 'Сбросить', danger: true });
  }
  render();
})();
