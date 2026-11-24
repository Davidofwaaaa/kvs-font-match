(function () {
  "use strict";

  var LIBRARY = [
    "Archivo-Regular.ttf",
    "Barlow-Regular.ttf",
    "LibreBaskerville-Regular.ttf",
    "Oswald-Medium.ttf",
    "Poppins-Medium.ttf",
    "Raleway-Medium.ttf",
    "SpaceMono-Regular.ttf",
    "Syne-Bold.ttf"
  ];
  var LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,- ";
  var MM = 72 / 25.4;
  var PAGE_W = 420 * MM;
  var PAGE_H = 297 * MM;
  var MARGIN = 12.7 * MM;
  var HEADER = 28;

  var fonts = [];
  var variations = [];
  var page = 0;
  var active = -1;
  var picked = {};
  var cache = {};
  var job = 0;
  var hits = [];

  var stage = document.getElementById("stage");
  paper.setup(document.getElementById("paper"));

  function nameOf(file) {
    return file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
  }

  function loadBuffer(buffer, file) {
    var parsed = opentype.parse(buffer);
    return {
      id: file + "-" + fonts.length + "-" + Math.random().toString(16).slice(2),
      file: file,
      name: nameOf(file),
      parsed: parsed,
      buffer: buffer,
      on: fonts.length < 4
    };
  }

  function boot() {
    applyTheme(localStorage.getItem("font-remix-theme") === "dark" ? "dark" : "light", false);
    paintGridChecks();
    Promise.all(LIBRARY.map(function (file) {
      return fetch("fonts/" + file).then(function (response) {
        if (!response.ok) throw new Error(file);
        return response.arrayBuffer();
      }).then(function (buffer) {
        try { fonts.push(loadBuffer(buffer, file)); } catch (error) {}
      }).catch(function () {});
    })).then(function () {
      paintFonts();
      paintCellSelects();
      publishFonts();
      runAll();
    });
  }

  function paintFonts() {
    var list = document.getElementById("font-list");
    list.innerHTML = "";
    fonts.forEach(function (font, index) {
      var label = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = font.on;
      box.addEventListener("change", function () {
        font.on = box.checked;
        runAll();
      });
      var text = document.createElement("span");
      text.textContent = font.name;
      label.appendChild(box);
      label.appendChild(text);
      list.appendChild(label);
      if (!document.getElementById("face-" + index)) {
        var face = new FontFace("kvs-" + index, font.buffer);
        face.load().then(function (loaded) {
          document.fonts.add(loaded);
          text.style.fontFamily = loaded.family;
          text.style.fontSize = "16px";
          text.style.letterSpacing = "0";
          text.style.textTransform = "none";
        }).catch(function () {});
      }
    });
  }

  function paintGridChecks() {
    var list = document.getElementById("grid-list");
    Object.keys(FontRemix.grids).forEach(function (id, index) {
      var grid = FontRemix.grids[id];
      var label = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = index === 0 || index === 1;
      box.dataset.grid = id;
      box.addEventListener("change", runAll);
      label.appendChild(box);
      label.appendChild(document.createTextNode(grid.label));
      list.appendChild(label);
    });
    var select = document.getElementById("cell-grid");
    Object.keys(FontRemix.grids).forEach(function (id) {
      var option = document.createElement("option");
      option.value = id;
      option.textContent = FontRemix.grids[id].label;
      select.appendChild(option);
    });
  }

  function selectedFonts() {
    return fonts.filter(function (font) { return font.on; });
  }

  function selectedGrids() {
    return Array.prototype.map.call(document.querySelectorAll("#grid-list input:checked"), function (box) {
      return box.dataset.grid;
    });
  }

  function pairBag(grids) {
    var group = selectedFonts();
    var bag = [];
    group.forEach(function (left) {
      group.forEach(function (right) {
        if (left === right) return;
        grids.forEach(function (grid) {
          var base = FontRemix.grids[grid];
          bag.push({
            a: left.id,
            b: right.id,
            grid: grid,
            h: (base.h || base.lines || [380]).slice(),
            v: (base.v || (base.kind === "v" ? base.lines : [0.5])).slice()
          });
        });
      });
    });
    return bag;
  }

  function fontById(id) {
    var found = null;
    fonts.forEach(function (font) { if (font.id === id) found = font; });
    return found;
  }

  function runAll() {
    variations = pairBag(selectedGrids());
    page = 0;
    active = variations.length ? 0 : -1;
    picked = {};
    document.getElementById("run-note").textContent = variations.length
      ? variations.length + " variations"
      : "Select two fonts and one grid.";
    draw();
  }

  function randomize() {
    var bag = pairBag(selectedGrids());
    var count = Math.max(1, Math.min(80, parseInt(document.getElementById("random-count").value, 10) || 12));
    var i;
    for (i = bag.length - 1; i > 0; i -= 1) {
      var swap = Math.floor(Math.random() * (i + 1));
      var hold = bag[i];
      bag[i] = bag[swap];
      bag[swap] = hold;
    }
    variations = bag.slice(0, count).map(function (item) {
      item.h = item.h.map(function (line) { return clamp(line + (Math.random() - 0.5) * 160, 40, 760); });
      item.v = item.v.map(function (line) { return clamp(line + (Math.random() - 0.5) * 0.3, 0.12, 0.88); });
      return item;
    });
    page = 0;
    active = variations.length ? 0 : -1;
    picked = {};
    document.getElementById("run-note").textContent = variations.length
      ? variations.length + " random variations"
      : "Select two fonts and one grid.";
    draw();
  }

  function columns() {
    return clamp(parseInt(document.getElementById("columns").value, 10) || 11, 2, 16);
  }

  function pageCount() {
    var cols = columns();
    var rows = rowsFor(cols);
    return Math.max(1, Math.ceil(variations.length / (cols * rows)));
  }

  function rowsFor(cols) {
    var cellW = (PAGE_W - MARGIN * 2) / cols;
    var room = PAGE_H - MARGIN * 2 - HEADER;
    return Math.max(1, Math.floor(room / (cellW * 0.82)));
  }

  function pageSlice(index) {
    var cols = columns();
    var rows = rowsFor(cols);
    var size = cols * rows;
    var start = index * size;
    return {
      cols: cols,
      rows: rows,
      start: start,
      items: variations.slice(start, start + size),
      cellW: (PAGE_W - MARGIN * 2) / cols,
      cellH: (PAGE_H - MARGIN * 2 - HEADER) / rows
    };
  }

  function sampleText() {
    return (document.getElementById("sample").value || "A").slice(0, 24);
  }

  function specKey(item) {
    return item.a + "|" + item.b + "|" + item.grid + "|" + item.h.join(",") + "|" + item.v.join(",");
  }

  function mixedChar(item, ch) {
    var key = specKey(item) + "|" + ch;
    if (cache[key]) return cache[key];
    var left = fontById(item.a);
    var right = fontById(item.b);
    if (!left || !right) return null;
    var made = FontRemix.remixChar(left.parsed, right.parsed, ch, item);
    cache[key] = made;
    return made;
  }

  function drawWord(item, x, y, width, height) {
    var text = sampleText();
    var left = fontById(item.a);
    if (!left) return "";
    var units = left.parsed.unitsPerEm || 1000;
    var asc = left.parsed.ascender || units * 0.8;
    var desc = left.parsed.descender || -units * 0.2;
    var chars = Array.from(text);
    var advances = chars.map(function (ch) {
      var made = mixedChar(item, ch);
      return made ? made.advance : units * 0.3;
    });
    var total = advances.reduce(function (sum, value) { return sum + value; }, 0) || units;
    var scale = Math.min((width * 0.82) / total, (height * 0.62) / (asc - desc));
    var cursor = x + (width - total * scale) / 2;
    var baseline = y + height * 0.58;
    var d = "";
    chars.forEach(function (ch, index) {
      var made = mixedChar(item, ch);
      if (made) d += pathData(made.path, cursor, baseline, scale);
      cursor += advances[index] * scale;
    });
    return d;
  }

  function pathData(path, x, baseline, scale) {
    if (!path || !path.commands) return "";
    return path.commands.map(function (command) {
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
      if (command.type === "Z") return "Z";
      return "";
    }).join("");
  }

  function n(value) { return Math.round(value * 100) / 100; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function ink() {
    return document.body.dataset.theme === "dark" ? "#f2f2f2" : "#111111";
  }

  function paperColor() {
    return document.body.dataset.theme === "dark" ? "#111111" : "#ffffff";
  }

  function headerLine(index) {
    var total = pageCount();
    return "Page " + (index + 1) + "/" + total + "  ·  " + variations.length + " variations  ·  " + sampleText();
  }

  function renderPage(svg, index) {
    var slice = pageSlice(index);
    var color = ink();
    svg.setAttribute("viewBox", "0 0 " + n(PAGE_W) + " " + n(PAGE_H));
    svg.innerHTML = "";
    var ns = "http://www.w3.org/2000/svg";
    function el(name) { return document.createElementNS(ns, name); }
    var ground = el("rect");
    ground.setAttribute("width", "100%");
    ground.setAttribute("height", "100%");
    ground.setAttribute("fill", paperColor());
    svg.appendChild(ground);
    var title = el("text");
    title.setAttribute("x", n(MARGIN));
    title.setAttribute("y", n(MARGIN + 11));
    title.setAttribute("fill", color);
    title.setAttribute("font-family", "Inter, Helvetica, sans-serif");
    title.setAttribute("font-size", "9");
    title.textContent = headerLine(index);
    svg.appendChild(title);
    hits = [];
    slice.items.forEach(function (item, offset) {
      var col = offset % slice.cols;
      var row = Math.floor(offset / slice.cols);
      var x = MARGIN + col * slice.cellW;
      var y = MARGIN + HEADER + row * slice.cellH;
      var number = slice.start + offset + 1;
      var mark = el("text");
      mark.setAttribute("x", n(x + 3));
      mark.setAttribute("y", n(y + 9));
      mark.setAttribute("fill", color);
      mark.setAttribute("font-family", "Inter, Helvetica, sans-serif");
      mark.setAttribute("font-size", "7");
      mark.textContent = String(number);
      svg.appendChild(mark);
      var d = drawWord(item, x, y + 8, slice.cellW, slice.cellH - 8);
      if (d) {
        var shape = el("path");
        shape.setAttribute("d", d);
        shape.setAttribute("fill", color);
        svg.appendChild(shape);
      }
      var frame = el("rect");
      frame.setAttribute("x", n(x));
      frame.setAttribute("y", n(y));
      frame.setAttribute("width", n(slice.cellW));
      frame.setAttribute("height", n(slice.cellH));
      frame.setAttribute("fill", "none");
      frame.setAttribute("stroke", color);
      frame.setAttribute("stroke-width", number - 1 === active || picked[number] ? "1.4" : "0.4");
      svg.appendChild(frame);
      hits.push({ number: number, index: slice.start + offset, x: x, y: y, w: slice.cellW, h: slice.cellH });
    });
  }

  function draw() {
    var pages = pageCount();
    if (page > pages - 1) page = pages - 1;
    document.getElementById("page-label").textContent = (page + 1) + " / " + pages;
    document.getElementById("sheet-note").textContent = variations.length
      ? headerLine(page)
      : "Select at least two fonts.";
    if (document.body.dataset.view === "sheet") {
      document.getElementById("mast-note").textContent = "SHEET  " + variations.length;
    }
    renderPage(stage, page);
    syncSingle();
    document.body.dataset.ready = variations.length ? "yes" : "empty";
  }

  function syncSingle() {
    var item = variations[active];
    var note = document.getElementById("cell-note");
    ["cell-a", "cell-b", "cell-grid"].forEach(function (id) {
      document.getElementById(id).disabled = !item;
    });
    if (!item) {
      note.textContent = "Click a cell. Shift-click marks it for the font export.";
      return;
    }
    var left = fontById(item.a);
    var right = fontById(item.b);
    note.textContent = (active + 1) + "  " + (left ? left.name : "") + " / " + (right ? right.name : "") + "  ·  " + FontRemix.gridById(item.grid).label;
    document.getElementById("cell-a").value = item.a;
    document.getElementById("cell-b").value = item.b;
    document.getElementById("cell-grid").value = item.grid;
  }

  function paintCellSelects() {
    ["cell-a", "cell-b"].forEach(function (id) {
      var select = document.getElementById(id);
      var value = select.value;
      select.innerHTML = "";
      fonts.forEach(function (font) {
        var option = document.createElement("option");
        option.value = font.id;
        option.textContent = font.name;
        select.appendChild(option);
      });
      if (value) select.value = value;
    });
  }

  function hitAt(event) {
    var rect = stage.getBoundingClientRect();
    var x = (event.clientX - rect.left) / rect.width * PAGE_W;
    var y = (event.clientY - rect.top) / rect.height * PAGE_H;
    var found = null;
    hits.forEach(function (hit) {
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) found = hit;
    });
    return found;
  }

  function download(name, body, type) {
    var blob = body instanceof Blob ? body : new Blob([body], { type: type });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1500);
  }

  function svgText(index) {
    var holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    renderPage(holder, index);
    holder.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    holder.setAttribute("width", n(PAGE_W));
    holder.setAttribute("height", n(PAGE_H));
    return new XMLSerializer().serializeToString(holder);
  }

  function pdfEscape(text) {
    return String(text).replace(/[^\x20-\x7e]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function pdfPage(index) {
    var slice = pageSlice(index);
    var ops = [];
    var color = document.body.dataset.theme === "dark" ? "0.95 0.95 0.95" : "0.07 0.07 0.07";
    var ground = document.body.dataset.theme === "dark" ? "0.07 0.07 0.07" : "1 1 1";
    ops.push(ground + " rg");
    ops.push("0 0 " + n(PAGE_W) + " " + n(PAGE_H) + " re f");
    ops.push("BT /F1 9 Tf " + color + " rg 1 0 0 -1 " + n(MARGIN) + " " + n(PAGE_H - (MARGIN + 11)) + " Tm (" + pdfEscape(headerLine(index)) + ") Tj ET");
    slice.items.forEach(function (item, offset) {
      var col = offset % slice.cols;
      var row = Math.floor(offset / slice.cols);
      var x = MARGIN + col * slice.cellW;
      var y = MARGIN + HEADER + row * slice.cellH;
      var number = slice.start + offset + 1;
      ops.push("BT /F1 7 Tf 1 0 0 -1 " + n(x + 3) + " " + n(PAGE_H - (y + 9)) + " Tm (" + number + ") Tj ET");
      var d = drawWord(item, x, y + 8, slice.cellW, slice.cellH - 8);
      if (d) ops.push(pathOperators(d, color));
      ops.push(color + " RG " + (number - 1 === active || picked[number] ? "1.4" : "0.4") + " w");
      ops.push(n(x) + " " + n(PAGE_H - y - slice.cellH) + " " + n(slice.cellW) + " " + n(slice.cellH) + " re S");
    });
    return ops.join("\n");
  }

  function pathOperators(d, color) {
    var tokens = d.match(/[MLCQZ]|-?\d*\.?\d+/g) || [];
    var ops = [color + " rg"];
    var i = 0;
    var current = [0, 0];
    function take() { return n(parseFloat(tokens[i += 1])); }
    while (i < tokens.length) {
      var command = tokens[i];
      if (command === "M") {
        current = [take(), n(PAGE_H - take())];
        ops.push(current[0] + " " + current[1] + " m");
      } else if (command === "L") {
        current = [take(), n(PAGE_H - take())];
        ops.push(current[0] + " " + current[1] + " l");
      } else if (command === "C") {
        var x1 = take(); var y1 = n(PAGE_H - take());
        var x2 = take(); var y2 = n(PAGE_H - take());
        current = [take(), n(PAGE_H - take())];
        ops.push(x1 + " " + y1 + " " + x2 + " " + y2 + " " + current[0] + " " + current[1] + " c");
      } else if (command === "Q") {
        var qx1 = take(); var qy1 = n(PAGE_H - take());
        var qx = take(); var qy = n(PAGE_H - take());
        var cx = current[0]; var cy = current[1];
        current = [qx, qy];
        ops.push(n(cx + (qx1 - cx) * 2 / 3) + " " + n(cy + (qy1 - cy) * 2 / 3) + " " +
          n(qx + (qx1 - qx) * 2 / 3) + " " + n(qy + (qy1 - qy) * 2 / 3) + " " + qx + " " + qy + " c");
      } else if (command === "Z") ops.push("h");
      i += 1;
    }
    ops.push("f");
    return ops.join("\n");
  }

  function buildPdf(streams) {
    var objects = [];
    function add(body) { objects.push(body); return objects.length; }
    var fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    var pageIds = streams.map(function (stream) {
      var content = add("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
      return add("<< /Type /Page /Parent PAGES /MediaBox [0 0 " + n(PAGE_W) + " " + n(PAGE_H) + "] /Contents " + content + " 0 R /Resources << /Font << /F1 " + fontId + " 0 R >> >> >>");
    });
    var pagesId = add("<< /Type /Pages /Count " + pageIds.length + " /Kids [" + pageIds.map(function (id) { return id + " 0 R"; }).join(" ") + "] >>");
    var catalog = add("<< /Type /Catalog /Pages " + pagesId + " 0 R >>");
    objects[pagesId - 1] = objects[pagesId - 1];
    objects.forEach(function (body, index) {
      objects[index] = body.replace("Parent PAGES", "Parent " + pagesId + " 0 R");
    });
    var body = "%PDF-1.4\n";
    var offsets = [0];
    objects.forEach(function (entry, index) {
      offsets.push(body.length);
      body += (index + 1) + " 0 obj\n" + entry + "\nendobj\n";
    });
    var xref = body.length;
    body += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.slice(1).forEach(function (offset) {
      var text = String(offset);
      while (text.length < 10) text = "0" + text;
      body += text + " 00000 n \n";
    });
    body += "trailer << /Size " + (objects.length + 1) + " /Root " + catalog + " 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    return body;
  }

  function exportTargets() {
    var marked = variations.filter(function (item, index) { return picked[index + 1]; });
    return marked.length ? marked : variations.slice();
  }

  function fileName(item) {
    var left = fontById(item.a);
    var right = fontById(item.b);
    var grid = FontRemix.gridById(item.grid).label.toLowerCase().replace(/\s+/g, "-");
    return slug(left ? left.name : "a") + "-" + slug(right ? right.name : "b") + "-" + grid + ".otf";
  }

  function slug(text) {
    return text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "font";
  }

  function charset() {
    var seen = {};
    (LATIN + sampleText()).split("").forEach(function (ch) { seen[ch] = true; });
    return Object.keys(seen);
  }

  function exportFonts() {
    var targets = exportTargets();
    if (!targets.length) return;
    var status = document.getElementById("status");
    var files = [];
    var manifest = { text: sampleText(), variations: [] };
    var index = 0;
    status.textContent = "Mixing fonts…";
    function step() {
      if (index >= targets.length) {
        files.push({ name: "variations.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
        download("kvs-font-match-variations.zip", zipStore(files), "application/zip");
        status.textContent = "Exported " + targets.length + " fonts.";
        return;
      }
      var item = targets[index];
      status.textContent = "Mixing " + (index + 1) + " / " + targets.length;
      var left = fontById(item.a);
      var right = fontById(item.b);
      var family = "KVS " + (left ? left.name : "") + " " + (right ? right.name : "");
      var font = FontRemix.buildFont(left.parsed, right.parsed, item, charset(), family);
      var name = fileName(item);
      files.push({ name: name, data: new Uint8Array(font.toArrayBuffer()) });
      manifest.variations.push({
        file: name,
        fontI: left ? left.name : "",
        fontII: right ? right.name : "",
        grid: FontRemix.gridById(item.grid).label,
        horizontalCuts: item.h,
        verticalCuts: item.v
      });
      index += 1;
      window.setTimeout(step, 0);
    }
    window.setTimeout(step, 0);
  }

  function zipStore(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (file) {
      var name = new TextEncoder().encode(file.name);
      var crc = crc32(file.data);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(8, 0, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, file.data.length, true);
      local.setUint32(22, file.data.length, true);
      local.setUint16(26, name.length, true);
      var head = new Uint8Array(local.buffer);
      parts.push(head, name, file.data);
      var dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, file.data.length, true);
      dir.setUint32(24, file.data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);
      offset += head.length + name.length + file.data.length;
    });
    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var size = all.reduce(function (sum, part) { return sum + part.length; }, 0);
    var out = new Uint8Array(size);
    var cursor = 0;
    all.forEach(function (part) {
      out.set(part, cursor);
      cursor += part.length;
    });
    return out;
  }

  function crc32(data) {
    if (!crc32.table) {
      crc32.table = [];
      var n;
      for (n = 0; n < 256; n += 1) {
        var c = n;
        var k;
        for (k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc32.table[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    var i;
    for (i = 0; i < data.length; i += 1) crc = crc32.table[(crc ^ data[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function publishFonts() {
    window.KVS = window.KVS || {};
    window.KVS.fonts = fonts;
    document.dispatchEvent(new CustomEvent("kvs-fonts"));
  }

  function showView(name) {
    var view = name === "sheet" || name === "slice" ? name : "specimen";
    document.body.dataset.view = view;
    ["", "-2", "-3"].forEach(function (suffix) {
      var specimen = document.getElementById("view-specimen" + suffix);
      var sheet = document.getElementById("view-sheet" + suffix);
      var slice = document.getElementById("view-slice" + suffix);
      if (specimen) specimen.setAttribute("aria-pressed", view === "specimen" ? "true" : "false");
      if (sheet) sheet.setAttribute("aria-pressed", view === "sheet" ? "true" : "false");
      if (slice) slice.setAttribute("aria-pressed", view === "slice" ? "true" : "false");
    });
    document.querySelector(".name").textContent = view === "slice" ? "KVS tools [Slice]" : "KVS tools [Font match]";
    document.getElementById("mast-note").textContent = view === "sheet" ? "SHEET  " + variations.length : view === "slice" ? "SLICE" : "SPECIMEN";
    if (view === "specimen" && window.KVS && window.KVS.redrawSpecimen) window.KVS.redrawSpecimen();
    if (view === "sheet") draw();
    if (view === "slice" && window.KVS && window.KVS.redrawSlice) window.KVS.redrawSlice();
  }

  window.KVS = window.KVS || {};
  window.KVS.refreshFonts = function () {
    paintFonts();
    paintCellSelects();
  };

  function applyTheme(name, persist) {
    document.body.dataset.theme = name === "dark" ? "dark" : "light";
    document.getElementById("theme-light").setAttribute("aria-pressed", name === "dark" ? "false" : "true");
    document.getElementById("theme-dark").setAttribute("aria-pressed", name === "dark" ? "true" : "false");
    if (persist) localStorage.setItem("font-remix-theme", name);
    if (variations.length && document.body.dataset.view === "sheet") draw();
    if (window.KVS && window.KVS.redrawSpecimen) window.KVS.redrawSpecimen();
    if (window.KVS && window.KVS.redrawSlice) window.KVS.redrawSlice();
  }

  document.getElementById("view-specimen").addEventListener("click", function () { showView("specimen"); });
  document.getElementById("view-sheet").addEventListener("click", function () { showView("sheet"); });
  document.getElementById("view-specimen-2").addEventListener("click", function () { showView("specimen"); });
  document.getElementById("view-sheet-2").addEventListener("click", function () { showView("sheet"); });
  document.getElementById("view-slice").addEventListener("click", function () { showView("slice"); });
  document.getElementById("view-slice-2").addEventListener("click", function () { showView("slice"); });
  document.getElementById("view-slice-3").addEventListener("click", function () { showView("slice"); });
  document.getElementById("view-specimen-3").addEventListener("click", function () { showView("specimen"); });
  document.getElementById("view-sheet-3").addEventListener("click", function () { showView("sheet"); });
  document.getElementById("theme-light").addEventListener("click", function () { applyTheme("light", true); });
  document.getElementById("theme-dark").addEventListener("click", function () { applyTheme("dark", true); });
  document.getElementById("all").addEventListener("click", runAll);
  document.getElementById("randomize").addEventListener("click", randomize);
  document.getElementById("sample").addEventListener("input", function () { draw(); });
  document.getElementById("columns").addEventListener("change", function () { page = 0; draw(); });
  document.getElementById("prev").addEventListener("click", function () { page = Math.max(0, page - 1); draw(); });
  document.getElementById("next").addEventListener("click", function () {
    page = Math.min(pageCount() - 1, page + 1);
    draw();
  });
  document.getElementById("add-fonts").addEventListener("change", function (event) {
    var files = Array.prototype.slice.call(event.target.files || []);
    Promise.all(files.map(function (file) {
      return file.arrayBuffer().then(function (buffer) {
        try {
          var entry = loadBuffer(buffer, file.name);
          entry.on = true;
          fonts.push(entry);
        } catch (error) {}
      }).catch(function () {});
    })).then(function () {
      paintFonts();
      paintCellSelects();
      publishFonts();
      runAll();
    });
  });
  stage.addEventListener("click", function (event) {
    var hit = hitAt(event);
    if (!hit) return;
    active = hit.index;
    if (event.shiftKey) {
      if (picked[hit.number]) delete picked[hit.number];
      else picked[hit.number] = true;
    }
    draw();
  });
  document.getElementById("cell-a").addEventListener("change", function (event) {
    if (!variations[active]) return;
    variations[active].a = event.target.value;
    draw();
  });
  document.getElementById("cell-b").addEventListener("change", function (event) {
    if (!variations[active]) return;
    variations[active].b = event.target.value;
    draw();
  });
  document.getElementById("cell-grid").addEventListener("change", function (event) {
    if (!variations[active]) return;
    var grid = FontRemix.grids[event.target.value];
    variations[active].grid = grid.id;
    variations[active].h = (grid.h || grid.lines || [380]).slice();
    variations[active].v = (grid.v || (grid.kind === "v" ? grid.lines : [0.5])).slice();
    draw();
  });
  document.getElementById("export-svg").addEventListener("click", function () {
    if (!variations.length) return;
    download("kvs-font-match-sheet-p" + (page + 1) + ".svg", svgText(page), "image/svg+xml");
  });
  document.getElementById("export-pdf").addEventListener("click", function () {
    if (!variations.length) return;
    download("kvs-font-match-sheet-p" + (page + 1) + ".pdf", buildPdf([pdfPage(page)]), "application/pdf");
  });
  document.getElementById("export-all").addEventListener("click", function () {
    if (!variations.length) return;
    var pages = [];
    var i;
    for (i = 0; i < pageCount(); i += 1) pages.push(pdfPage(i));
    download("kvs-font-match-sheet.pdf", buildPdf(pages), "application/pdf");
  });
  document.getElementById("export-fonts").addEventListener("click", exportFonts);

  boot();
}());
