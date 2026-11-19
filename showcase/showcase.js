(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var root = document.documentElement;
  var slides = $$(".slide");
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var motion = hasGsap && !reduce;
  var lenis = null;
  var stopCache = [];
  var currentSlide = -1;

  var TALK_WINDOW = 5 * 60 * 1000;
  var TALK_LIMIT = 7 * 60 * 1000;
  var KEY = {
    list: "studyhub.assignments",
    note: "uplanner.showcase.note",
    slide: "uplanner.showcase.slide",
    reloaded: "uplanner.showcase.reloaded",
    timer: "uplanner.showcase.timer"
  };

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  function pad(n) { return String(n).padStart(2, "0"); }

  function isoDay(offset) {
    var d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function session(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch (error) { return null; }
    return null;
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- the planner's data ---------- */

  function readList() {
    try {
      var parsed = JSON.parse(localStorage.getItem(KEY.list));
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function plannerStats() {
    var list = readList();
    if (!list) return null;
    var today = isoDay(0);
    var open = list.filter(function (a) { return !a.completed; });
    var late = open.filter(function (a) { return a.dueDate < today; });
    return {
      total: list.length,
      open: open.length,
      done: list.length - open.length,
      late: late.length,
      today: open.filter(function (a) { return a.dueDate === today; }).length
    };
  }

  function heroLine(stats) {
    if (!stats) return "Open the demo to load homework.";
    if (!stats.total) return "Right now: an empty list.";
    if (!stats.open) return "Right now: all caught up.";
    if (stats.late) return "Right now: " + stats.open + " open, " + stats.late + " late.";
    if (stats.today) return "Right now: " + stats.open + " open, " + stats.today + " due today.";
    return "Right now: " + stats.open + " open.";
  }

  function setCount(el, value) {
    var from = Number(el.textContent) || 0;
    if (!motion) { el.textContent = value; return; }
    if (from === value && el.dataset.ready) return;
    el.dataset.ready = "1";
    var box = { v: from };
    gsap.to(box, {
      v: value,
      duration: 0.7,
      ease: "power2.out",
      onUpdate: function () { el.textContent = Math.round(box.v); }
    });
    if (from !== value) {
      gsap.fromTo(el, { scale: 1.45, rotate: -6 }, { scale: 1, rotate: 0, duration: 0.7, ease: "elastic.out(1, 0.45)" });
    }
  }

  function kb(text) {
    var bytes = new Blob([text || ""]).size;
    return bytes < 1024 ? bytes + " B" : (bytes / 1024).toFixed(1) + " KB";
  }

  function highlightJson(json) {
    return escapeHtml(json).replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
      var cls = "n";
      if (/^"/.test(match)) cls = /:$/.test(match) ? "k" : "s";
      else if (/true|false|null/.test(match)) cls = "b";
      return '<span class="' + cls + '">' + match + "</span>";
    });
  }

  var knownIds = null;
  var lastRaw = null;

  function renderJson() {
    var view = $("#json-view");
    var list = readList();
    var raw = "";
    try { raw = localStorage.getItem(KEY.list) || ""; } catch (error) { raw = ""; }
    if (raw === lastRaw) return;
    lastRaw = raw;
    $("#json-size").textContent = kb(raw);
    if (!list) {
      view.innerHTML = '<span class="b">null</span>  <span class="k">// open the demo once to create it</span>';
      knownIds = null;
      return;
    }
    var fresh = [];
    var body = list.map(function (item) {
      var isNew = knownIds !== null && knownIds.indexOf(item.id) === -1;
      if (isNew) fresh.push(item.id);
      var text = JSON.stringify(item, null, 2).replace(/\n/g, "\n  ");
      return '  <span class="item' + (isNew ? " flash" : "") + '" data-id="' + escapeHtml(item.id) + '">' + highlightJson(text) + "</span>";
    }).join(",\n");
    view.innerHTML = "[\n" + body + "\n]";
    knownIds = list.map(function (item) { return item.id; });
    if (fresh.length) {
      var el = view.querySelector('[data-id="' + fresh[fresh.length - 1] + '"]');
      if (el) view.scrollTop = el.offsetTop - 40;
    }
  }

  function renderKeys() {
    var keys = ["studyhub.assignments", "studyhub.grades", "studyhub.prefs"];
    var total = 0;
    var html = keys.map(function (key) {
      var value = "";
      try { value = localStorage.getItem(key) || ""; } catch (error) { value = ""; }
      total += new Blob([value]).size;
      return "<li><b>" + key + "</b><span>" + kb(value) + "</span></li>";
    }).join("");
    html += '<li class="total"><span>whole backend</span><span>' + (total / 1024).toFixed(1) + " KB</span></li>";
    $("#keys").innerHTML = html;
  }

  function refreshLive() {
    var stats = plannerStats();
    $("#live-line").textContent = heroLine(stats);
    setCount($("#st-open"), stats ? stats.open : 0);
    setCount($("#st-done"), stats ? stats.done : 0);
    setCount($("#st-late"), stats ? stats.late : 0);
    renderKeys();
    renderJson();
  }

  window.addEventListener("storage", function (event) {
    if (!event.key || event.key.indexOf("studyhub.") === 0) refreshLive();
  });

  /* ---------- demo frame ---------- */

  var frame = $("#demo-frame");
  var viewport = $("#demo-viewport");

  function fitFrame() {
    var narrow = viewport.clientWidth < 700;
    var w = narrow ? 400 : 1280;
    var h = narrow ? 720 : 800;
    viewport.style.aspectRatio = w + " / " + h;
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    frame.style.transform = "scale(" + viewport.clientWidth / w + ")";
  }

  if (window.ResizeObserver) new ResizeObserver(fitFrame).observe(viewport);
  fitFrame();

  $("#demo-url").textContent = (location.host || "uplanner") + "/#dashboard";

  function hookFrame() {
    refreshLive();
    try {
      var win = frame.contentWindow;
      if (win.__deckHooked) return;
      win.__deckHooked = true;
      win.addEventListener("keydown", function (event) {
        if (event.key === "PageDown" || event.key === "PageUp") {
          event.preventDefault();
          window.focus();
          go(event.key === "PageDown" ? 1 : -1);
        }
        if (event.key === "Escape") {
          var modal = win.document.getElementById("modal-root");
          if (!modal || !modal.innerHTML) {
            frame.blur();
            window.focus();
          }
        }
      }, true);
    } catch (error) { /* The frame stays usable without deck shortcuts. */ }
  }

  frame.addEventListener("load", hookFrame);
  try {
    if (frame.contentDocument.readyState === "complete" && frame.contentWindow.location.href !== "about:blank") hookFrame();
  } catch (error) { /* Not loaded yet; the load listener handles it. */ }

  $$(".step").forEach(function (step) {
    step.addEventListener("click", function () {
      step.classList.toggle("done");
      if (motion && step.classList.contains("done")) {
        gsap.fromTo(step.querySelector(".step-n"), { scale: 1.8, rotate: -20 }, { scale: 1, rotate: 0, duration: 0.6, ease: "back.out(3)" });
      }
    });
  });

  /* ---------- lesson ---------- */

  var note = $("#note");
  try { note.value = localStorage.getItem(KEY.note) || ""; } catch (error) { note.value = ""; }
  note.addEventListener("input", function () {
    try { localStorage.setItem(KEY.note, note.value); } catch (error) { /* Storage can be blocked in private windows. */ }
  });

  $("#reload").addEventListener("click", function () {
    if (!note.value.trim()) {
      note.focus();
      if (motion) gsap.fromTo("#sticky", { x: -8 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.3)" });
      return;
    }
    session(KEY.reloaded, "1");
    session(KEY.slide, String(currentSlide));
    location.reload();
  });

  function stamp() {
    var el = $("#stamp");
    if (!motion) { el.style.opacity = 1; return; }
    gsap.timeline()
      .fromTo(el, { scale: 3.2, rotate: -40, opacity: 0 }, { scale: 1, rotate: -12, opacity: 1, duration: 0.42, ease: "power4.in" })
      .fromTo("#sticky", { x: -7 }, { x: 0, duration: 0.6, ease: "elastic.out(1.2, 0.25)" }, ">-0.04");
  }

  $("#copy-code").addEventListener("click", function () {
    var button = this;
    var snippet = 'localStorage.setItem("note", "Bio quiz Friday");\nlocalStorage.getItem("note");';
    var done = function () {
      button.textContent = "copied";
      setTimeout(function () { button.textContent = "copy"; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(snippet).then(done, done);
    else done();
  });

  $("#add-one").addEventListener("click", function () {
    var list = readList() || [];
    var stamp = Date.now();
    list.push({
      id: "id-" + stamp.toString(36) + "-show",
      title: "Added from the showcase",
      subject: "Advanced Coding",
      description: "Written straight into localStorage by the showcase page.",
      dueDate: isoDay(1),
      priority: "medium",
      estimatedMinutes: 15,
      completed: false,
      createdAt: new Date(stamp).toISOString(),
      completedAt: null
    });
    try {
      localStorage.setItem(KEY.list, JSON.stringify(list));
    } catch (error) {
      $("#add-msg").textContent = "This browser blocked storage.";
      return;
    }
    refreshLive();
    try { frame.contentWindow.location.reload(); } catch (error) { frame.src = frame.src; }
    $("#add-msg").textContent = "Saved. The planner in the demo shows it now.";
    if (motion) gsap.fromTo("#add-msg", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 });
  });

  /* ---------- QR ---------- */

  function drawQR() {
    var url = location.protocol === "file:" ? new URL("../index.html", location.href).href : location.origin + "/";
    $("#qr-url").textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    var svg = $("#qr");
    if (typeof window.qrcode !== "function") { svg.style.display = "none"; return; }
    var qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 1;
    var rects = "";
    for (var r = 0; r < n; r += 1) {
      for (var c = 0; c < n; c += 1) {
        if (qr.isDark(r, c)) rects += '<rect x="' + (c + quiet) + '" y="' + (r + quiet) + '" width="1.04" height="1.04"/>';
      }
    }
    svg.setAttribute("viewBox", "0 0 " + (n + quiet * 2) + " " + (n + quiet * 2));
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.innerHTML = rects;
  }

  /* ---------- talk timer ---------- */

  var timerButton = $("#hud-timer");
  var timer = { started: null, elapsed: 0 };
  try {
    var savedTimer = JSON.parse(session(KEY.timer) || "null");
    if (savedTimer) timer = savedTimer;
  } catch (error) { timer = { started: null, elapsed: 0 }; }

  function elapsed() { return timer.elapsed + (timer.started ? Date.now() - timer.started : 0); }

  function saveTimer() { session(KEY.timer, JSON.stringify(timer)); }

  function paintTimer() {
    var ms = elapsed();
    var s = Math.floor(ms / 1000);
    timerButton.innerHTML = Math.floor(s / 60) + ":" + pad(s % 60) + " <small>/ 7:00</small>";
    timerButton.classList.toggle("is-running", !!timer.started);
    timerButton.classList.toggle("in-window", ms >= TALK_WINDOW && ms <= TALK_LIMIT);
    timerButton.classList.toggle("over", ms > TALK_LIMIT);
  }

  function toggleTimer() {
    if (timer.started) {
      timer.elapsed += Date.now() - timer.started;
      timer.started = null;
    } else {
      timer.started = Date.now();
    }
    saveTimer();
    paintTimer();
  }

  function resetTimer() {
    timer = { started: null, elapsed: 0 };
    saveTimer();
    paintTimer();
  }

  timerButton.addEventListener("click", toggleTimer);
  timerButton.addEventListener("dblclick", resetTimer);
  setInterval(paintTimer, 250);
  paintTimer();

  /* ---------- slide navigation ---------- */

  function scrollPos() { return window.scrollY || window.pageYOffset || 0; }

  function computeStops() {
    var list = [];
    slides.forEach(function (slide, index) {
      var st = slide._pin;
      if (st) {
        var parts = slide._parts || 1;
        for (var p = 0; p <= parts; p += 1) list.push({ y: Math.round(st.start + (st.end - st.start) * (p / parts)), i: index });
      } else {
        list.push({ y: Math.round(slide.getBoundingClientRect().top + scrollPos()), i: index });
      }
    });
    list.sort(function (a, b) { return a.y - b.y; });
    stopCache = list;
    return list;
  }

  function slideStart(index) {
    var hit = stopCache.filter(function (stop) { return stop.i === index; })[0];
    return hit ? hit.y : 0;
  }

  function scrollToY(y, immediate) {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    y = Math.max(0, Math.min(max, y));
    if (lenis) {
      var distance = Math.abs(y - lenis.targetScroll);
      lenis.scrollTo(y, {
        immediate: !!immediate,
        force: true,
        duration: Math.min(2.6, Math.max(0.9, (distance / window.innerHeight) * 0.8)),
        easing: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
      });
    } else {
      window.scrollTo({ top: y, behavior: immediate ? "auto" : "smooth" });
    }
  }

  function go(direction) {
    var stops = stopCache.length ? stopCache : computeStops();
    var here = lenis ? lenis.targetScroll : scrollPos();
    var target = null;
    if (direction > 0) {
      target = stops.filter(function (stop) { return stop.y > here + 4; })[0];
    } else {
      var before = stops.filter(function (stop) { return stop.y < here - 4; });
      target = before[before.length - 1];
    }
    if (target) scrollToY(target.y);
  }

  function updateHud() {
    var y = scrollPos();
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    $("#progress-bar").style.transform = "scaleX(" + Math.min(1, y / max).toFixed(4) + ")";
    var probe = y + window.innerHeight * 0.4;
    var index = 0;
    stopCache.forEach(function (stop) { if (stop.y <= probe) index = Math.max(index, stop.i); });
    if (index === currentSlide) return;
    currentSlide = index;
    var slide = slides[index];
    var title = slide.getAttribute("data-title");
    $("#hud-slide").textContent = (index + 1) + " / " + slides.length + " · " + title;
    var budget = Number(slide.getAttribute("data-budget")) || 0;
    $("#speaker-meta").textContent = (index + 1) + " / " + slides.length + " · " + title + " · " + Math.floor(budget / 60) + ":" + pad(budget % 60);
    $("#speaker-text").textContent = slide.getAttribute("data-notes") || "";
    session(KEY.slide, String(index));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
  }

  document.addEventListener("keydown", function (event) {
    var target = event.target;
    if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (target && target.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) return;
    var key = event.key;
    if (key === "ArrowDown" || key === "ArrowRight" || key === "PageDown" || (key === " " && !event.shiftKey)) {
      event.preventDefault();
      go(1);
    } else if (key === "ArrowUp" || key === "ArrowLeft" || key === "PageUp" || (key === " " && event.shiftKey)) {
      event.preventDefault();
      go(-1);
    } else if (key === "Home") {
      event.preventDefault();
      scrollToY(0);
    } else if (key === "End") {
      event.preventDefault();
      scrollToY(document.documentElement.scrollHeight);
    } else if (key === "f" || key === "F") {
      toggleFullscreen();
    } else if (key === "t" || key === "T") {
      if (event.shiftKey) resetTimer();
      else toggleTimer();
    } else if (key === "n" || key === "N") {
      var speaker = $("#speaker");
      speaker.hidden = !speaker.hidden;
    }
  });

  /* ---------- motion ---------- */

  function wrapChars(el) {
    var chars = [];
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var frag = document.createDocumentFragment();
          Array.from(child.textContent).forEach(function (ch) {
            if (ch === "\n" || ch === " ") {
              frag.appendChild(document.createTextNode(ch));
            } else {
              var span = document.createElement("span");
              span.textContent = ch;
              frag.appendChild(span);
              chars.push(span);
            }
          });
          child.parentNode.replaceChild(frag, child);
        } else {
          walk(child);
        }
      });
    })(el);
    return chars;
  }

  var codeChars = null;

  function onEnter(trigger, start) {
    return { trigger: trigger, start: start || "top 72%", toggleActions: "play none none reverse" };
  }

  function splitHeadings() {
    if (!window.SplitText) return;
    $$(".split").forEach(function (el) {
      var split = SplitText.create(el, { type: "lines", linesClass: "line", mask: "lines" });
      gsap.from(split.lines, {
        yPercent: 115,
        rotate: 3,
        duration: 1.1,
        ease: "expo.out",
        stagger: 0.09,
        scrollTrigger: onEnter(el, "top 86%")
      });
    });
  }

  function heroMotion() {
    var chars = $$(".hero-word .ch");
    var ring = $(".ring path");
    var ringLength = ring.getTotalLength();
    gsap.set(ring, { strokeDasharray: ringLength, strokeDashoffset: ringLength });
    root.classList.add("ready");

    gsap.timeline({ defaults: { ease: "expo.out" } })
      .from(".ruled", { clipPath: "inset(0 100% 0 0)", duration: 1.3, ease: "power3.inOut" }, 0)
      .from(".margin-line", { scaleY: 0, duration: 1.1, ease: "power3.inOut" }, 0.2)
      .from(chars, { yPercent: 120, rotate: 14, opacity: 0, duration: 1.4, stagger: 0.06 }, 0.3)
      .to(ring, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" }, 1.05)
      .from(".byline", { y: -24, opacity: 0, duration: 0.8 }, 0.5)
      .from(".hero-sub", { y: 36, opacity: 0, duration: 1 }, 0.95)
      .fromTo(".hero-sub mark", { backgroundSize: "0% 100%" }, { backgroundSize: "100% 100%", duration: 0.9, ease: "power3.inOut" }, 1.35)
      .from(".live-note", { y: -160, rotate: -26, opacity: 0, duration: 1.2, ease: "back.out(1.7)" }, 1.5)
      .from(".hint", { opacity: 0, y: 12, duration: 0.6 }, 1.9)
      .to(chars, { "--w": 340, duration: 0.45, stagger: 0.06, yoyo: true, repeat: 1, ease: "sine.inOut" }, 2.1);

    var setters = chars.map(function (ch) { return gsap.quickTo(ch, "--w", { duration: 0.5, ease: "power3" }); });
    var hero = $("#s-hero");
    hero.addEventListener("pointermove", function (event) {
      chars.forEach(function (ch, i) {
        var box = ch.getBoundingClientRect();
        var distance = Math.abs(event.clientX - (box.left + box.width / 2));
        var pull = Math.max(0, 1 - distance / (window.innerWidth * 0.2));
        setters[i](260 + pull * 640);
      });
    });
    hero.addEventListener("pointerleave", function () { setters.forEach(function (set) { set(820); }); });

    var away = { trigger: "#s-hero", start: "top top", end: "bottom top", scrub: true };
    gsap.to("#hero-word", { yPercent: -28, scale: 1.12, opacity: 0.15, ease: "none", scrollTrigger: away });
    gsap.to(".ruled", { yPercent: 18, ease: "none", scrollTrigger: away });
  }

  function tapeMotion() {
    var loop = gsap.to("#tape-track", { xPercent: -50, ease: "none", duration: 26, repeat: -1 });
    var skew = gsap.quickTo("#tape-track", "skewX", { duration: 0.4, ease: "power3" });
    ScrollTrigger.create({
      trigger: ".tape",
      start: "top bottom",
      end: "bottom top",
      onUpdate: function (self) {
        var v = self.getVelocity();
        var speed = Math.min(7, 1 + Math.abs(v) / 260);
        gsap.to(loop, { timeScale: speed, duration: 0.15, overwrite: true, onComplete: function () { gsap.to(loop, { timeScale: 1, duration: 1.4 }); } });
        skew(gsap.utils.clamp(-14, 14, v / -140));
      },
      onLeave: function () { skew(0); },
      onLeaveBack: function () { skew(0); }
    });
  }

  function chaosMotion(desktop) {
    var board = $("#chaos-board");
    var notes = $$(".note", board);
    var papers = $$(".paper", board);
    gsap.to(papers, {
      y: "random(-10, 10)",
      rotate: "random(-3, 3)",
      duration: "random(1.6, 2.6)",
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
      stagger: 0.15
    });
    gsap.from(papers, {
      scale: 0.3,
      opacity: 0,
      duration: 0.9,
      ease: "back.out(1.8)",
      stagger: 0.08,
      scrollTrigger: onEnter("#s-chaos", "top 75%")
    });
    if (!desktop) return;

    gsap.set(".chaos-title .t-b", { yPercent: 110 });
    var spins = [-14, 9, -6, 12, -10, 7];
    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: "#s-chaos",
        start: "top top",
        end: "+=150%",
        pin: true,
        scrub: 1,
        invalidateOnRefresh: true
      }
    });
    notes.forEach(function (n, i) {
      tl.to(n, {
        x: function () { return board.clientWidth / 2 - (n.offsetLeft + n.offsetWidth / 2); },
        y: function () { return board.clientHeight / 2 - (n.offsetTop + n.offsetHeight / 2); },
        rotate: spins[i % spins.length],
        scale: 0.4,
        opacity: 0,
        duration: 1,
        ease: "power2.in"
      }, i * 0.07);
    });
    tl.fromTo("#one-card", { scale: 0.3, rotate: -16, opacity: 0 }, { scale: 1, rotate: -1.5, opacity: 1, duration: 0.7, ease: "back.out(1.7)" }, 0.95)
      .fromTo("#one-card .oc-row", { x: -30, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.08, duration: 0.4 }, 1.25)
      .to(".chaos-title .t-a", { yPercent: -110, duration: 0.5, ease: "power3.in" }, 0.7)
      .to(".chaos-title .t-b", { yPercent: 0, duration: 0.6, ease: "power3.out" }, 1.1)
      .to({}, { duration: 0.3 });
    $("#s-chaos")._pin = tl.scrollTrigger;
  }

  function demoMotion() {
    gsap.fromTo("#s-demo", { clipPath: "inset(12% 5% 0% 5% round 48px)" }, {
      clipPath: "inset(0% 0% 0% 0% round 0px)",
      ease: "none",
      scrollTrigger: { trigger: "#s-demo", start: "top bottom", end: "top 25%", scrub: true }
    });
    gsap.fromTo("#browser", { rotateX: 32, y: 160, scale: 0.84 }, {
      rotateX: 0,
      y: 0,
      scale: 1,
      ease: "power2.out",
      scrollTrigger: { trigger: "#s-demo", start: "top bottom", end: "top 10%", scrub: 1 }
    });
    gsap.from(".run li", { x: -50, opacity: 0, duration: 0.7, ease: "power3.out", stagger: 0.07, scrollTrigger: onEnter("#s-demo", "top 55%") });
    gsap.from(".live-stats > div", { y: 40, opacity: 0, duration: 0.8, ease: "back.out(2)", stagger: 0.1, scrollTrigger: onEnter("#s-demo", "top 45%") });
  }

  function specsMotion() {
    var tl = gsap.timeline({ scrollTrigger: onEnter("#s-specs", "top 62%") });
    tl.from("#label", { y: 160, rotate: 10, opacity: 0, duration: 1.1, ease: "back.out(1.3)" })
      .from("#label .bar", { scaleX: 0, duration: 0.6, stagger: 0.1, ease: "power3.inOut" }, 0.35)
      .from("#label .row", { opacity: 0, x: -16, stagger: 0.05, duration: 0.4 }, 0.4)
      .from(".specs-say .hand", { scale: 0, rotate: -50, duration: 0.8, ease: "back.out(2.4)" }, 0.6)
      .from(".specs-say .mono", { opacity: 0, y: 14, duration: 0.6 }, 0.9);
    $$("[data-count]").forEach(function (el) {
      var end = Number(el.getAttribute("data-count"));
      var box = { v: 0 };
      el.textContent = "0";
      tl.to(box, {
        v: end,
        duration: 1.4,
        ease: "power2.out",
        onUpdate: function () { el.textContent = Math.round(box.v).toLocaleString(); }
      }, 0.45);
    });
  }

  function reelMotion(desktop) {
    var cards = $$(".index-card");
    if (!desktop) {
      cards.forEach(function (card) {
        gsap.from(card, { y: 60, opacity: 0, duration: 0.8, ease: "power3.out", scrollTrigger: onEnter(card, "top 88%") });
      });
      return;
    }
    var track = $("#reel-track");
    var distance = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
    var slide = gsap.to(track, {
      x: function () { return -distance(); },
      ease: "none",
      scrollTrigger: {
        trigger: "#s-reel",
        start: "top top",
        end: function () { return "+=" + distance(); },
        pin: true,
        scrub: 1,
        invalidateOnRefresh: true
      }
    });
    cards.forEach(function (card, i) {
      gsap.from(card, {
        yPercent: 36,
        rotate: i % 2 ? -14 : 14,
        opacity: 0.15,
        ease: "power2.out",
        scrollTrigger: { trigger: card, containerAnimation: slide, start: "left 98%", end: "left 58%", scrub: true }
      });
    });
    gsap.from(".reel-intro h2", { xPercent: -30, opacity: 0, duration: 1, ease: "expo.out", scrollTrigger: onEnter("#s-reel", "top 60%") });
    $("#s-reel")._pin = slide.scrollTrigger;
    $("#s-reel")._parts = 3;
  }

  function versionsMotion(desktop) {
    var shots = $$(".shot");
    var items = $$("#v-list li");
    if (!desktop) {
      shots.forEach(function (shot) {
        gsap.from(shot, { y: 80, rotate: 4, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: onEnter(shot, "top 88%") });
      });
      return;
    }
    var active = -1;
    var setActive = function (index) {
      if (index === active) return;
      active = index;
      items.forEach(function (item, i) { item.classList.toggle("on", i === index); });
    };
    setActive(0);
    var tilts = [7, -6, 5];
    gsap.set(shots, { "--shade": 0 });
    gsap.set(shots.slice(1), { yPercent: 210, rotate: function (i) { return tilts[i % tilts.length]; } });
    var steps = shots.length - 1;
    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: "#s-versions",
        start: "top top",
        end: "+=" + steps * 75 + "%",
        pin: true,
        scrub: 1,
        onUpdate: function (self) { setActive(Math.min(steps, Math.round(self.progress * steps))); }
      }
    });
    shots.slice(1).forEach(function (shot, i) {
      tl.to(shot, { yPercent: 0, rotate: 0, duration: 1, ease: "power2.out" }, i)
        .to(shots[i], { scale: 0.9, rotate: -3, "--shade": 0.5, duration: 1, ease: "power1.in" }, i);
    });
    gsap.from(shots[0], { y: 140, rotate: -8, opacity: 0, duration: 1.1, ease: "expo.out", scrollTrigger: onEnter("#s-versions", "top 70%") });
    $("#s-versions")._pin = tl.scrollTrigger;
    $("#s-versions")._parts = steps;
  }

  function teachMotion() {
    gsap.fromTo("#s-teach", { clipPath: "circle(8% at 50% 100%)" }, {
      clipPath: "circle(150% at 50% 100%)",
      ease: "none",
      scrollTrigger: { trigger: "#s-teach", start: "top bottom", end: "top 15%", scrub: true }
    });
    gsap.fromTo(".teach-title mark", { backgroundSize: "0% 100%" }, {
      backgroundSize: "100% 100%",
      duration: 0.8,
      ease: "power3.inOut",
      delay: 0.5,
      scrollTrigger: onEnter("#s-teach", "top 50%")
    });
    codeChars = codeChars || wrapChars($("#lesson-code"));
    gsap.from(codeChars, {
      autoAlpha: 0,
      duration: 0.001,
      stagger: 0.011,
      ease: "none",
      scrollTrigger: { trigger: ".code-card", start: "top 78%", toggleActions: "play none none none" }
    });
    gsap.from("#sticky", { y: -260, rotate: -28, opacity: 0, duration: 1.2, ease: "back.out(1.5)", scrollTrigger: onEnter(".teach-grid", "top 72%") });
    gsap.from(".rules li", { y: 24, opacity: 0, stagger: 0.1, duration: 0.6, ease: "power3.out", scrollTrigger: onEnter(".rules", "top 92%") });
  }

  function peekMotion() {
    gsap.from(".json-card", { x: 140, rotate: 4, opacity: 0, duration: 1.1, ease: "expo.out", scrollTrigger: onEnter("#s-peek", "top 60%") });
    gsap.from(".add-one", { scale: 0, rotate: -12, duration: 0.8, ease: "back.out(2.5)", scrollTrigger: onEnter("#s-peek", "top 45%") });
    ScrollTrigger.create({
      trigger: "#s-peek",
      start: "top 55%",
      onEnter: function () { gsap.from("#keys li", { x: -30, opacity: 0, stagger: 0.08, duration: 0.5, ease: "power3.out" }); }
    });
  }

  function closeMotion() {
    gsap.fromTo("#s-close", { clipPath: "inset(30% 30% 30% 30% round 60px)" }, {
      clipPath: "inset(0% 0% 0% 0% round 0px)",
      ease: "none",
      scrollTrigger: { trigger: "#s-close", start: "top bottom", end: "top 20%", scrub: true }
    });
    var letters = $$("#q-word span");
    gsap.from(letters, {
      yPercent: 130,
      rotationX: -100,
      transformPerspective: 700,
      opacity: 0,
      duration: 1.1,
      ease: "back.out(1.6)",
      stagger: 0.05,
      scrollTrigger: onEnter("#s-close", "top 55%")
    });
    gsap.to(".q .qm", { rotate: 16, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: -1 });
    gsap.from(".qr-card", { y: 200, rotate: -24, opacity: 0, duration: 1.1, ease: "back.out(1.4)", scrollTrigger: onEnter("#s-close", "top 45%") });
    gsap.from("#qr rect", {
      scale: 0,
      transformOrigin: "50% 50%",
      duration: 0.4,
      ease: "back.out(3)",
      stagger: { amount: 0.9, from: "random" },
      scrollTrigger: onEnter("#s-close", "top 40%")
    });
  }

  function buildMotion() {
    gsap.registerPlugin(ScrollTrigger);
    if (window.SplitText) gsap.registerPlugin(SplitText);
    root.classList.add("motion");

    if (typeof window.Lenis === "function") {
      lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    }

    heroMotion();
    tapeMotion();

    var mm = gsap.matchMedia();
    mm.add({ desktop: "(min-width: 901px)", mobile: "(max-width: 900px)" }, function (context) {
      var desktop = context.conditions.desktop;
      slides.forEach(function (slide) { slide._pin = null; slide._parts = null; });
      splitHeadings();
      chaosMotion(desktop);
      demoMotion();
      specsMotion();
      reelMotion(desktop);
      versionsMotion(desktop);
      teachMotion();
      peekMotion();
      closeMotion();
    });

    ScrollTrigger.addEventListener("refresh", function () {
      computeStops();
      currentSlide = -1;
      updateHud();
    });
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
    if (lenis) lenis.on("scroll", updateHud);
    else window.addEventListener("scroll", updateHud, { passive: true });
  }

  function start() {
    var saved = Number(session(KEY.slide));
    var reloaded = session(KEY.reloaded) === "1";
    session(KEY.reloaded, null);
    drawQR();
    refreshLive();
    if (motion) {
      buildMotion();
    } else {
      root.classList.add("ready");
      computeStops();
      window.addEventListener("scroll", updateHud, { passive: true });
      window.addEventListener("resize", function () { computeStops(); updateHud(); });
    }
    computeStops();
    updateHud();

    if (saved > 0 && saved < slides.length) {
      scrollToY(slideStart(saved), true);
      setTimeout(updateHud, 50);
    }
    if (reloaded) setTimeout(stamp, 700);
  }

  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  var timeout = new Promise(function (resolve) { setTimeout(resolve, 1800); });
  Promise.race([fontsReady, timeout]).then(start);
})();
