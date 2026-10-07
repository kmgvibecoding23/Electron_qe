/* =========================================================================
   storage.js — единственная точка доступа к данным.
   В MVP данные лежат в localStorage. Для перехода на сервер достаточно
   заменить реализацию функций этого модуля на HTTP-запросы к API —
   сигнатуры и бизнес-правила (проверки) остаются теми же.
   ========================================================================= */
const DB = (() => {
  const KEY = 'eq_db_v2';

  const ROLES = { admin: 'Администратор', guard: 'Охранник', trustee: 'Доверенное лицо', lab: 'Товарная лаборатория' };
  const BOOKING_STATUS = {
    booked: 'Забронирована', entered: 'Въехала', exited: 'Выехала', cancelled: 'Отменена', no_show: 'Неявка',
  };
  const ACTIVE = ['booked', 'entered'];               // «Забронировано» в партии
  const OCCUPYING = ['booked', 'entered', 'exited'];   // занимают место в дне и лимит
  const DEFAULT_SETTINGS = {
    trucksPerPostPerDay: 15,   // вместимость поста за день (живая очередь)
    workdayStart: '08:00',
    workdayEnd: '20:00',
    dailyLimitPerTrustee: 100, // т в сутки на одно доверенное лицо
    noShowLimit: 3,            // санкция: N неявок…
    noShowPeriodDays: 30,      // …за период (дней)…
    banDays: 7,                // …блокируют бронирование на K дней
  };

  let data = null;

  /* ---------------------------- утилиты ---------------------------- */
  const pad = (n) => String(n).padStart(2, '0');
  function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayStr() { return dateStr(new Date()); }
  function addDays(str, n) { const d = parseDate(str); d.setDate(d.getDate() + n); return dateStr(d); }
  function parseDate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }
  const nowIso = () => new Date().toISOString();

  // Латиница, совпадающая по начертанию с кириллицей, приводится к кириллице (FR-6.2)
  const LAT2CYR = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  function normalizePlate(s) {
    return String(s || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/[ABEKMHOPCTYX]/g, (ch) => LAT2CYR[ch]);
  }

  // Демо-хэш (cyrb53). В серверной версии — bcrypt/argon2 (см. PRD 7.4).
  function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  function hashPassword(pass, salt = Math.random().toString(36).slice(2, 10)) { return `${salt}$${cyrb53(salt + ':' + pass)}`; }
  function checkPassword(pass, stored) { const [salt] = String(stored).split('$'); return hashPassword(pass, salt) === stored; }

  function fail(msg) { throw new Error(msg); }
  const round = (n) => Math.round(n * 1000) / 1000;

  /* --------------------------- хранилище --------------------------- */
  function load() {
    if (data) return;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { data = null; }
    if (!data || !data.users) { data = seed(); save(); }
    data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(data)); }
  function reload() { data = null; load(); }
  function nextId(prefix) { data.seq = (data.seq || 0) + 1; return `${prefix}${data.seq}`; }

  function logEvent(entity, entityId, action, oldValue, newValue, userId) {
    data.events.push({ id: nextId('e'), entity, entityId, action, oldValue: oldValue ?? null, newValue: newValue ?? null, userId: userId || 'system', timestamp: nowIso() });
  }

  /* ------------------------------ users ----------------------------- */
  const publicUser = (u) => u && Object.assign({}, u, { passwordHash: undefined });
  function listUsers() { load(); return data.users.map(publicUser); }
  function getUser(id) { load(); return publicUser(data.users.find((u) => u.id === id)); }

  function authenticate(login, password) {
    load();
    const u = data.users.find((x) => x.login.toLowerCase() === String(login).trim().toLowerCase());
    if (!u || !checkPassword(password, u.passwordHash)) fail('Неверный логин или пароль');
    if (u.isBlocked) fail('Учётная запись заблокирована. Обратитесь к администратору');
    return publicUser(u);
  }

  function validateUser(f, id) {
    if (!f.login || !/^[a-zA-Z0-9_.-]{3,}$/.test(f.login)) fail('Логин: минимум 3 символа, латиница, цифры, «_», «.», «-»');
    if (data.users.some((u) => u.id !== id && u.login.toLowerCase() === f.login.toLowerCase())) fail('Такой логин уже существует');
    if (!f.fullName || !f.fullName.trim()) fail('Укажите ФИО');
    if (!ROLES[f.role]) fail('Укажите роль');
    if (f.role === 'trustee') {
      if (!f.organization || !f.organization.trim()) fail('Для доверенного лица организация обязательна');
      const org = f.organization.trim().toLowerCase();
      const other = data.users.find((u) => u.id !== id && u.role === 'trustee' && (u.organization || '').trim().toLowerCase() === org);
      if (other) fail(`У организации уже есть доверенное лицо: ${other.fullName}. Одна организация — одно доверенное лицо`);
    }
  }
  function createUser(f, actorId) {
    load(); validateUser(f, null);
    if (!f.password || f.password.length < 4) fail('Пароль: минимум 4 символа');
    const u = {
      id: nextId('u'), login: f.login.trim(), passwordHash: hashPassword(f.password), fullName: f.fullName.trim(),
      phone: f.phone || '', role: f.role, organization: (f.organization || '').trim(), isBlocked: false,
      sanctionClearedAt: null, createdAt: nowIso(),
    };
    data.users.push(u); logEvent('user', u.id, 'create', null, u.login, actorId); save();
    return publicUser(u);
  }
  function updateUser(id, f, actorId) {
    load(); const u = data.users.find((x) => x.id === id) || fail('Пользователь не найден');
    const merged = Object.assign({}, u, f); validateUser(merged, id);
    if (u.role !== merged.role && data.trucks.some((t) => t.ownerId === id)) fail('Нельзя сменить роль: у пользователя есть машины');
    Object.assign(u, { login: merged.login.trim(), fullName: merged.fullName.trim(), phone: merged.phone || '', role: merged.role, organization: (merged.organization || '').trim() });
    logEvent('user', id, 'update', null, u.login, actorId); save();
  }
  function setBlocked(id, blocked, actorId) {
    load(); const u = data.users.find((x) => x.id === id) || fail('Пользователь не найден');
    if (id === actorId && blocked) fail('Нельзя заблокировать самого себя');
    u.isBlocked = !!blocked; logEvent('user', id, blocked ? 'block' : 'unblock', null, null, actorId); save();
  }
  function resetPassword(id, password, actorId) {
    load(); const u = data.users.find((x) => x.id === id) || fail('Пользователь не найден');
    if (!password || password.length < 4) fail('Пароль: минимум 4 символа');
    u.passwordHash = hashPassword(password); logEvent('user', id, 'reset_password', null, null, actorId); save();
  }
  function deleteUser(id, actorId) {
    load();
    if (id === actorId) fail('Нельзя удалить самого себя');
    const linked = data.bookings.some((b) => [b.trusteeId, b.enteredBy, b.exitedBy].includes(id))
      || data.events.some((e) => e.userId === id) || data.trucks.some((t) => t.ownerId === id)
      || data.batches.some((b) => b.createdBy === id);
    if (linked) fail('С пользователем связаны брони или записи журнала — удаление невозможно, используйте блокировку');
    data.users = data.users.filter((u) => u.id !== id); save();
  }
  function clearSanction(id, actorId) {
    load(); const u = data.users.find((x) => x.id === id) || fail('Пользователь не найден');
    u.sanctionClearedAt = nowIso(); logEvent('user', id, 'sanction_cleared', null, null, actorId); save();
  }

  /* --------------------------- санкции ----------------------------- */
  function sanctionInfo(trusteeId) {
    load(); const s = data.settings; const u = data.users.find((x) => x.id === trusteeId);
    const from = addDays(todayStr(), -s.noShowPeriodDays);
    const cleared = u && u.sanctionClearedAt ? dateStr(new Date(u.sanctionClearedAt)) : null;
    const list = data.bookings.filter((b) => b.trusteeId === trusteeId && b.status === 'no_show' && b.date >= from && (!cleared || b.date >= cleared))
      .sort((a, b) => a.date.localeCompare(b.date));
    const count = list.length;
    let banned = false, until = null;
    if (count >= s.noShowLimit) {
      until = addDays(list[list.length - 1].date, s.banDays + 1); // включительно banDays дней после неявки
      banned = todayStr() < until;
    }
    return { count, limit: s.noShowLimit, banned, until: banned ? addDays(until, -1) : null };
  }

  /* ---------------------------- products ---------------------------- */
  function listProducts() { load(); return data.products.slice(); }
  function getProduct(id) { load(); return data.products.find((p) => p.id === id); }
  function saveProduct(f, actorId) {
    load();
    if (!f.name || !f.name.trim()) fail('Укажите наименование');
    const name = f.name.trim();
    if (data.products.some((p) => p.id !== f.id && p.name.toLowerCase() === name.toLowerCase())) fail('Такой продукт уже есть');
    if (f.id) {
      const p = data.products.find((x) => x.id === f.id) || fail('Продукт не найден');
      Object.assign(p, { name, isActive: !!f.isActive }); logEvent('product', p.id, 'update', null, name, actorId);
    } else {
      const p = { id: nextId('p'), name, unit: 'т', isActive: f.isActive !== false };
      data.products.push(p); logEvent('product', p.id, 'create', null, name, actorId);
    }
    save();
  }

  /* ---------------------------- settings ---------------------------- */
  function getSettings() { load(); return Object.assign({}, data.settings); }
  function updateSettings(f, actorId) {
    load();
    const n = {
      trucksPerPostPerDay: parseInt(f.trucksPerPostPerDay, 10), workdayStart: f.workdayStart, workdayEnd: f.workdayEnd,
      dailyLimitPerTrustee: parseFloat(f.dailyLimitPerTrustee), noShowLimit: parseInt(f.noShowLimit, 10),
      noShowPeriodDays: parseInt(f.noShowPeriodDays, 10), banDays: parseInt(f.banDays, 10),
    };
    if (!(n.trucksPerPostPerDay >= 1)) fail('Вместимость поста — не меньше 1 машины');
    if (!n.workdayStart || !n.workdayEnd || n.workdayStart >= n.workdayEnd) fail('Начало рабочего дня должно быть раньше окончания');
    if (!(n.dailyLimitPerTrustee > 0)) fail('Лимит должен быть больше 0');
    if (!(n.noShowLimit >= 1) || !(n.noShowPeriodDays >= 1) || !(n.banDays >= 1)) fail('Параметры санкций — целые числа ≥ 1');
    data.settings = n; logEvent('settings', 'settings', 'update', null, JSON.stringify(n), actorId); save();
  }

  /* ----------------------------- batches ---------------------------- */
  function batchStats(batch) {
    let reserved = 0, shipped = 0;
    data.bookings.forEach((b) => {
      if (b.batchId !== batch.id) return;
      if (ACTIVE.includes(b.status)) reserved += b.volume;
      else if (b.status === 'exited') shipped += b.volume;
    });
    reserved = round(reserved); shipped = round(shipped);
    return { reserved, shipped, free: round(batch.quantity - reserved - shipped) };
  }
  const withStats = (b) => Object.assign({}, b, batchStats(b), { product: getProduct(b.productId) });
  function listBatches() { load(); return data.batches.map(withStats); }
  function getBatch(id) { load(); const b = data.batches.find((x) => x.id === id); return b && withStats(b); }
  function listAvailableBatches() {
    return listBatches().filter((b) => b.status === 'open' && b.free > 0).sort((a, b) => a.availableFrom.localeCompare(b.availableFrom));
  }
  function createBatch(f, actorId) {
    load();
    const p = getProduct(f.productId) || fail('Выберите продукт');
    if (!p.isActive) fail('Продукт неактивен — его нельзя выбрать в новой партии');
    const q = parseFloat(f.quantity); if (!(q > 0)) fail('Количество должно быть больше 0');
    if (!f.availableFrom) fail('Укажите дату начала выдачи');
    const b = {
      id: nextId('b'), productId: p.id, quantity: round(q), unit: 'т', availableFrom: f.availableFrom,
      qualityPassport: (f.qualityPassport || '').trim(), comment: (f.comment || '').trim(),
      status: 'open', createdBy: actorId, createdAt: nowIso(),
    };
    data.batches.push(b); logEvent('batch', b.id, 'create', null, `${p.name} ${b.quantity} т`, actorId); save();
    return b;
  }
  function updateBatch(id, f, actorId) {
    load(); const b = data.batches.find((x) => x.id === id) || fail('Партия не найдена');
    const q = parseFloat(f.quantity); if (!(q > 0)) fail('Количество должно быть больше 0');
    const st = batchStats(b);
    if (q < st.reserved + st.shipped) fail(`Нельзя уменьшить количество ниже забронированного + отгруженного (${round(st.reserved + st.shipped)} т)`);
    if (!f.availableFrom) fail('Укажите дату начала выдачи');
    const old = b.quantity;
    Object.assign(b, { quantity: round(q), availableFrom: f.availableFrom, qualityPassport: (f.qualityPassport || '').trim(), comment: (f.comment || '').trim() });
    logEvent('batch', id, 'quantity', old, b.quantity, actorId); save();
  }
  function setBatchStatus(id, status, actorId) {
    load(); const b = data.batches.find((x) => x.id === id) || fail('Партия не найдена');
    const old = b.status; b.status = status === 'closed' ? 'closed' : 'open';
    logEvent('batch', id, 'status', old, b.status, actorId); save();
  }

  /* ------------------------------ trucks ---------------------------- */
  function listTrucks(ownerId) { load(); return data.trucks.filter((t) => !ownerId || t.ownerId === ownerId).map((t) => Object.assign({}, t)); }
  function getTruck(id) { load(); const t = data.trucks.find((x) => x.id === id); return t && Object.assign({}, t); }
  function saveTruck(f, actor) {
    load();
    const plateN = normalizePlate(f.plate);
    if (plateN.length < 4) fail('Укажите госномер тягача');
    if (data.trucks.some((t) => t.id !== f.id && t.plateNormalized === plateN)) fail('Машина с таким госномером уже зарегистрирована');
    const tank = parseFloat(f.tankVolume); if (!(tank > 0)) fail('Укажите вместимость цистерны (т)');
    if (!f.driverName || !f.driverName.trim()) fail('Укажите ФИО водителя');
    const ownerId = actor.role === 'admin' ? f.ownerId : actor.id;
    const owner = data.users.find((u) => u.id === ownerId && u.role === 'trustee') || fail('Укажите владельца — доверенное лицо');
    const fields = {
      ownerId: owner.id, plate: String(f.plate).trim().toUpperCase(), plateNormalized: plateN,
      trailerPlate: (f.trailerPlate || '').trim().toUpperCase(), trailerNormalized: normalizePlate(f.trailerPlate),
      model: (f.model || '').trim(), tankVolume: round(tank), driverName: f.driverName.trim(), driverPhone: (f.driverPhone || '').trim(),
    };
    if (f.id) {
      const t = data.trucks.find((x) => x.id === f.id) || fail('Машина не найдена');
      if (actor.role !== 'admin' && t.ownerId !== actor.id) fail('Нет доступа к этой машине');
      Object.assign(t, fields); logEvent('truck', t.id, 'update', null, t.plate, actor.id);
    } else {
      const t = Object.assign({ id: nextId('t'), isActive: true }, fields);
      data.trucks.push(t); logEvent('truck', t.id, 'create', null, t.plate, actor.id);
    }
    save();
  }
  function setTruckActive(id, active, actor) {
    load(); const t = data.trucks.find((x) => x.id === id) || fail('Машина не найдена');
    if (actor.role !== 'admin' && t.ownerId !== actor.id) fail('Нет доступа к этой машине');
    if (!active && data.bookings.some((b) => b.truckId === id && ACTIVE.includes(b.status))) fail('У машины есть активная бронь — деактивация невозможна');
    t.isActive = !!active; logEvent('truck', id, active ? 'activate' : 'deactivate', null, t.plate, actor.id); save();
  }
  function findTrucksByPlate(q) {
    load(); const n = normalizePlate(q); if (!n) return [];
    return data.trucks.filter((t) => t.plateNormalized === n || (t.trailerNormalized && t.trailerNormalized === n));
  }

  /* ----------------------------- bookings --------------------------- */
  function enrich(b) {
    const truck = data.trucks.find((t) => t.id === b.truckId) || {};
    const batch = data.batches.find((x) => x.id === b.batchId) || {};
    const product = data.products.find((p) => p.id === batch.productId) || {};
    const trustee = data.users.find((u) => u.id === b.trusteeId) || {};
    return Object.assign({}, b, { truck, batch, product, trustee });
  }
  function listBookings(filter = {}) {
    load();
    return data.bookings.filter((b) => {
      if (filter.trusteeId && b.trusteeId !== filter.trusteeId) return false;
      if (filter.date && b.date !== filter.date) return false;
      if (filter.from && b.date < filter.from) return false;
      if (filter.to && b.date > filter.to) return false;
      if (filter.status && (Array.isArray(filter.status) ? !filter.status.includes(b.status) : b.status !== filter.status)) return false;
      if (filter.truckId && b.truckId !== filter.truckId) return false;
      if (filter.batchId && b.batchId !== filter.batchId) return false;
      return true;
    }).map(enrich);
  }
  function getBooking(id) { load(); const b = data.bookings.find((x) => x.id === id); return b && enrich(b); }

  function dayLoad(date, excludeId) {
    const cnt = { 1: 0, 2: 0 };
    data.bookings.forEach((b) => { if (b.date === date && b.id !== excludeId && OCCUPYING.includes(b.status)) cnt[b.post]++; });
    return cnt;
  }
  function dayAvailability(date) {
    load(); const cap = data.settings.trucksPerPostPerDay; const c = dayLoad(date);
    return { post1: c[1], post2: c[2], capacity: cap, free: Math.max(0, cap - c[1]) + Math.max(0, cap - c[2]) };
  }
  function trusteeDayVolume(trusteeId, date, excludeId) {
    return round(data.bookings.filter((b) => b.trusteeId === trusteeId && b.date === date && b.id !== excludeId && OCCUPYING.includes(b.status))
      .reduce((s, b) => s + b.volume, 0));
  }
  function trusteeLimitInfo(trusteeId, date) {
    load(); const used = trusteeDayVolume(trusteeId, date);
    return { limit: data.settings.dailyLimitPerTrustee, used, left: round(Math.max(0, data.settings.dailyLimitPerTrustee - used)) };
  }

  function createBooking(f, actor) {
    load();
    const batchRaw = data.batches.find((x) => x.id === f.batchId) || fail('Выберите партию продукта');
    const batch = withStats(batchRaw);
    if (batch.status !== 'open') fail('Партия закрыта — бронирование невозможно');
    const truck = data.trucks.find((t) => t.id === f.truckId) || fail('Выберите машину');
    if (!truck.isActive) fail('Машина деактивирована');
    if (actor.role !== 'admin' && truck.ownerId !== actor.id) fail('Можно бронировать только свои машины');
    const trusteeId = truck.ownerId;
    const volume = round(parseFloat(f.volume));
    if (!(volume > 0)) fail('Укажите объём брони');
    const date = f.date || fail('Укажите дату приезда');
    if (date < todayStr()) fail('Дата приезда не может быть в прошлом');
    if (date < batch.availableFrom) fail(`Продукт можно получить не раньше ${fmt(batch.availableFrom)}`);
    if (volume > batch.free) fail(`Объём ${volume} т превышает свободный остаток партии (${batch.free} т)`);
    if (volume > truck.tankVolume) fail(`Объём ${volume} т превышает вместимость цистерны машины (${truck.tankVolume} т)`);
    if (data.bookings.some((b) => b.truckId === truck.id && b.date === date && ACTIVE.includes(b.status))) fail('У этой машины уже есть активная бронь на эту дату');
    const sanc = sanctionInfo(trusteeId);
    if (sanc.banned) fail(`Бронирование заблокировано за неявки (${sanc.count} за ${data.settings.noShowPeriodDays} дн.) до ${fmt(sanc.until)} включительно`);
    const lim = data.settings.dailyLimitPerTrustee; const used = trusteeDayVolume(trusteeId, date);
    if (used + volume > lim) fail(`Превышен суточный лимит ${lim} т на доверенное лицо: уже забронировано ${used} т на ${fmt(date)}, доступно ${round(lim - used)} т`);
    const c = dayLoad(date); const cap = data.settings.trucksPerPostPerDay;
    let post = c[1] <= c[2] ? 1 : 2;
    if (c[post] >= cap) post = post === 1 ? 2 : 1;
    if (c[post] >= cap) fail(`На ${fmt(date)} оба поста заполнены (${cap} машин на пост). Выберите другую дату`);
    const b = {
      id: nextId('k'), batchId: batch.id, truckId: truck.id, trusteeId, volume, date, post, status: 'booked',
      enteredAt: null, enteredBy: null, exitedAt: null, exitedBy: null, createdAt: nowIso(),
    };
    data.bookings.push(b); logEvent('booking', b.id, 'status', null, 'booked', actor.id); save();
    return enrich(b);
  }
  function changeStatus(b, status, actorId) { const old = b.status; b.status = status; logEvent('booking', b.id, 'status', old, status, actorId); }
  function cancelBooking(id, actor) {
    load(); const b = data.bookings.find((x) => x.id === id) || fail('Бронь не найдена');
    if (actor.role !== 'admin' && b.trusteeId !== actor.id) fail('Нет доступа к этой брони');
    if (b.status !== 'booked') fail('Отменить можно только бронь в статусе «Забронирована»');
    changeStatus(b, 'cancelled', actor.id); save();
  }
  function markEntered(id, actor) {
    load(); const b = data.bookings.find((x) => x.id === id) || fail('Бронь не найдена');
    if (b.status !== 'booked') fail('Въезд уже отмечен или бронь неактивна');
    if (b.date !== todayStr()) fail('Бронь не на сегодня');
    b.enteredAt = nowIso(); b.enteredBy = actor.id; changeStatus(b, 'entered', actor.id); save();
  }
  function markExited(id, actor) {
    load(); const b = data.bookings.find((x) => x.id === id) || fail('Бронь не найдена');
    if (b.status !== 'entered') fail('Машина не на территории');
    b.exitedAt = nowIso(); b.exitedBy = actor.id; changeStatus(b, 'exited', actor.id); save();
  }
  function reassignPost(id, post, actor) {
    load(); const b = data.bookings.find((x) => x.id === id) || fail('Бронь не найдена');
    post = Number(post); if (![1, 2].includes(post)) fail('Пост 1 или 2');
    if (!['booked', 'entered'].includes(b.status)) fail('Пост можно сменить только у активной брони');
    if (b.post === post) return;
    if (dayLoad(b.date, b.id)[post] >= data.settings.trucksPerPostPerDay) fail(`Пост ${post} на ${fmt(b.date)} заполнен`);
    const old = b.post; b.post = post; logEvent('booking', id, 'post', old, post, actor.id); save();
  }
  // Очередь на посту — порядок въезда (живая очередь)
  function queueOnTerritory() {
    load();
    return data.bookings.filter((b) => b.status === 'entered').map(enrich).sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
  }

  /* -------------------- неявки (FR-9.1) и события ------------------- */
  function processNoShows() {
    load(); const today = todayStr(); let n = 0;
    data.bookings.forEach((b) => { if (b.status === 'booked' && b.date < today) { changeStatus(b, 'no_show', 'system'); n++; } });
    if (n) save();
    return n;
  }
  function listEvents() { load(); return data.events.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)); }

  function fmt(str) { const [y, m, d] = str.split('-'); return `${d}.${m}.${y}`; }

  function resetDemo() { localStorage.removeItem(KEY); data = null; load(); }

  /* ============================ ДЕМО-ДАННЫЕ ============================ */
  function seed() {
    data = { seq: 0, users: [], products: [], batches: [], trucks: [], bookings: [], events: [], settings: Object.assign({}, DEFAULT_SETTINGS) };
    let r = 42; const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
    const today = todayStr();
    const at = (date, h, m) => { const d = parseDate(date); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const created = addDays(today, -40) + 'T06:00:00.000Z';

    const U = (login, pass, fullName, role, organization, phone, isBlocked) => {
      const u = { id: nextId('u'), login, passwordHash: hashPassword(pass), fullName, phone, role, organization: organization || '', isBlocked: !!isBlocked, sanctionClearedAt: null, createdAt: created };
      data.users.push(u); return u;
    };
    const admin = U('admin', 'admin123', 'Кудинов Владимир Александрович', 'admin', '', '+7 701 100 00 01');
    const guard = U('guard', 'guard123', 'Сапаров Ерлан Маратович', 'guard', '', '+7 701 100 00 02');
    U('guard2', 'guard123', 'Ким Олег Викторович', 'guard', '', '+7 701 100 00 03', true);
    const lab = U('lab', 'lab123', 'Ахметова Динара Сериковна', 'lab', '', '+7 701 100 00 04');
    const t1 = U('trustee1', 'trust123', 'Иванов Сергей Петрович', 'trustee', 'ТОО «Транзит Ойл»', '+7 702 200 00 01');
    const t2 = U('trustee2', 'trust123', 'Нурланов Асхат Бекович', 'trustee', 'ТОО «КазТрансАвто»', '+7 702 200 00 02');
    const t3 = U('trustee3', 'trust123', 'Петренко Андрей Юрьевич', 'trustee', 'ТОО «Степной перевозчик»', '+7 702 200 00 03');

    const P = (name, isActive = true) => { const p = { id: nextId('p'), name, unit: 'т', isActive }; data.products.push(p); return p; };
    const ai92 = P('АИ-92'), ai95 = P('АИ-95'), dtl = P('ДТ летнее'), dtz = P('ДТ зимнее'), ts1 = P('Топливо ТС-1');
    P('Мазут М-100', false);

    const B = (product, quantity, availableFrom, passport, status, comment = '') => {
      const b = { id: nextId('b'), productId: product.id, quantity, unit: 'т', availableFrom, qualityPassport: passport, comment, status, createdBy: lab.id, createdAt: at(addDays(availableFrom, -1), 15, 0) };
      data.batches.push(b); data.events.push({ id: nextId('e'), entity: 'batch', entityId: b.id, action: 'create', oldValue: null, newValue: `${product.name} ${quantity} т`, userId: lab.id, timestamp: b.createdAt });
      return b;
    };
    // Исторические партии (закрыты) и текущие (открыты)
    const old = {
      [ai92.id]: B(ai92, 900, addDays(today, -21), 'ПК-0912', 'closed', 'Резервуар Р-3'),
      [ai95.id]: B(ai95, 500, addDays(today, -21), 'ПК-0913', 'closed', 'Резервуар Р-5'),
      [dtl.id]: B(dtl, 1200, addDays(today, -21), 'ПК-0914', 'closed', 'Резервуар Р-1'),
    };
    const cur = {
      [ai92.id]: B(ai92, 500, addDays(today, -1), 'ПК-1031', 'open', 'Резервуар Р-4'),
      [ai95.id]: B(ai95, 300, today, 'ПК-1032', 'open', 'Резервуар Р-6'),
      [dtl.id]: B(dtl, 800, addDays(today, -1), 'ПК-1033', 'open', 'Резервуар Р-2'),
      [dtz.id]: B(dtz, 250, addDays(today, 2), 'ПК-1034', 'open', 'Выдача после анализа на ПТФ'),
      [ts1.id]: B(ts1, 120, today, '', 'open'),
    };

    const T = (owner, plate, trailer, model, tank, driver, phone) => {
      const t = { id: nextId('t'), ownerId: owner.id, plate, plateNormalized: normalizePlate(plate), trailerPlate: trailer, trailerNormalized: normalizePlate(trailer), model, tankVolume: tank, driverName: driver, driverPhone: phone, isActive: true };
      data.trucks.push(t); return t;
    };
    const trucks = {
      [t1.id]: [
        T(t1, 'А123ВС 77', 'АК 4512 77', 'КамАЗ 65116', 30, 'Смирнов Алексей Иванович', '+7 705 111 11 01'),
        T(t1, '245 KTA 02', '817 AH 02', 'MAN TGS 19.400', 32, 'Жумабаев Данияр Ерланович', '+7 705 111 11 02'),
        T(t1, '310 OPT 02', '552 AX 02', 'Volvo FH 460', 30, 'Ли Виктор Сергеевич', '+7 705 111 11 03'),
      ],
      [t2.id]: [
        T(t2, '777 HKE 01', '901 AM 01', 'Scania R450', 32, 'Оспанов Нурлан Канатович', '+7 707 222 22 01'),
        T(t2, '118 TBK 01', '334 AT 01', 'DAF XF 480', 30, 'Козлов Игорь Николаевич', '+7 707 222 22 02'),
        T(t2, '064 MAX 01', '', 'КамАЗ 5490', 25, 'Сеитов Арман Болатович', '+7 707 222 22 03'),
      ],
      [t3.id]: [
        T(t3, '512 CTE 05', '780 AC 05', 'Mercedes Actros', 28, 'Бондаренко Павел Олегович', '+7 708 333 33 01'),
        T(t3, '903 EKB 05', '211 AE 05', 'Shacman X3000', 30, 'Абенов Тимур Сакенович', '+7 708 333 33 02'),
      ],
    };
    const prodList = [ai92, ai95, dtl];
    const noShowDays = { [t3.id]: [-9, -6, -3], [t1.id]: [-12], [t2.id]: [-5] };

    const addBooking = (o) => {
      const b = Object.assign({ id: nextId('k'), enteredAt: null, enteredBy: null, exitedAt: null, exitedBy: null }, o);
      data.bookings.push(b);
      const ev = (oldS, newS, ts, uid) => data.events.push({ id: nextId('e'), entity: 'booking', entityId: b.id, action: 'status', oldValue: oldS, newValue: newS, userId: uid, timestamp: ts });
      ev(null, 'booked', b.createdAt, b.trusteeId);
      if (b.enteredAt) ev('booked', 'entered', b.enteredAt, guard.id);
      if (b.exitedAt) ev('entered', 'exited', b.exitedAt, guard.id);
      if (b.status === 'cancelled') {
        const ts = new Date(Math.min(new Date(at(addDays(b.date, -1), 18, 10)).getTime(), Date.now() - 10 * 60000)).toISOString();
        ev('booked', 'cancelled', ts, b.trusteeId);
      }
      if (b.status === 'no_show') ev('booked', 'no_show', at(addDays(b.date, 1), 7, 55), 'system');
      return b;
    };

    // История за 20 дней
    for (let d = -20; d <= -1; d++) {
      const date = addDays(today, d); const cnt = { 1: 0, 2: 0 };
      [t1, t2, t3].forEach((tr) => {
        trucks[tr.id].forEach((truck, i) => {
          const forcedNoShow = (noShowDays[tr.id] || []).includes(d) && i === 0;
          if (!forcedNoShow && rnd() < 0.35) return;
          const product = prodList[Math.floor(rnd() * prodList.length)];
          const volume = Math.min(truck.tankVolume, 20 + Math.round(rnd() * 8));
          const post = cnt[1] <= cnt[2] ? 1 : 2; cnt[post]++;
          let status = 'exited';
          if (forcedNoShow) status = 'no_show';
          else if (rnd() < 0.06) status = 'cancelled';
          const o = { batchId: old[product.id].id, truckId: truck.id, trusteeId: tr.id, volume, date, post, status, createdAt: at(addDays(date, -1 - Math.floor(rnd() * 3)), 10 + Math.floor(rnd() * 6), Math.floor(rnd() * 60)) };
          if (status === 'exited') {
            const h = 8 + Math.floor(rnd() * 10); const m = Math.floor(rnd() * 60);
            o.enteredAt = at(date, h, m); o.enteredBy = guard.id;
            o.exitedAt = new Date(new Date(o.enteredAt).getTime() + (35 + Math.floor(rnd() * 70)) * 60000).toISOString(); o.exitedBy = guard.id;
          }
          addBooking(o);
        });
      });
    }
    // Сегодня: одна выехала, две на территории, остальные ожидаются
    const now = Date.now(); const ago = (min) => new Date(now - min * 60000).toISOString();
    const yest = (h) => at(addDays(today, -1), h, 15);
    addBooking({ batchId: cur[dtl.id].id, truckId: trucks[t2.id][0].id, trusteeId: t2.id, volume: 30, date: today, post: 1, status: 'exited', createdAt: yest(11), enteredAt: ago(170), enteredBy: guard.id, exitedAt: ago(95), exitedBy: guard.id });
    addBooking({ batchId: cur[ai92.id].id, truckId: trucks[t1.id][1].id, trusteeId: t1.id, volume: 30, date: today, post: 2, status: 'entered', createdAt: yest(12), enteredAt: ago(45), enteredBy: guard.id });
    addBooking({ batchId: cur[dtl.id].id, truckId: trucks[t2.id][1].id, trusteeId: t2.id, volume: 28, date: today, post: 1, status: 'entered', createdAt: yest(13), enteredAt: ago(20), enteredBy: guard.id });
    addBooking({ batchId: cur[ai92.id].id, truckId: trucks[t1.id][0].id, trusteeId: t1.id, volume: 30, date: today, post: 2, status: 'booked', createdAt: yest(14) });
    addBooking({ batchId: cur[ai95.id].id, truckId: trucks[t1.id][2].id, trusteeId: t1.id, volume: 25, date: today, post: 1, status: 'booked', createdAt: yest(15) });
    addBooking({ batchId: cur[ts1.id].id, truckId: trucks[t2.id][2].id, trusteeId: t2.id, volume: 20, date: today, post: 2, status: 'booked', createdAt: yest(16) });
    // Будущие брони
    addBooking({ batchId: cur[ai92.id].id, truckId: trucks[t1.id][0].id, trusteeId: t1.id, volume: 28, date: addDays(today, 1), post: 1, status: 'booked', createdAt: ago(60) });
    addBooking({ batchId: cur[dtl.id].id, truckId: trucks[t2.id][0].id, trusteeId: t2.id, volume: 32, date: addDays(today, 1), post: 2, status: 'booked', createdAt: ago(50) });
    addBooking({ batchId: cur[ai95.id].id, truckId: trucks[t2.id][1].id, trusteeId: t2.id, volume: 30, date: addDays(today, 1), post: 1, status: 'booked', createdAt: ago(40) });
    addBooking({ batchId: cur[dtz.id].id, truckId: trucks[t1.id][1].id, trusteeId: t1.id, volume: 32, date: addDays(today, 3), post: 1, status: 'booked', createdAt: ago(30) });
    addBooking({ batchId: cur[ai92.id].id, truckId: trucks[t1.id][2].id, trusteeId: t1.id, volume: 30, date: addDays(today, 1), post: 2, status: 'cancelled', createdAt: ago(300) });

    data.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    data.events.push({ id: nextId('e'), entity: 'user', entityId: 'u3', action: 'block', oldValue: null, newValue: null, userId: admin.id, timestamp: at(addDays(today, -2), 9, 0) });
    return data;
  }

  return {
    ROLES, BOOKING_STATUS, ACTIVE,
    todayStr, addDays, dateStr, parseDate, normalizePlate, reload, resetDemo,
    listUsers, getUser, authenticate, createUser, updateUser, setBlocked, resetPassword, deleteUser, clearSanction, sanctionInfo,
    listProducts, getProduct, saveProduct, getSettings, updateSettings,
    listBatches, getBatch, listAvailableBatches, createBatch, updateBatch, setBatchStatus,
    listTrucks, getTruck, saveTruck, setTruckActive, findTrucksByPlate,
    listBookings, getBooking, dayAvailability, trusteeLimitInfo, createBooking, cancelBooking, markEntered, markExited, reassignPost, queueOnTerritory,
    processNoShows, listEvents,
  };
})();
