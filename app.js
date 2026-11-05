import {
  pctChange, monthlyTrend, taskGaps, taskTracker, filterTasks,
  donationSummary, noShowSummary, headlineFigures, plannerDefaults, planScenario,
  volunteersNeeded, dataIssues, STATUS_ORDER, capacityRate, volunteerConcentration,
  noShowRate, insights, boardSummary,
} from './calc.js';
import { lineChart, columnChart, hBars, tableView } from './charts.js';

const $ = (sel) => document.querySelector(sel);
const PALETTE = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];

// ---------------------------------------------------------------------------
// formatting helpers

const fmtInt = (n) => Math.round(n).toLocaleString('en-GB');
const fmtHours = (n, dp = 1) => (n == null ? '—' : `${n.toFixed(dp)}h`);
const fmtMoney = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;
const fmtPct = (n, dp = 1) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(dp)}%`);
const fmtSignedHours = (n, dp = 1) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(dp)}h`);

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** 'delta-up' / 'delta-down' / 'delta-flat'. `invert` means a rise is bad (e.g. no-shows). */
function deltaClass(value, invert = false) {
  if (value == null || Math.abs(value) < 0.05) return 'delta-flat';
  const rose = value > 0;
  return rose !== invert ? 'delta-up' : 'delta-down';
}

function uniqRound(values, step = 0.5) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    const r = Math.round(v / step) * step;
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

function td(text) {
  const el = document.createElement('td');
  el.textContent = text;
  return el;
}

function renderChips(container, values, format, onPick) {
  container.replaceChildren();
  for (const v of values) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = format(v);
    btn.addEventListener('click', () => onPick(v));
    container.append(btn);
  }
}

// ---------------------------------------------------------------------------
// page meta, data-issue banner

function renderMeta(data) {
  $('#charity').textContent = data.charity;
  $('#meta').textContent = `${data.period} · figures as of ${fmtDate(data.as_of)}`;
  $('#footer-note').textContent = data.note || '';
}

function renderDataIssues(data) {
  const issues = dataIssues(data);
  const box = $('#data-issues');
  if (!issues.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const list = $('#data-issues-list');
  list.replaceChildren();
  for (const msg of issues) {
    const li = document.createElement('li');
    li.textContent = msg;
    list.append(li);
  }
}

// ---------------------------------------------------------------------------
// headline

function renderHeadline(data) {
  const h = headlineFigures(data);

  const hero = $('#hero');
  hero.replaceChildren();
  const heroLabel = document.createElement('div');
  heroLabel.className = 'hero-label';
  heroLabel.textContent = `Volunteer hours per family — ${h.month}`;
  const heroValue = document.createElement('div');
  heroValue.className = 'hero-value';
  heroValue.textContent = fmtHours(h.hoursPerFamily);
  const heroDelta = document.createElement('div');
  heroDelta.className = `hero-delta ${deltaClass(h.hoursPerFamilyChange)}`;
  heroDelta.textContent = h.hoursPerFamilyChange == null
    ? '—'
    : `${fmtPct(h.hoursPerFamilyChange)} since ${h.baseMonth} (then ${fmtHours(h.baseHoursPerFamily)})`;
  hero.append(heroLabel, heroValue, heroDelta);

  const activeChange = pctChange(h.baseActiveVolunteers, h.activeVolunteers);
  const cap = capacityRate(data.tasks);
  const conc = volunteerConcentration(data.volunteers, 3);
  const rates = noShowRate(data.monthly);
  const lastRate = rates[rates.length - 1]?.rate ?? null;
  const firstRate = rates[0]?.rate ?? null;
  const rateDelta = lastRate != null && firstRate != null ? lastRate - firstRate : null;

  const tiles = [
    { label: `Families helped — ${h.month}`, value: fmtInt(h.families), delta: h.familiesChange, deltaText: `${fmtPct(h.familiesChange)} since ${h.baseMonth}` },
    { label: `Volunteer hours — ${h.month}`, value: fmtHours(h.hours, 0), delta: h.hoursChange, deltaText: `${fmtPct(h.hoursChange)} since ${h.baseMonth}` },
    { label: 'Active volunteers', value: fmtInt(h.activeVolunteers), delta: activeChange, deltaText: `${fmtPct(activeChange)} since ${h.baseMonth}` },
    {
      label: 'Task hours delivered', value: cap == null ? '—' : `${cap.toFixed(0)}%`,
      warn: cap != null && cap < 60, deltaText: 'of estimated hours, all open tasks',
    },
    { label: `Donations — ${h.month}`, value: fmtMoney(h.donations), delta: h.donationsChange, deltaText: `${fmtPct(h.donationsChange)} since ${h.baseMonth}` },
    {
      label: `No-shows per volunteer — ${h.month}`, value: lastRate == null ? '—' : `${lastRate.toFixed(0)}%`,
      delta: rateDelta, invert: true, warn: rateDelta != null && rateDelta > 5,
      deltaText: rateDelta == null ? '—' : `${rateDelta >= 0 ? '+' : ''}${rateDelta.toFixed(0)}pp since ${h.baseMonth}`,
    },
    {
      label: 'Hours from top 3 volunteers', value: conc.share == null ? '—' : `${conc.share.toFixed(0)}%`,
      warn: conc.share != null && conc.share >= 40,
      deltaText: conc.topN.length ? conc.topN.map((v) => v.name.split(' ')[0]).join(', ') : '—',
    },
    { label: 'Volunteer places unfilled', value: `${h.placesUnfilled}/${h.placesNeeded}`, deltaText: 'across all open tasks' },
  ];
  const tilesEl = $('#tiles');
  tilesEl.replaceChildren();
  for (const t of tiles) {
    const card = document.createElement('div');
    card.className = `tile${t.warn ? ' tile-warn' : ''}`;
    const l = document.createElement('div');
    l.className = 'tile-label';
    l.textContent = t.label;
    const v = document.createElement('div');
    v.className = 'tile-value';
    v.textContent = t.value;
    card.append(l, v);
    if (t.deltaText) {
      const d = document.createElement('div');
      d.className = `tile-delta ${deltaClass(t.delta, t.invert)}`;
      d.textContent = t.deltaText;
      card.append(d);
    }
    tilesEl.append(card);
  }
}

// ---------------------------------------------------------------------------
// needs attention

function renderInsights(data) {
  const items = insights(data, data.as_of);
  const list = $('#insights-list');
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'insight-item insight-info';
    li.textContent = 'Nothing flagged this month.';
    list.append(li);
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = `insight-item insight-${item.severity}`;
    li.textContent = item.text;
    list.append(li);
  }

  const btn = $('#copy-summary');
  btn.addEventListener('click', async () => {
    const text = boardSummary(data, data.as_of);
    const original = btn.textContent;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        copied = document.execCommand('copy');
        ta.remove();
      } catch {
        copied = false;
      }
    }
    btn.textContent = copied ? 'Copied!' : 'Could not copy — see console';
    if (!copied) console.info(`Board summary:\n${text}`);
    setTimeout(() => { btn.textContent = original; }, 1800);
  });
}

// ---------------------------------------------------------------------------
// demand against volunteer hours

function renderDemand(data) {
  const rows = monthlyTrend(data.monthly);
  const labels = rows.map((r) => r.month);

  lineChart($('#chart-demand'), {
    title: 'Families helped and volunteer hours, indexed to the first month = 100',
    labels,
    series: [
      { name: 'Families helped', short: 'Families', values: rows.map((r) => r.familiesIndex), color: '--series-1' },
      { name: 'Volunteer hours', short: 'Hours', values: rows.map((r) => r.hoursIndex), color: '--series-2' },
    ],
    format: (v) => Math.round(v).toString(),
    refLine: 100,
  });

  lineChart($('#chart-per-family'), {
    title: 'Volunteer hours per family helped, by month',
    labels,
    series: [{ name: 'Hours per family', values: rows.map((r) => r.hoursPerFamily), color: '--series-3' }],
    format: (v) => v.toFixed(1),
  });

  tableView(
    $('#table-demand'),
    'Show monthly figures',
    [
      { label: 'Month' },
      { label: 'Families helped', numeric: true },
      { label: 'Volunteer hours', numeric: true },
      { label: 'Hours per family', numeric: true },
      { label: 'Families index', numeric: true },
      { label: 'Hours index', numeric: true },
    ],
    rows.map((r) => [
      r.month,
      fmtInt(r.families),
      fmtInt(r.hours),
      r.hoursPerFamily == null ? '—' : r.hoursPerFamily.toFixed(2),
      r.familiesIndex == null ? '—' : Math.round(r.familiesIndex),
      r.hoursIndex == null ? '—' : Math.round(r.hoursIndex),
    ]),
  );
}

// ---------------------------------------------------------------------------
// volunteer gaps by task

function renderGaps(data) {
  const gaps = taskGaps(data.tasks);
  $('#gaps-sub').textContent =
    `${gaps.totals.assigned} of ${gaps.totals.needed} volunteer places filled; ${gaps.totals.gap} still needed.`;

  hBars($('#chart-gaps'), {
    title: 'Volunteer gaps by task',
    max: Math.max(...gaps.rows.map((r) => r.needed)),
    legend: [{ name: 'Filled', color: '--series-1' }, { name: 'Gap', color: '--series-5' }],
    rows: gaps.rows.map((r) => ({
      label: r.task,
      sub: r.programme,
      segments: [
        { name: 'Filled', value: r.assigned, color: '--series-1' },
        { name: 'Still needed', value: r.gap, color: '--series-5' },
      ],
      endText: `${r.assigned}/${r.needed}`,
      emphasis: r.gap > 0,
    })),
  });

  tableView(
    $('#table-gaps'),
    'Show all tasks',
    [{ label: 'Task' }, { label: 'Programme' }, { label: 'Needed', numeric: true }, { label: 'Assigned', numeric: true }, { label: 'Gap', numeric: true }],
    gaps.rows.map((r) => [r.task, r.programme, r.needed, r.assigned, r.gap]),
  );
}

// ---------------------------------------------------------------------------
// planner

function setupPlanner(data) {
  const defaults = plannerDefaults(data);
  const els = {
    range: $('#p-count-range'), count: $('#p-count'),
    hours: $('#p-hours'), hoursHint: $('#p-hours-hint'), hoursChips: $('#p-hours-chips'),
    families: $('#p-families'), familiesChips: $('#p-families-chips'),
    result: $('#p-result'), delta: $('#p-delta'), total: $('#p-total'),
    plan: $('#chart-plan'), needed: $('#p-needed'),
  };

  const seedHours = defaults.newVolunteerHours || defaults.averageVolunteerHours || 1;
  els.hours.value = Math.round(seedHours * 2) / 2;
  els.families.value = Math.round(defaults.families);
  els.hoursHint.textContent = defaults.newVolunteerCount
    ? `New volunteers so far have averaged ${fmtHours(defaults.newVolunteerHours)} a month; all active volunteers average ${fmtHours(defaults.averageVolunteerHours)}.`
    : `Active volunteers currently average ${fmtHours(defaults.averageVolunteerHours)} a month.`;

  renderChips(
    els.hoursChips,
    uniqRound([defaults.newVolunteerHours, defaults.averageVolunteerHours, 5, 10, 20]),
    (v) => `${v}h`,
    (v) => { els.hours.value = v; recalc(); },
  );
  renderChips(
    els.familiesChips,
    uniqRound([defaults.families, defaults.projectedFamilies], 1),
    (v) => fmtInt(v),
    (v) => { els.families.value = v; recalc(); },
  );

  function recalc() {
    const newVolunteers = Number(els.range.value) || 0;
    const hoursEach = Number(els.hours.value) || 0;
    const families = Number(els.families.value) || defaults.families;
    const scen = planScenario({ baseHours: defaults.baseHours, families, newVolunteers, hoursEach });

    els.result.textContent = fmtHours(scen.hoursPerFamily);
    els.delta.textContent = scen.change == null ? '' : `${fmtSignedHours(scen.change, 2)} vs today`;
    els.delta.className = `delta ${deltaClass(scen.change)}`;

    els.total.textContent = newVolunteers > 0
      ? `${newVolunteers} new volunteer${newVolunteers === 1 ? '' : 's'} at ${fmtHours(hoursEach)} each would add ${fmtHours(scen.addedHours, 0)} a month — ${fmtHours(scen.totalHours, 0)} in total for ${fmtInt(families)} families.`
      : `No new volunteers added yet — this shows today's ${fmtHours(defaults.baseHours, 0)} for ${fmtInt(families)} families.`;

    columnChart(els.plan, {
      title: 'Hours per family: today vs with this plan',
      labels: ['Today', 'With plan'],
      values: [scen.basePerFamily || 0, scen.hoursPerFamily || 0],
      format: (v) => v.toFixed(1),
      color: '--series-1',
    });

    const needed = volunteersNeeded({ targetPerFamily: defaults.targetPerFamily, families, baseHours: defaults.baseHours, hoursEach });
    if (needed === 0) {
      els.needed.textContent = `Already at or above the ${defaults.targetMonth} level of ${fmtHours(defaults.targetPerFamily)} per family.`;
    } else if (needed === null) {
      els.needed.textContent = `Add an hours figure above to see how many new volunteers would get back to the ${defaults.targetMonth} level of ${fmtHours(defaults.targetPerFamily)} per family.`;
    } else {
      els.needed.textContent = `You'd need at least ${needed} new volunteer${needed === 1 ? '' : 's'} like this to get back to the ${defaults.targetMonth} level of ${fmtHours(defaults.targetPerFamily)} per family.`;
    }
  }

  els.range.addEventListener('input', () => { els.count.value = els.range.value; recalc(); });
  els.count.addEventListener('input', () => {
    const v = Math.max(0, Math.min(200, Number(els.count.value) || 0));
    els.range.value = Math.min(30, v);
    recalc();
  });
  els.hours.addEventListener('input', recalc);
  els.families.addEventListener('input', recalc);

  recalc();
}

// ---------------------------------------------------------------------------
// task tracker

function renderTaskTracker(data) {
  const rows = taskTracker(data.tasks, data.volunteers, data.as_of);
  const programmes = [...new Set(data.tasks.map((t) => t.programme))].sort();
  const statuses = STATUS_ORDER.filter((s) => rows.some((r) => r.status === s));

  const progSel = $('#f-programme');
  for (const p of programmes) progSel.append(new Option(p, p));
  const statSel = $('#f-status');
  for (const s of statuses) statSel.append(new Option(s, s));

  $('#tasks-sub').textContent = `Status is worked out from completion and the deadline as of ${fmtDate(data.as_of)}, not just the stored label.`;

  function draw() {
    const filtered = filterTasks(rows, { programme: progSel.value, status: statSel.value });
    const tbody = $('#task-rows');
    tbody.replaceChildren();
    for (const r of filtered) {
      const tr = document.createElement('tr');
      tr.append(td(r.task));

      const statusTd = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `status-pill status-${slug(r.status)}`;
      pill.textContent = r.status;
      statusTd.append(pill);
      tr.append(statusTd);

      const progressTd = document.createElement('td');
      const track = document.createElement('div');
      track.className = 'hbar-track';
      track.style.cssText = 'width:80px;display:inline-block;vertical-align:middle;margin-right:8px;';
      const seg = document.createElement('span');
      seg.className = 'hbar-seg end';
      seg.style.width = `${r.completion}%`;
      seg.style.background = r.completion >= 100 ? 'var(--good)' : 'var(--accent)';
      track.append(seg);
      progressTd.append(track, document.createTextNode(`${r.completion}% (${r.loggedHours}/${r.estHours}h)`));
      tr.append(progressTd);

      const deadlineNote = r.status === 'Done'
        ? 'done'
        : r.daysLeft < 0 ? `${Math.abs(r.daysLeft)}d overdue`
        : r.daysLeft === 0 ? 'today' : `in ${r.daysLeft}d`;
      tr.append(td(`${r.deadline} (${deadlineNote})`));
      tr.append(td(r.people.length ? r.people.join(', ') : '—'));

      const prTd = document.createElement('td');
      const prSpan = document.createElement('span');
      prSpan.className = `priority-${r.priority.toLowerCase()}`;
      prSpan.textContent = r.priority;
      prTd.append(prSpan);
      tr.append(prTd);

      tbody.append(tr);
    }
    $('#f-count').textContent = `${filtered.length} of ${rows.length} tasks shown`;
  }

  progSel.addEventListener('change', draw);
  statSel.addEventListener('change', draw);
  draw();
}

// ---------------------------------------------------------------------------
// donations

function renderDonations(data) {
  const d = donationSummary(data);
  const months = data.monthly;
  $('#donations-sub').textContent =
    `${fmtMoney(d.total)} raised from ${months[0].month} to ${months[months.length - 1].month}, averaging ${fmtMoney(d.average)} a month.`;

  columnChart($('#chart-donations'), {
    title: 'Donations by month',
    labels: d.monthly.map((m) => m.month),
    values: d.monthly.map((m) => m.amount),
    format: fmtMoney,
    color: '--series-3',
  });

  $('#sources-title').textContent = `October sources — ${fmtMoney(d.sourcesTotal)} total`;
  hBars($('#chart-sources'), {
    title: 'October donations by source',
    max: d.sourcesTotal,
    rows: d.sources.map((s, i) => ({
      label: s.source,
      segments: [{ name: s.source, value: s.amount, color: PALETTE[i % PALETTE.length] }],
      endText: `${fmtMoney(s.amount)} (${s.share.toFixed(0)}%)`,
    })),
  });

  tableView(
    $('#table-donations'),
    'Show monthly figures',
    [{ label: 'Month' }, { label: 'Amount', numeric: true }],
    d.monthly.map((m) => [m.month, fmtMoney(m.amount)]),
  );
}

// ---------------------------------------------------------------------------
// no-shows

function renderNoShows(data) {
  const n = noShowSummary(data);
  const last = data.monthly[data.monthly.length - 1];
  $('#noshows-sub').textContent =
    `${last.no_shows} no-shows in ${last.month}; ${n.noNoticeCount} of all logged no-shows gave no notice.`;

  columnChart($('#chart-noshows'), {
    title: 'No-shows by month',
    labels: n.monthly.map((m) => m.month),
    values: n.monthly.map((m) => m.count),
    format: (v) => String(Math.round(v)),
    color: '--series-5',
  });

  const list = $('#repeat-list');
  list.replaceChildren();
  if (!n.repeat.length) {
    const li = document.createElement('li');
    li.textContent = 'No one missed more than one shift in October.';
    list.append(li);
  }
  for (const v of n.repeat) {
    const li = document.createElement('li');
    li.textContent = `${v.name} — ${v.count} missed shifts (${v.shifts.join(', ')})${v.noNotice ? `, ${v.noNotice} with no notice` : ''}`;
    list.append(li);
  }

  tableView(
    $('#table-noshows'),
    'Show every no-show',
    [{ label: 'Date' }, { label: 'Volunteer' }, { label: 'Shift' }, { label: 'Notice' }],
    n.list.map((x) => [x.date, x.volunteer, x.shift, x.notice]),
  );
}

// ---------------------------------------------------------------------------
// init

async function init() {
  try {
    const res = await fetch('northside-data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderMeta(data);
    renderDataIssues(data);
    renderHeadline(data);
    renderInsights(data);
    renderDemand(data);
    renderGaps(data);
    setupPlanner(data);
    renderTaskTracker(data);
    renderDonations(data);
    renderNoShows(data);
  } catch (err) {
    $('#meta').textContent = '';
    const box = $('#load-error');
    box.hidden = false;
    box.textContent = `Could not load the dashboard data: ${err.message}`;
    console.error(err);
  }
}

init();
