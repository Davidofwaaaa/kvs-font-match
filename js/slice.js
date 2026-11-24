(function () {
  "use strict";

  var original = document.getElementById("slice-original");
  var cut = document.getElementById("slice-cut");
  var octx = original.getContext("2d");
  var cctx = cut.getContext("2d");
  var guidesEl = document.getElementById("slice-guides");
  var image = null;
  var grid = "hHalfFold";
  var lines = [];
  var pans = {};
  var show = true;
  var serial = 0;
  var drag = null;
  var fitBox = null;

  var presets = {
    hHalfFold: [{ axis: "h", value: 0.5 }],
    vHalfFold: [{ axis: "v", value: 0.5 }],
    triFold: [{ axis: "h", value: 1 / 3 }, { axis: "h", value: 2 / 3 }],
    quadFold: [{ axis: "h", value: 0.25 }, { axis: "h", value: 0.5 }, { axis: "h", value: 0.75 }],
    checker: [{ axis: "h", value: 0.5 }, { axis: "v", value: 0.5 }]
  };

  function copyPreset(id) {
    return presets[id].map(function (line, index) {
      return { id: line.axis + index, axis: line.axis, value: line.value };
    });
  }

  lines = copyPreset(grid);

  function paper() {
    return document.body.dataset.theme === "dark" ? "#000000" : "#ffffff";
  }

  function ink() {
    return document.body.dataset.theme === "dark" ? "#ffffff" : "#000000";
  }

  function stops(axis) {
    var values = lines.filter(function (line) { return line.axis === axis; }).map(function (line) { return line.value; });
    values.sort(function (a, b) { return a - b; });
    return [0].concat(values, [1]);
  }

  function cells() {
    var xs = stops("v");
    var ys = stops("h");
    var list = [];
    var row;
    var col;
    for (row = 0; row < ys.length - 1; row += 1) {
      for (col = 0; col < xs.length - 1; col += 1) {
        list.push({
          key: row + ":" + col,
          x0: xs[col],
          x1: xs[col + 1],
          y0: ys[row],
          y1: ys[row + 1]
        });
      }
    }
    return list;
  }

  function fit(canvas) {
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    if (!image || !width || !height) return null;
    var scale = Math.min(width / image.width, height / image.height);
    var w = image.width * scale;
    var h = image.height * scale;
    return { x: (width - w) / 2, y: (height - h) / 2, w: w, h: h, scale: scale, width: width, height: height };
  }

  function clampPan(cell) {
    var pan = pans[cell.key] || { x: 0, y: 0 };
    var sw = (cell.x1 - cell.x0) * image.width;
    var sh = (cell.y1 - cell.y0) * image.height;
    var maxX = image.width - sw;
    var maxY = image.height - sh;
    return {
      x: Math.max(-cell.x0 * image.width, Math.min(maxX - cell.x0 * image.width, pan.x)),
      y: Math.max(-cell.y0 * image.height, Math.min(maxY - cell.y0 * image.height, pan.y))
    };
  }

  function prepare(context, canvas) {
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = paper();
    context.fillRect(0, 0, width, height);
    return fit(canvas);
  }

  function draw() {
    if (document.body.dataset.view !== "slice") return;
    var source = prepare(octx, original);
    fitBox = source;
    if (source && image) octx.drawImage(image, source.x, source.y, source.w, source.h);
    var box = prepare(cctx, cut);
    if (box && image) {
      cells().forEach(function (cell) {
        var pan = clampPan(cell);
        var sw = (cell.x1 - cell.x0) * image.width;
        var sh = (cell.y1 - cell.y0) * image.height;
        cctx.drawImage(
          image,
          cell.x0 * image.width + pan.x,
          cell.y0 * image.height + pan.y,
          sw,
          sh,
          box.x + cell.x0 * box.w,
          box.y + cell.y0 * box.h,
          (cell.x1 - cell.x0) * box.w,
          (cell.y1 - cell.y0) * box.h
        );
      });
      if (show) {
        cctx.strokeStyle = ink();
        cctx.lineWidth = 1;
        cctx.beginPath();
        lines.forEach(function (line) {
          if (line.axis === "h") {
            var y = box.y + line.value * box.h;
            cctx.moveTo(box.x, y);
            cctx.lineTo(box.x + box.w, y);
          } else {
            var x = box.x + line.value * box.w;
            cctx.moveTo(x, box.y);
            cctx.lineTo(x, box.y + box.h);
          }
        });
        cctx.stroke();
      }
    }
    placeGuides();
  }

  function placeGuides() {
    if (drag) {
      positionGuides();
      return;
    }
    guidesEl.innerHTML = "";
    if (!show || !fitBox) return;
    lines.forEach(function (line) {
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
          lines = lines.filter(function (item) { return item.id !== line.id; });
          draw();
        });
        node.appendChild(remove);
      }
      guidesEl.appendChild(node);
    });
    positionGuides();
  }

  function positionGuides() {
    if (!fitBox) return;
    lines.forEach(function (line) {
      var node = guidesEl.querySelector('[data-id="' + line.id + '"]');
      if (!node) return;
      if (line.axis === "h") {
        node.style.top = (fitBox.y + line.value * fitBox.h) + "px";
        node.style.left = fitBox.x + "px";
        node.style.width = fitBox.w + "px";
        node.style.height = "1px";
      } else {
        node.style.left = (fitBox.x + line.value * fitBox.w) + "px";
        node.style.top = fitBox.y + "px";
        node.style.height = fitBox.h + "px";
        node.style.width = "1px";
      }
    });
  }

  function addGuide(axis) {
    var values = lines.filter(function (line) { return line.axis === axis; }).map(function (line) { return line.value; }).sort(function (a, b) { return a - b; });
    var points = [0.08].concat(values, [0.92]);
    var best = 0.5;
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
    show = true;
    document.getElementById("slice-view-guides").setAttribute("aria-pressed", "true");
    draw();
  }

  function cellAt(event) {
    var box = fit(cut);
    if (!box) return null;
    var bounds = cut.getBoundingClientRect();
    var x = (event.clientX - bounds.left - box.x) / box.w;
    var y = (event.clientY - bounds.top - box.y) / box.h;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    var found = null;
    cells().forEach(function (cell) {
      if (x >= cell.x0 && x <= cell.x1 && y >= cell.y0 && y <= cell.y1) found = cell;
    });
    return found ? { cell: found, box: box } : null;
  }

  document.getElementById("slice-open").addEventListener("click", function () {
    document.getElementById("slice-file").click();
  });
  document.getElementById("slice-file").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var next = new Image();
      next.onload = function () {
        image = next;
        pans = {};
        document.getElementById("slice-name").textContent = file.name;
        document.getElementById("slice-status").textContent = "";
        draw();
      };
      next.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  document.querySelectorAll("#slice-grids button").forEach(function (button) {
    button.addEventListener("click", function () {
      grid = button.dataset.grid;
      lines = copyPreset(grid);
      pans = {};
      document.querySelectorAll("#slice-grids button").forEach(function (other) {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      });
      draw();
    });
  });
  document.getElementById("slice-view-guides").addEventListener("click", function () {
    show = !show;
    document.getElementById("slice-view-guides").setAttribute("aria-pressed", show ? "true" : "false");
    draw();
  });
  document.getElementById("slice-add-h").addEventListener("click", function () { addGuide("h"); });
  document.getElementById("slice-add-v").addEventListener("click", function () { addGuide("v"); });
  document.getElementById("slice-reset").addEventListener("click", function () {
    lines = copyPreset(grid);
    draw();
  });
  document.getElementById("slice-reset-pan").addEventListener("click", function () {
    pans = {};
    draw();
  });
  guidesEl.addEventListener("pointerdown", function (event) {
    var line = event.target.closest(".guide");
    if (!line || event.target.classList.contains("guide-remove")) return;
    drag = { kind: "guide", id: line.dataset.id };
    line.setPointerCapture(event.pointerId);
  });
  guidesEl.addEventListener("pointermove", function (event) {
    if (!drag || drag.kind !== "guide" || !fitBox) return;
    var bounds = document.getElementById("slice-source").getBoundingClientRect();
    lines.forEach(function (line) {
      if (line.id !== drag.id) return;
      if (line.axis === "h") line.value = Math.max(0.04, Math.min(0.96, (event.clientY - bounds.top - fitBox.y) / fitBox.h));
      else line.value = Math.max(0.04, Math.min(0.96, (event.clientX - bounds.left - fitBox.x) / fitBox.w));
    });
    draw();
  });
  guidesEl.addEventListener("pointerup", function () { drag = null; draw(); });
  cut.addEventListener("pointerdown", function (event) {
    var hit = cellAt(event);
    if (!hit) return;
    if (!pans[hit.cell.key]) pans[hit.cell.key] = { x: 0, y: 0 };
    drag = { kind: "pan", key: hit.cell.key, x: event.clientX, y: event.clientY, ox: pans[hit.cell.key].x, oy: pans[hit.cell.key].y, scale: hit.box.scale };
    cut.setPointerCapture(event.pointerId);
  });
  cut.addEventListener("pointermove", function (event) {
    if (!drag || drag.kind !== "pan") return;
    pans[drag.key] = {
      x: drag.ox - (event.clientX - drag.x) / drag.scale,
      y: drag.oy - (event.clientY - drag.y) / drag.scale
    };
    draw();
  });
  cut.addEventListener("pointerup", function () { if (drag && drag.kind === "pan") drag = null; });
  cut.addEventListener("dblclick", function (event) {
    var hit = cellAt(event);
    if (!hit) return;
    delete pans[hit.cell.key];
    draw();
  });
  document.getElementById("slice-png").addEventListener("click", function () {
    if (!image) {
      document.getElementById("slice-status").textContent = "Open an image first.";
      return;
    }
    var board = document.createElement("canvas");
    board.width = image.width;
    board.height = image.height;
    var g = board.getContext("2d");
    cells().forEach(function (cell) {
      var pan = clampPan(cell);
      var sw = (cell.x1 - cell.x0) * image.width;
      var sh = (cell.y1 - cell.y0) * image.height;
      g.drawImage(
        image,
        cell.x0 * image.width + pan.x,
        cell.y0 * image.height + pan.y,
        sw,
        sh,
        cell.x0 * image.width,
        cell.y0 * image.height,
        sw,
        sh
      );
    });
    var link = document.createElement("a");
    link.href = board.toDataURL("image/png");
    link.download = "kvs-slice.png";
    link.click();
  });
  window.addEventListener("resize", draw);
  window.KVS = window.KVS || {};
  window.KVS.redrawSlice = function () { requestAnimationFrame(draw); };
}());
