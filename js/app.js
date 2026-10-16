/* StudyHub
   Browser-only homework planner. Data lives in localStorage.
   Sections: storage, dates, stats, theme, toasts, assignments,
   dashboard, calendar, timer, grades, events. */

(function () {
  var VIEWS = ["dashboard", "assignments", "calendar", "timer", "grades"];
  var KEYS = {
    assignments: "studyhub.assignments",
    grades: "studyhub.grades",
    prefs: "studyhub.prefs"
  };
  var PRIORITIES = ["low", "medium", "high"];
  var MODE_LABELS = {
    focus: "Focus",
    short: "Short break",
    long: "Long break"
  };
  var MODE_HELP = {
    focus: "Stay on one task until the timer ends.",
    short: "Stand up, stretch, and look away from the screen.",
    long: "Take a real break. This one comes after four focus sessions."
  };
  var RING = 2 * Math.PI * 52;
  var SUBJECT_COLORS = ["#8b5cf6", "#3b82f6", "#06b6d4", "#22c55e", "#f59e0b", "#f43f5e", "#ec4899", "#6366f1"];

  var assignments = [];
  var grades = [];
  var prefs = {};
  var filters = { subject: "all", priority: "all", status: "all", upcoming: false, search: "" };
  var calendar = null;
  var highlightId = null;
  var editingGradeId = null;
  var lastFocus = null;
  var timer = {
    mode: "focus",
    remaining: 25 * 60,
    running: false,
    endTime: 0,
    intervalId: null,
    audio: null
  };

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      try { return window.crypto.randomUUID(); } catch (error) { /* fall through */ }
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function readRaw(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      toast("This browser blocked saving. Your changes will disappear after a refresh.", "error");
      return false;
    }
  }

  function clampMinutes(value, fallback) {
    var number = Math.round(Number(value));
    if (!isFinite(number) || number < 1 || number > 180) return fallback;
    return number;
  }

  function loadPrefs() {
    var saved = {};
    try { saved = JSON.parse(readRaw(KEYS.prefs) || "{}"); } catch (error) { saved = {}; }
    var durations = saved.durations || {};
    return {
      theme: saved.theme === "light" ? "light" : "dark",
      name: typeof saved.name === "string" ? saved.name.slice(0, 40) : "",
      durations: {
        focus: clampMinutes(durations.focus, 25),
        short: clampMinutes(durations.short, 5),
        long: clampMinutes(durations.long, 15)
      },
      sessionsDate: typeof saved.sessionsDate === "string" ? saved.sessionsDate : "",
      focusSessions: Math.max(0, Math.round(Number(saved.focusSessions) || 0))
    };
  }

  function savePrefs() {
    writeRaw(KEYS.prefs, JSON.stringify(prefs));
  }

  function toISO(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function todayISO() {
    return toISO(new Date());
  }

  function parseISO(iso) {
    var parts = String(iso).split("-").map(Number);
    return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  }

  function addDays(iso, amount) {
    var date = parseISO(iso);
    date.setDate(date.getDate() + amount);
    return toISO(date);
  }

  function daysBetween(from, to) {
    return Math.round((parseISO(to) - parseISO(from)) / 86400000);
  }

  function dateOnly(stamp) {
    var date = new Date(stamp);
    if (isNaN(date.getTime())) return todayISO();
    return toISO(date);
  }

  function formatLong(iso) {
    return parseISO(iso).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function formatDate(iso) {
    return parseISO(iso).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
  }

  function formatMinutes(mins) {
    var total = Math.max(0, Math.round(Number(mins) || 0));
    if (total < 60) return total + " min";
    var hours = Math.floor(total / 60);
    var minutes = total % 60;
    return minutes ? hours + "h " + minutes + "m" : hours + "h";
  }

  function relativeDue(iso) {
    var diff = daysBetween(todayISO(), iso);
    if (diff === 0) return "Due today";
    if (diff === 1) return "Due tomorrow";
    if (diff > 1) return "Due in " + diff + " days";
    if (diff === -1) return "Due yesterday";
    return Math.abs(diff) + " days overdue";
  }

  function dueLabel(assignment) {
    var pretty = formatDate(assignment.dueDate);
    if (assignment.completed) {
      var late = assignment.completedAt && dateOnly(assignment.completedAt) > assignment.dueDate;
      return late ? "Completed late · was due " + pretty : "Completed · due " + pretty;
    }
    return relativeDue(assignment.dueDate) + " · " + pretty;
  }

  function subjectColor(name) {
    var hash = 0;
    var text = String(name || "");
    for (var i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
  }

  function normalizeAssignment(item) {
    return {
      id: String(item.id || uid()),
      title: String(item.title || "Untitled").slice(0, 80),
      subject: String(item.subject || "General").slice(0, 40),
      description: String(item.description || "").slice(0, 500),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : todayISO(),
      priority: PRIORITIES.indexOf(item.priority) >= 0 ? item.priority : "medium",
      estimatedMinutes: Math.min(1000, Math.max(1, Math.round(Number(item.estimatedMinutes) || 30))),
      completed: Boolean(item.completed),
      createdAt: item.createdAt || new Date().toISOString(),
      completedAt: item.completedAt || null
    };
  }

  function sampleAssignments() {
    var today = todayISO();
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return [
      {
        title: "Quadratic Functions Problem Set",
        subject: "Algebra II",
        description: "Finish problems 1–18 on parabolas and vertex form. Show your work on the word problems.",
        dueDate: addDays(today, 1),
        priority: "high",
        estimatedMinutes: 50
      },
      {
        title: "Hamlet Act 2 Discussion Questions",
        subject: "English",
        description: "Answer all five questions in complete sentences and cite one line from the act.",
        dueDate: addDays(today, 3),
        priority: "medium",
        estimatedMinutes: 40
      },
      {
        title: "Stoichiometry Lab Report",
        subject: "Chemistry",
        description: "Include the data table, error analysis, and the conclusion paragraph from the lab handout.",
        dueDate: addDays(today, -2),
        priority: "high",
        estimatedMinutes: 90
      },
      {
        title: "Irregular Verb Quiz Prep",
        subject: "Spanish",
        description: "Drill the preterite forms for the 12 verbs on the review sheet.",
        dueDate: today,
        priority: "high",
        estimatedMinutes: 25
      },
      {
        title: "Chapter 9 Reading Notes",
        subject: "U.S. History",
        description: "One page of notes on the New Deal programs. Bullet form is fine.",
        dueDate: addDays(today, 5),
        priority: "low",
        estimatedMinutes: 35
      },
      {
        title: "Personal Website Milestone",
        subject: "Computer Science",
        description: "Publish the homepage and about page. Check keyboard navigation before you submit.",
        dueDate: addDays(today, 8),
        priority: "medium",
        estimatedMinutes: 150
      },
      {
        title: "Cell Division Review Sheet",
        subject: "Biology",
        description: "Compare mitosis and meiosis in the table on page 4.",
        dueDate: addDays(today, 2),
        priority: "medium",
        estimatedMinutes: 45
      },
      {
        title: "Still Life Sketch",
        subject: "Studio Art",
        description: "Graphite drawing of the classroom still life with a full value range.",
        dueDate: addDays(today, -1),
        priority: "low",
        estimatedMinutes: 60,
        completed: true,
        completedAt: yesterday.toISOString()
      },
      {
        title: "Poetry Annotation",
        subject: "English",
        description: "Annotate the assigned poem for tone, imagery, and one shift in the speaker.",
        dueDate: addDays(today, -4),
        priority: "low",
        estimatedMinutes: 20,
        completed: true,
        completedAt: new Date().toISOString()
      },
      {
        title: "Essay Outline: Coming of Age",
        subject: "English",
        description: "Thesis plus three body-paragraph claims with a quotation for each.",
        dueDate: addDays(today, 6),
        priority: "medium",
        estimatedMinutes: 30,
        completed: true,
        completedAt: yesterday.toISOString()
      }
    ].map(function (item) {
      return normalizeAssignment(Object.assign({
        id: uid(),
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null
      }, item));
    });
  }

  function loadAssignments() {
    var raw = readRaw(KEYS.assignments);
    if (raw == null) {
      var seeded = sampleAssignments();
      writeRaw(KEYS.assignments, JSON.stringify(seeded));
      return seeded;
    }
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeAssignment);
    } catch (error) {
      return [];
    }
  }

  function saveAssignments() {
    writeRaw(KEYS.assignments, JSON.stringify(assignments));
  }

  function normalizeGrade(item) {
    var weight = item.weight == null || item.weight === "" ? null : Number(item.weight);
    return {
      id: String(item.id || uid()),
      name: String(item.name || "Untitled").slice(0, 80),
      earned: Math.max(0, Number(item.earned) || 0),
      total: Number(item.total) > 0 ? Number(item.total) : 1,
      weight: weight != null && isFinite(weight) && weight > 0 ? weight : null
    };
  }

  function loadGrades() {
    try {
      var parsed = JSON.parse(readRaw(KEYS.grades) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeGrade);
    } catch (error) {
      return [];
    }
  }

  function saveGrades() {
    writeRaw(KEYS.grades, JSON.stringify(grades));
  }

  function sortAssignments(list) {
    return list.slice().sort(function (a, b) {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority);
    });
  }

  function matchesFilters(assignment, source) {
    var rules = source || filters;
    if (rules.subject !== "all" && assignment.subject !== rules.subject) return false;
    if (rules.priority !== "all" && assignment.priority !== rules.priority) return false;
    if (rules.status === "active" && assignment.completed) return false;
    if (rules.status === "completed" && !assignment.completed) return false;
    if (rules.upcoming && assignment.dueDate < todayISO()) return false;
    var query = (rules.search || "").trim().toLowerCase();
    if (query) {
      var blob = (assignment.title + " " + assignment.subject + " " + assignment.description).toLowerCase();
      if (blob.indexOf(query) === -1) return false;
    }
    return true;
  }

  function filteredAssignments() {
    return sortAssignments(assignments.filter(function (assignment) {
      return matchesFilters(assignment);
    }));
  }

  function getStats() {
    var today = todayISO();
    var weekEnd = addDays(today, 6);
    var active = assignments.filter(function (item) { return !item.completed; });
    var overdue = active.filter(function (item) { return item.dueDate < today; });
    var dueToday = active.filter(function (item) { return item.dueDate === today; });
    var dueWeek = active.filter(function (item) { return item.dueDate >= today && item.dueDate <= weekEnd; });
    var completed = assignments.filter(function (item) { return item.completed; });
    var onTime = completed.filter(function (item) {
      return item.completedAt && dateOnly(item.completedAt) <= item.dueDate;
    });
    var minutesLeft = active.reduce(function (sum, item) { return sum + item.estimatedMinutes; }, 0);
    var percent = assignments.length ? Math.round((completed.length / assignments.length) * 100) : 0;
    return {
      active: active,
      overdue: overdue,
      dueToday: dueToday,
      dueWeek: dueWeek,
      completed: completed,
      onTime: onTime,
      minutesLeft: minutesLeft,
      percent: percent
    };
  }

  function subjectProgress() {
    var map = {};
    assignments.forEach(function (assignment) {
      if (!map[assignment.subject]) map[assignment.subject] = { subject: assignment.subject, total: 0, done: 0 };
      map[assignment.subject].total += 1;
      if (assignment.completed) map[assignment.subject].done += 1;
    });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b); }).map(function (key) {
      return map[key];
    });
  }

  function priorityMix() {
    var counts = { high: 0, medium: 0, low: 0 };
    var active = assignments.filter(function (item) { return !item.completed; });
    active.forEach(function (item) { counts[item.priority] += 1; });
    var total = active.length;
    return {
      counts: counts,
      total: total,
      widths: {
        high: total ? (counts.high / total) * 100 : 0,
        medium: total ? (counts.medium / total) * 100 : 0,
        low: total ? (counts.low / total) * 100 : 0
      }
    };
  }

  function workload() {
    var today = todayISO();
    var weekEnd = addDays(today, 6);
    var buckets = { overdue: 0, week: 0, later: 0 };
    assignments.forEach(function (assignment) {
      if (assignment.completed) return;
      if (assignment.dueDate < today) buckets.overdue += assignment.estimatedMinutes;
      else if (assignment.dueDate <= weekEnd) buckets.week += assignment.estimatedMinutes;
      else buckets.later += assignment.estimatedMinutes;
    });
    buckets.total = buckets.overdue + buckets.week + buckets.later;
    return buckets;
  }

  function currentView() {
    var hash = (location.hash || "#dashboard").slice(1).split("?")[0];
    return VIEWS.indexOf(hash) >= 0 ? hash : "dashboard";
  }

  function toast(message, type) {
    var root = document.getElementById("toast-root");
    var item = document.createElement("div");
    item.className = "toast" + (type === "error" ? " error" : "");
    item.innerHTML = "<p>" + escapeHtml(message) + "</p>";
    item.addEventListener("click", function () { dismissToast(item); });
    root.appendChild(item);
    requestAnimationFrame(function () { item.classList.add("show"); });
    setTimeout(function () { dismissToast(item); }, 3400);
  }

  function dismissToast(item) {
    if (!item || !item.parentNode) return;
    item.classList.remove("show");
    setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 250);
  }

  function openModal(html, onReady) {
    var root = document.getElementById("modal-root");
    lastFocus = document.activeElement;
    root.innerHTML = '<div class="modal-backdrop" id="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' + html + "</div></div>";
    document.body.classList.add("modal-open");
    if (onReady) onReady(root);
    var focusTarget = root.querySelector("input, select, textarea, button");
    if (focusTarget) focusTarget.focus();
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
    document.body.classList.remove("modal-open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function showFormError(root, message) {
    var error = root.querySelector(".form-error");
    if (!error) return;
    if (!message) {
      error.hidden = true;
      error.textContent = "";
      return;
    }
    error.hidden = false;
    error.textContent = message;
  }

  function applyTheme() {
    var light = prefs.theme === "light";
    document.documentElement.setAttribute("data-theme", prefs.theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", light ? "#eef2f9" : "#070d1a");
    var label = light ? "Switch to dark theme" : "Switch to light theme";
    document.getElementById("theme-toggle").setAttribute("aria-pressed", String(light));
    document.getElementById("theme-toggle").setAttribute("aria-label", label);
    document.getElementById("theme-toggle-top").setAttribute("aria-label", label);
    document.getElementById("theme-label").textContent = light ? "Light theme" : "Dark theme";
  }

  function toggleTheme() {
    prefs.theme = prefs.theme === "light" ? "dark" : "light";
    savePrefs();
    applyTheme();
  }

  function setSidebar(open) {
    document.getElementById("sidebar").classList.toggle("open", open);
    document.getElementById("backdrop").hidden = !open;
    document.getElementById("menu-btn").setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("nav-open", open);
  }

  function updateNavBadge() {
    var count = assignments.filter(function (item) {
      return !item.completed && item.dueDate < todayISO();
    }).length;
    var badge = document.getElementById("nav-overdue");
    badge.hidden = count === 0;
    badge.textContent = String(count);
  }

  function showView(name) {
    if (VIEWS.indexOf(name) === -1) name = "dashboard";
    if (location.hash !== "#" + name) {
      location.hash = name;
      return;
    }
    var modalRoot = document.getElementById("modal-root");
    if (modalRoot.innerHTML) {
      modalRoot.innerHTML = "";
      document.body.classList.remove("modal-open");
    }
    document.querySelectorAll(".view").forEach(function (view) {
      view.classList.toggle("active", view.id === "view-" + name);
    });
    document.querySelectorAll(".nav-btn").forEach(function (link) {
      var on = link.getAttribute("data-view") === name;
      link.classList.toggle("active", on);
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    var titles = {
      dashboard: ["Dashboard", "Your day at a glance"],
      assignments: ["Assignments", "Add, edit, and finish your work"],
      calendar: ["Calendar", "See what is due and when"],
      timer: ["Study Timer", "Focus in short sessions"],
      grades: ["Grade Calculator", "Turn scores into an average"]
    };
    document.getElementById("page-title").textContent = titles[name][0];
    document.getElementById("page-sub").textContent = titles[name][1];
    document.title = titles[name][0] + " · StudyHub";
    setSidebar(false);
    if (name === "dashboard") renderDashboard();
    if (name === "assignments") {
      renderSubjectOptions();
      renderAssignmentList();
    }
    if (name === "calendar") renderCalendar();
    if (name === "timer") {
      updateTimerDom({ full: true });
      renderStudyNext();
    }
    if (name === "grades") renderGrades();
  }

  function animateBars(scope) {
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scope.querySelectorAll("[data-fill]").forEach(function (element) {
      var value = element.getAttribute("data-fill") + "%";
      if (reduced) element.style.width = value;
      else requestAnimationFrame(function () {
        requestAnimationFrame(function () { element.style.width = value; });
      });
    });
    scope.querySelectorAll("[data-ring]").forEach(function (element) {
      var offset = element.getAttribute("data-offset");
      if (reduced) element.setAttribute("stroke-dashoffset", offset);
      else requestAnimationFrame(function () {
        requestAnimationFrame(function () { element.setAttribute("stroke-dashoffset", offset); });
      });
    });
  }

  function meter(label, caption, percent, extraClass) {
    var safe = Math.max(0, Math.min(100, percent));
    return '<div class="meter"><div class="meter-label"><span>' + label + '</span><span>' + caption + '</span></div><div class="meter-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(safe) + '" aria-label="' + label + '"><div class="meter-fill ' + (extraClass || "") + '" data-fill="' + safe + '"></div></div></div>';
  }

  function emptyState(title, copy, actionLabel, action) {
    return '<div class="empty"><div class="empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h11M8 12h11M8 18h7"></path><path d="M4 6h.01M4 12h.01M4 18h.01"></path></svg></div><h3>' + title + "</h3><p>" + copy + "</p>" + (actionLabel ? '<button type="button" class="btn btn-primary" data-action="' + action + '">' + actionLabel + "</button>" : "") + "</div>";
  }

  function assignmentRow(assignment) {
    var overdue = !assignment.completed && assignment.dueDate < todayISO();
    return '<div class="row-item' + (assignment.completed ? " is-done" : "") + (overdue ? " is-overdue" : "") + '"><span class="priority-dot priority-' + assignment.priority + '" aria-hidden="true"></span><div class="row-copy"><strong>' + escapeHtml(assignment.title) + "</strong><span>" + escapeHtml(assignment.subject) + " · " + escapeHtml(dueLabel(assignment)) + " · " + formatMinutes(assignment.estimatedMinutes) + '</span></div><div class="row-actions"><button type="button" class="btn btn-small ' + (assignment.completed ? "btn-ghost" : "btn-success") + '" data-action="toggle-complete" data-id="' + assignment.id + '">' + (assignment.completed ? "Reopen" : "Done") + '</button><button type="button" class="btn btn-small btn-ghost" data-action="edit" data-id="' + assignment.id + '">Edit</button><button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="' + assignment.id + '">Delete</button></div></div>';
  }

  function greeting() {
    var hour = new Date().getHours();
    var part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    var name = prefs.name.trim();
    return name ? "Good " + part + ", " + name : "Good " + part;
  }

  function heroMessage(stats) {
    if (!assignments.length) return "Add an assignment to start planning. Everything stays saved in this browser.";
    if (!stats.active.length) return "Everything on your list is complete. Enjoy the breathing room.";
    if (stats.overdue.length && stats.dueToday.length) {
      return stats.overdue.length + " overdue and " + stats.dueToday.length + " due today. Start with the oldest one.";
    }
    if (stats.overdue.length) {
      return stats.overdue.length + " overdue " + (stats.overdue.length === 1 ? "assignment needs" : "assignments need") + " attention.";
    }
    if (stats.dueToday.length) {
      return stats.dueToday.length + " due today. You still have " + formatMinutes(stats.minutesLeft) + " of work overall.";
    }
    return stats.active.length + " active " + (stats.active.length === 1 ? "assignment" : "assignments") + " and " + formatMinutes(stats.minutesLeft) + " of work still ahead.";
  }

  function renderDashboard() {
    var stats = getStats();
    var subjects = subjectProgress();
    var mix = priorityMix();
    var load = workload();
    var upcoming = sortAssignments(stats.active.filter(function (item) { return item.dueDate >= todayISO(); })).slice(0, 5);
    var overdueSorted = sortAssignments(stats.overdue);
    var onTimePercent = stats.completed.length ? Math.round((stats.onTime.length / stats.completed.length) * 100) : 0;
    var offset = RING * (1 - stats.percent / 100);
    var subjectMeters = subjects.length
      ? subjects.map(function (row) {
        var pct = Math.round((row.done / row.total) * 100);
        return meter(escapeHtml(row.subject), row.done + " of " + row.total, pct);
      }).join("")
      : "<p class=\"muted\">Subject progress will show up after you add assignments.</p>";
    var priorityBlock = mix.total
      ? '<div class="stack" aria-hidden="true"><span class="stack-seg priority-high" data-fill="' + mix.widths.high + '"></span><span class="stack-seg priority-medium" data-fill="' + mix.widths.medium + '"></span><span class="stack-seg priority-low" data-fill="' + mix.widths.low + '"></span></div><ul class="legend"><li><i class="dot priority-high"></i> High ' + mix.counts.high + '</li><li><i class="dot priority-medium"></i> Medium ' + mix.counts.medium + '</li><li><i class="dot priority-low"></i> Low ' + mix.counts.low + "</li></ul>"
      : "<p class=\"muted\">No active assignments, so the priority mix is empty.</p>";
    var loadBlock = load.total
      ? (function () {
        var overdueWidth = (load.overdue / load.total) * 100;
        var weekWidth = (load.week / load.total) * 100;
        var laterWidth = (load.later / load.total) * 100;
        return '<div class="workload"><div class="meter-label"><span>Study time still on your list</span><span>' + formatMinutes(load.total) + '</span></div><div class="stack" aria-label="Remaining study time"><span class="stack-seg priority-high" data-fill="' + overdueWidth + '"></span><span class="stack-seg priority-medium" data-fill="' + weekWidth + '"></span><span class="stack-seg priority-low" data-fill="' + laterWidth + '"></span></div><ul class="legend"><li><i class="dot priority-high"></i> Overdue ' + formatMinutes(load.overdue) + '</li><li><i class="dot priority-medium"></i> This week ' + formatMinutes(load.week) + '</li><li><i class="dot priority-low"></i> Later ' + formatMinutes(load.later) + "</li></ul></div>";
      })()
      : "";
    var upcomingHtml = upcoming.length
      ? '<div class="row-list">' + upcoming.map(assignmentRow).join("") + "</div>"
      : emptyState("Nothing coming up", assignments.length ? "No active assignments are due today or later." : "Add a due date and it will land here.", assignments.length ? "" : "Add assignment", "add");
    var overdueHtml = stats.overdue.length
      ? '<div class="row-list">' + overdueSorted.map(assignmentRow).join("") + "</div>"
      : emptyState(assignments.length ? "No overdue work" : "No assignments yet", assignments.length ? "You are on top of the due dates." : "Add an assignment and anything past due will show here.", "", "");

    document.getElementById("view-dashboard").innerHTML = ''
      + '<section class="hero"><div class="hero-copy"><p class="eyebrow">' + escapeHtml(formatLong(todayISO())) + "</p><h2>" + escapeHtml(greeting()) + '</h2><p class="hero-message">' + escapeHtml(heroMessage(stats)) + '</p><div class="hero-actions"><button type="button" class="btn btn-primary" data-action="add">Add assignment</button><button type="button" class="btn btn-on-dark" data-action="edit-name">' + (prefs.name.trim() ? "Change name" : "Add your name") + '</button></div></div><div class="hero-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#c4b5fd"></stop><stop offset="100%" stop-color="#60a5fa"></stop></linearGradient></defs><circle cx="60" cy="60" r="52" class="ring-track"></circle><circle cx="60" cy="60" r="52" class="ring-value" data-ring data-offset="' + offset + '" stroke-dasharray="' + RING + '" stroke-dashoffset="' + RING + '"></circle></svg><div class="hero-ring-label"><strong>' + stats.percent + '%</strong><span>complete</span></div></div></section>'
      + '<div class="stat-grid">'
      + statCard("Active", stats.active.length, "Still on your list", "")
      + statCard("Overdue", stats.overdue.length, "Past the due date", stats.overdue.length ? "is-alert" : "", "alert")
      + statCard("Due this week", stats.dueWeek.length, "Today through the next 6 days", "", "week")
      + statCard("Completed", stats.completed.length, assignments.length ? stats.percent + "% of your list" : "Nothing checked off yet", "", "good")
      + "</div>"
      + '<div class="dash-grid"><section class="card"><div class="section-head"><h2>Progress</h2><a class="linkish" href="#assignments">View assignments</a></div>'
      + meter("Overall", stats.completed.length + " of " + assignments.length + " complete", stats.percent)
      + meter("On time", stats.completed.length ? stats.onTime.length + " of " + stats.completed.length + " completed on time" : "Complete one to start this", onTimePercent, "good")
      + subjectMeters
      + '<div class="meter-label"><span>Active work by priority</span><span>' + mix.total + "</span></div>"
      + priorityBlock
      + loadBlock
      + '</section><section class="card"><div class="section-head"><h2>Upcoming deadlines</h2><a class="linkish" href="#calendar">Open calendar</a></div>' + upcomingHtml + "</section></div>"
      + '<section class="card"><div class="section-head"><h2>Overdue</h2></div>' + overdueHtml + "</section>";

    animateBars(document.getElementById("view-dashboard"));
  }

  function statCard(label, value, hint, valueClass, iconClass) {
    return '<article class="stat-card"><div class="stat-icon ' + (iconClass || "") + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19V5M4 19h16"></path><path d="M8 16l3-4 3 2 4-6"></path></svg></div><p class="stat-label">' + label + '</p><p class="stat-value ' + (valueClass || "") + '">' + value + '</p><p class="stat-hint">' + hint + "</p></article>";
  }

  function renderSubjectOptions() {
    var select = document.getElementById("filter-subject");
    var subjects = [];
    assignments.forEach(function (assignment) {
      if (subjects.indexOf(assignment.subject) === -1) subjects.push(assignment.subject);
    });
    subjects.sort(function (a, b) { return a.localeCompare(b); });
    if (filters.subject !== "all" && subjects.indexOf(filters.subject) === -1) filters.subject = "all";
    select.innerHTML = '<option value="all">All subjects</option>' + subjects.map(function (subject) {
      return '<option value="' + escapeHtml(subject) + '">' + escapeHtml(subject) + "</option>";
    }).join("");
    select.value = filters.subject;
  }

  function syncFilterStyles() {
    document.getElementById("filter-subject").classList.toggle("is-set", filters.subject !== "all");
    document.getElementById("filter-priority").classList.toggle("is-set", filters.priority !== "all");
    document.getElementById("filter-status").classList.toggle("is-set", filters.status !== "all");
    document.getElementById("filter-search").classList.toggle("is-set", filters.search.trim() !== "");
    document.getElementById("filter-upcoming").closest("label").classList.toggle("is-set", filters.upcoming);
  }

  function assignmentCard(assignment) {
    var overdue = !assignment.completed && assignment.dueDate < todayISO();
    return '<article class="task-card priority-' + assignment.priority + (assignment.completed ? " is-done" : "") + (overdue ? " is-overdue" : "") + (assignment.id === highlightId ? " just-added" : "") + '"><div class="task-top"><span class="subject-pill" style="--pill:' + subjectColor(assignment.subject) + '">' + escapeHtml(assignment.subject) + '</span><span class="priority-pill priority-' + assignment.priority + '">' + assignment.priority + "</span></div><h3>" + escapeHtml(assignment.title) + "</h3><p class=\"task-meta\">" + escapeHtml(dueLabel(assignment)) + " · " + formatMinutes(assignment.estimatedMinutes) + (overdue ? ' <span class="chip-overdue">Overdue</span>' : "") + "</p>" + (assignment.description ? '<p class="task-desc" title="' + escapeHtml(assignment.description) + '">' + escapeHtml(assignment.description) + "</p>" : "") + '<div class="task-actions"><button type="button" class="btn btn-small ' + (assignment.completed ? "btn-ghost" : "btn-success") + '" data-action="toggle-complete" data-id="' + assignment.id + '">' + (assignment.completed ? "Reopen" : "Complete") + '</button><button type="button" class="btn btn-small btn-ghost" data-action="edit" data-id="' + assignment.id + '">Edit</button><button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="' + assignment.id + '">Delete</button></div></article>';
  }

  function renderAssignmentList() {
    var list = document.getElementById("assignment-list");
    var count = document.getElementById("list-count");
    syncFilterStyles();
    if (!assignments.length) {
      count.textContent = "No assignments yet";
      list.innerHTML = emptyState("No assignments yet", "Add your first assignment and it will show up here, on the dashboard, and on the calendar.", "Add assignment", "add");
      return;
    }
    var rows = filteredAssignments();
    count.textContent = "Showing " + rows.length + " of " + assignments.length;
    if (!rows.length) {
      list.innerHTML = emptyState("Nothing matches", "No assignments fit these filters. Clear them to see the full list.", "Clear filters", "clear-filters");
      return;
    }
    list.innerHTML = '<div class="card-grid">' + rows.map(assignmentCard).join("") + "</div>";
  }

  function clearFilters() {
    filters = { subject: "all", priority: "all", status: "all", upcoming: false, search: "" };
    document.getElementById("filter-subject").value = "all";
    document.getElementById("filter-priority").value = "all";
    document.getElementById("filter-status").value = "all";
    document.getElementById("filter-upcoming").checked = false;
    document.getElementById("filter-search").value = "";
    renderAssignmentList();
  }

  function readAssignmentForm(form) {
    var title = form.title.value.trim();
    var subject = form.subject.value.trim();
    var description = form.description.value.trim();
    var dueDate = form.due.value;
    var priority = form.priority.value;
    var minutes = Math.round(Number(form.minutes.value));
    if (!title) return { error: "Add a title so you can recognize this assignment." };
    if (!subject) return { error: "Add a subject, like Algebra II or English." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { error: "Choose a due date." };
    if (PRIORITIES.indexOf(priority) === -1) return { error: "Choose a priority." };
    if (!isFinite(minutes) || minutes < 1) return { error: "Estimated time must be at least 1 minute." };
    if (minutes > 1000) return { error: "Estimated time must be 1000 minutes or less." };
    return {
      data: {
        title: title.slice(0, 80),
        subject: subject.slice(0, 40),
        description: description.slice(0, 500),
        dueDate: dueDate,
        priority: priority,
        estimatedMinutes: minutes
      }
    };
  }

  function openAssignmentModal(existing, presetDate) {
    var assignment = existing || {
      title: "",
      subject: "",
      description: "",
      dueDate: presetDate || todayISO(),
      priority: "medium",
      estimatedMinutes: 30
    };
    var editing = Boolean(existing);
    openModal(
      '<h3 id="modal-title">' + (editing ? "Edit assignment" : "New assignment") + '</h3><p class="lede">' + (editing ? "Update the details and save. The calendar and dashboard use the same record." : "It will be saved in this browser and show up on your dashboard and calendar.") + '</p><form id="assignment-form" novalidate><div class="form-grid"><label class="field full">Title<input name="title" maxlength="80" required value="' + escapeHtml(assignment.title) + '" placeholder="Essay draft, problem set, lab report"></label><label class="field">Subject<input name="subject" maxlength="40" list="subject-list" required value="' + escapeHtml(assignment.subject) + '" placeholder="Algebra II"></label><label class="field">Due date<input name="due" type="date" required value="' + escapeHtml(assignment.dueDate) + '"></label><label class="field full">Description<span class="hint">Optional</span><textarea name="description" maxlength="500" placeholder="What do you need to finish?">' + escapeHtml(assignment.description) + '</textarea></label><div class="field full"><span>Priority</span><div class="segmented" role="radiogroup" aria-label="Priority"><label class="seg low"><input type="radio" name="priority" value="low"' + (assignment.priority === "low" ? " checked" : "") + '>Low</label><label class="seg medium"><input type="radio" name="priority" value="medium"' + (assignment.priority === "medium" ? " checked" : "") + '>Medium</label><label class="seg high"><input type="radio" name="priority" value="high"' + (assignment.priority === "high" ? " checked" : "") + '>High</label></div></div><label class="field full">Estimated time<span class="hint">Minutes. Your best guess is fine.</span><input name="minutes" type="number" min="1" max="1000" step="5" required value="' + assignment.estimatedMinutes + '"></label></div><p class="form-error" role="alert" hidden></p><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">' + (editing ? "Save changes" : "Add assignment") + "</button></div></form>",
      function (root) {
        root.querySelector("#assignment-form").addEventListener("submit", function (event) {
          event.preventDefault();
          var result = readAssignmentForm(event.target);
          if (result.error) {
            showFormError(root, result.error);
            return;
          }
          if (editing) {
            Object.assign(existing, result.data);
            saveAssignments();
            closeModal();
            refresh();
            toast("Updated “" + existing.title + "”.");
            return;
          }
          var created = normalizeAssignment(Object.assign({
            id: uid(),
            completed: false,
            createdAt: new Date().toISOString(),
            completedAt: null
          }, result.data));
          assignments.push(created);
          highlightId = created.id;
          saveAssignments();
          closeModal();
          refresh();
          if (!matchesFilters(created)) toast("Added “" + created.title + "”. It is hidden by your current filters.");
          else toast("Added “" + created.title + "”.");
          setTimeout(function () { highlightId = null; }, 1800);
        });
      }
    );
  }

  function toggleComplete(id) {
    var assignment = assignments.find(function (item) { return item.id === id; });
    if (!assignment) return;
    assignment.completed = !assignment.completed;
    assignment.completedAt = assignment.completed ? new Date().toISOString() : null;
    saveAssignments();
    refresh();
    toast(assignment.completed ? "Completed “" + assignment.title + "”." : "Reopened “" + assignment.title + "”.");
  }

  function askDelete(id) {
    var assignment = assignments.find(function (item) { return item.id === id; });
    if (!assignment) return;
    openModal(
      '<h3 id="modal-title">Delete this assignment?</h3><p class="lede">“' + escapeHtml(assignment.title) + "” will be removed from this browser. This does not affect anything else.</p><div class=\"modal-actions\"><button type=\"button\" class=\"btn btn-ghost\" data-action=\"close-modal\">Cancel</button><button type=\"button\" class=\"btn btn-danger\" id=\"confirm-delete\">Delete</button></div>",
      function (root) {
        root.querySelector("#confirm-delete").addEventListener("click", function () {
          assignments = assignments.filter(function (item) { return item.id !== id; });
          saveAssignments();
          closeModal();
          refresh();
          toast("Deleted “" + assignment.title + "”.");
        });
      }
    );
  }

  function askRestore() {
    openModal(
      '<h3 id="modal-title">Restore sample assignments?</h3><p class="lede">This replaces your current assignments with the built-in sample set. Grades, your name, and the theme stay as they are.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="button" class="btn btn-primary" id="confirm-restore">Restore samples</button></div>',
      function (root) {
        root.querySelector("#confirm-restore").addEventListener("click", function () {
          assignments = sampleAssignments();
          saveAssignments();
          closeModal();
          refresh();
          toast("Sample assignments restored.");
        });
      }
    );
  }

  function openNameModal() {
    openModal(
      '<h3 id="modal-title">What should we call you?</h3><p class="lede">Your name stays on this device and only changes the greeting.</p><form id="name-form"><label class="field">Name<input name="name" maxlength="40" value="' + escapeHtml(prefs.name) + '" placeholder="Alex"></label><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></form>',
      function (root) {
        root.querySelector("#name-form").addEventListener("submit", function (event) {
          event.preventDefault();
          prefs.name = event.target.name.value.trim().slice(0, 40);
          savePrefs();
          closeModal();
          renderDashboard();
          toast(prefs.name ? "Hi, " + prefs.name + "." : "Name cleared.");
        });
      }
    );
  }

  function ensureCalendar() {
    if (calendar) return;
    var now = new Date();
    calendar = { year: now.getFullYear(), month: now.getMonth(), selected: todayISO() };
  }

  function renderCalendar() {
    ensureCalendar();
    var title = new Date(calendar.year, calendar.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    document.getElementById("cal-title").textContent = title;
    var first = new Date(calendar.year, calendar.month, 1);
    var startPad = first.getDay();
    var days = new Date(calendar.year, calendar.month + 1, 0).getDate();
    var html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(function (label) {
      return '<div class="cal-dow">' + label + "</div>";
    }).join("");
    for (var pad = 0; pad < startPad; pad += 1) html += '<div class="cal-pad"></div>';
    for (var day = 1; day <= days; day += 1) {
      var iso = toISO(new Date(calendar.year, calendar.month, day));
      var items = assignments.filter(function (assignment) { return assignment.dueDate === iso; });
      var shown = items.slice(0, 3);
      var extra = items.length - shown.length;
      var dots = shown.map(function (assignment) {
        return '<i class="dot priority-' + assignment.priority + '"></i>';
      }).join("") + (extra > 0 ? '<span class="more">+' + extra + "</span>" : "");
      var classes = "day" + (iso === todayISO() ? " is-today" : "") + (iso === calendar.selected ? " is-selected" : "");
      var label = formatDate(iso) + ", " + (items.length ? items.length + (items.length === 1 ? " assignment" : " assignments") : "no assignments");
      html += '<button type="button" class="' + classes + '" data-action="select-day" data-date="' + iso + '" aria-label="' + escapeHtml(label) + '"' + (iso === calendar.selected ? ' aria-current="date"' : "") + '><span class="num">' + day + '</span><span class="dots">' + dots + "</span></button>";
    }
    document.getElementById("cal-grid").innerHTML = html;
    renderCalendarDetail();
  }

  function renderCalendarDetail() {
    ensureCalendar();
    var items = sortAssignments(assignments.filter(function (assignment) { return assignment.dueDate === calendar.selected; }));
    var body = items.length
      ? '<div class="row-list">' + items.map(assignmentRow).join("") + "</div>"
      : '<div class="empty"><h3>Nothing due</h3><p>No assignments are scheduled for this day.</p></div>';
    document.getElementById("cal-detail").innerHTML = '<h2>' + escapeHtml(formatLong(calendar.selected)) + '</h2><p class="detail-date">' + items.length + (items.length === 1 ? " assignment" : " assignments") + '</p>' + body + '<div class="form-actions"><button type="button" class="btn btn-primary" data-action="add-on-day">Add assignment on this day</button></div>';
  }

  function shiftMonth(amount) {
    ensureCalendar();
    var date = new Date(calendar.year, calendar.month + amount, 1);
    calendar.year = date.getFullYear();
    calendar.month = date.getMonth();
    renderCalendar();
  }

  function goToToday() {
    var now = new Date();
    calendar = { year: now.getFullYear(), month: now.getMonth(), selected: todayISO() };
    renderCalendar();
  }

  function durationSeconds() {
    return prefs.durations[timer.mode] * 60;
  }

  function formatClock(totalSeconds) {
    var safe = Math.max(0, totalSeconds);
    var minutes = Math.floor(safe / 60);
    var seconds = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function ensureSessionDay() {
    var today = todayISO();
    if (prefs.sessionsDate !== today) {
      prefs.sessionsDate = today;
      prefs.focusSessions = 0;
      savePrefs();
    }
  }

  function dotsFilled() {
    if (!prefs.focusSessions) return 0;
    var mod = prefs.focusSessions % 4;
    return mod === 0 ? 4 : mod;
  }

  function setTimerStatus(message) {
    document.getElementById("timer-status").textContent = message;
  }

  function updateTimerDom(options) {
    var full = options && options.full;
    ensureSessionDay();
    var total = durationSeconds();
    var progress = document.getElementById("timer-progress");
    var ratio = total ? timer.remaining / total : 0;
    progress.setAttribute("stroke-dasharray", String(RING));
    progress.setAttribute("stroke-dashoffset", String(RING * (1 - ratio)));
    progress.setAttribute("stroke", timer.mode === "short" ? "#4ade80" : timer.mode === "long" ? "#60a5fa" : "url(#timerGrad)");
    document.getElementById("timer-display").textContent = formatClock(timer.remaining);
    document.getElementById("timer-mode-label").textContent = MODE_LABELS[timer.mode];
    document.getElementById("timer-face").classList.toggle("is-running", timer.running);
    document.getElementById("timer-start").disabled = timer.running;
    document.getElementById("timer-pause").disabled = !timer.running;
    document.querySelectorAll("[data-timer-mode]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-timer-mode") === timer.mode));
    });
    var mini = document.getElementById("mini-timer");
    var inProgress = timer.running || timer.remaining !== total;
    mini.hidden = !inProgress;
    document.getElementById("mini-time").textContent = formatClock(timer.remaining);
    document.getElementById("mini-mode").textContent = MODE_LABELS[timer.mode];
    if (!full) return;
    var minutesInput = document.getElementById("timer-minutes");
    minutesInput.value = String(prefs.durations[timer.mode]);
    minutesInput.disabled = timer.running;
    document.getElementById("timer-minutes-label").textContent = MODE_LABELS[timer.mode] + " length (minutes)";
    document.getElementById("timer-help").textContent = MODE_HELP[timer.mode];
    var filled = dotsFilled();
    document.getElementById("session-count").textContent = prefs.focusSessions + (prefs.focusSessions === 1 ? " focus session today" : " focus sessions today");
    document.getElementById("session-dots").innerHTML = [0, 1, 2, 3].map(function (index) {
      return '<span class="pip' + (index < filled ? " on" : "") + '"></span>';
    }).join("");
    document.getElementById("session-note").textContent = filled === 4
      ? "You finished a set of four. The next suggested break is the long one."
      : "A long break is suggested after every fourth focus session.";
  }

  function ensureAudio() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!timer.audio) timer.audio = new AudioCtx();
      if (timer.audio.state === "suspended") timer.audio.resume();
    } catch (error) { /* sound is optional */ }
  }

  function chime() {
    try {
      ensureAudio();
      if (!timer.audio) return;
      var ctx = timer.audio;
      var now = ctx.currentTime;
      [880, 1175].forEach(function (frequency, index) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        osc.connect(gain);
        gain.connect(ctx.destination);
        var start = now + index * 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    } catch (error) { /* ignore blocked audio */ }
  }

  function startTimer() {
    if (timer.running) return;
    ensureAudio();
    if (timer.remaining <= 0) timer.remaining = durationSeconds();
    timer.running = true;
    timer.endTime = Date.now() + timer.remaining * 1000;
    clearInterval(timer.intervalId);
    timer.intervalId = setInterval(tick, 200);
    updateTimerDom({ full: true });
    setTimerStatus(MODE_LABELS[timer.mode] + " started.");
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.running = false;
    clearInterval(timer.intervalId);
    timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
    updateTimerDom({ full: true });
    setTimerStatus("Timer paused.");
  }

  function resetTimer() {
    timer.running = false;
    clearInterval(timer.intervalId);
    timer.remaining = durationSeconds();
    updateTimerDom({ full: true });
    setTimerStatus(MODE_LABELS[timer.mode] + " reset.");
  }

  function tick() {
    ensureSessionDay();
    timer.remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
    if (timer.remaining <= 0) {
      completeSession();
      return;
    }
    updateTimerDom();
  }

  function completeSession() {
    timer.running = false;
    clearInterval(timer.intervalId);
    timer.remaining = 0;
    chime();
    var finished = timer.mode;
    if (finished === "focus") {
      ensureSessionDay();
      prefs.focusSessions += 1;
      savePrefs();
      var longBreak = prefs.focusSessions % 4 === 0;
      timer.mode = longBreak ? "long" : "short";
      toast(longBreak
        ? "Four focus sessions done. A long break is ready."
        : "Focus session complete. A short break is ready.");
      setTimerStatus("Focus session complete.");
    } else {
      timer.mode = "focus";
      toast(finished === "long" ? "Long break finished. Focus is ready when you are." : "Short break finished. Focus is ready when you are.");
      setTimerStatus("Break finished.");
    }
    timer.remaining = durationSeconds();
    updateTimerDom({ full: true });
    if (currentView() === "timer") renderStudyNext();
  }

  function setTimerMode(mode) {
    if (!MODE_LABELS[mode]) return;
    if (timer.mode === mode) return;
    if (timer.running) pauseTimer();
    timer.mode = mode;
    timer.remaining = durationSeconds();
    updateTimerDom({ full: true });
    setTimerStatus("Switched to " + MODE_LABELS[mode] + ".");
  }

  function renderStudyNext() {
    var next = assignments.filter(function (item) { return !item.completed; });
    next = sortAssignments(next).slice(0, 4);
    var root = document.getElementById("study-next");
    if (!next.length) {
      root.innerHTML = '<div class="empty"><h3>Nothing to study</h3><p>Add an assignment when you know what to work on.</p><button type="button" class="btn btn-primary" data-action="add">Add assignment</button></div>';
      return;
    }
    root.innerHTML = next.map(function (assignment) {
      return '<div class="study-item"><div class="study-copy"><strong>' + escapeHtml(assignment.title) + "</strong><span>" + escapeHtml(dueLabel(assignment)) + " · " + formatMinutes(assignment.estimatedMinutes) + '</span></div><button type="button" class="btn btn-small btn-success" data-action="toggle-complete" data-id="' + assignment.id + '">Done</button></div>';
    }).join("");
  }

  function letterGrade(percent) {
    var bands = [
      [93, "A"], [90, "A−"], [87, "B+"], [83, "B"], [80, "B−"],
      [77, "C+"], [73, "C"], [70, "C−"], [67, "D+"], [63, "D"], [60, "D−"]
    ];
    for (var i = 0; i < bands.length; i += 1) {
      if (percent >= bands[i][0]) return bands[i][1];
    }
    return "F";
  }

  function gradeSummary(list) {
    if (!list.length) return null;
    var weightSum = 0;
    var acc = 0;
    list.forEach(function (grade) {
      var weight = grade.weight == null ? 1 : grade.weight;
      acc += (grade.earned / grade.total) * 100 * weight;
      weightSum += weight;
    });
    var average = weightSum ? acc / weightSum : 0;
    return {
      average: average,
      letter: letterGrade(average),
      weighted: list.some(function (grade) { return grade.weight != null; }),
      count: list.length
    };
  }

  function formatPoints(number) {
    var rounded = Math.round(number * 100) / 100;
    return String(rounded);
  }

  function showGradeError(message) {
    var error = document.getElementById("grade-error");
    if (!message) {
      error.hidden = true;
      error.textContent = "";
      return;
    }
    error.hidden = false;
    error.textContent = message;
  }

  function resetGradeForm() {
    editingGradeId = null;
    document.getElementById("grade-form").reset();
    document.getElementById("grade-form-title").textContent = "Add a grade";
    document.getElementById("grade-submit").textContent = "Add grade";
    document.getElementById("grade-cancel").hidden = true;
    showGradeError("");
  }

  function renderGrades() {
    var summary = gradeSummary(grades);
    var card = document.getElementById("average-card");
    var scale = "Scale: A 93+, A− 90, B+ 87, B 83, B− 80, C+ 77, C 73, C− 70, D+ 67, D 63, D− 60, F below 60.";
    if (!summary) {
      card.innerHTML = '<p class="avg-kicker">Average</p><div class="avg-row"><p class="avg-number">—</p></div><p>Add a grade to calculate your average. Try something like 18 points earned out of 20 possible.</p><p class="scale">' + scale + "</p>";
    } else {
      var width = Math.max(0, Math.min(100, summary.average));
      card.innerHTML = '<p class="avg-kicker">' + (summary.weighted ? "Weighted average" : "Average") + '</p><div class="avg-row"><p class="avg-number">' + summary.average.toFixed(1) + '%</p><span class="letter-pill">' + summary.letter + "</span></div>"
        + meter("Class average", summary.count + (summary.count === 1 ? " grade" : " grades"), width, summary.average >= 70 ? "good" : "warn")
        + "<p class=\"muted\">" + (summary.weighted ? "Blank weights count as 1. Higher weights pull the average more." : "Every grade currently counts equally.") + "</p><p class=\"scale\">" + scale + "</p>";
      animateBars(card);
    }
    var list = document.getElementById("grade-list");
    document.getElementById("clear-grades").disabled = grades.length === 0;
    if (!grades.length) {
      list.innerHTML = emptyState("No grades yet", "Grades you add are saved in this browser. Remove one any time, or clear the list.", "", "");
      return;
    }
    list.innerHTML = grades.map(function (grade) {
      var pct = (grade.earned / grade.total) * 100;
      var weight = grade.weight == null ? "equal weight" : "weight " + formatPoints(grade.weight);
      return '<div class="grade-row"><div class="grade-copy"><strong>' + escapeHtml(grade.name) + "</strong><span>" + formatPoints(grade.earned) + " / " + formatPoints(grade.total) + " · " + pct.toFixed(1) + "% · " + weight + '</span></div><div class="grade-actions"><button type="button" class="btn btn-small btn-ghost" data-action="edit-grade" data-id="' + grade.id + '">Edit</button><button type="button" class="btn btn-small btn-danger" data-action="delete-grade" data-id="' + grade.id + '">Remove</button></div></div>';
    }).join("");
  }

  function readGradeForm() {
    var name = document.getElementById("grade-name").value.trim();
    var earnedRaw = document.getElementById("grade-earned").value.trim();
    var totalRaw = document.getElementById("grade-total").value.trim();
    var weightRaw = document.getElementById("grade-weight").value.trim();
    var earned = Number(earnedRaw);
    var total = Number(totalRaw);
    if (!name) return { error: "Name this grade so you can tell it apart." };
    if (earnedRaw === "" || !isFinite(earned) || earned < 0) return { error: "Enter the points earned. Zero is allowed." };
    if (totalRaw === "") return { error: "Enter the points possible." };
    if (!isFinite(total) || total <= 0) return { error: "Points possible must be greater than zero." };
    if (earned > 100000 || total > 100000) return { error: "Enter points up to 100,000." };
    var weight = null;
    if (weightRaw !== "") {
      weight = Number(weightRaw);
      if (!isFinite(weight) || weight <= 0) return { error: "Weight must be greater than zero, or left blank." };
      if (weight > 1000) return { error: "Weight must be 1,000 or less." };
    }
    return { data: { name: name.slice(0, 80), earned: earned, total: total, weight: weight } };
  }

  function beginEditGrade(id) {
    var grade = grades.find(function (item) { return item.id === id; });
    if (!grade) return;
    editingGradeId = id;
    document.getElementById("grade-name").value = grade.name;
    document.getElementById("grade-earned").value = String(grade.earned);
    document.getElementById("grade-total").value = String(grade.total);
    document.getElementById("grade-weight").value = grade.weight == null ? "" : String(grade.weight);
    document.getElementById("grade-form-title").textContent = "Edit grade";
    document.getElementById("grade-submit").textContent = "Save changes";
    document.getElementById("grade-cancel").hidden = false;
    showGradeError("");
    document.getElementById("grade-form").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("grade-name").focus();
  }

  function askDeleteGrade(id) {
    var grade = grades.find(function (item) { return item.id === id; });
    if (!grade) return;
    openModal(
      '<h3 id="modal-title">Remove this grade?</h3><p class="lede">“' + escapeHtml(grade.name) + "” will leave the average.</p><div class=\"modal-actions\"><button type=\"button\" class=\"btn btn-ghost\" data-action=\"close-modal\">Cancel</button><button type=\"button\" class=\"btn btn-danger\" id=\"confirm-grade\">Remove</button></div>",
      function (root) {
        root.querySelector("#confirm-grade").addEventListener("click", function () {
          grades = grades.filter(function (item) { return item.id !== id; });
          if (editingGradeId === id) resetGradeForm();
          saveGrades();
          closeModal();
          renderGrades();
          toast("Removed “" + grade.name + "”.");
        });
      }
    );
  }

  function askClearGrades() {
    if (!grades.length) return;
    openModal(
      '<h3 id="modal-title">Clear every grade?</h3><p class="lede">The average will reset. Assignments are not affected.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="button" class="btn btn-danger" id="confirm-clear">Clear all</button></div>',
      function (root) {
        root.querySelector("#confirm-clear").addEventListener("click", function () {
          grades = [];
          resetGradeForm();
          saveGrades();
          closeModal();
          renderGrades();
          toast("Grade list cleared.");
        });
      }
    );
  }

  function refresh() {
    updateNavBadge();
    var view = currentView();
    if (view === "dashboard") renderDashboard();
    if (view === "assignments") {
      renderSubjectOptions();
      renderAssignmentList();
    }
    if (view === "calendar") renderCalendar();
    if (view === "timer") renderStudyNext();
  }

  function onClick(event) {
    if (event.target.id === "modal-backdrop") {
      closeModal();
      return;
    }
    var actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;
    var action = actionElement.getAttribute("data-action");
    var id = actionElement.getAttribute("data-id");
    if (action === "close-modal") closeModal();
    if (action === "add") openAssignmentModal(null, null);
    if (action === "add-on-day") openAssignmentModal(null, calendar && calendar.selected);
    if (action === "edit") {
      var found = assignments.find(function (item) { return item.id === id; });
      if (found) openAssignmentModal(found);
    }
    if (action === "toggle-complete") toggleComplete(id);
    if (action === "delete") askDelete(id);
    if (action === "edit-name") openNameModal();
    if (action === "clear-filters") clearFilters();
    if (action === "select-day") {
      calendar.selected = actionElement.getAttribute("data-date");
      renderCalendar();
    }
    if (action === "edit-grade") beginEditGrade(id);
    if (action === "delete-grade") askDeleteGrade(id);
  }

  function bindEvents() {
    document.body.addEventListener("click", onClick);
    document.getElementById("menu-btn").addEventListener("click", function () {
      var open = !document.getElementById("sidebar").classList.contains("open");
      setSidebar(open);
    });
    document.getElementById("backdrop").addEventListener("click", function () { setSidebar(false); });
    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
    document.getElementById("theme-toggle-top").addEventListener("click", toggleTheme);
    document.getElementById("clear-filters").addEventListener("click", clearFilters);
    document.getElementById("restore-samples").addEventListener("click", askRestore);
    document.getElementById("filter-subject").addEventListener("change", function (event) {
      filters.subject = event.target.value;
      renderAssignmentList();
    });
    document.getElementById("filter-priority").addEventListener("change", function (event) {
      filters.priority = event.target.value;
      renderAssignmentList();
    });
    document.getElementById("filter-status").addEventListener("change", function (event) {
      filters.status = event.target.value;
      renderAssignmentList();
    });
    document.getElementById("filter-upcoming").addEventListener("change", function (event) {
      filters.upcoming = event.target.checked;
      renderAssignmentList();
    });
    document.getElementById("filter-search").addEventListener("input", function (event) {
      filters.search = event.target.value;
      renderAssignmentList();
    });
    document.getElementById("cal-prev").addEventListener("click", function () { shiftMonth(-1); });
    document.getElementById("cal-next").addEventListener("click", function () { shiftMonth(1); });
    document.getElementById("cal-today").addEventListener("click", goToToday);
    document.getElementById("timer-start").addEventListener("click", startTimer);
    document.getElementById("timer-pause").addEventListener("click", pauseTimer);
    document.getElementById("timer-reset").addEventListener("click", resetTimer);
    document.querySelectorAll("[data-timer-mode]").forEach(function (button) {
      button.addEventListener("click", function () { setTimerMode(button.getAttribute("data-timer-mode")); });
    });
    document.getElementById("timer-minutes").addEventListener("change", function (event) {
      if (timer.running) return;
      var number = Math.round(Number(event.target.value));
      if (!isFinite(number) || number < 1) number = 1;
      if (number > 180) number = 180;
      event.target.value = String(number);
      prefs.durations[timer.mode] = number;
      savePrefs();
      timer.remaining = number * 60;
      updateTimerDom({ full: true });
    });
    document.getElementById("grade-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var result = readGradeForm();
      if (result.error) {
        showGradeError(result.error);
        return;
      }
      if (editingGradeId) {
        var existing = grades.find(function (item) { return item.id === editingGradeId; });
        if (existing) Object.assign(existing, result.data);
        var summary = gradeSummary(grades);
        saveGrades();
        resetGradeForm();
        renderGrades();
        toast("Grade updated. Average is " + summary.average.toFixed(1) + "% (" + summary.letter + ").");
        return;
      }
      grades.push(normalizeGrade(Object.assign({ id: uid() }, result.data)));
      var added = gradeSummary(grades);
      saveGrades();
      resetGradeForm();
      renderGrades();
      toast("Grade added. Average is " + added.average.toFixed(1) + "% (" + added.letter + ").");
    });
    document.getElementById("grade-cancel").addEventListener("click", resetGradeForm);
    document.getElementById("clear-grades").addEventListener("click", askClearGrades);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && document.getElementById("modal-root").innerHTML) closeModal();
    });
    window.addEventListener("hashchange", function () { showView(currentView()); });
  }

  function init() {
    assignments = loadAssignments();
    grades = loadGrades();
    prefs = loadPrefs();
    ensureSessionDay();
    timer.remaining = prefs.durations.focus * 60;
    applyTheme();
    bindEvents();
    updateNavBadge();
    updateTimerDom({ full: true });
    if (!location.hash) location.hash = "dashboard";
    showView(currentView());
  }

  init();
})();
