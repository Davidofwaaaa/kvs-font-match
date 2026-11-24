(function () {
  "use strict";

  var canvas = document.getElementById("specimen");
  var ctx = canvas.getContext("2d");
  var composer = document.getElementById("composer");
  var guidesEl = document.getElementById("guides");
  var caret = document.getElementById("caret");
  var menu = document.getElementById("font-menu");
  var state = {
    a: "",
    b: "",
    slot: "a",
    library: "local",
    query: "",
    grid: "hHalfFold",
    lines: [],
    letters: false,
    caret: 0,
    letterLines: {},
    guide: true,
    guideView: true,
    size: 280,
    track: 0,
    kern: 0,
    mass: false
  };
  var serial = 0;
  var drag = null;
  var layout = null;
  var catalog = null;
  var massCache = {};

  function fonts() {
    return (window.KVS && window.KVS.fonts) || [];
  }

  function fontById(id) {
    var found = null;
    fonts().forEach(function (font) { if (font.id === id) found = font; });
    return found;
  }

  function tagBundled() {
    fonts().forEach(function (font) {
      if (!font.source) font.source = "local";
    });
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

  function setStatus(text) {
    document.getElementById("specimen-status").textContent = text || "";
  }

  function pairNote() {
    var left = fontById(state.a);
    var right = fontById(state.b);
    document.getElementById("pair-note").textContent = (left ? left.name : "—") + "  /  " + (right ? right.name : "—");
  }

  function ready() {
    tagBundled();
    var list = fonts().filter(function (font) { return font.source === "local"; });
    if (list.length >= 2 && !state.a) {
      var oswald = list.filter(function (font) { return /oswald/i.test(font.name); })[0];
      var barlow = list.filter(function (font) { return /barlow/i.test(font.name); })[0];
      state.a = (oswald || list[0]).id;
      state.b = (barlow || list[1]).id;
      if (state.a === state.b && list[1]) state.b = list[1].id;
      state.lines = defaultLines(state.grid);
    }
    pairNote();
    paintMenu();
    draw();
  }

  function paintMenu() {
    menu.innerHTML = "";
    var query = state.query.trim().toLowerCase();
    if (state.library === "local") {
      fonts().filter(function (font) {
        return font.source === "local" && (!query || font.name.toLowerCase().indexOf(query) !== -1);
      }).forEach(function (font) { addRow(font.name, font.id === state[state.slot], function () { assign(font); }); });
      return;
    }
    if (!catalog) {
      addRow("Loading Google Fonts", false, function () {});
      return;
    }
    var shown = 0;
    catalog.forEach(function (item) {
      if (shown >= 80) return;
      if (query && item.family.toLowerCase().indexOf(query) === -1) return;
      shown += 1;
      addRow(item.family, false, function () { loadGoogle(item); });
    });
    if (!shown) addRow(query ? "No match" : "Type to search", false, function () {});
  }

  function addRow(label, selected, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.addEventListener("click", onClick);
    menu.appendChild(button);
  }

  function assign(entry) {
    state[state.slot] = entry.id;
    pairNote();
    paintMenu();
    draw();
    if (window.KVS && window.KVS.refreshFonts) window.KVS.refreshFonts();
  }

  function loadGoogle(item) {
    var existing = fonts().filter(function (font) { return font.googleId === item.id; })[0];
    if (existing) {
      assign(existing);
      return;
    }
    setStatus("Loading " + item.family);
    var url = "https://cdn.jsdelivr.net/fontsource/fonts/" + item.id + "@latest/" + item.subset + "-" + item.weight + "-normal.ttf";
    fetch(url).then(function (response) {
      if (!response.ok) throw new Error("missing");
      return response.arrayBuffer();
    }).then(function (buffer) {
      var parsed = opentype.parse(buffer);
      var entry = {
        id: "google-" + item.id,
        googleId: item.id,
        name: item.family,
        source: "google",
        parsed: parsed,
        buffer: buffer,
        on: false
      };
      fonts().push(entry);
      assign(entry);
      setStatus("");
    }).catch(function () {
      setStatus(item.family + " has no static file.");
    });
  }

  function textValue() {
    return (composer.value || "A").slice(0, 48);
  }

  function inkCenter(path) {
    var key = (path.commands || []).map(function (command) { return command.type + (command.x || 0); }).join("").slice(0, 120);
    if (massCache[key]) return massCache[key];
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    (path.commands || []).forEach(function (command) {
      [command.x, command.x1, command.x2].forEach(function (value, index) {
        if (value == null) return;
        var y = index === 0 ? command.y : index === 1 ? command.y1 : command.y2;
        if (value < minX) minX = value;
        if (value > maxX) maxX = value;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
    });
    if (!isFinite(minX)) return { x: 0, y: 0 };
    var size = 48;
    var board = document.createElement("canvas");
    board.width = size;
    board.height = size;
    var g = board.getContext("2d");
    var spanX = Math.max(1, maxX - minX);
    var spanY = Math.max(1, maxY - minY);
    var scale = Math.min((size - 2) / spanX, (size - 2) / spanY);
    g.setTransform(scale, 0, 0, -scale, 1 - minX * scale, size - 1 + minY * scale);
    g.beginPath();
    traceOn(g, path, 0, 0, 1);
    g.fill();
    var pixels = g.getImageData(0, 0, size, size).data;
    var sum = 0;
    var sx = 0;
    var sy = 0;
    var i;
    for (i = 0; i < size * size; i += 1) {
      if (pixels[i * 4 + 3] < 16) continue;
      sum += 1;
      sx += i % size;
      sy += Math.floor(i / size);
    }
    var center = sum
      ? { x: (sx / sum - 1) / scale + minX, y: (size - 1 - sy / sum) / scale + minY }
      : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    massCache[key] = center;
    return center;
  }

  function draw() {
    if (document.body.dataset.view !== "specimen") return;
    var left = fontById(state.a);
    var right = fontById(state.b);
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    if (!width || !height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    var text = textValue();
    var pos = composer.selectionStart || 0;
    if (pos > text.length) pos = text.length;
    state.caret = Math.max(0, Math.min(text.length - 1, pos - 1));
    syncLetters(text);
    if (!left || !right || !text) {
      layout = null;
      placeGuides();
      placeCaret(null);
      return;
    }
    var units = left.parsed.unitsPerEm || 1000;
    var scale = state.size / units;
    var chars = Array.from(text);
    var items = chars.map(function (ch, index) {
      var lines = state.letters && state.letterLines[index] ? state.letterLines[index] : state.lines;
      var made = FontRemix.remixChar(left.parsed, right.parsed, ch, specFrom(lines, state.grid));
      return { ch: ch, index: index, made: made, lines: lines };
    });
    var cursor = 0;
    var total = 0;
    items.forEach(function (item, index) {
      var advance = (item.made.advance || units * 0.3) * scale + state.track;
      var gap = index ? state.kern : 0;
      total += advance + gap;
      item.slot = Math.max(8, advance);
      item.gap = gap;
    });
    cursor = (width - total) / 2;
    var mid = height / 2;
    var ink = document.body.dataset.theme === "dark" ? "#ffffff" : "#000000";
    items.forEach(function (item) {
      cursor += item.gap;
      var com = state.mass ? inkCenter(item.made.path) : null;
      var origin = cursor;
      var baseline = mid + state.size * 0.15;
      if (com) {
        origin = cursor + item.slot / 2 - com.x * scale;
        baseline = mid + com.y * scale;
      }
      item.x = origin;
      item.scale = scale;
      item.advance = item.slot;
      item.baseline = baseline;
      item.left = cursor;
      ctx.fillStyle = ink;
      ctx.beginPath();
      traceOn(ctx, item.made.path, origin, baseline, scale);
      ctx.fill();
      if (state.letters && item.index === state.caret) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(cursor, mid - state.size * 0.55, item.slot, state.size * 1.1);
      }
      cursor += item.slot;
    });
    layout = { items: items, width: width, end: cursor };
    placeGuides();
    placeCaret(items[Math.max(0, pos - 1)] || null, pos === 0 ? items[0] : null, pos);
  }

  function placeCaret(before, first, pos) {
    if (!layout || document.activeElement !== composer) {
      caret.hidden = true;
      return;
    }
    var x;
    var top;
    var height = Math.max(24, state.size * 0.9);
    if (pos === 0 && first) {
      x = first.left;
      top = first.baseline - state.size * 0.75;
    } else if (before) {
      x = before.left + before.slot;
      top = before.baseline - state.size * 0.75;
    } else {
      caret.hidden = true;
      return;
    }
    caret.hidden = false;
    caret.style.left = x + "px";
    caret.style.top = top + "px";
    caret.style.height = height + "px";
  }

  function traceOn(context, path, x, baseline, scale) {
    (path.commands || []).forEach(function (command) {
      if (command.type === "M") context.moveTo(x + command.x * scale, baseline - command.y * scale);
      else if (command.type === "L") context.lineTo(x + command.x * scale, baseline - command.y * scale);
      else if (command.type === "C") {
        context.bezierCurveTo(
          x + command.x1 * scale, baseline - command.y1 * scale,
          x + command.x2 * scale, baseline - command.y2 * scale,
          x + command.x * scale, baseline - command.y * scale
        );
      } else if (command.type === "Q") {
        context.quadraticCurveTo(x + command.x1 * scale, baseline - command.y1 * scale, x + command.x * scale, baseline - command.y * scale);
      } else if (command.type === "Z") context.closePath();
    });
  }

  function frame() {
    if (!layout || !layout.items.length) return null;
    if (state.letters) {
      var item = layout.items[state.caret] || layout.items[0];
      return { left: item.left, advance: item.slot, baseline: item.baseline, scale: item.scale, items: [item] };
    }
    var first = layout.items[0];
    return {
      left: first.left,
      advance: layout.end - first.left,
      baseline: first.baseline,
      scale: first.scale,
      items: layout.items
    };
  }

  function placeGuides() {
    var show = state.guide && state.guideView && frame();
    if (drag && show) {
      positionGuideNodes(frame());
      return;
    }
    guidesEl.innerHTML = "";
    if (!show) return;
    var box = frame();
    activeLines().forEach(function (line) {
      var node = document.createElement("div");
      node.className = "guide " + line.axis;
      node.dataset.id = line.id;
      if (line.added) {
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "guide-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove guide");
        remove.addEventListener("pointerdown", function (event) {
          event.stopPropagation();
          var next = activeLines().filter(function (item) { return item.id !== line.id; });
          if (state.letters) state.letterLines[state.caret] = next;
          else state.lines = next;
          draw();
        });
        node.appendChild(remove);
      }
      guidesEl.appendChild(node);
    });
    positionGuideNodes(box);
  }

  function positionGuideNodes(box) {
    activeLines().forEach(function (line) {
      var node = guidesEl.querySelector('[data-id="' + line.id + '"]');
      if (!node) return;
      if (line.axis === "h") {
        var item = box.items[0];
        node.style.top = (item.baseline - line.value * item.scale) + "px";
        node.style.left = box.left + "px";
        node.style.width = box.advance + "px";
        node.style.height = "1px";
      } else {
        node.style.left = (box.left + box.advance * line.value) + "px";
        node.style.top = (box.baseline - state.size * 0.8) + "px";
        node.style.height = (state.size * 1.15) + "px";
        node.style.width = "1px";
      }
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
        composer.setSelectionRange(index + 1, index + 1);
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
    var bounds = document.getElementById("field").getBoundingClientRect();
    var box = frame();
    activeLines().forEach(function (line) {
      if (line.id !== drag) return;
      if (line.axis === "h") line.value = clamp((box.baseline - (event.clientY - bounds.top)) / box.scale, -120, 900);
      else line.value = clamp((event.clientX - bounds.left - box.left) / box.advance, 0.04, 0.96);
    });
    draw();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function saveSvg() {
    if (!layout) return;
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    var ink = document.body.dataset.theme === "dark" ? "#ffffff" : "#000000";
    var paper = document.body.dataset.theme === "dark" ? "#000000" : "#ffffff";
    var body = layout.items.map(function (item) {
      return '<path d="' + pathData(item.made.path, item.x, item.baseline, item.scale) + '" fill="' + ink + '"/>';
    }).join("");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="' + paper + '"/>' + body + '</svg>';
    download("kvs-specimen.svg", svg, "image/svg+xml");
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

  function saveFont() {
    var left = fontById(state.a);
    var right = fontById(state.b);
    if (!left || !right) return;
    var chars = Array.from(new Set(Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,- " + textValue())));
    var font = FontRemix.buildFont(left.parsed, right.parsed, specFrom(state.lines, state.grid), chars, "KVS " + left.name + " " + right.name);
    download(left.name.replace(/\s+/g, "-") + "-" + right.name.replace(/\s+/g, "-") + ".otf", new Blob([font.toArrayBuffer()]), "font/otf");
  }

  function download(name, body, type) {
    var blob = body instanceof Blob ? body : new Blob([body], { type: type });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function readFolder(files) {
    var pending = Array.prototype.filter.call(files, function (file) {
      return /\.(ttf|otf|woff2?)$/i.test(file.name);
    });
    Promise.all(pending.map(function (file) {
      return file.arrayBuffer().then(function (buffer) {
        try {
          var parsed = opentype.parse(buffer);
          fonts().push({
            id: "local-" + file.name + "-" + fonts().length,
            name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
            source: "local",
            parsed: parsed,
            buffer: buffer,
            on: false
          });
        } catch (error) {}
      });
    })).then(function () {
      state.library = "local";
      document.getElementById("lib-local").setAttribute("aria-pressed", "true");
      document.getElementById("lib-google").setAttribute("aria-pressed", "false");
      setStatus(pending.length + " local fonts");
      paintMenu();
      if (window.KVS && window.KVS.refreshFonts) window.KVS.refreshFonts();
    });
  }

  document.querySelectorAll("#specimen-grids button").forEach(function (button) {
    button.addEventListener("click", function () {
      state.grid = button.dataset.grid;
      state.lines = defaultLines(state.grid);
      state.letterLines = {};
      document.querySelectorAll("#specimen-grids button").forEach(function (other) {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      });
      draw();
    });
  });

  guidesEl.addEventListener("pointerdown", function (event) {
    var line = event.target.closest(".guide");
    if (!line || event.target.classList.contains("guide-remove")) return;
    drag = line.dataset.id;
    line.setPointerCapture(event.pointerId);
    move(event);
  });
  guidesEl.addEventListener("pointermove", function (event) { if (drag) move(event); });
  guidesEl.addEventListener("pointerup", function () { drag = null; });
  document.getElementById("field").addEventListener("pointerdown", function (event) {
    if (document.body.dataset.view === "sheet" || event.target.closest(".guide")) return;
    composer.focus();
    draw();
  });
  composer.addEventListener("input", draw);
  composer.addEventListener("keyup", draw);
  composer.addEventListener("blur", function () { caret.hidden = true; });
  document.getElementById("lib-local").addEventListener("click", function () {
    state.library = "local";
    document.getElementById("lib-local").setAttribute("aria-pressed", "true");
    document.getElementById("lib-google").setAttribute("aria-pressed", "false");
    paintMenu();
  });
  document.getElementById("lib-google").addEventListener("click", function () {
    state.library = "google";
    document.getElementById("lib-local").setAttribute("aria-pressed", "false");
    document.getElementById("lib-google").setAttribute("aria-pressed", "true");
    if (!catalog) {
      fetch("fonts/google-fonts.json").then(function (response) { return response.json(); }).then(function (data) {
        catalog = data;
        paintMenu();
      });
    }
    paintMenu();
  });
  document.getElementById("font-find").addEventListener("input", function (event) {
    state.query = event.target.value;
    paintMenu();
  });
  document.getElementById("slot-a").addEventListener("click", function () {
    state.slot = "a";
    document.getElementById("slot-a").setAttribute("aria-pressed", "true");
    document.getElementById("slot-b").setAttribute("aria-pressed", "false");
    paintMenu();
  });
  document.getElementById("slot-b").addEventListener("click", function () {
    state.slot = "b";
    document.getElementById("slot-a").setAttribute("aria-pressed", "false");
    document.getElementById("slot-b").setAttribute("aria-pressed", "true");
    paintMenu();
  });
  document.getElementById("swap").addEventListener("click", function () {
    var hold = state.a;
    state.a = state.b;
    state.b = hold;
    pairNote();
    paintMenu();
    draw();
  });
  document.getElementById("open-folder").addEventListener("click", function () {
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker({ mode: "read" }).then(function (handle) {
        var files = [];
        function walk(dir) {
          var iterator = dir.entries();
          function next() {
            return iterator.next().then(function (step) {
              if (step.done) return;
              var entry = step.value[1];
              if (entry.kind === "file" && /\.(ttf|otf|woff2?)$/i.test(entry.name)) {
                return entry.getFile().then(function (file) { files.push(file); return next(); });
              }
              if (entry.kind === "directory") return walk(entry).then(next);
              return next();
            });
          }
          return next();
        }
        return walk(handle).then(function () { readFolder(files); });
      }).catch(function () {});
      return;
    }
    document.getElementById("folder").click();
  });
  document.getElementById("folder").addEventListener("change", function (event) {
    readFolder(event.target.files);
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
  document.getElementById("mass-btn").addEventListener("click", function () {
    state.mass = !state.mass;
    document.getElementById("mass-btn").setAttribute("aria-pressed", state.mass ? "true" : "false");
    draw();
  });
  document.getElementById("size").addEventListener("input", function (event) { state.size = Number(event.target.value); draw(); });
  document.getElementById("track").addEventListener("input", function (event) { state.track = Number(event.target.value); draw(); });
  document.getElementById("kern").addEventListener("input", function (event) { state.kern = Number(event.target.value); draw(); });
  document.getElementById("clear-text").addEventListener("click", function () {
    composer.value = "";
    state.letterLines = {};
    composer.focus();
    draw();
  });
  document.getElementById("save-svg").addEventListener("click", saveSvg);
  document.getElementById("save-font").addEventListener("click", saveFont);
  window.addEventListener("resize", draw);
  document.addEventListener("kvs-fonts", ready);
  window.KVS = window.KVS || {};
  window.KVS.redrawSpecimen = function () { requestAnimationFrame(draw); };
  if (fonts().length) ready();
  else fetch("fonts/google-fonts.json").then(function (response) { return response.json(); }).then(function (data) { catalog = data; }).catch(function () {});
}());
