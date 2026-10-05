(function (root) {
  var HOLIDAYS = [
    "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
    "02-23", "03-08", "05-01", "05-09", "06-12", "11-04"
  ];

  var WORKISH = { w: 1, to: 1, from: 1 };
  var SITE = { w: 1, r: 1, to: 1, from: 1 };

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function iso(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function parseIso(s) {
    var p = s.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    return x;
  }

  function md(s) {
    return s.slice(5);
  }

  function isHoliday(dateIso) {
    return HOLIDAYS.indexOf(md(dateIso)) !== -1;
  }

  function toMin(hhmm) {
    var p = String(hhmm || "08:00").split(":");
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }

  function shiftIntervals(start, end) {
    var s = toMin(start);
    var e = toMin(end);
    if (e === s) return [[s, s + 24 * 60]];
    if (e < s) return [[s, 24 * 60], [0, e]];
    return [[s, e]];
  }

  function overlap(a0, a1, b0, b1) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }

  function nightHours(start, end) {
    var night = [[22 * 60, 24 * 60], [0, 6 * 60]];
    var min = 0;
    var iv = shiftIntervals(start, end);
    for (var i = 0; i < iv.length; i++) {
      for (var j = 0; j < night.length; j++) {
        min += overlap(iv[i][0], iv[i][1], night[j][0], night[j][1]);
      }
    }
    return min / 60;
  }

  function shiftLength(start, end, breakMin) {
    var iv = shiftIntervals(start, end);
    var min = 0;
    for (var i = 0; i < iv.length; i++) min += iv[i][1] - iv[i][0];
    min -= Number(breakMin) || 0;
    return Math.max(0, min / 60);
  }

  function rates(cfg) {
    var h = Number(cfg.hoursPerShift) || 11;
    var rate = Number(cfg.rate) || 0;
    if (cfg.payMode === "hourly") {
      return { hourly: rate, daily: rate * h };
    }
    return { hourly: h ? rate / h : 0, daily: rate };
  }

  function isPaidWork(day, cfg) {
    if (!day) return false;
    if (day.t === "w") return true;
    if ((day.t === "to" || day.t === "from") && cfg.travelCountsAsWork) return true;
    return false;
  }

  function isSiteDay(day) {
    return !!(day && SITE[day.t]);
  }

  function eachDate(fromIso, toIso, fn) {
    var d = parseIso(fromIso);
    var end = parseIso(toIso);
    while (d <= end) {
      fn(iso(d), d);
      d = addDays(d, 1);
    }
  }

  function summarize(days, cfg, fromIso, toIso) {
    var r = rates(cfg);
    var nightPct = (Number(cfg.nightPct) || 0) / 100;
    var holMult = Number(cfg.holidayMult) || 2;
    var bonusPct = (Number(cfg.vahtaBonusPct) || 0) / 100;
    var rk = Number(cfg.rk) || 1;
    var north = (Number(cfg.northPct) || 0) / 100;
    var ndflOn = !!cfg.ndfl;
    var ndflPct = (Number(cfg.ndflPct) || 13) / 100;

    var labor = 0;
    var nightPay = 0;
    var holidayExtra = 0;
    var extras = 0;
    var hours = 0;
    var nightH = 0;
    var workDays = 0;
    var siteDays = 0;
    var homeDays = 0;
    var holidayWork = 0;

    eachDate(fromIso, toIso, function (key) {
      var day = days[key];
      if (!day) return;
      if (day.t === "h") homeDays += 1;
      if (isSiteDay(day)) siteDays += 1;
      extras += Number(day.extra) || 0;
      if (!isPaidWork(day, cfg)) return;
      workDays += 1;
      var h = day.h != null ? Number(day.h) : shiftLength(cfg.shiftStart, cfg.shiftEnd, cfg.unpaidBreakMin);
      var n = day.n != null ? Number(day.n) : nightHours(cfg.shiftStart, cfg.shiftEnd);
      if (n > h) n = h;
      hours += h;
      nightH += n;
      var base = h * r.hourly;
      var np = n * r.hourly * nightPct;
      var he = 0;
      if (isHoliday(key) && holMult > 1) {
        he = base * (holMult - 1);
        holidayWork += 1;
      }
      labor += base;
      nightPay += np;
      holidayExtra += he;
    });

    var basePlus = labor + nightPay + holidayExtra;
    var rkAmt = basePlus * (rk - 1);
    var northAmt = basePlus * north;
    var bonus = siteDays * r.daily * bonusPct;
    var gross = basePlus + rkAmt + northAmt + bonus + extras;
    var tax = ndflOn ? gross * ndflPct : 0;
    return {
      hours: hours,
      nightH: nightH,
      workDays: workDays,
      siteDays: siteDays,
      homeDays: homeDays,
      holidayWork: holidayWork,
      labor: labor,
      nightPay: nightPay,
      holidayExtra: holidayExtra,
      rkAmt: rkAmt,
      northAmt: northAmt,
      bonus: bonus,
      extras: extras,
      gross: gross,
      tax: tax,
      net: gross - tax,
      hourly: r.hourly,
      daily: r.daily
    };
  }

  function generateRotation(opts) {
    var start = parseIso(opts.start);
    var work = Math.max(1, Number(opts.work) || 15);
    var rest = Math.max(0, Number(opts.rest) || 15);
    var cycle = work + rest;
    var months = Number(opts.months) || 12;
    var until = addDays(start, Math.max(cycle * 2, 32 * months));
    var travelOn = !!opts.travelOn;
    var out = {};
    var i = 0;
    for (var d = new Date(start); d < until; d = addDays(d, 1), i++) {
      var pos = i % cycle;
      var key = iso(d);
      if (pos < work) {
        var t = "w";
        if (travelOn && pos === 0) t = "to";
        if (travelOn && pos === work - 1) t = "from";
        out[key] = { t: t };
      } else {
        out[key] = { t: "h" };
      }
    }
    return out;
  }

  function nextChange(days, todayIso, want) {
    var d = parseIso(todayIso);
    for (var i = 1; i <= 400; i++) {
      var key = iso(addDays(d, i));
      var day = days[key];
      if (!day) continue;
      if (want === "home" && day.t === "h") return { date: key, days: i };
      if (want === "work" && WORKISH[day.t]) return { date: key, days: i };
    }
    return null;
  }

  function statusOf(day) {
    if (!day) return "empty";
    if (day.t === "h") return "home";
    if (day.t === "to") return "to";
    if (day.t === "from") return "from";
    if (day.t === "r") return "rest";
    if (day.t === "s") return "sick";
    if (day.t === "v") return "vac";
    if (day.t === "w") return "work";
    return "empty";
  }

  function cycleProgress(days, todayIso) {
    var today = days[todayIso];
    var st = statusOf(today);
    var onSite = st === "work" || st === "to" || st === "from" || st === "rest";
    var d = parseIso(todayIso);
    var start = 0;
    for (var i = 0; i <= 90; i++) {
      var key = iso(addDays(d, -i));
      var day = days[key];
      var site = day && SITE[day.t];
      if (onSite ? !site : site) {
        start = i;
        break;
      }
      if (i === 90) start = i;
    }
    var nxt = nextChange(days, todayIso, onSite ? "home" : "work");
    var remain = nxt ? nxt.days : 0;
    var streak = start;
    var total = Math.max(1, streak + remain - (remain ? 1 : 0));
    return {
      onSite: onSite,
      elapsed: streak,
      remain: remain,
      total: total,
      next: nxt,
      status: st
    };
  }

  function moneyInRange(pays, fromIso, toIso) {
    var got = 0;
    var spent = 0;
    for (var i = 0; i < pays.length; i++) {
      var p = pays[i];
      if (p.d < fromIso || p.d > toIso) continue;
      if (p.k === "exp") spent += Number(p.a) || 0;
      else got += Number(p.a) || 0;
    }
    return { got: got, spent: spent };
  }

  function monthBounds(y, m) {
    var from = y + "-" + pad(m + 1) + "-01";
    var last = new Date(y, m + 1, 0).getDate();
    var to = y + "-" + pad(m + 1) + "-" + pad(last);
    return { from: from, to: to };
  }

  function yearBounds(y) {
    return { from: y + "-01-01", to: y + "-12-31" };
  }

  root.SmenaPay = {
    HOLIDAYS: HOLIDAYS,
    iso: iso,
    parseIso: parseIso,
    addDays: addDays,
    pad: pad,
    isHoliday: isHoliday,
    nightHours: nightHours,
    shiftLength: shiftLength,
    rates: rates,
    isPaidWork: isPaidWork,
    summarize: summarize,
    generateRotation: generateRotation,
    nextChange: nextChange,
    statusOf: statusOf,
    cycleProgress: cycleProgress,
    moneyInRange: moneyInRange,
    monthBounds: monthBounds,
    yearBounds: yearBounds,
    eachDate: eachDate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.SmenaPay;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
