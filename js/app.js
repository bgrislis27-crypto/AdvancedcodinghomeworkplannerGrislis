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
  var SUBJECT_COLORS = ["#3b82f6", "#7c3aed", "#0f9f6e", "#f59e0b", "#e11d48", "#0891b2", "#ec4899", "#6366f1"];
  var SUBJECT_TONES = [
    { bg: "#e8f1ff", fg: "#3b82f6" },
    { bg: "#f1e9ff", fg: "#7c3aed" },
    { bg: "#e7f8ef", fg: "#0f9f6e" },
    { bg: "#fff4e5", fg: "#f59e0b" },
    { bg: "#ffe8ea", fg: "#e11d48" },
    { bg: "#e6f7fb", fg: "#0891b2" }
  ];
  var DASH = { query: "", range: "month", scope: "week" };

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
      theme: saved.theme === "dark" ? "dark" : "light",
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

  function subjectHash(name) {
    var hash = 0;
    var text = String(name || "");
    for (var i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return hash;
  }

  function subjectColor(name) {
    return SUBJECT_COLORS[subjectHash(name) % SUBJECT_COLORS.length];
  }

  function subjectTone(name) {
    return SUBJECT_TONES[subjectHash(name) % SUBJECT_TONES.length];
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
    if (meta) meta.setAttribute("content", light ? "#e8eaee" : "#10141b");
    paintAvatar();
    var label = light ? "Switch to dark theme" : "Switch to light theme";
    document.getElementById("theme-toggle").setAttribute("aria-pressed", String(light));
    document.getElementById("theme-toggle").setAttribute("aria-label", label);
    document.getElementById("theme-toggle-top").setAttribute("aria-label", label);
    document.getElementById("theme-label").textContent = light ? "Light theme" : "Dark theme";
  }

  function paintAvatar() {
    var name = prefs.name.trim();
    var initial = name ? name.charAt(0).toUpperCase() : "S";
    var avatar = document.getElementById("avatar-initial");
    var button = document.getElementById("avatar-btn");
    if (avatar) avatar.textContent = initial;
    if (button) button.setAttribute("aria-label", name ? "Change name, " + name : "Add your name");
  }

  function toggleTheme() {
    prefs.theme = prefs.theme === "light" ? "dark" : "light";
    savePrefs();
    applyTheme();
  }

  function setSidebar(open) {
    var sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("open", open);
    document.getElementById("backdrop").hidden = !open;
    document.getElementById("menu-btn").setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("nav-open", open);
    var mobile = window.matchMedia("(max-width: 800px)").matches;
    if (mobile && !open) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
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
    document.querySelector(".topbar").classList.toggle("is-dashboard", name === "dashboard");
    var globalSearch = document.getElementById("global-search");
    if (globalSearch && document.activeElement !== globalSearch) globalSearch.value = filters.search;
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

  function monthStamp(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }

  function subjectBars(doneOnly) {
    var map = {};
    assignments.forEach(function (item) {
      if (doneOnly && !item.completed) return;
      map[item.subject] = (map[item.subject] || 0) + 1;
    });
    var values = Object.keys(map).sort().map(function (key) { return map[key]; });
    if (!values.length) return [0, 0, 0, 0, 0, 0];
    return values;
  }

  function sparkBars(values, color) {
    var max = 1;
    values.forEach(function (value) { if (value > max) max = value; });
    var width = 112;
    var height = 48;
    var count = Math.max(values.length, 1);
    var gap = 4;
    var bar = (width - gap * (count - 1)) / count;
    color = color || "#8ea0b5";
    var shapes = values.map(function (value, index) {
      var barHeight = Math.max(6, (value / max) * (height - 4));
      var x = index * (bar + gap);
      var y = height - barHeight;
      var opacity = (0.28 + 0.72 * (value / max)).toFixed(2);
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bar.toFixed(1) + '" height="' + barHeight.toFixed(1) + '" rx="3" fill="' + color + '" fill-opacity="' + opacity + '"></rect>';
    }).join("");
    return '<svg class="spark" viewBox="0 0 ' + width + ' ' + height + '" aria-hidden="true">' + shapes + "</svg>";
  }

  function chartSeries() {
    var today = new Date();
    var points = [];
    if (DASH.range === "week") {
      var start = new Date(today);
      start.setDate(today.getDate() - today.getDay() - 49);
      for (var week = 0; week < 8; week += 1) {
        var from = new Date(start);
        from.setDate(start.getDate() + week * 7);
        var to = new Date(from);
        to.setDate(from.getDate() + 6);
        var fromISO = toISO(from);
        var toDate = toISO(to);
        points.push({
          label: (from.getMonth() + 1) + "/" + from.getDate(),
          value: assignments.filter(function (item) { return item.dueDate >= fromISO && item.dueDate <= toDate; }).length
        });
      }
      return { points: points, caption: "Assignments due each week" };
    }
    if (DASH.range === "year") {
      var year = today.getFullYear();
      for (var y = year - 4; y <= year; y += 1) {
        points.push({
          label: String(y),
          value: assignments.filter(function (item) { return item.dueDate.slice(0, 4) === String(y); }).length
        });
      }
      return { points: points, caption: "Assignments due each year" };
    }
    for (var month = 11; month >= 0; month -= 1) {
      var date = new Date(today.getFullYear(), today.getMonth() - month, 1);
      var key = monthStamp(date);
      points.push({
        label: date.toLocaleDateString(undefined, { month: "short" }),
        value: assignments.filter(function (item) { return item.dueDate.slice(0, 7) === key; }).length
      });
    }
    return { points: points, caption: "Assignments due each month" };
  }

  function lineChart(points) {
    var width = 640;
    var height = 220;
    var padL = 36;
    var padR = 12;
    var padT = 18;
    var padB = 28;
    var max = 1;
    points.forEach(function (point) { if (point.value > max) max = point.value; });
    var top = Math.max(4, Math.ceil(max / 2) * 2);
    var innerW = width - padL - padR;
    var innerH = height - padT - padB;
    var coords = points.map(function (point, index) {
      var x = padL + (points.length === 1 ? innerW / 2 : (innerW * index) / (points.length - 1));
      var y = padT + innerH - (point.value / top) * innerH;
      return { x: x, y: y, label: point.label, value: point.value };
    });
    var line = coords.map(function (coord, index) {
      return (index ? "L" : "M") + coord.x.toFixed(1) + " " + coord.y.toFixed(1);
    }).join(" ");
    var last = coords[coords.length - 1];
    var area = line + " L" + last.x.toFixed(1) + " " + (padT + innerH).toFixed(1) + " L" + coords[0].x.toFixed(1) + " " + (padT + innerH).toFixed(1) + " Z";
    var grid = "";
    for (var step = 0; step <= 4; step += 1) {
      var y = padT + (innerH * step) / 4;
      var label = Math.round(top * (1 - step / 4));
      grid += '<line class="grid-line" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (width - padR) + '" y2="' + y.toFixed(1) + '"></line>';
      grid += '<text class="axis" x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + label + "</text>";
    }
    var labels = coords.map(function (coord) {
      return '<text class="axis" x="' + coord.x.toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' + escapeHtml(coord.label) + "</text>";
    }).join("");
    var dots = coords.map(function (coord) {
      return '<circle class="line-dot" cx="' + coord.x.toFixed(1) + '" cy="' + coord.y.toFixed(1) + '" r="4.5"><title>' + escapeHtml(coord.label + ": " + coord.value) + "</title></circle>";
    }).join("");
    return '<svg class="line-chart" viewBox="0 0 ' + width + " " + height + '" role="img">' +
      '<defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#12b886" stop-opacity="0.28"></stop><stop offset="100%" stop-color="#12b886" stop-opacity="0"></stop></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#areaFill)"></path><path d="' + line + '" fill="none" stroke="#12b886" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>' +
      dots + labels + "</svg>";
  }

  function gradeSpark(list) {
    var width = 180;
    var height = 70;
    if (!list.length) {
      return '<svg class="grade-spark" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true"><path d="M8 48 C50 46 90 40 172 28" fill="none" stroke="#d5dee8" stroke-width="2"></path></svg>';
    }
    var coords = list.map(function (grade, index) {
      var pct = Math.max(0, Math.min(100, (grade.earned / grade.total) * 100));
      var x = list.length === 1 ? width / 2 : (width - 16) * index / (list.length - 1) + 8;
      var y = 10 + (1 - pct / 100) * (height - 22);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var area = "M" + coords[0] + " L" + coords.join(" L") + " L" + (width - 8) + " " + (height - 8) + " L8 " + (height - 8) + " Z";
    return '<svg class="grade-spark" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true"><path d="' + area + '" fill="#12b886" fill-opacity="0.18"></path><polyline points="' + coords.join(" ") + '" fill="none" stroke="#12b886" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline></svg>';
  }

  function donut(percent) {
    var radius = 36;
    var length = 2 * Math.PI * radius;
    var safe = Math.max(0, Math.min(100, percent));
    var offset = length * (1 - safe / 100);
    return '<div class="donut"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="donut-track" cx="50" cy="50" r="' + radius + '"></circle><circle class="donut-value" cx="50" cy="50" r="' + radius + '" data-ring data-offset="' + offset + '" stroke-dasharray="' + length + '" stroke-dashoffset="' + length + '"></circle></svg><strong>' + Math.round(safe) + "%</strong></div>";
  }

  function miniRing(percent) {
    var radius = 16;
    var length = 2 * Math.PI * radius;
    var safe = Math.max(0, Math.min(100, percent));
    var offset = length * (1 - safe / 100);
    return '<div class="mini-ring"><svg viewBox="0 0 42 42" aria-hidden="true"><circle class="donut-track" cx="21" cy="21" r="' + radius + '"></circle><circle class="donut-value" cx="21" cy="21" r="' + radius + '" data-ring data-offset="' + offset + '" stroke-dasharray="' + length + '" stroke-dashoffset="' + length + '"></circle></svg><span>' + Math.round(safe) + "%</span></div>";
  }

  function duePressure(assignment) {
    if (assignment.completed) return 100;
    var diff = daysBetween(todayISO(), assignment.dueDate);
    if (diff <= 0) return 100;
    if (diff >= 14) return 12;
    return Math.round(100 - (diff / 14) * 88);
  }

  function shortDate(iso) {
    return parseISO(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function statusPill(assignment) {
    if (assignment.completed) return '<span class="status-pill done">Done</span>';
    if (assignment.dueDate < todayISO()) return '<span class="status-pill late">Overdue</span>';
    return '<span class="status-pill assigned">Assigned</span>';
  }

  function tableRow(assignment) {
    return '<tr class="' + (assignment.completed ? "is-done" : "") + (assignment.id === highlightId ? " just-added" : "") + '"><td>' + escapeHtml(assignment.subject) + '</td><td><strong>' + escapeHtml(assignment.title) + "</strong>" + (assignment.description ? '<span class="desc">' + escapeHtml(assignment.description) + "</span>" : "") + "</td><td>" + escapeHtml(shortDate(assignment.dueDate)) + "</td><td>" + statusPill(assignment) + '</td><td class="marks">' + escapeHtml(formatMinutes(assignment.estimatedMinutes)) + '</td><td class="priority-text priority-' + assignment.priority + '">' + assignment.priority + '</td><td class="row-actions"><button type="button" class="btn btn-small ' + (assignment.completed ? "btn-ghost" : "btn-success") + '" data-action="toggle-complete" data-id="' + assignment.id + '">' + (assignment.completed ? "Reopen" : "Done") + '</button><button type="button" class="btn btn-small btn-ghost" data-action="edit" data-id="' + assignment.id + '">Edit</button><button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="' + assignment.id + '">Delete</button></td></tr>';
  }

  function homeworkTable(rows, emptyTitle, emptyCopy) {
    if (!rows.length) {
      return '<div class="table-scroll"><table class="hw-table"><tbody><tr><td>' + emptyState(emptyTitle, emptyCopy, "", "") + "</td></tr></tbody></table></div>";
    }
    return '<div class="table-scroll"><table class="hw-table"><thead><tr><th>Subject</th><th>Homework title</th><th>Date</th><th>Status</th><th>Time</th><th>Priority</th><th></th></tr></thead><tbody>' + rows.map(tableRow).join("") + "</tbody></table></div>";
  }

  function dashRows() {
    var query = DASH.query.trim().toLowerCase();
    return sortAssignments(assignments.filter(function (assignment) {
      if (!query) return true;
      var blob = (assignment.title + " " + assignment.subject + " " + assignment.description).toLowerCase();
      return blob.indexOf(query) !== -1;
    }));
  }

  function paintDashRows() {
    var body = document.getElementById("dash-rows");
    if (!body) return;
    var rows = dashRows();
    if (!assignments.length) {
      body.innerHTML = '<tr><td colspan="7">' + emptyState("No assignments yet", "Add an assignment and it will show up in this table, on the calendar, and in the timer.", "Add assignment", "add") + "</td></tr>";
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7">' + emptyState("Nothing matches", "Try a different title or subject.", "", "") + "</td></tr>";
      return;
    }
    body.innerHTML = rows.map(tableRow).join("");
  }

  function weekStrip() {
    var today = parseISO(todayISO());
    var start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var html = '<div class="week-strip">';
    for (var i = 0; i < 7; i += 1) {
      var date = new Date(start);
      date.setDate(start.getDate() + i);
      var iso = toISO(date);
      var due = assignments.some(function (item) { return !item.completed && item.dueDate === iso; });
      html += '<div class="week-day' + (iso === todayISO() ? " is-today" : "") + '"><span>' + names[i] + "</span><strong>" + date.getDate() + "</strong>" + (due ? "<i></i>" : "") + "</div>";
    }
    return html + "</div>";
  }

  function upcomingMarkup(items) {
    if (!items.length) {
      return emptyState("Nothing coming up", assignments.length ? "No open assignments are due today or later." : "Add a due date and it will land here.", assignments.length ? "" : "Add assignment", "add");
    }
    return '<div class="up-list">' + items.map(function (assignment) {
      var tone = subjectTone(assignment.subject);
      return '<div class="up-row"><span class="subj-badge" style="--tone-bg:' + tone.bg + ";--tone-fg:" + tone.fg + '">' + escapeHtml(assignment.subject.slice(0, 1).toUpperCase()) + '</span><div class="up-copy"><strong>' + escapeHtml(assignment.title) + "</strong><span>" + escapeHtml(formatDate(assignment.dueDate)) + '</span></div><div class="up-side"><span>' + escapeHtml(formatMinutes(assignment.estimatedMinutes)) + "</span><small>" + escapeHtml(assignment.subject) + "</small></div></div>";
    }).join("") + "</div>";
  }

  function pendingMarkup(items) {
    if (!items.length) {
      var copy = DASH.scope === "week" ? "Nothing unfinished is due this week." : "Every assignment is checked off.";
      return emptyState("No pending homework", assignments.length ? copy : "Add an assignment to start the list.", assignments.length ? "" : "Add assignment", "add");
    }
    return '<div class="pend-list">' + items.map(function (assignment) {
      var pressure = duePressure(assignment);
      return '<div class="pend-row"><div class="pend-copy"><strong>' + escapeHtml(assignment.subject) + "</strong><span>" + escapeHtml(assignment.title) + "</span></div>" + miniRing(pressure) + "</div>";
    }).join("") + "</div>";
  }

  function kpiCard(className, tone, label, value, hint, extra) {
    return '<article class="panel kpi ' + className + '"><div class="kpi-top"><span class="kpi-icon ' + tone + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"></rect></svg></span><span>' + label + '</span></div><div class="kpi-body"><div><strong class="kpi-value">' + value + '</strong><span class="kpi-hint">' + hint + "</span></div>" + extra + "</div></article>";
  }

  function renderDashboard() {
    var stats = getStats();
    var summary = gradeSummary(grades);
    var upcoming = sortAssignments(stats.active.filter(function (item) { return item.dueDate >= todayISO(); })).slice(0, 4);
    var weekEnd = addDays(todayISO(), 6);
    var pending = sortAssignments(stats.active.filter(function (item) {
      return DASH.scope === "all" || item.dueDate <= weekEnd;
    })).slice(0, 4);
    var series = chartSeries();
    var totalHint = stats.overdue.length ? stats.overdue.length + " overdue" : "On your list";
    var doneHint = assignments.length ? stats.percent + "% of your list" : "Nothing checked off yet";
    var gradeValue = summary ? summary.average.toFixed(0) + "%" : "—";
    var gradeHint = summary ? summary.letter + " · " + summary.count + (summary.count === 1 ? " grade" : " grades") : "Add a grade";
    var rangeBtn = function (range, label) {
      return '<button type="button" class="range-btn" data-action="dash-range" data-range="' + range + '" aria-pressed="' + (DASH.range === range ? "true" : "false") + '">' + label + "</button>";
    };
    document.getElementById("view-dashboard").innerHTML = ''
      + '<div class="board"><div class="board-top">'
      + kpiCard("kpi-total", "tone-blue", "Total Homework", assignments.length, escapeHtml(totalHint), sparkBars(subjectBars(false)))
      + kpiCard("kpi-done", "tone-orange", "Completed Homework", stats.completed.length, escapeHtml(doneHint), sparkBars(subjectBars(true), "#12b886"))
      + '<section class="panel upcoming-panel"><div class="panel-head"><h2>Upcoming Homework</h2><a class="linkish" href="#calendar">Calendar</a></div>' + upcomingMarkup(upcoming) + "</section>"
      + kpiCard("kpi-grade", "tone-red", "Grade Average", gradeValue, escapeHtml(gradeHint), gradeSpark(grades))
      + '<article class="panel kpi kpi-progress"><div class="kpi-top"><span class="kpi-icon tone-purple" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"></circle></svg></span><span>Homework Progress</span></div><div class="progress-body"><div><strong class="kpi-value">' + stats.percent + '%</strong><span class="kpi-hint">' + stats.completed.length + " of " + assignments.length + ' complete</span></div>' + donut(stats.percent) + "</div></article>"
      + '</div><div class="board-low">'
      + '<section class="panel"><div class="panel-head"><div><h2>Homework Analytics</h2><p class="panel-sub">' + escapeHtml(series.caption) + '</p></div><div class="range-switch" role="group" aria-label="Chart range">' + rangeBtn("week", "Weekly") + rangeBtn("month", "Monthly") + rangeBtn("year", "Yearly") + "</div></div>" + lineChart(series.points) + '<p class="chart-note">Each point is how many assignments are due in that period. Hover a dot to see the count.</p></section>'
      + '<section class="panel"><div class="panel-head"><h2>Pending Homework</h2><select id="pending-scope" aria-label="Which pending assignments"><option value="week"' + (DASH.scope === "week" ? " selected" : "") + '>This week</option><option value="all"' + (DASH.scope === "all" ? " selected" : "") + ">All pending</option></select></div>" + weekStrip() + pendingMarkup(pending) + '<p class="chart-note">The ring fills as a due date gets closer. Today and overdue work sit at 100%.</p></section>'
      + '</div><section class="panel"><div class="panel-head"><h2>All Homework</h2><div class="table-tools"><label class="mini-search"><input id="dash-search" type="search" placeholder="Search..." value="' + escapeHtml(DASH.query) + '" aria-label="Filter the homework table" autocomplete="off"></label><button type="button" class="btn btn-primary btn-small" data-action="add">Add</button></div></div><div class="table-scroll"><table class="hw-table"><thead><tr><th>Subject</th><th>Homework title</th><th>Date</th><th>Status</th><th>Time</th><th>Priority</th><th></th></tr></thead><tbody id="dash-rows"></tbody></table></div></section></div>';
    paintDashRows();
    animateBars(document.getElementById("view-dashboard"));
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
    list.innerHTML = homeworkTable(rows, "Nothing matches", "No assignments fit these filters. Clear them to see the full list.");
  }

  function clearFilters() {
    filters = { subject: "all", priority: "all", status: "all", upcoming: false, search: "" };
    document.getElementById("filter-subject").value = "all";
    document.getElementById("filter-priority").value = "all";
    document.getElementById("filter-status").value = "all";
    document.getElementById("filter-upcoming").checked = false;
    document.getElementById("filter-search").value = "";
    document.getElementById("global-search").value = "";
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
          paintAvatar();
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

  function parseDecimal(raw) {
    var cleaned = String(raw == null ? "" : raw).trim().replace(/,/g, "");
    if (!cleaned) return NaN;
    return Number(cleaned);
  }

  function readGradeForm() {
    var name = document.getElementById("grade-name").value.trim();
    var earnedRaw = document.getElementById("grade-earned").value.trim();
    var totalRaw = document.getElementById("grade-total").value.trim();
    var weightRaw = document.getElementById("grade-weight").value.trim();
    var earned = parseDecimal(earnedRaw);
    var total = parseDecimal(totalRaw);
    if (!name) return { error: "Name this grade so you can tell it apart." };
    if (earnedRaw === "" || !isFinite(earned) || earned < 0) return { error: "Enter the points earned. Zero is allowed." };
    if (totalRaw === "") return { error: "Enter the points possible." };
    if (!isFinite(total) || total <= 0) return { error: "Points possible must be greater than zero." };
    if (earned > 100000 || total > 100000) return { error: "Enter points up to 100,000." };
    var weight = null;
    if (weightRaw !== "") {
      weight = parseDecimal(weightRaw);
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
    if (action === "dash-range") {
      DASH.range = actionElement.getAttribute("data-range") || "month";
      renderDashboard();
    }
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
    window.addEventListener("resize", function () {
      var mobile = window.matchMedia("(max-width: 800px)").matches;
      if (!mobile) setSidebar(false);
      else setSidebar(document.getElementById("sidebar").classList.contains("open"));
    });
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
      document.getElementById("global-search").value = filters.search;
      renderAssignmentList();
    });
    document.body.addEventListener("input", function (event) {
      if (event.target.id === "dash-search") {
        DASH.query = event.target.value;
        paintDashRows();
      }
      if (event.target.id === "global-search") {
        filters.search = event.target.value;
        var pageSearch = document.getElementById("filter-search");
        if (pageSearch) pageSearch.value = filters.search;
        if (currentView() !== "assignments") {
          if (location.hash !== "#assignments") location.hash = "assignments";
        } else renderAssignmentList();
      }
    });
    document.body.addEventListener("change", function (event) {
      if (event.target.id === "pending-scope") {
        DASH.scope = event.target.value === "all" ? "all" : "week";
        renderDashboard();
      }
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
