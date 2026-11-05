// All dashboard calculations. Pure functions only: no DOM, no fetch, no dates read from the clock.
// Used by app.js in the browser and by the tests in Node.

const MONTH_NUMBERS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

export function sum(items, pick = (x) => x) {
  return items.reduce((total, item) => total + pick(item), 0);
}

/** Percentage change from `from` to `to`, or null when there is no base to compare with. */
export function pctChange(from, to) {
  if (!from) return null;
  return ((to - from) / from) * 100;
}

/** Volunteer hours per family helped, or null when no families were helped. */
export function hoursPerFamily(hours, families) {
  if (!families || families <= 0) return null;
  return hours / families;
}

/** Whole days from one ISO date (YYYY-MM-DD) to another. Negative when `to` is earlier. */
export function daysBetween(fromIso, toIso) {
  const toUtc = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86400000);
}

/** Today's date as YYYY-MM-DD in local time. Takes the date so callers (and tests) control it. */
export function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------------------------------------------------------------------------
// Demand against volunteer hours

/** One row per month, with hours per family and both measures indexed to the first month = 100. */
export function monthlyTrend(monthly) {
  if (monthly.length === 0) return [];
  const base = monthly[0];
  return monthly.map((m) => ({
    month: m.month,
    families: m.families,
    hours: m.hours,
    hoursPerFamily: hoursPerFamily(m.hours, m.families),
    familiesIndex: base.families ? (m.families / base.families) * 100 : null,
    hoursIndex: base.hours ? (m.hours / base.hours) * 100 : null,
  }));
}

// ---------------------------------------------------------------------------
// Volunteer gaps by task

/** Places still to fill on each task, biggest gap first, plus totals. */
export function taskGaps(tasks) {
  const rows = tasks
    .map((t) => ({
      id: t.id,
      task: t.task,
      programme: t.programme,
      needed: t.needed,
      assigned: Math.min(t.assigned, t.needed),
      gap: Math.max(0, t.needed - t.assigned),
    }))
    .sort((a, b) => b.gap - a.gap || b.needed - a.needed || a.id.localeCompare(b.id));
  return {
    rows,
    totals: {
      needed: sum(rows, (r) => r.needed),
      assigned: sum(tasks, (t) => t.assigned),
      gap: sum(rows, (r) => r.gap),
    },
  };
}

// ---------------------------------------------------------------------------
// Task tracker

export const STATUS_ORDER = ['Overdue', 'At risk', 'Behind', 'In progress', 'Not started', 'Done'];

/**
 * The status to show for a task on a given day. Worked out from completion and the deadline,
 * so a task past its deadline shows as Overdue even if the stored status was never updated.
 */
export function taskStatus(task, todayIso) {
  const daysLeft = daysBetween(todayIso, task.deadline_date);
  let label;
  if (task.completion >= 100) label = 'Done';
  else if (daysLeft < 0) label = 'Overdue';
  else if (task.status === 'Overdue' || task.status === 'Done') label = 'In progress';
  else if (STATUS_ORDER.includes(task.status)) label = task.status;
  else label = 'In progress';
  return { label, daysLeft };
}

/** Task rows ready for the tracker: worst status first, then nearest deadline. */
export function taskTracker(tasks, volunteers, todayIso) {
  const names = new Map(volunteers.map((v) => [v.id, v.name]));
  return tasks
    .map((t) => {
      const { label, daysLeft } = taskStatus(t, todayIso);
      return {
        id: t.id,
        task: t.task,
        programme: t.programme,
        priority: t.priority,
        needed: t.needed,
        assigned: t.assigned,
        people: (t.volunteers || []).map((x) => names.get(x.id) || x.id),
        estHours: t.est_hours,
        loggedHours: t.logged_hours,
        hoursLeft: Math.max(0, t.est_hours - t.logged_hours),
        completion: Math.max(0, Math.min(100, t.completion)),
        deadline: t.deadline,
        deadlineDate: t.deadline_date,
        daysLeft,
        status: label,
      };
    })
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        a.deadlineDate.localeCompare(b.deadlineDate) ||
        a.id.localeCompare(b.id),
    );
}

/** Rows that match the chosen programme and status ('' means any). */
export function filterTasks(rows, { programme = '', status = '' } = {}) {
  return rows.filter((r) => (!programme || r.programme === programme) && (!status || r.status === status));
}

// ---------------------------------------------------------------------------
// Donations

export function donationSummary(data) {
  const monthly = data.monthly.map((m) => ({ month: m.month, amount: m.donations }));
  const sourcesTotal = sum(data.donations_october, (s) => s.amount);
  const sources = data.donations_october
    .map((s) => ({ source: s.source, amount: s.amount, share: sourcesTotal ? (s.amount / sourcesTotal) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const total = sum(monthly, (m) => m.amount);
  return {
    monthly,
    total,
    average: monthly.length ? total / monthly.length : 0,
    sources,
    sourcesTotal,
  };
}

// ---------------------------------------------------------------------------
// No-shows

export function noShowSummary(data) {
  const monthly = data.monthly.map((m) => ({ month: m.month, count: m.no_shows }));
  const volunteers = new Map(data.volunteers.map((v) => [v.id, v]));
  const byId = new Map();
  for (const n of data.noshows) {
    const entry = byId.get(n.volunteer_id) || {
      id: n.volunteer_id,
      name: volunteers.get(n.volunteer_id)?.name || n.volunteer,
      status: volunteers.get(n.volunteer_id)?.status || 'Unknown',
      count: 0,
      noNotice: 0,
      shifts: [],
    };
    entry.count += 1;
    if (n.notice === 'None') entry.noNotice += 1;
    entry.shifts.push(n.shift);
    byId.set(n.volunteer_id, entry);
  }
  const byVolunteer = [...byId.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const list = [...data.noshows].sort((a, b) => a.date_iso.localeCompare(b.date_iso));
  return {
    monthly,
    list,
    byVolunteer,
    repeat: byVolunteer.filter((v) => v.count >= 2),
    noNoticeCount: sum(data.noshows, (n) => (n.notice === 'None' ? 1 : 0)),
  };
}

// ---------------------------------------------------------------------------
// Headline figures

export function headlineFigures(data) {
  const first = data.monthly[0];
  const last = data.monthly[data.monthly.length - 1];
  const gaps = taskGaps(data.tasks);
  const donations = donationSummary(data);
  return {
    month: last.month,
    baseMonth: first.month,
    families: last.families,
    familiesChange: pctChange(first.families, last.families),
    hours: last.hours,
    hoursChange: pctChange(first.hours, last.hours),
    hoursPerFamily: hoursPerFamily(last.hours, last.families),
    baseHoursPerFamily: hoursPerFamily(first.hours, first.families),
    hoursPerFamilyChange: pctChange(
      hoursPerFamily(first.hours, first.families),
      hoursPerFamily(last.hours, last.families),
    ),
    activeVolunteers: last.active_volunteers,
    baseActiveVolunteers: first.active_volunteers,
    placesNeeded: gaps.totals.needed,
    placesUnfilled: gaps.totals.gap,
    donations: last.donations,
    donationsChange: pctChange(first.donations, last.donations),
    donationsTotal: donations.total,
    noShows: last.no_shows,
    baseNoShows: first.no_shows,
  };
}

// ---------------------------------------------------------------------------
// Planner

/** Starting values for the planner, all taken from the data. */
export function plannerDefaults(data) {
  const first = data.monthly[0];
  const last = data.monthly[data.monthly.length - 1];
  const working = data.volunteers.filter((v) => v.hours > 0);
  const newcomers = working.filter((v) => v.status === 'New');
  const average = (list) => (list.length ? sum(list, (v) => v.hours) / list.length : 0);
  const growth = data.monthly.length > 1 ? (last.families - first.families) / (data.monthly.length - 1) : 0;
  const averageAll = average(working);
  return {
    baseHours: last.hours,
    families: last.families,
    month: last.month,
    newVolunteerHours: newcomers.length ? average(newcomers) : averageAll,
    newVolunteerCount: newcomers.length,
    averageVolunteerHours: averageAll,
    targetMonth: first.month,
    targetPerFamily: hoursPerFamily(first.hours, first.families),
    projectedFamilies: Math.round(last.families + growth),
  };
}

/** Hours per family if `newVolunteers` each give `hoursEach` hours a month on top of `baseHours`. */
export function planScenario({ baseHours, families, newVolunteers, hoursEach }) {
  const added = Math.max(0, newVolunteers) * Math.max(0, hoursEach);
  const totalHours = baseHours + added;
  const perFamily = hoursPerFamily(totalHours, families);
  const basePerFamily = hoursPerFamily(baseHours, families);
  return {
    addedHours: added,
    totalHours,
    hoursPerFamily: perFamily,
    basePerFamily,
    change: perFamily === null || basePerFamily === null ? null : perFamily - basePerFamily,
  };
}

/** Fewest new volunteers needed to reach `targetPerFamily`. Null if it can't be reached (no hours each). */
export function volunteersNeeded({ targetPerFamily, families, baseHours, hoursEach }) {
  const shortfall = targetPerFamily * families - baseHours;
  if (shortfall <= 1e-9) return 0;
  if (!(hoursEach > 0)) return null;
  return Math.ceil(shortfall / hoursEach - 1e-9);
}

// ---------------------------------------------------------------------------
// Capacity & risk KPIs

/** Share of estimated task hours actually logged, across all tasks. Null with no tasks. */
export function capacityRate(tasks) {
  const estTotal = sum(tasks, (t) => t.est_hours);
  if (!estTotal) return null;
  return (sum(tasks, (t) => t.logged_hours) / estTotal) * 100;
}

/** How much of all logged hours the busiest `topN` volunteers carry between them. */
export function volunteerConcentration(volunteers, topN = 3) {
  const working = volunteers.filter((v) => v.hours > 0).sort((a, b) => b.hours - a.hours);
  const total = sum(working, (v) => v.hours);
  const top = working.slice(0, topN);
  const topHours = sum(top, (v) => v.hours);
  return { topN: top, topHours, total, share: total ? (topHours / total) * 100 : null };
}

/** No-shows per active volunteer, by month — comparable across months unlike a raw count. */
export function noShowRate(monthly) {
  return monthly.map((m) => ({
    month: m.month,
    rate: m.active_volunteers ? (m.no_shows / m.active_volunteers) * 100 : null,
  }));
}

/**
 * What needs attention this month: computed risk flags first (high, then medium),
 * followed by the staff notes as-is. Each item is { severity: 'high'|'medium'|'info', text }.
 */
export function insights(data, todayIso) {
  const items = [];

  const cap = capacityRate(data.tasks);
  if (cap != null && cap < 60) {
    items.push({
      severity: 'high',
      text: `Only ${Math.round(cap)}% of estimated task hours have been logged across all tasks — most are behind pace.`,
    });
  }

  const tracker = taskTracker(data.tasks, data.volunteers, todayIso);
  const overdueHigh = tracker.filter((t) => t.status === 'Overdue' && t.priority === 'High');
  if (overdueHigh.length) {
    items.push({
      severity: 'high',
      text: `${overdueHigh.length} high-priority task${overdueHigh.length === 1 ? ' is' : 's are'} overdue: ${overdueHigh.map((t) => t.task).join(', ')}.`,
    });
  }

  const conc = volunteerConcentration(data.volunteers, 3);
  if (conc.share != null && conc.share >= 40) {
    items.push({
      severity: 'medium',
      text: `The top 3 volunteers (${conc.topN.map((v) => v.name).join(', ')}) carry ${Math.round(conc.share)}% of all logged hours — losing one would hurt capacity.`,
    });
  }

  const rates = noShowRate(data.monthly);
  const first = rates[0];
  const last = rates[rates.length - 1];
  if (first?.rate != null && last?.rate != null && last.rate > first.rate * 1.5 && last.rate - first.rate > 5) {
    items.push({
      severity: 'medium',
      text: `No-shows per volunteer have risen from ${Math.round(first.rate)}% in ${first.month} to ${Math.round(last.rate)}% in ${last.month}.`,
    });
  }

  const gapsById = new Map(taskGaps(data.tasks).rows.map((r) => [r.id, r]));
  const soonGaps = tracker.filter((t) => t.daysLeft >= 0 && t.daysLeft <= 14 && (gapsById.get(t.id)?.gap || 0) > 0);
  if (soonGaps.length) {
    items.push({
      severity: 'medium',
      text: `${soonGaps.length} task${soonGaps.length === 1 ? '' : 's'} due within two weeks still need${soonGaps.length === 1 ? 's' : ''} more volunteers: ${soonGaps.map((t) => t.task).join(', ')}.`,
    });
  }

  for (const note of data.staff_notes || []) items.push({ severity: 'info', text: note });

  const rank = { high: 0, medium: 1, info: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** A short, plain-text summary ready to paste into an email or slide. */
export function boardSummary(data, todayIso) {
  const h = headlineFigures(data);
  const gaps = taskGaps(data.tasks);
  const cap = capacityRate(data.tasks);
  const conc = volunteerConcentration(data.volunteers, 3);
  return [
    `${data.charity} — volunteer capacity summary (${data.period})`,
    '',
    `Families helped: ${Math.round(h.families)} in ${h.month} (${fmtSigned(h.familiesChange)}% vs ${h.baseMonth})`,
    `Volunteer hours: ${Math.round(h.hours)}h in ${h.month} (${fmtSigned(h.hoursChange)}% vs ${h.baseMonth})`,
    `Hours per family: ${h.hoursPerFamily.toFixed(1)}h, vs ${h.baseHoursPerFamily.toFixed(1)}h in ${h.baseMonth}`,
    `Volunteer places: ${gaps.totals.assigned} of ${gaps.totals.needed} filled, ${gaps.totals.gap} still needed`,
    cap != null ? `Task hours delivered: ${Math.round(cap)}% of estimate` : null,
    conc.share != null ? `Top 3 volunteers carry ${Math.round(conc.share)}% of all hours` : null,
    `Donations: £${Math.round(h.donations)} in ${h.month} (${fmtSigned(h.donationsChange)}% vs ${h.baseMonth})`,
    `No-shows: ${h.noShows} in ${h.month}`,
    '',
    `As of ${todayIso}.`,
  ].filter((line) => line != null).join('\n');
}

function fmtSigned(n) {
  return n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Data checks: everything that should agree in the data file. Returns a list of problems.

const AVAILABLE_DAYS = {
  Weekdays: [1, 2, 3, 4, 5],
  Weekends: [0, 6],
  Saturdays: [6],
};

export function dataIssues(data) {
  const issues = [];
  const check = (ok, message) => {
    if (!ok) issues.push(message);
  };
  const volunteers = new Map(data.volunteers.map((v) => [v.id, v]));
  const last = data.monthly[data.monthly.length - 1];
  const year = (data.as_of || '').slice(0, 4);

  check(
    sum(data.volunteers, (v) => v.hours) === last.hours,
    `Volunteer hours add up to ${sum(data.volunteers, (v) => v.hours)}, but ${last.month} shows ${last.hours}.`,
  );
  check(
    sum(data.tasks, (t) => t.logged_hours) === last.hours,
    `Task hours add up to ${sum(data.tasks, (t) => t.logged_hours)}, but ${last.month} shows ${last.hours}.`,
  );

  const taskHoursByVolunteer = new Map();
  for (const t of data.tasks) {
    const people = t.volunteers || [];
    check(t.assigned === people.length, `${t.id}: ${t.assigned} assigned, but ${people.length} volunteers listed.`);
    check(t.logged_hours === sum(people, (p) => p.hours), `${t.id}: logged hours don't match its volunteers' hours.`);
    check(
      t.completion === Math.min(100, Math.round((t.logged_hours / t.est_hours) * 100)),
      `${t.id}: completion ${t.completion}% doesn't match hours logged.`,
    );
    check(t.logged_hours <= t.est_hours, `${t.id}: logged hours are over the estimate.`);
    check((t.status === 'Done') === (t.completion === 100), `${t.id}: status "${t.status}" doesn't match completion.`);
    if (data.as_of) {
      const label = taskStatus(t, data.as_of).label;
      check(label === t.status, `${t.id}: stored status "${t.status}" should be "${label}" on ${data.as_of}.`);
    }
    for (const p of people) {
      const v = volunteers.get(p.id);
      check(Boolean(v), `${t.id}: unknown volunteer ${p.id}.`);
      check(!v || v.status !== 'Inactive', `${t.id}: ${p.id} is inactive.`);
      taskHoursByVolunteer.set(p.id, (taskHoursByVolunteer.get(p.id) || 0) + p.hours);
    }
  }
  for (const v of data.volunteers) {
    const onTasks = taskHoursByVolunteer.get(v.id) || 0;
    check(onTasks === v.hours, `${v.name}: ${v.hours} hours logged, but ${onTasks} on tasks.`);
  }

  for (const m of data.monthly) {
    const ym = `${year}-${String(MONTH_NUMBERS[m.month]).padStart(2, '0')}`;
    const count = data.volunteers.filter(
      (v) => (v.joined || '0000-00') <= ym && ym <= (v.last_active || '9999-99'),
    ).length;
    check(count === m.active_volunteers, `${m.month}: ${m.active_volunteers} active volunteers, but the list gives ${count}.`);
  }

  const sourcesTotal = sum(data.donations_october, (s) => s.amount);
  check(sourcesTotal === last.donations, `Donation sources add up to £${sourcesTotal}, but ${last.month} shows £${last.donations}.`);
  check(data.noshows.length === last.no_shows, `${data.noshows.length} no-shows listed, but ${last.month} shows ${last.no_shows}.`);

  for (const n of data.noshows) {
    const v = volunteers.get(n.volunteer_id);
    check(Boolean(v) && v.name === n.volunteer, `No-show on ${n.date}: ${n.volunteer} doesn't match ${n.volunteer_id}.`);
    if (!v) continue;
    const allowed = AVAILABLE_DAYS[v.availability];
    const [y, mo, d] = n.date_iso.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    check(!allowed || allowed.includes(weekday), `No-show on ${n.date}: ${v.name} isn't available that day.`);
    const task = data.tasks.find((t) => t.id === n.task_id);
    check(
      Boolean(task) && (task.volunteers || []).some((p) => p.id === n.volunteer_id),
      `No-show on ${n.date}: ${v.name} isn't on task ${n.task_id}.`,
    );
  }
  return issues;
}
