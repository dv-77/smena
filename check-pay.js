var assert = require("assert");
var P = require("./webapp/pay.js");

assert.strictEqual(P.isHoliday("2026-01-07"), true);
assert.strictEqual(P.isHoliday("2026-01-09"), false);
assert.strictEqual(P.isHoliday("2026-11-04"), true);
assert.strictEqual(P.nightHours("08:00", "20:00"), 0);
assert.strictEqual(P.nightHours("20:00", "08:00"), 8);
assert.strictEqual(P.shiftLength("08:00", "20:00", 60), 11);

var cfg = {
  payMode: "daily",
  rate: 10000,
  hoursPerShift: 11,
  shiftStart: "08:00",
  shiftEnd: "20:00",
  unpaidBreakMin: 60,
  nightPct: 20,
  holidayMult: 2,
  vahtaBonusPct: 75,
  rk: 1.7,
  northPct: 80,
  ndfl: true,
  ndflPct: 13,
  travelCountsAsWork: false
};

var days = {
  "2026-10-05": { t: "w" },
  "2026-10-06": { t: "r" },
  "2026-11-04": { t: "w" },
  "2026-10-07": { t: "h" }
};

var s = P.summarize(days, cfg, "2026-10-05", "2026-11-04");
assert.strictEqual(s.workDays, 2);
assert.strictEqual(s.siteDays, 3);
assert.strictEqual(s.homeDays, 1);
assert.strictEqual(s.holidayWork, 1);
assert.ok(Math.abs(s.labor - 20000) < 0.01);
assert.ok(Math.abs(s.nightPay - 0) < 0.01);
assert.ok(Math.abs(s.holidayExtra - 10000) < 0.01);
var basePlus = 30000;
assert.ok(Math.abs(s.rkAmt - basePlus * 0.7) < 0.01);
assert.ok(Math.abs(s.northAmt - basePlus * 0.8) < 0.01);
assert.ok(Math.abs(s.bonus - 3 * 10000 * 0.75) < 0.01);
assert.ok(s.gross > s.net);

var plain = Object.assign({}, cfg, { vahtaBonusPct: 0, rk: 1, northPct: 0, ndfl: false });
var ps = P.summarize({ "2026-10-05": { t: "w" }, "2026-10-06": { t: "w" } }, plain, "2026-10-05", "2026-10-06");
assert.strictEqual(ps.workDays, 2);
assert.ok(Math.abs(ps.labor - 20000) < 0.01);
assert.ok(Math.abs(ps.net - 20000) < 0.01);
assert.ok(Math.abs(ps.rkAmt) < 0.01);
assert.ok(Math.abs(ps.bonus) < 0.01);

var nightCfg = Object.assign({}, cfg, { payMode: "hourly", rate: 1000, shiftStart: "20:00", shiftEnd: "08:00", unpaidBreakMin: 0 });
var ns = P.summarize({ "2026-10-05": { t: "w" } }, nightCfg, "2026-10-05", "2026-10-05");
assert.strictEqual(ns.hours, 12);
assert.strictEqual(ns.nightH, 8);
assert.ok(Math.abs(ns.nightPay - 8 * 1000 * 0.2) < 0.01);

var rot = P.generateRotation({ start: "2026-10-01", work: 2, rest: 2, months: 1, travelOn: true });
assert.strictEqual(rot["2026-10-01"].t, "to");
assert.strictEqual(rot["2026-10-02"].t, "from");
assert.strictEqual(rot["2026-10-03"].t, "h");
assert.strictEqual(rot["2026-10-04"].t, "h");
assert.strictEqual(rot["2026-10-05"].t, "to");

assert.strictEqual(P.nightHours("08:00", "08:00"), 8);
assert.strictEqual(P.shiftLength("08:00", "08:00", 60), 23);

var one = P.generateRotation({ start: "2026-10-01", work: 1, rest: 1, months: 1, travelOn: true });
assert.strictEqual(one["2026-10-01"].t, "w");
assert.strictEqual(one["2026-10-02"].t, "h");

var dailyMismatch = Object.assign({}, cfg, { hoursPerShift: 11, shiftStart: "08:00", shiftEnd: "19:00", unpaidBreakMin: 0 });
var dm = P.summarize({ "2026-10-05": { t: "w" } }, dailyMismatch, "2026-10-05", "2026-10-05");
assert.ok(Math.abs(dm.labor - 10000) < 0.01);
assert.ok(Math.abs(dm.hours - 11) < 0.01);

var sickDays = {
  "2026-10-01": { t: "w" },
  "2026-10-02": { t: "s" },
  "2026-10-03": { t: "w" },
  "2026-10-04": { t: "h" }
};
var sickCyc = P.cycleProgress(sickDays, "2026-10-02");
assert.strictEqual(sickCyc.onSite, true);
assert.strictEqual(sickCyc.elapsed, 2);
assert.strictEqual(sickCyc.remain, 2);

var cyc = P.cycleProgress(rot, "2026-10-01");
assert.strictEqual(cyc.onSite, true);
assert.strictEqual(cyc.elapsed, 1);
assert.strictEqual(cyc.remain, 2);
assert.strictEqual(cyc.total, 2);

console.log("check-pay: ok");
