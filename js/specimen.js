(function () {
  "use strict";

  var canvas = document.getElementById("specimen");
  var ctx = canvas.getContext("2d");
  var composer = document.getElementById("composer");
  var guidesEl = document.getElementById("guides");
  var state = {
    a: "",
    b: "",
    grid: "hHalfFold",
    lines: [],
    letters: false,
    caret: 0,
    letterLines: {},
    guide: true,
    guideView: true,
    size: 280
  };
  var serial = 0;
  var drag = null;
  var layout = null;

  function fonts() {
    return (window.KVS && window.KVS.fonts) || [];
  }

  function fontById(id) {
    var found = null;
    fonts().forEach(function (font) { if (font.id === id) found = font; });
    return found;
  }

  function defaultLines(gridId) {
    var grid = FontRemix.grids[gridId];
    if (grid.kind === "c") {
      return [
        { id: "h0", axis: "h", value: grid.h[0] },
        { id: "v0", axis: "v", value: grid.v[0] }
      ];
    }
    var axis = grid.kind === "v" ? "v" : "h";
    return grid.lines.map(function (value, index) {
      return { id: axis + index, axis: axis, value: value };
    });
  }

  function activeLines() {
    if (state.letters && state.letterLines[state.caret]) return state.letterLines[state.caret];
    return state.lines;
  }

  function specFrom(lines, grid) {
    return {
      grid: grid,
      h: lines.filter(function (line) { return line.axis === "h"; }).map(function (line) { return line.value; }),
      v: lines.filter(function (line) { return line.axis === "v"; }).map(function (line) { return line.value; })
    };
  }

  function fillSelect(select, value) {
    select.innerHTML = "";
    fonts().forEach(function (font) {
      var option = document.createElement("option");
      option.value = font.id;
      option.textContent = font.name;
      select.appendChild(option);
    });
    if (value) select.value = value;
  }

  function ready() {
    var list = fonts();
    if (list.length < 2) return;
    if (!state.a || !fontById(state.a)) {
      var oswald = list.filter(function (font) { return /oswald/i.test(font.name); })[0];
      var barlow = list.filter(function (font) { return /barlow/i.test(font.name); })[0];
      state.a = (oswald || list[0]).id;
      state.b = (barlow || list[1]).id;
      if (state.a === state.b) state.b = list[1].id;
      state.lines = defaultLines(state.grid);
    }
    fillSelect(document.getElementById("font-a"), state.a);
    fillSelect(document.getElementById("font-b"), state.b);
    paintGrids();
    draw();
  }

  function paintGrids() {
    var host = document.getElementById("specimen-grids");
    if (host.childElementCount) {
      Array.prototype.forEach.call(host.children, function (button) {
        button.setAttribute("aria-pressed", button.dataset.grid === state.grid ? "true" : "false");
      });
      return;
    }
    Object.keys(FontRemix.grids).forEach(function (id) {
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.grid = id;
      button.textContent = FontRemix.grids[id].label;
      button.setAttribute("aria-pressed", id === state.grid ? "true" : "false");
      button.addEventListener("click", function () {
        state.grid = id;
        state.lines = defaultLines(id);
        state.letterLines = {};
        paintGrids();
        draw();
      });
      host.appendChild(button);
    });
  }

  function textValue() {
    return (composer.value || "A").toUpperCase().slice(0, 24);
  }

  function draw() {
    if (document.getElementById("specimen-view").hidden) return;
    var left = fontById(state.a);
    var right = fontById(state.b);
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    var text = textValue();
    if (state.caret >= text.length) state.caret = Math.max(0, text.length - 1);
    syncLetters(text);
    if (!left || !right || !text) {
      layout = null;
      placeGuides();
      return;
    }
    var units = left.parsed.unitsPerEm || 1000;
    var scale = state.size / units;
    var baseline = height / 2 + state.size / 3;
    var chars = Array.from(text);
    var items = chars.map(function (ch, index) {
      var lines = state.letters && state.letterLines[index] ? state.letterLines[index] : state.lines;
      var grid = state.grid;
      var made = FontRemix.remixChar(left.parsed, right.parsed, ch, specFrom(lines, grid));
      return { ch: ch, index: index, made: made, lines: lines };
    });
    var total = items.reduce(function (sum, item) { return sum + (item.made.advance || units * 0.3); }, 0);
    var x = (width - total * scale) / 2;
    var ink = document.body.dataset.theme === "dark" ? "#f2f2f2" : "#111111";
    items.forEach(function (item) {
      item.x = x;
      item.scale = scale;
      item.advance = (item.made.advance || units * 0.3) * scale;
      item.baseline = baseline;
      ctx.fillStyle = ink;
      ctx.beginPath();
      trace(item.made.path, x, baseline, scale);
      ctx.fill();
      if (state.letters && item.index === state.caret) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(item.x - 4, baseline - state.size * 0.82, Math.max(12, item.advance) + 8, state.size);
      }
      x += item.advance;
    });
    layout = { items: items, baseline: baseline, scale: scale, width: width };
    placeGuides();
  }

  function trace(path, x, baseline, scale) {
    (path.commands || []).forEach(function (command) {
      if (command.type === "M") ctx.moveTo(x + command.x * scale, baseline - command.y * scale);
      else if (command.type === "L") ctx.lineTo(x + command.x * scale, baseline - command.y * scale);
      else if (command.type === "C") {
        ctx.bezierCurveTo(
          x + command.x1 * scale, baseline - command.y1 * scale,
          x + command.x2 * scale, baseline - command.y2 * scale,
          x + command.x * scale, baseline - command.y * scale
        );
      } else if (command.type === "Q") {
        ctx.quadraticCurveTo(x + command.x1 * scale, baseline - command.y1 * scale, x + command.x * scale, baseline - command.y * scale);
      } else if (command.type === "Z") ctx.closePath();
    });
  }

  function frame() {
    if (!layout || !layout.items.length) return null;
    if (state.letters) {
      var item = layout.items[state.caret] || layout.items[0];
      return { left: item.x, advance: Math.max(item.advance, 8), baseline: item.baseline, scale: item.scale };
    }
    var first = layout.items[0];
    var last = layout.items[layout.items.length - 1];
    return {
      left: first.x,
      advance: Math.max(last.x + last.advance - first.x, 8),
      baseline: first.baseline,
      scale: first.scale
    };
  }

  function placeGuides() {
    var show = state.guide && state.guideView && frame();
    if (drag && show) {
      var held = frame();
      activeLines().forEach(function (line) {
        var node = guidesEl.querySelector('[data-id="' + line.id + '"]');
        if (!node) return;
        if (line.axis === "h") node.style.top = (held.baseline - line.value * held.scale) + "px";
        else node.style.left = (held.left + held.advance * line.value) + "px";
      });
      return;
    }
    guidesEl.innerHTML = "";
    if (!show) return;
    var box = frame();
    activeLines().forEach(function (line) {
      var node = document.createElement("div");
      node.className = "guide " + line.axis;
      node.dataset.id = line.id;
      if (line.axis === "h") {
        node.style.top = (box.baseline - line.value * box.scale) + "px";
        node.style.left = box.left + "px";
        node.style.width = box.advance + "px";
      } else {
        node.style.left = (box.left + box.advance * line.value) + "px";
        node.style.top = (box.baseline - 860 * box.scale) + "px";
        node.style.height = Math.max(24, (860 + 120) * box.scale) + "px";
      }
      if (line.added) {
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "guide-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove guide");
        remove.addEventListener("pointerdown", function (event) {
          event.stopPropagation();
          var lines = activeLines();
          var next = lines.filter(function (item) { return item.id !== line.id; });
          if (state.letters) state.letterLines[state.caret] = next;
          else state.lines = next;
          draw();
        });
        node.appendChild(remove);
      }
      guidesEl.appendChild(node);
    });
  }

  function syncLetters(text) {
    var host = document.getElementById("letter-picks");
    host.hidden = !state.letters;
    host.innerHTML = "";
    if (!state.letters) return;
    Array.from(text).forEach(function (ch, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = ch;
      button.setAttribute("aria-pressed", index === state.caret ? "true" : "false");
      button.addEventListener("click", function () {
        state.caret = index;
        if (!state.letterLines[index]) state.letterLines[index] = state.lines.map(copyLine);
        draw();
      });
      host.appendChild(button);
    });
  }

  function copyLine(line) {
    return { id: line.id, axis: line.axis, value: line.value, added: line.added };
  }

  function ensureLetter() {
    if (!state.letterLines[state.caret]) state.letterLines[state.caret] = state.lines.map(copyLine);
    return state.letterLines[state.caret];
  }

  function addGuide() {
    var lines = state.letters ? ensureLetter() : state.lines;
    var axis = FontRemix.grids[state.grid].kind === "v" ? "v" : "h";
    var values = lines.filter(function (line) { return line.axis === axis; }).map(function (line) { return line.value; }).sort(function (a, b) { return a - b; });
    var min = axis === "h" ? 80 : 0.16;
    var max = axis === "h" ? 760 : 0.84;
    var points = [min].concat(values, [max]);
    var best = (min + max) / 2;
    var gap = -1;
    var i;
    for (i = 0; i < points.length - 1; i += 1) {
      var size = points[i + 1] - points[i];
      if (size > gap) {
        gap = size;
        best = (points[i] + points[i + 1]) / 2;
      }
    }
    lines.push({ id: "add" + (serial += 1), axis: axis, value: best, added: true });
    state.guide = true;
    document.getElementById("guide-btn").setAttribute("aria-pressed", "true");
    draw();
  }

  function resetGuides() {
    var fresh = defaultLines(state.grid);
    if (state.letters) state.letterLines[state.caret] = fresh;
    else state.lines = fresh;
    draw();
  }

  function move(event) {
    if (!drag || !frame()) return;
    var bounds = document.getElementById("specimen-stage").getBoundingClientRect();
    var box = frame();
    var lines = activeLines();
    lines.forEach(function (line) {
      if (line.id !== drag) return;
      if (line.axis === "h") {
        line.value = clamp((box.baseline - (event.clientY - bounds.top)) / box.scale, -120, 860);
      } else {
        line.value = clamp((event.clientX - bounds.left - box.left) / box.advance, 0.04, 0.96);
      }
    });
    placeGuides();
    draw();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pathData(path, x, baseline, scale) {
    return (path.commands || []).map(function (command) {
      function n(value) { return Math.round(value * 100) / 100; }
      if (command.type === "M") return "M" + n(x + command.x * scale) + " " + n(baseline - command.y * scale);
      if (command.type === "L") return "L" + n(x + command.x * scale) + " " + n(baseline - command.y * scale);
      if (command.type === "C") {
        return "C" + n(x + command.x1 * scale) + " " + n(baseline - command.y1 * scale) + " " +
          n(x + command.x2 * scale) + " " + n(baseline - command.y2 * scale) + " " +
          n(x + command.x * scale) + " " + n(baseline - command.y * scale);
      }
      if (command.type === "Q") {
        return "Q" + n(x + command.x1 * scale) + " " + n(baseline - command.y1 * scale) + " " +
          n(x + command.x * scale) + " " + n(baseline - command.y * scale);
      }
      return command.type === "Z" ? "Z" : "";
    }).join("");
  }

  function saveSvg() {
    if (!layout) return;
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    var ink = document.body.dataset.theme === "dark" ? "#f2f2f2" : "#111111";
    var paper = document.body.dataset.theme === "dark" ? "#111111" : "#ffffff";
    var body = layout.items.map(function (item) {
      return '<path d="' + pathData(item.made.path, item.x, item.baseline, item.scale) + '" fill="' + ink + '"/>';
    }).join("");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="' + paper + '"/>' + body + '</svg>';
    download("kvs-specimen.svg", svg, "image/svg+xml");
  }

  function saveFont() {
    var left = fontById(state.a);
    var right = fontById(state.b);
    if (!left || !right) return;
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,- ".split("");
    var font = FontRemix.buildFont(left.parsed, right.parsed, specFrom(state.lines, state.grid), chars, "KVS " + left.name + " " + right.name);
    var bytes = font.toArrayBuffer();
    download(left.name.replace(/\s+/g, "-") + "-" + right.name.replace(/\s+/g, "-") + ".otf", new Blob([bytes]), "font/otf");
  }

  function download(name, body, type) {
    var blob = body instanceof Blob ? body : new Blob([body], { type: type });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  guidesEl.addEventListener("pointerdown", function (event) {
    var line = event.target.closest(".guide");
    if (!line || event.target.classList.contains("guide-remove")) return;
    drag = line.dataset.id;
    line.setPointerCapture(event.pointerId);
    move(event);
  });
  guidesEl.addEventListener("pointermove", function (event) { if (drag) move(event); });
  guidesEl.addEventListener("pointerup", function () {
    drag = null;
  });

  document.getElementById("specimen-stage").addEventListener("pointerdown", function (event) {
    if (event.target.closest(".guide")) return;
    composer.focus();
  });
  composer.addEventListener("input", draw);
  document.getElementById("font-a").addEventListener("change", function (event) { state.a = event.target.value; draw(); });
  document.getElementById("font-b").addEventListener("change", function (event) { state.b = event.target.value; draw(); });
  document.getElementById("swap").addEventListener("click", function () {
    var hold = state.a;
    state.a = state.b;
    state.b = hold;
    document.getElementById("font-a").value = state.a;
    document.getElementById("font-b").value = state.b;
    draw();
  });
  document.getElementById("guide-btn").addEventListener("click", function () {
    state.guide = !state.guide;
    document.getElementById("guide-btn").setAttribute("aria-pressed", state.guide ? "true" : "false");
    placeGuides();
  });
  document.getElementById("view-guides").addEventListener("click", function () {
    state.guideView = !state.guideView;
    document.getElementById("view-guides").setAttribute("aria-pressed", state.guideView ? "true" : "false");
    placeGuides();
  });
  document.getElementById("add-guide").addEventListener("click", addGuide);
  document.getElementById("reset-guides").addEventListener("click", resetGuides);
  document.getElementById("letters-btn").addEventListener("click", function () {
    state.letters = !state.letters;
    document.getElementById("letters-btn").setAttribute("aria-pressed", state.letters ? "true" : "false");
    if (state.letters) ensureLetter();
    draw();
  });
  document.getElementById("size").addEventListener("input", function (event) {
    state.size = Number(event.target.value);
    draw();
  });
  document.getElementById("clear-text").addEventListener("click", function () {
    composer.value = "";
    state.letterLines = {};
    state.caret = 0;
    composer.focus();
    draw();
  });
  document.getElementById("save-svg").addEventListener("click", saveSvg);
  document.getElementById("save-font").addEventListener("click", saveFont);
  window.addEventListener("resize", draw);
  document.addEventListener("kvs-fonts", ready);
  window.KVS = window.KVS || {};
  window.KVS.redrawSpecimen = draw;
  if (fonts().length) ready();
}());
