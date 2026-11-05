import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  sum, pctChange, hoursPerFamily, daysBetween, isoDate, monthlyTrend, taskGaps, taskStatus,
  taskTracker, filterTasks, donationSummary, noShowSummary, headlineFigures, plannerDefaults,
  planScenario, volunteersNeeded, dataIssues,
} from './calc.js';

const data = JSON.parse(readFileSync(new URL('./northside-data.json', import.meta.url), 'utf8'));
const close = (actual, expected, places = 2) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -places, `${actual} is not close to ${expected}`);

// --- small helpers -----------------------------------------------------------

test('sum adds plain numbers and picked fields', () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([{ a: 2 }, { a: 5 }], (x) => x.a), 7);
  assert.equal(sum([]), 0);
});

test('pctChange handles rises, falls and a zero base', () => {
  assert.equal(pctChange(100, 150), 50);
  assert.equal(pctChange(200, 150), -25);
  assert.equal(pctChange(0, 10), null);
});

test('hoursPerFamily returns null with no families', () => {
  assert.equal(hoursPerFamily(190, 0), null);
  close(hoursPerFamily(190, 188), 1.0106, 4);
});

test('daysBetween counts across month ends and backwards', () => {
  assert.equal(daysBetween('2026-10-31', '2026-11-05'), 5);
  assert.equal(daysBetween('2026-11-05', '2026-10-31'), -5);
  assert.equal(daysBetween('2026-11-05', '2026-11-05'), 0);
});

test('isoDate pads months and days', () => {
  assert.equal(isoDate(new Date(2026, 0, 7)), '2026-01-07');
});

// --- demand against hours ---------------------------------------------------

test('monthlyTrend indexes to the first month', () => {
  const rows = monthlyTrend(data.monthly);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].familiesIndex, 100);
  assert.equal(rows[0].hoursIndex, 100);
  close(rows[4].familiesIndex, (188 / 142) * 100);
  close(rows[4].hoursIndex, (190 / 260) * 100);
  close(rows[0].hoursPerFamily, 260 / 142);
  assert.deepEqual(monthlyTrend([]), []);
});

// --- gaps -------------------------------------------------------------------

test('taskGaps sorts by gap and totals the shortfall', () => {
  const { rows, totals } = taskGaps(data.tasks);
  assert.deepEqual(totals, { needed: 35, assigned: 17, gap: 18 });
  assert.equal(rows[0].id, 'T01');
  assert.equal(rows[0].gap, 4);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].gap >= rows[i].gap);
});

test('taskGaps never shows a negative gap when a task is over-staffed', () => {
  const { rows, totals } = taskGaps([{ id: 'X', task: 'x', programme: 'p', needed: 2, assigned: 3 }]);
  assert.equal(rows[0].gap, 0);
  assert.equal(rows[0].assigned, 2);
  assert.equal(totals.gap, 0);
});

// --- task status ------------------------------------------------------------

const task = (over = {}) => ({
  id: 'T', status: 'In progress', completion: 50, deadline_date: '2026-11-10', ...over,
});

test('taskStatus marks unfinished past-deadline tasks overdue', () => {
  assert.deepEqual(taskStatus(task({ deadline_date: '2026-10-31' }), '2026-11-05'), { label: 'Overdue', daysLeft: -5 });
});

test('taskStatus keeps a task due today as not overdue', () => {
  assert.equal(taskStatus(task({ deadline_date: '2026-11-05' }), '2026-11-05').label, 'In progress');
});

test('taskStatus shows complete tasks as done even after the deadline', () => {
  assert.equal(taskStatus(task({ completion: 100, deadline_date: '2026-10-01' }), '2026-11-05').label, 'Done');
});

test('taskStatus keeps the stored status when on time', () => {
  assert.equal(taskStatus(task({ status: 'At risk' }), '2026-11-05').label, 'At risk');
  assert.equal(taskStatus(task({ status: 'Not started', completion: 0 }), '2026-11-05').label, 'Not started');
});

test('taskStatus does not trust a stale Overdue or Done label', () => {
  assert.equal(taskStatus(task({ status: 'Overdue' }), '2026-11-05').label, 'In progress');
  assert.equal(taskStatus(task({ status: 'Done' }), '2026-11-05').label, 'In progress');
});

test('taskTracker puts overdue first and names volunteers', () => {
  const rows = taskTracker(data.tasks, data.volunteers, '2026-11-05');
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.status), ['Overdue', 'Overdue', 'Overdue', 'Overdue']);
  assert.equal(rows.at(-1).status, 'Done');
  const packing = rows.find((r) => r.id === 'T01');
  assert.deepEqual(packing.people, ['Amina Shah', 'Ruth Adeyemi', "Daniel Okafor", "Liam O'Connor"]);
  assert.equal(packing.hoursLeft, 103);
});

test('taskTracker moves more tasks to overdue as time passes', () => {
  const rows = taskTracker(data.tasks, data.volunteers, '2026-11-16');
  const overdue = rows.filter((r) => r.status === 'Overdue').map((r) => r.id).sort();
  assert.deepEqual(overdue, ['T01', 'T02', 'T04', 'T05', 'T07', 'T08', 'T09']);
});

test('filterTasks filters by programme and status', () => {
  const rows = taskTracker(data.tasks, data.volunteers, '2026-11-05');
  assert.equal(filterTasks(rows).length, 11);
  assert.equal(filterTasks(rows, { programme: 'Food bank' }).length, 3);
  assert.equal(filterTasks(rows, { programme: 'Food bank', status: 'Overdue' }).length, 2);
  assert.equal(filterTasks(rows, { status: 'Done' }).length, 2);
});

// --- donations and no-shows ---------------------------------------------------

test('donationSummary totals the period and shares the October sources', () => {
  const d = donationSummary(data);
  assert.equal(d.total, 18700);
  assert.equal(d.average, 3740);
  assert.equal(d.sourcesTotal, 3950);
  assert.equal(d.sources[0].source, 'One-off gifts from individuals');
  close(sum(d.sources, (s) => s.share), 100);
});

test('noShowSummary finds repeat no-shows', () => {
  const n = noShowSummary(data);
  assert.equal(n.list.length, 9);
  assert.equal(n.noNoticeCount, 6);
  assert.deepEqual(n.repeat.map((v) => v.name), ['Chloe Evans', "Liam O'Connor", 'Tom Briggs']);
  assert.equal(n.list[0].date_iso, '2026-10-03');
  assert.deepEqual(n.monthly.map((m) => m.count), [3, 5, 7, 6, 9]);
});

// --- headline ---------------------------------------------------------------

test('headlineFigures compares October with June', () => {
  const h = headlineFigures(data);
  assert.equal(h.month, 'October');
  assert.equal(h.families, 188);
  close(h.familiesChange, 32.39);
  assert.equal(h.hours, 190);
  close(h.hoursChange, -26.92);
  close(h.hoursPerFamily, 1.0106, 4);
  close(h.baseHoursPerFamily, 1.831, 3);
  assert.equal(h.activeVolunteers, 13);
  assert.equal(h.placesUnfilled, 18);
  assert.equal(h.placesNeeded, 35);
  assert.equal(h.donationsTotal, 18700);
  assert.equal(h.noShows, 9);
  assert.equal(h.baseNoShows, 3);
});

// --- planner ----------------------------------------------------------------

test('plannerDefaults come from the data', () => {
  const p = plannerDefaults(data);
  assert.equal(p.baseHours, 190);
  assert.equal(p.families, 188);
  assert.equal(p.newVolunteerHours, 6.5);
  assert.equal(p.newVolunteerCount, 2);
  close(p.averageVolunteerHours, 190 / 13);
  assert.equal(p.projectedFamilies, 200);
});

test('planScenario with no new volunteers changes nothing', () => {
  const s = planScenario({ baseHours: 190, families: 188, newVolunteers: 0, hoursEach: 10 });
  assert.equal(s.addedHours, 0);
  assert.equal(s.change, 0);
});

test('planScenario adds hours and divides by families', () => {
  const s = planScenario({ baseHours: 190, families: 188, newVolunteers: 10, hoursEach: 6.5 });
  assert.equal(s.addedHours, 65);
  assert.equal(s.totalHours, 255);
  close(s.hoursPerFamily, 255 / 188);
  close(s.change, 65 / 188);
});

test('planScenario ignores negative inputs and handles zero families', () => {
  assert.equal(planScenario({ baseHours: 190, families: 188, newVolunteers: -3, hoursEach: 5 }).addedHours, 0);
  const none = planScenario({ baseHours: 190, families: 0, newVolunteers: 2, hoursEach: 5 });
  assert.equal(none.hoursPerFamily, null);
  assert.equal(none.change, null);
});

test('volunteersNeeded rounds up to whole people', () => {
  const p = plannerDefaults(data);
  const args = { targetPerFamily: p.targetPerFamily, families: 188, baseHours: 190 };
  assert.equal(volunteersNeeded({ ...args, hoursEach: 6.5 }), 24);
  assert.equal(volunteersNeeded({ ...args, hoursEach: p.averageVolunteerHours }), 11);
});

test('volunteersNeeded handles an exact fit, a target already met, and zero hours', () => {
  assert.equal(volunteersNeeded({ targetPerFamily: 2, families: 100, baseHours: 180, hoursEach: 10 }), 2);
  assert.equal(volunteersNeeded({ targetPerFamily: 1, families: 100, baseHours: 180, hoursEach: 10 }), 0);
  assert.equal(volunteersNeeded({ targetPerFamily: 2, families: 100, baseHours: 180, hoursEach: 0 }), null);
});

// --- data checks --------------------------------------------------------------

test('the data file has no inconsistencies', () => {
  assert.deepEqual(dataIssues(data), []);
});

test('dataIssues catches broken data', () => {
  const broken = structuredClone(data);
  broken.volunteers[0].hours += 5;
  broken.tasks[0].assigned = 5;
  broken.donations_october[0].amount += 1;
  broken.noshows[1].date_iso = '2026-10-05';
  const issues = dataIssues(broken);
  assert.ok(issues.some((i) => i.startsWith('Volunteer hours add up to 195')));
  assert.ok(issues.some((i) => i.startsWith('T01: 5 assigned')));
  assert.ok(issues.some((i) => i.startsWith('Donation sources')));
  assert.ok(issues.some((i) => i.includes("Tom Briggs isn't available")));
});
