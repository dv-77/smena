(function () {
  var P = window.SmenaPay;
  var TG = window.Telegram && window.Telegram.WebApp;
  var $ = document.getElementById("app");

  var TYPES = [
    { id: "w", label: "Вахта" },
    { id: "h", label: "Дом" },
    { id: "to", label: "Заезд" },
    { id: "from", label: "Выезд" },
    { id: "r", label: "Вых. на вахте" },
    { id: "s", label: "Больничный" },
    { id: "v", label: "Отпуск" }
  ];
  var WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  var MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

  function defCfg() {
    return {
      v: 4,
      work: 0,
      rest: 0,
      travelOn: false,
      travelCountsAsWork: false,
      payMode: "daily",
      rate: 0,
      hoursPerShift: 11,
      shiftStart: "08:00",
      shiftEnd: "20:00",
      unpaidBreakMin: 60,
      nightPct: 20,
      holidayMult: 2,
      vahtaBonusPct: 0,
      rk: 1,
      northPct: 0,
      ndfl: false,
      ndflPct: 13,
      goalMonth: 0,
      warnDocsDays: 30,
      warnTravelDays: 3,
      setup: false
    };
  }

  var S = {
    cfg: defCfg(),
    days: {},
    pays: [],
    docs: [],
    pack: [],
    tab: "home",
    page: null,
    sheet: null,
    ym: null,
    brush: "w",
    paint: false,
    toast: "",
    dirtyMonths: {}
  };

  function todayIso() {
    return P.iso(new Date());
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function rub(n) {
    n = Math.round(Number(n) || 0);
    return n.toLocaleString("ru-RU") + " ₽";
  }

  function payExtras(s) {
    return (s.rkAmt || 0) + (s.northAmt || 0) + (s.bonus || 0) + (s.nightPay || 0) + (s.holidayExtra || 0) + (s.extras || 0);
  }

  function ratePhrase() {
    if (!Number(S.cfg.rate)) return "";
    return rub(S.cfg.rate) + (S.cfg.payMode === "hourly" ? "/ч" : "");
  }

  function byRateLine(s) {
    if (!Number(S.cfg.rate)) return "ставку не задали";
    if (S.cfg.payMode === "hourly") return s.hours.toFixed(1) + " ч × " + ratePhrase();
    return s.workDays + " × " + ratePhrase();
  }

  function headlinePay(s) {
    if (!Number(S.cfg.rate)) return "ставку не задали";
    if (payExtras(s) < 0.5 && !S.cfg.ndfl) return rub(s.labor);
    return rub(s.net);
  }

  function haptic(k) {
    try { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred(k || "light"); } catch (e) {}
  }

  function toast(t) {
    S.toast = t;
    render();
    setTimeout(function () { if (S.toast === t) { S.toast = ""; render(); } }, 1800);
  }

  function lockClose(on) {
    if (!TG) return;
    try {
      if (on && TG.enableClosingConfirmation) TG.enableClosingConfirmation();
      else if (!on && TG.disableClosingConfirmation) TG.disableClosingConfirmation();
    } catch (e) {}
  }

  function confirmTg(msg, yes) {
    if (TG && TG.showConfirm) {
      TG.showConfirm(msg, function (ok) { if (ok) yes(); });
      return;
    }
    if (window.confirm(msg)) yes();
  }

  function typeLabel(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i].label;
    return "—";
  }

  function fmtDay(iso) {
    var d = P.parseIso(iso);
    return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  }

  function monthKey(iso) {
    return "m-" + iso.slice(0, 7);
  }

  /* ---------- storage ---------- */
  function cs() { return TG && TG.CloudStorage; }
  function ds() { return TG && TG.DeviceStorage; }

  function callStore(obj, method, args) {
    return new Promise(function (resolve, reject) {
      if (!obj || typeof obj[method] !== "function") { resolve(null); return; }
      var list = args.slice();
      list.push(function (err, value) {
        if (err) reject(typeof err === "string" ? new Error(err) : err);
        else resolve(value);
      });
      try { obj[method].apply(obj, list); } catch (e) { reject(e); }
    });
  }

  function getCloud(key) { return callStore(cs(), "getItem", [key]).then(function (v) { return v || ""; }); }
  function setCloud(key, val) { return callStore(cs(), "setItem", [key, val]); }
  function getDev(key) { return callStore(ds(), "getItem", [key]).then(function (v) { return v || ""; }); }
  function setDev(key, val) { return callStore(ds(), "setItem", [key, val]); }

  var NS = "s4-";
  var LOCAL = "smena-s4";

  function full(key) { return NS + key; }

  var localMem = {};
  try { localMem = JSON.parse(localStorage.getItem(LOCAL) || "{}") || {}; } catch (e) { localMem = {}; }

  function persistLocal() {
    try { localStorage.setItem(LOCAL, JSON.stringify(localMem)); } catch (e) {}
  }

  function wrapVal(val) {
    var packed = JSON.stringify({ t: Date.now(), d: val });
    return packed.length > 4000 ? val : packed;
  }

  function unwrapVal(s) {
    if (!s) return { t: 0, d: "" };
    try {
      var o = JSON.parse(s);
      if (o && typeof o === "object" && typeof o.t === "number" && typeof o.d === "string") return o;
    } catch (e) {}
    return { t: 0, d: s };
  }

  function pickStored(parts) {
    var i, u, best = "", bestT = -1, anyT = false;
    for (i = 0; i < parts.length; i++) {
      u = unwrapVal(parts[i]);
      if (u.t > 0) anyT = true;
      if (u.t >= bestT && u.d) { bestT = u.t; best = u.d; }
    }
    if (anyT) return best;
    for (i = 0; i < parts.length; i++) if (parts[i]) return parts[i];
    return "";
  }

  function readRaw(raw) {
    return Promise.all([
      getCloud(raw).catch(function () { return ""; }),
      getDev(raw).catch(function () { return ""; }),
      Promise.resolve(localMem[raw] || "")
    ]).then(pickStored);
  }

  function readKey(key) { return readRaw(full(key)); }

  function writeKey(key, val) {
    var packed = wrapVal(val);
    localMem[full(key)] = packed;
    persistLocal();
    setDev(full(key), packed).catch(function () {});
    return setCloud(full(key), packed).catch(function () {});
  }

  function delRaw(raw) {
    delete localMem[raw];
    persistLocal();
    callStore(ds(), "removeItem", [raw]).catch(function () {});
    return callStore(cs(), "removeItem", [raw]).catch(function () {});
  }

  function delKey(key) { return delRaw(full(key)); }

  function listRawKeys() {
    var jobs = [
      cs() && cs().getKeys ? callStore(cs(), "getKeys", []).catch(function () { return []; }) : Promise.resolve([]),
      ds() && ds().getKeys ? callStore(ds(), "getKeys", []).catch(function () { return []; }) : Promise.resolve([])
    ];
    return Promise.all(jobs).then(function (arr) {
      var set = {};
      function add(keys) {
        (keys || []).forEach(function (k) { if (k) set[k] = 1; });
      }
      add(arr[0]);
      add(arr[1]);
      add(Object.keys(localMem));
      return Object.keys(set);
    });
  }

  function listMonthKeys() {
    return listRawKeys().then(function (keys) {
      var out = [];
      var p = NS + "m-";
      keys.forEach(function (k) {
        if (String(k).indexOf(p) === 0) out.push(k.slice(NS.length));
      });
      return out;
    });
  }

  function wipeForeign() {
    try { localStorage.removeItem("smena"); } catch (e) {}
    return listRawKeys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return String(k).indexOf(NS) !== 0;
      }).map(delRaw));
    });
  }

  function wipeEverything() {
    try { localStorage.removeItem("smena"); } catch (e) {}
    return listRawKeys().then(function (keys) {
      return Promise.all(keys.map(delRaw));
    }).then(function () {
      localMem = {};
      persistLocal();
    });
  }

  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
    lockClose(true);
  }

  function flush() {
    var snap = Object.keys(S.dirtyMonths);
    var jobs = [
      writeKey("cfg", JSON.stringify(S.cfg)),
      writeKey("pay", JSON.stringify(S.pays)),
      writeKey("docs", JSON.stringify(S.docs)),
      writeKey("pack", JSON.stringify(S.pack))
    ];
    snap.forEach(function (mk) {
      var chunk = {};
      Object.keys(S.days).forEach(function (iso) {
        if (monthKey(iso) === mk) chunk[iso] = S.days[iso];
      });
      jobs.push(writeKey(mk, JSON.stringify(chunk)));
    });
    return Promise.all(jobs).then(function () {
      snap.forEach(function (k) { delete S.dirtyMonths[k]; });
      if (!Object.keys(S.dirtyMonths).length) lockClose(false);
    });
  }

  function markDay(iso) { S.dirtyMonths[monthKey(iso)] = 1; }

  function monthsFromDays(days) {
    var set = {};
    Object.keys(days || {}).forEach(function (iso) { set[monthKey(iso)] = 1; });
    return Object.keys(set);
  }

  function parseJson(s, fallback) {
    if (!s) return fallback;
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function emptyState() {
    S.cfg = defCfg();
    S.cfg.setup = true;
    S.days = {};
    S.pays = [];
    S.docs = [];
    S.pack = [];
    S.dirtyMonths = {};
    S.page = null;
    S.sheet = null;
    S.tab = "home";
  }

  function loadAll() {
    return wipeForeign().then(function () {
      return Promise.all([readKey("cfg"), readKey("pay"), readKey("docs"), readKey("pack")]);
    }).then(function (base) {
      var cfg = parseJson(base[0], null);
      if (cfg && typeof cfg === "object") S.cfg = Object.assign(defCfg(), cfg);
      S.pays = parseJson(base[1], []) || [];
      S.docs = parseJson(base[2], []) || [];
      S.pack = parseJson(base[3], []) || [];
      return listMonthKeys();
    }).then(function (months) {
      return Promise.all((months || []).map(function (k) {
        return readKey(k).then(function (v) {
          var o = parseJson(v, {});
          Object.keys(o).forEach(function (iso) { S.days[iso] = o[iso]; });
        });
      }));
    });
  }

  /* ---------- domain helpers ---------- */
  function setDay(iso, patch) {
    if (patch == null) {
      delete S.days[iso];
    } else {
      S.days[iso] = patch;
    }
    markDay(iso);
    scheduleSave();
  }

  function cycleNow() {
    return P.cycleProgress(S.days, todayIso());
  }

  function vahtaBounds() {
    var iso = todayIso();
    var d = P.parseIso(iso);
    var from = iso;
    var to = iso;
    var i;
    for (i = 0; i <= 90; i++) {
      var k = P.iso(P.addDays(d, -i));
      var day = S.days[k];
      if (!day) { if (i) from = P.iso(P.addDays(d, -i + 1)); break; }
      if (day.t === "h" && i) { from = P.iso(P.addDays(d, -i + 1)); break; }
      from = k;
    }
    for (i = 0; i <= 90; i++) {
      var k2 = P.iso(P.addDays(d, i));
      var day2 = S.days[k2];
      if (!day2) { if (i) to = P.iso(P.addDays(d, i - 1)); break; }
      if (day2.t === "h" && i) { to = P.iso(P.addDays(d, i - 1)); break; }
      to = k2;
    }
    return { from: from, to: to };
  }

  function sumRange(from, to) {
    return P.summarize(S.days, S.cfg, from, to);
  }

  /* ---------- render ---------- */
  function render() {
    var tabsOn = !!(S.cfg.setup && !S.page);
    document.body.classList.toggle("has-tabs", tabsOn);
    document.body.classList.toggle("wiz-on", !S.cfg.setup);
    if (!S.cfg.setup) {
      $.innerHTML = renderWizard();
    } else if (S.page) {
      $.innerHTML = renderPage();
    } else {
      var body = "";
      if (S.tab === "home") body = renderHome();
      else if (S.tab === "cal") body = renderCal();
      else if (S.tab === "money") body = renderMoney();
      else body = renderMore();
      $.innerHTML = body + renderTabs() + (S.sheet ? renderSheet() : "") + (S.toast ? '<div class="toast">' + esc(S.toast) + "</div>" : "");
    }
    bindBack();
  }

  function renderTabs() {
    var tabs = [["home", "Сегодня"], ["cal", "Календарь"], ["money", "Деньги"], ["more", "Ещё"]];
    return '<nav class="tabs">' + tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? "on" : "") + '">' + t[1] + "</button>";
    }).join("") + "</nav>";
  }

  function ringSvg(p) {
    var r = 48, c = 2 * Math.PI * r;
    var frac = Math.min(1, (p.elapsed) / (p.total || 1));
    var off = c * (1 - frac);
    return '<div class="ring-wrap"><svg viewBox="0 0 112 112">' +
      '<circle cx="56" cy="56" r="' + r + '" fill="none" stroke="currentColor" opacity=".12" stroke-width="8"/>' +
      '<circle cx="56" cy="56" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '"/>' +
      "</svg><div class=\"num\"><b>" + p.remain + "</b><span>дней</span></div></div>";
  }

  function renderHome() {
    var iso = todayIso();
    var p = cycleNow();
    var today = S.days[iso];
    var stMap = { work: "На вахте", home: "Дома", to: "Заезд", from: "Выезд", rest: "Выходной на вахте", sick: "Больничный", vac: "Отпуск", empty: "График не отмечен" };
    var title = stMap[p.status] || stMap.empty;
    var nextLabel = p.onSite ? "до дома" : "до вахты";
    var vb = vahtaBounds();
    var vs = p.onSite ? sumRange(vb.from, vb.to) : sumRange(iso, iso);
    var mb = P.monthBounds(new Date().getFullYear(), new Date().getMonth());
    var ms = sumRange(mb.from, mb.to);
    var td = today && P.isPaidWork(today, S.cfg) ? sumRange(iso, iso) : null;
    var warns = warnings();
    var html = '<div class="top"><h1>Смена</h1><div class="sub">' + esc(fmtDay(iso)) + "</div></div><div class=\"wrap\">";
    html += '<div class="hero"><div class="st">' + esc(title) + "</div>";
    if (p.status !== "empty") {
      html += ringSvg(p);
      html += '<div class="big"><em>' + p.remain + "</em> " + nextLabel + "</div>";
      html += '<div class="muted">день ' + p.elapsed + " из " + p.total + "</div>";
    } else if (p.next) {
      html += '<div class="big"><em>' + p.remain + "</em> " + nextLabel + "</div>";
      html += '<div class="muted">сегодня не отмечен — открой календарь</div>';
    } else {
      html += '<div class="big">Нет графика</div><div class="muted">Нарисуй дни на вкладке Календарь</div>';
    }
    html += "</div>";

    var homeRows = "";
    if (today) {
      var todayVal = typeLabel(today.t);
      if (td) todayVal += " · " + rub(td.labor);
      homeRows += rowTap("Сегодня", todayVal, "open-day", iso);
    }
    if (p.onSite && (Number(S.cfg.rate) || vs.workDays)) {
      homeRows += '<div class="row tap" data-act="go-money"><div class="lbl">Эта вахта<small>' + esc(byRateLine(vs)) + '</small></div><div class="val money">' + esc(headlinePay(vs)) + '</div><div class="chev">›</div></div>';
    }
    if (Number(S.cfg.rate) || ms.workDays) {
      homeRows += '<div class="row tap" data-act="go-money"><div class="lbl">Месяц<small>' + esc(byRateLine(ms)) + (S.cfg.goalMonth ? goalPct(ms.net) : "") + '</small></div><div class="val money">' + esc(headlinePay(ms)) + '</div><div class="chev">›</div></div>';
    }
    if (homeRows) html += '<div class="group">' + homeRows + "</div>";

    if (warns.length) {
      html += '<div class="group">';
      warns.forEach(function (w) {
        html += '<div class="row warn"><div class="lbl">' + esc(w.t) + "<small>" + esc(w.s) + "</small></div></div>";
      });
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function goalPct(net) {
    var g = Number(S.cfg.goalMonth) || 0;
    if (!g) return "";
    var p = Math.round(net / g * 100);
    return " · " + p + "% цели";
  }

  function warnings() {
    var out = [];
    var iso = todayIso();
    var today = P.parseIso(iso);
    S.docs.forEach(function (d) {
      if (!d.exp) return;
      var left = Math.round((P.parseIso(d.exp) - today) / 86400000);
      if (left <= (S.cfg.warnDocsDays || 30)) {
        out.push({ t: d.n, s: left < 0 ? "просрочено" : "ещё " + left + " дн." });
      }
    });
    var n = P.nextChange(S.days, iso, cycleNow().onSite ? "home" : "work");
    if (n && n.days <= (S.cfg.warnTravelDays || 3) && n.days > 0) {
      var going = cycleNow().onSite ? "Домой" : "На вахту";
      out.push({ t: going, s: fmtDay(n.date) + " · через " + n.days + " дн." });
    }
    var packLeft = S.pack.filter(function (x) { return !x.done; }).length;
    if (n && n.days <= 2 && packLeft) out.push({ t: "Сборы", s: "осталось " + packLeft });
    var last = P.lastMarked(S.days);
    if (last) {
      var leftG = Math.round((P.parseIso(last) - today) / 86400000);
      if (leftG <= 21) {
        out.push({ t: "График кончается", s: leftG < 0 ? "закончился — расставь ещё" : "ещё " + leftG + " дн." });
      }
    }
    return out;
  }

  function rowTap(title, val, act, arg) {
    return '<div class="row tap" data-act="' + act + '"' + (arg ? ' data-arg="' + esc(arg) + '"' : "") + ">" +
      '<div class="lbl">' + esc(title) + '</div><div class="val money">' + esc(val) + '</div><div class="chev">›</div></div>';
  }

  function renderCal() {
    if (!S.ym) S.ym = { y: new Date().getFullYear(), m: new Date().getMonth() };
    var y = S.ym.y, m = S.ym.m;
    var first = new Date(y, m, 1);
    var start = (first.getDay() + 6) % 7;
    var dim = new Date(y, m + 1, 0).getDate();
    var prevDim = new Date(y, m, 0).getDate();
    var today = todayIso();
    var cells = [];
    var i;
    for (i = 0; i < start; i++) {
      var pd = prevDim - start + i + 1;
      var piso = P.iso(new Date(y, m - 1, pd));
      cells.push(calCell(piso, pd, true, today));
    }
    for (i = 1; i <= dim; i++) {
      var iso = P.iso(new Date(y, m, i));
      cells.push(calCell(iso, i, false, today));
    }
    while (cells.length % 7) {
      var nd = cells.length - (start + dim) + 1;
      var niso = P.iso(new Date(y, m + 1, nd));
      cells.push(calCell(niso, nd, true, today));
    }
    var mb = P.monthBounds(y, m);
    var ms = sumRange(mb.from, mb.to);
    var html = '<div class="top"><h1>Календарь</h1><div class="sub money">' + ms.workDays + " раб. · " + headlinePay(ms) + "</div></div><div class=\"wrap\">";
    html += '<div class="cal-nav"><button data-act="prev-m">‹</button><b>' + MONTHS[m] + " " + y + "</b><button data-act=\"next-m\">›</button></div>";
    html += '<div class="brush">';
    TYPES.forEach(function (t) {
      html += '<button class="chip' + (S.brush === t.id ? " on" : "") + '" data-act="brush" data-arg="' + t.id + '">' + esc(t.label) + "</button>";
    });
    html += '<button class="chip' + (S.paint ? " on" : "") + '" data-act="toggle-paint">' + (S.paint ? "Кисть вкл" : "Кисть") + "</button>";
    html += "</div>";
    html += '<div class="week">' + WEEK.map(function (w) { return "<span>" + w + "</span>"; }).join("") + "</div>";
    html += '<div class="grid' + (S.paint ? " paint-on" : "") + '">' + cells.join("") + "</div>";
    html += '<div class="legend"><span><i style="background:var(--accent)"></i>вахта</span><span><i style="background:var(--hint)"></i>дом</span><span><i style="background:var(--travel)"></i>путь</span><span><i style="background:var(--rest)"></i>вых.</span></div>';
    html += '<div class="group" style="margin-top:16px">';
    html += '<div class="row tap" data-act="gen"><div class="lbl">Расставить график<small>' + (canAutoGen() ? S.cfg.work + "/" + S.cfg.rest + " с выбранной даты" : "сначала укажи рабочие и дом") + "</small></div><div class=\"chev\">›</div></div>";
    html += "</div></div>";
    return html;
  }

  function calCell(iso, num, off, today) {
    var t = S.days[iso] && S.days[iso].t;
    var hol = P.isHoliday(iso);
    var cls = "cell" + (off ? " off" : "") + (iso === today ? " today" : "") + (t ? " t-" + t : "");
    var dot = t ? '<span class="dot t-' + t + '"></span>' : (hol ? '<span class="dot t-s"></span>' : "");
    return '<button class="' + cls + '" data-act="cell" data-arg="' + iso + '">' + num + dot + "</button>";
  }

  function renderMoney() {
    var now = new Date();
    var mb = P.monthBounds(now.getFullYear(), now.getMonth());
    var yb = P.yearBounds(now.getFullYear());
    var vb = vahtaBounds();
    var p = cycleNow();
    var month = sumRange(mb.from, mb.to);
    var year = sumRange(yb.from, yb.to);
    var vahta = p.onSite || p.status !== "empty" ? sumRange(vb.from, vb.to) : null;
    var payM = P.moneyInRange(S.pays, mb.from, mb.to);
    var html = '<div class="top"><h1>Деньги</h1><div class="sub">оценка, не расчётка</div></div><div class="wrap">';
    html += '<div class="hero"><div class="st">Этот месяц</div><div class="big money">' + headlinePay(month) + "</div>";
    html += '<div class="muted">' + esc(byRateLine(month)) + "</div>";
    if (payExtras(month) >= 0.5) html += '<div class="muted">ниже — из чего сложилось</div>';
    if (S.cfg.goalMonth) html += '<div class="muted">цель ' + rub(S.cfg.goalMonth) + goalPct(month.net) + "</div>";
    html += "</div>";
    if (vahta && p.onSite) {
      html += groupStats("Текущая вахта", vahta);
    }
    html += groupStats("Месяц", month);
    html += groupStats("Год", year);
    html += '<div class="group">';
    if (S.pays.length) {
      html += '<div class="row"><div class="lbl">Пришло</div><div class="val money">' + rub(payM.got) + "</div></div>";
      html += '<div class="row"><div class="lbl">Траты</div><div class="val money">' + rub(payM.spent) + "</div></div>";
    }
    html += '<div class="row tap" data-act="add-pay"><div class="lbl">Записать выплату или трату</div><div class="chev">›</div></div>';
    html += "</div>";
    if (S.pays.length) {
      html += '<div class="group">';
      S.pays.slice().sort(function (a, b) { return a.d < b.d ? 1 : -1; }).slice(0, 12).forEach(function (x) {
        var kind = x.k === "exp" ? "трата" : x.k === "adv" ? "аванс" : x.k === "sal" ? "расчёт" : "премия";
        html += '<div class="row tap" data-act="del-pay" data-arg="' + esc(x.id) + '"><div class="lbl">' + esc(kind) + "<small>" + esc(x.d) + (x.n ? " · " + esc(x.n) : "") + '</small></div><div class="val money">' + (x.k === "exp" ? "−" : "+") + rub(x.a) + "</div></div>";
      });
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function groupStats(title, s) {
    var extra = payExtras(s) >= 0.5 || S.cfg.ndfl;
    var rows = [
      ["Рабочих дней", String(s.workDays)],
      s.siteDays !== s.workDays ? ["Дней на объекте", String(s.siteDays)] : null,
      ["По ставке", extra ? rub(s.labor) : byRateLine(s) + " = " + rub(s.labor)]
    ];
    if (s.nightPay) rows.push(["Ночные 22:00–06:00", rub(s.nightPay)]);
    if (s.holidayExtra) rows.push(["Праздники ×" + (S.cfg.holidayMult || 2), rub(s.holidayExtra)]);
    if (s.rkAmt) rows.push(["Районный " + S.cfg.rk, rub(s.rkAmt)]);
    if (s.northAmt) rows.push(["Северная " + S.cfg.northPct + "%", rub(s.northAmt)]);
    if (s.bonus) rows.push(["Вахтовая " + S.cfg.vahtaBonusPct + "% × " + s.siteDays + " дн", rub(s.bonus)]);
    if (s.extras) rows.push(["Доплаты вручную", rub(s.extras)]);
    if (extra) {
      rows.push(["Всего", rub(s.gross)]);
      if (S.cfg.ndfl) rows.push(["НДФЛ " + (S.cfg.ndflPct || 13) + "%", rub(s.tax)]);
      rows.push([S.cfg.ndfl ? "На руки" : "Итого", rub(s.net)]);
    }
    var html = '<div class="group"><div class="head-row">' + esc(title) + "</div>";
    rows.forEach(function (r) {
      if (!r) return;
      html += '<div class="row"><div class="lbl">' + esc(r[0]) + '</div><div class="val money">' + esc(String(r[1])) + "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function renderMore() {
    var html = '<div class="top"><h1>Ещё</h1></div><div class="wrap"><div class="group">';
    html += rowTap("Ставка и надбавки", (function () {
      if (!S.cfg.rate) return "не задана";
      var t = rub(S.cfg.rate) + " / " + (S.cfg.payMode === "hourly" ? "час" : "сутки");
      var bits = [];
      if (Number(S.cfg.rk) > 1) bits.push("РК " + S.cfg.rk);
      if (Number(S.cfg.northPct)) bits.push("север " + S.cfg.northPct + "%");
      if (Number(S.cfg.vahtaBonusPct)) bits.push("вахтовая " + S.cfg.vahtaBonusPct + "%");
      if (S.cfg.ndfl) bits.push("НДФЛ");
      return bits.length ? t + " · " + bits.join(", ") : t;
    })(), "page", "payset");
    html += rowTap("График", S.cfg.work && S.cfg.rest ? S.cfg.work + "/" + S.cfg.rest : "не задан", "page", "graphset");
    html += rowTap("Документы", S.docs.length ? String(S.docs.length) : "пусто", "page", "docs");
    html += rowTap("Сборы", (function () {
      var left = S.pack.filter(function (x) { return !x.done; }).length;
      if (!S.pack.length) return "пусто";
      return left ? left + " осталось" : "всё собрано";
    })(), "page", "pack");
    html += "</div><div class=\"group\">";
    html += '<div class="row tap" data-act="share"><div class="lbl">Написать семье статус</div><div class="chev">›</div></div>';
    html += rowTap("Бэкап", "JSON", "page", "backup");
    html += '<div class="row tap" data-act="homescreen"><div class="lbl">На домашний экран</div><div class="chev">›</div></div>';
    html += "</div><div class=\"group\">";
    html += '<div class="row tap" data-act="hard-reset"><div class="lbl danger">Начать заново</div><div class="chev">›</div></div>';
    html += "</div></div>";
    return html;
  }

  function pageHead(t) {
    return '<div class="top"><h1>' + esc(t) + "</h1></div><div class=\"wrap\">";
  }

  function renderPage() {
    if (S.page === "payset") return renderPayset();
    if (S.page === "graphset") return renderGraphset();
    if (S.page === "docs") return renderDocs();
    if (S.page === "pack") return renderPack();
    if (S.page === "backup") return renderBackup();
    return "";
  }

  function opt(v, label, cur) {
    return '<option value="' + v + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  function numField(label, key, step) {
    return '<div class="field"><label>' + esc(label) + '</label><input data-cfg="' + key + '" type="number" step="' + (step || "1") + '" value="' + esc(S.cfg[key]) + '"></div>';
  }

  function renderPayset() {
    var html = pageHead("Ставка и надбавки") + '<div class="group" style="padding:12px 16px">';
    html += '<div class="field"><label>Как платят</label><select data-cfg="payMode"><option value="daily"' + (S.cfg.payMode === "daily" ? " selected" : "") + ">За сутки</option><option value=\"hourly\"" + (S.cfg.payMode === "hourly" ? " selected" : "") + ">За час</option></select></div>";
    html += numField(S.cfg.payMode === "hourly" ? "Ставка, ₽/час" : "Ставка, ₽/сутки", "rate", "100");
    html += '<div class="pair"><div class="field"><label>Начало смены</label><input data-cfg="shiftStart" type="time" value="' + esc(S.cfg.shiftStart) + '"></div><div class="field"><label>Конец смены</label><input data-cfg="shiftEnd" type="time" value="' + esc(S.cfg.shiftEnd) + '"></div></div>';
    html += numField("Часов в смене", "hoursPerShift", "0.5");
    html += '<p class="muted" style="margin:0 0 12px">Часы — для ставки. Время смены — только ночные 22:00–06:00.</p>';
    html += numField("Неоплачиваемый перерыв, мин", "unpaidBreakMin");
    html += numField("Ночные, %", "nightPct");
    html += numField("Праздник, множитель", "holidayMult", "0.1");
    html += '<div class="field"><label>Вахтовая надбавка</label><select data-cfg="vahtaBonusPct">' +
      opt("0", "Нет", S.cfg.vahtaBonusPct) +
      opt("30", "30% прочие районы", S.cfg.vahtaBonusPct) +
      opt("50", "50% Сибирь / ДВ", S.cfg.vahtaBonusPct) +
      opt("75", "75% Крайний Север", S.cfg.vahtaBonusPct) +
      "</select></div>";
    html += numField("Районный коэффициент", "rk", "0.01");
    html += '<p class="muted" style="margin:-4px 0 12px">1 — без районного. 1.7 — типичный север.</p>';
    html += numField("Северная надбавка, %", "northPct");
    html += '<p class="muted" style="margin:-4px 0 12px">0 — нет. Включается только если есть в расчётке.</p>';
    html += '<div class="field"><label>НДФЛ</label><select data-cfg="ndfl">' + opt("0", "Не вычитать", S.cfg.ndfl ? 1 : 0) + opt("1", "13% показать", S.cfg.ndfl ? 1 : 0) + "</select></div>";
    html += numField("Цель на месяц, ₽", "goalMonth", "1000");
    html += "</div></div>";
    return html;
  }

  function renderGraphset() {
    var html = pageHead("График") + '<div class="group" style="padding:12px 16px">';
    html += '<div class="pair">' + numField("Рабочих", "work") + numField("Дома", "rest") + "</div>";
    html += '<div class="field"><label>Заезд и выезд отдельными днями</label><select data-cfg="travelOn">' + opt("1", "Да", S.cfg.travelOn ? 1 : 0) + opt("0", "Нет", S.cfg.travelOn ? 1 : 0) + "</select></div>";
    html += '<div class="field"><label>Заезд/выезд как рабочие (деньги)</label><select data-cfg="travelCountsAsWork">' + opt("0", "Нет", S.cfg.travelCountsAsWork ? 1 : 0) + opt("1", "Да", S.cfg.travelCountsAsWork ? 1 : 0) + "</select></div>";
    html += numField("Напомнить о выезде за, дн", "warnTravelDays");
    html += numField("Напомнить о доках за, дн", "warnDocsDays");
    html += '<button class="btn" data-act="gen">Расставить с сегодня</button>';
    html += "</div></div>";
    return html;
  }

  function renderDocs() {
    var html = pageHead("Документы") + '<div class="group">';
    if (!S.docs.length) html += '<div class="row"><div class="lbl muted">Медкомиссия, аттестация, вакцина — сроки на главной</div></div>';
    S.docs.forEach(function (d) {
      html += '<div class="row tap" data-act="del-doc" data-arg="' + esc(d.id) + '"><div class="lbl">' + esc(d.n) + "<small>до " + esc(d.exp || "—") + '</small></div><div class="chev">×</div></div>';
    });
    html += '</div><button class="btn" data-act="add-doc">Добавить</button></div>';
    return html;
  }

  function renderPack() {
    var html = pageHead("Сборы") + '<div class="group">';
    S.pack.forEach(function (p) {
      html += '<div class="row tap' + (p.done ? " done" : "") + '" data-act="toggle-pack" data-arg="' + esc(p.id) + '"><div class="check' + (p.done ? " on" : "") + '"></div><div class="lbl">' + esc(p.n) + "</div></div>";
    });
    html += '</div><button class="btn ghost" data-act="add-pack">Добавить пункт</button>';
    html += '<button class="btn ghost" data-act="reset-pack">Сбросить галочки</button></div>';
    return html;
  }

  function renderBackup() {
    var dump = JSON.stringify({ v: 1, cfg: S.cfg, days: S.days, pays: S.pays, docs: S.docs, pack: S.pack });
    var html = pageHead("Бэкап") + '<div class="field"><label>Копия. Храни в Избранном Telegram</label><textarea id="dump" readonly>' + esc(dump) + "</textarea></div>";
    html += '<button class="btn" data-act="copy-dump">Скопировать</button>';
    html += '<div class="field" style="margin-top:16px"><label>Восстановить JSON</label><textarea id="restore" placeholder="вставь сюда"></textarea></div>';
    html += '<button class="btn danger" data-act="do-restore">Заменить все данные</button></div>';
    return html;
  }

  function renderWizard() {
    return '<div class="wiz"><h1>Смена</h1><p>Пусто. График, ставку, сборы и документы заполняешь сам. Ничего заранее не расставляем.</p><button class="btn" data-act="wiz" data-arg="7">Открыть</button></div>';
  }

  function renderSheet() {
    var sh = S.sheet;
    if (!sh) return "";
    var inner = "";
    if (sh.k === "day") inner = sheetDay(sh.iso);
    if (sh.k === "pay") inner = sheetPay();
    if (sh.k === "doc") inner = sheetDoc();
    if (sh.k === "pack") inner = sheetPack();
    if (sh.k === "gen") inner = sheetGen();
    return '<div class="sheet" data-act="close-sheet"><div class="box" data-stop="1"><div class="grab"></div>' + inner + "</div></div>";
  }

  function sheetDay(iso) {
    var day = S.days[iso] || { t: "" };
    var html = "<h2>" + esc(fmtDay(iso)) + (P.isHoliday(iso) ? " · праздник" : "") + "</h2>";
    html += '<div class="brush">';
    TYPES.forEach(function (t) {
      html += '<button class="chip' + (day.t === t.id ? " on" : "") + '" data-act="set-type" data-arg="' + t.id + '">' + esc(t.label) + "</button>";
    });
    html += "</div>";
    html += '<div class="pair"><div class="field"><label>Часы</label><input id="dh" type="number" step="0.5" value="' + esc(day.h != null ? day.h : "") + '" placeholder="авто"></div>';
    html += '<div class="field"><label>Ночные</label><input id="dn" type="number" step="0.5" value="' + esc(day.n != null ? day.n : "") + '" placeholder="авто"></div></div>';
    html += '<div class="field"><label>Доплата в этот день, ₽</label><input id="dx" type="number" value="' + esc(day.extra || "") + '"></div>';
    html += '<div class="field"><label>Заметка</label><input id="dnote" value="' + esc(day.note || "") + '"></div>';
    html += '<button class="btn" data-act="save-day">Сохранить</button>';
    html += '<button class="btn ghost" data-act="clear-day">Убрать день</button>';
    return html;
  }

  function sheetPay() {
    return "<h2>Запись</h2>" +
      '<div class="field"><label>Тип</label><select id="pk"><option value="adv">Аванс</option><option value="sal">Расчёт</option><option value="bon">Премия</option><option value="exp">Трата</option></select></div>' +
      '<div class="field"><label>Сумма</label><input id="pa" type="number"></div>' +
      '<div class="field"><label>Дата</label><input id="pd" type="date" value="' + todayIso() + '"></div>' +
      '<div class="field"><label>Заметка</label><input id="pn"></div>' +
      '<button class="btn" data-act="save-pay">Сохранить</button>';
  }

  function sheetDoc() {
    return "<h2>Документ</h2>" +
      '<div class="field"><label>Название</label><input id="dn" placeholder="Медкомиссия"></div>' +
      '<div class="field"><label>Срок</label><input id="de" type="date"></div>' +
      '<button class="btn" data-act="save-doc">Сохранить</button>';
  }

  function sheetPack() {
    return "<h2>Пункт сборов</h2><div class=\"field\"><label>Название</label><input id=\"pn\"></div><button class=\"btn\" data-act=\"save-pack\">Добавить</button>";
  }

  function canAutoGen() {
    return Number(S.cfg.work) >= 1 && Number(S.cfg.rest) >= 0;
  }

  function sheetGen() {
    if (!canAutoGen()) {
      return "<h2>Расставить график</h2><p class=\"muted\">Сначала укажи рабочие и дом в Ещё → График.</p>";
    }
    return "<h2>Расставить график</h2><p class=\"muted\">" + S.cfg.work + "/" + S.cfg.rest + ". Уже заполненные дни не трогаем.</p>" +
      '<div class="field"><label>С даты</label><input id="gs" type="date" value="' + todayIso() + '"></div>' +
      '<button class="btn" data-act="do-gen">Расставить 12 месяцев</button>';
  }

  function bindBack() {
    if (!TG || !TG.BackButton) return;
    if (S.sheet || S.page) {
      TG.BackButton.show();
    } else TG.BackButton.hide();
  }

  function onBack() {
    if (S.sheet) { S.sheet = null; render(); return; }
    if (S.page) { S.page = null; render(); return; }
  }

  function applyPaint(btn) {
    if (!btn || btn.getAttribute("data-act") !== "cell") return;
    var iso = btn.getAttribute("data-arg");
    if (!iso) return;
    var cur = S.days[iso] ? Object.assign({}, S.days[iso]) : {};
    cur.t = S.brush;
    setDay(iso, cur);
    var off = btn.classList.contains("off");
    btn.className = "cell" + (off ? " off" : "") + (iso === todayIso() ? " today" : "") + " t-" + S.brush;
    var dot = btn.querySelector(".dot");
    if (!dot) {
      dot = document.createElement("span");
      btn.appendChild(dot);
    }
    dot.className = "dot t-" + S.brush;
  }

  var painting = false;
  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }

  function finishWiz() {
    emptyState();
    scheduleSave();
    flush();
    S.tab = "home";
    render();
  }

  $.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act], [data-tab]");
    if (e.target.closest("[data-stop]") && !t) { e.stopPropagation(); return; }
    if (!t) {
      if (e.target.classList.contains("sheet")) { S.sheet = null; render(); }
      return;
    }
    if (t.dataset.tab) {
      S.tab = t.dataset.tab;
      S.page = null;
      haptic();
      render();
      return;
    }
    var act = t.dataset.act;
    var arg = t.dataset.arg;
    haptic();
    if (act === "close-sheet") { S.sheet = null; render(); }
    else if (act === "wiz") finishWiz();
    else if (act === "go-money") { S.tab = "money"; render(); }
    else if (act === "page") { S.page = arg; render(); }
    else if (act === "prev-m") { S.ym.m -= 1; if (S.ym.m < 0) { S.ym.m = 11; S.ym.y -= 1; } render(); }
    else if (act === "next-m") { S.ym.m += 1; if (S.ym.m > 11) { S.ym.m = 0; S.ym.y += 1; } render(); }
    else if (act === "brush") { S.brush = arg; render(); }
    else if (act === "toggle-paint") { S.paint = !S.paint; render(); }
    else if (act === "cell") {
      if (S.paint) {
        applyPaint(t);
      } else {
        S.sheet = { k: "day", iso: arg };
        render();
      }
    } else if (act === "open-day") { S.sheet = { k: "day", iso: arg }; render(); }
    else if (act === "set-type") {
      S.sheet.t = arg;
      var day = S.days[S.sheet.iso] || {};
      day.t = arg;
      setDay(S.sheet.iso, day);
      render();
    } else if (act === "save-day") {
      var cur = S.days[S.sheet.iso] || { t: "w" };
      var h = val("dh"); var n = val("dn"); var x = val("dx");
      cur.h = h === "" ? null : Number(h);
      cur.n = n === "" ? null : Number(n);
      cur.extra = x === "" ? 0 : Number(x);
      cur.note = val("dnote").slice(0, 200);
      if (!cur.t) cur.t = "w";
      setDay(S.sheet.iso, cur);
      S.sheet = null;
      render();
    } else if (act === "clear-day") {
      setDay(S.sheet.iso, null);
      S.sheet = null;
      render();
    } else if (act === "gen") { S.sheet = { k: "gen" }; render(); }
    else if (act === "do-gen") {
      if (!canAutoGen()) { toast("Сначала укажи рабочие и дом"); return; }
      var gs = val("gs") || todayIso();
      var gen = P.generateRotation({ start: gs, work: S.cfg.work, rest: S.cfg.rest, months: 12, travelOn: S.cfg.travelOn });
      Object.keys(gen).forEach(function (iso) {
        if (!S.days[iso]) { S.days[iso] = gen[iso]; markDay(iso); }
      });
      scheduleSave();
      S.sheet = null;
      S.page = null;
      S.tab = "cal";
      toast("График расставлен");
      render();
    } else if (act === "add-pay") { S.sheet = { k: "pay" }; render(); }
    else if (act === "save-pay") {
      S.pays.push({ id: "p" + Date.now(), k: val("pk"), a: Number(val("pa")) || 0, d: val("pd") || todayIso(), n: val("pn") });
      scheduleSave();
      S.sheet = null;
      render();
    } else if (act === "del-pay") {
      confirmTg("Удалить запись?", function () {
        S.pays = S.pays.filter(function (x) { return x.id !== arg; });
        scheduleSave();
        render();
      });
    } else if (act === "add-doc") { S.sheet = { k: "doc" }; render(); }
    else if (act === "save-doc") {
      S.docs.push({ id: "d" + Date.now(), n: val("dn") || "Документ", exp: val("de") });
      scheduleSave();
      S.sheet = null;
      render();
    } else if (act === "del-doc") {
      confirmTg("Удалить документ?", function () {
        S.docs = S.docs.filter(function (x) { return x.id !== arg; });
        scheduleSave();
        render();
      });
    } else if (act === "toggle-pack") {
      S.pack.forEach(function (p) { if (p.id === arg) p.done = !p.done; });
      scheduleSave();
      render();
    } else if (act === "add-pack") { S.sheet = { k: "pack" }; render(); }
    else if (act === "save-pack") {
      S.pack.push({ id: "k" + Date.now(), n: val("pn") || "Пункт", done: false });
      scheduleSave();
      S.sheet = null;
      render();
    } else if (act === "reset-pack") {
      S.pack.forEach(function (p) { p.done = false; });
      scheduleSave();
      render();
    } else if (act === "share") shareStatus();
    else if (act === "homescreen") {
      try { TG && TG.addToHomeScreen && TG.addToHomeScreen(); toast("Если клиент умеет — появится запрос"); }
      catch (err) { toast("Клиент не умеет"); }
    } else if (act === "copy-dump") {
      var ta = document.getElementById("dump");
      if (ta) {
        ta.select();
        try { navigator.clipboard.writeText(ta.value); } catch (err) { document.execCommand("copy"); }
        toast("Скопировано");
      }
    } else if (act === "hard-reset") {
      confirmTg("Удалить все данные и начать с нуля?", function () {
        wipeEverything().then(function () {
          emptyState();
          scheduleSave();
          flush();
          toast("Всё стёрто");
          render();
        });
      });
    } else if (act === "do-restore") {
      confirmTg("Заменить все данные этой копией?", function () {
        try {
          var data = JSON.parse(val("restore"));
          if (!data || !data.cfg) throw new Error("bad");
          listMonthKeys().then(function (oldKeys) {
            S.cfg = Object.assign(defCfg(), data.cfg);
            S.days = data.days || {};
            S.pays = data.pays || [];
            S.docs = data.docs || [];
            S.pack = data.pack || [];
            Object.keys(S.days).forEach(markDay);
            var keep = monthsFromDays(S.days);
            (oldKeys || []).forEach(function (k) {
              if (keep.indexOf(k) === -1) delKey(k);
            });
            scheduleSave();
            flush();
            S.page = null;
            toast("Восстановлено");
            render();
          });
        } catch (err) { toast("Непонятный JSON"); }
      });
    }
  });

  $.addEventListener("pointerdown", function (e) {
    if (!S.paint || S.page || S.sheet) return;
    var cell = e.target.closest("[data-act=cell]");
    if (!cell) return;
    painting = true;
    applyPaint(cell);
    haptic("light");
    e.preventDefault();
  });
  window.addEventListener("pointermove", function (e) {
    if (!painting) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var cell = el && el.closest && el.closest("[data-act=cell]");
    if (cell) applyPaint(cell);
  });
  window.addEventListener("pointerup", function () {
    painting = false;
  });
  window.addEventListener("pointercancel", function () {
    painting = false;
  });

  $.addEventListener("change", function (e) {
    var el = e.target;
    if (!el.dataset.cfg) return;
    var key = el.dataset.cfg;
    var v = el.value;
    if (el.type === "number" || key === "rk" || key === "vahtaBonusPct" || key === "ndfl" || key === "travelOn" || key === "travelCountsAsWork") {
      if (key === "ndfl" || key === "travelOn" || key === "travelCountsAsWork") S.cfg[key] = v === "1" || v === "true";
      else S.cfg[key] = Number(v);
    } else S.cfg[key] = v;
    if (key === "shiftStart" || key === "shiftEnd" || key === "unpaidBreakMin") {
      S.cfg.hoursPerShift = P.shiftLength(S.cfg.shiftStart, S.cfg.shiftEnd, S.cfg.unpaidBreakMin);
    }
    scheduleSave();
    if (key === "payMode") render();
  });

  function shareStatus() {
    var p = cycleNow();
    var map = { work: "на вахте", home: "дома", to: "в заезде", from: "в выезде", rest: "выходной на вахте", sick: "на больничном", vac: "в отпуске", empty: "график не отмечен" };
    var line = "Сейчас " + (map[p.status] || "") + ".";
    if (p.next) line += " " + (p.onSite ? "Дома " : "На вахте ") + fmtDay(p.next.date) + ", осталось " + p.next.days + " дн.";
    if (navigator.share) {
      navigator.share({ text: line }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(line).then(function () { toast("Текст скопирован — кинь семье"); });
    } else toast(line);
  }

  function boot() {
    if (TG) {
      TG.ready();
      TG.expand();
      try {
        var plat = TG.platform || "";
        if (TG.requestFullscreen && (plat === "ios" || plat === "android" || plat === "android_x")) {
          TG.requestFullscreen();
        }
      } catch (e) {}
      TG.setHeaderColor && TG.setHeaderColor("secondary_bg_color");
      TG.setBackgroundColor && TG.setBackgroundColor("secondary_bg_color");
      if (TG.BackButton) TG.BackButton.onClick(onBack);
      if (TG.disableVerticalSwipes) TG.disableVerticalSwipes();
      if (TG.onEvent) {
        TG.onEvent("themeChanged", function () {
          TG.setHeaderColor && TG.setHeaderColor("secondary_bg_color");
          TG.setBackgroundColor && TG.setBackgroundColor("secondary_bg_color");
        });
      }
    }
    loadAll().then(function () {
      if (!S.ym) S.ym = { y: new Date().getFullYear(), m: new Date().getMonth() };
      if (S.cfg.setup) lockClose(true);
      render();
    }).catch(function () {
      render();
    });
  }

  boot();
})();
