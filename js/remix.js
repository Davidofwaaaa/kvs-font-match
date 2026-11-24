(function (root) {
  "use strict";

  var GRIDS = {
    hHalfFold: { id: "hHalfFold", label: "Horizontal", kind: "h", lines: [380] },
    vHalfFold: { id: "vHalfFold", label: "Vertical", kind: "v", lines: [0.5] },
    triFold: { id: "triFold", label: "Thirds", kind: "h", lines: [240, 480] },
    quadFold: { id: "quadFold", label: "Quarters", kind: "h", lines: [180, 360, 540] },
    checker: { id: "checker", label: "Checker", kind: "c", h: [350], v: [0.5] }
  };

  function gridById(id) {
    return GRIDS[id] || GRIDS.hHalfFold;
  }

  function cloneSpec(spec) {
    var grid = gridById(spec.grid);
    return {
      grid: grid.id,
      h: (spec.h || grid.h || grid.lines || [380]).slice(),
      v: (spec.v || grid.v || (grid.kind === "v" ? grid.lines : [0.5])).slice()
    };
  }

  function cutsFor(spec) {
    var grid = gridById(spec.grid);
    if (grid.kind === "c") {
      return { kind: "c", h: (spec.h || grid.h).slice(), v: (spec.v || grid.v).slice() };
    }
    if (grid.kind === "v") return { kind: "v", lines: (spec.v || grid.lines).slice() };
    return { kind: "h", lines: (spec.h || grid.lines).slice() };
  }

  function glyphOf(font, ch) {
    if (!font || !ch) return null;
    var glyph = font.charToGlyph(ch);
    if (!glyph || glyph.index === 0 && ch !== ".notdef") {
      var code = ch.codePointAt(0);
      if (!glyph || !glyph.unicode || glyph.unicode !== code) return null;
    }
    return glyph;
  }

  function toCompound(glyph) {
    var commands = (glyph && glyph.path && glyph.path.commands) || [];
    if (!commands.length) return null;
    var compound = new paper.CompoundPath();
    compound.fillColor = "#000";
    var path = null;
    commands.forEach(function (command) {
      if (command.type === "M") {
        path = new paper.Path();
        path.fillColor = "#000";
        compound.addChild(path);
        path.moveTo(new paper.Point(command.x, command.y));
      } else if (!path) {
        return;
      } else if (command.type === "L") {
        path.lineTo(new paper.Point(command.x, command.y));
      } else if (command.type === "C") {
        path.cubicCurveTo(
          new paper.Point(command.x1, command.y1),
          new paper.Point(command.x2, command.y2),
          new paper.Point(command.x, command.y)
        );
      } else if (command.type === "Q") {
        path.quadraticCurveTo(new paper.Point(command.x1, command.y1), new paper.Point(command.x, command.y));
      } else if (command.type === "Z") {
        path.closePath();
      }
    });
    if (!compound.children.length) return null;
    return compound;
  }

  function nearlyZero(point) {
    return Math.abs(point.x) < 0.05 && Math.abs(point.y) < 0.05;
  }

  function toOpentype(item) {
    var ot = new opentype.Path();
    if (!item) return ot;
    var paths = [];
    if (item instanceof paper.CompoundPath) paths = item.children || [];
    else paths = [item];
    paths.forEach(function (path) {
      if (!path.segments || path.segments.length < 2) return;
      var segs = path.segments;
      ot.moveTo(round(segs[0].point.x), round(segs[0].point.y));
      var last = path.closed ? segs.length : segs.length - 1;
      var i;
      for (i = 0; i < last; i += 1) {
        var seg = segs[i];
        var next = segs[(i + 1) % segs.length];
        var out = seg.handleOut;
        var inn = next.handleIn;
        if (nearlyZero(out) && nearlyZero(inn)) {
          ot.lineTo(round(next.point.x), round(next.point.y));
        } else {
          ot.curveTo(
            round(seg.point.x + out.x),
            round(seg.point.y + out.y),
            round(next.point.x + inn.x),
            round(next.point.y + inn.y),
            round(next.point.x),
            round(next.point.y)
          );
        }
      }
      if (path.closed) ot.close();
    });
    return ot;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function hasInk(item) {
    if (!item) return false;
    if (item instanceof paper.CompoundPath) {
      return (item.children || []).some(function (child) {
        return child.segments && child.segments.length > 1;
      });
    }
    return item.segments && item.segments.length > 1;
  }

  function clip(source, rect) {
    if (!source) return null;
    var box = new paper.Path.Rectangle(rect);
    box.fillColor = "#000";
    var cut = source.intersect(box);
    box.remove();
    return hasInk(cut) ? cut : null;
  }

  function uniteAll(parts) {
    var acc = null;
    parts.forEach(function (part) {
      if (!hasInk(part)) return;
      acc = acc ? acc.unite(part) : part;
    });
    return acc;
  }

  function bands(stops, min, max) {
    var points = [min].concat(stops.slice().sort(function (a, b) { return a - b; }), [max]);
    var spans = [];
    var i;
    for (i = 0; i < points.length - 1; i += 1) {
      if (points[i + 1] - points[i] > 0.5) spans.push([points[i], points[i + 1]]);
    }
    return spans;
  }

  function remixChar(fontA, fontB, ch, spec) {
    var glyphA = glyphOf(fontA, ch);
    var glyphB = glyphOf(fontB, ch);
    var advance = Math.max(
      (glyphA && glyphA.advanceWidth) || 0,
      (glyphB && glyphB.advanceWidth) || 0,
      fontA.unitsPerEm * 0.25
    );
    if (!glyphA && !glyphB) return { path: new opentype.Path(), advance: advance };
    if (!glyphA) return { path: glyphB.path, advance: glyphB.advanceWidth || advance };
    if (!glyphB) return { path: glyphA.path, advance: glyphA.advanceWidth || advance };
    if (ch === " ") return { path: new opentype.Path(), advance: advance };

    paper.project.clear();
    var compoundA;
    var compoundB;
    var cuts;
    try {
      compoundA = toCompound(glyphA);
      compoundB = toCompound(glyphB);
      cuts = cutsFor(spec);
    } catch (error) {
      paper.project.clear();
      return { path: glyphA.path, advance: glyphA.advanceWidth || advance };
    }
    var parts = [];
    var wide = new paper.Rectangle(-advance, -800, advance * 3, 2400);
    try {
    if (cuts.kind === "h") {
      bands(cuts.lines, -800, 1600).forEach(function (span, index) {
        var source = index % 2 === 0 ? compoundA : compoundB;
        parts.push(clip(source, new paper.Rectangle(wide.x, span[0], wide.width, span[1] - span[0])));
      });
    } else if (cuts.kind === "v") {
      bands(cuts.lines.map(function (line) { return line * advance; }), -advance * 0.2, advance * 1.2).forEach(function (span, index) {
        var source = index % 2 === 0 ? compoundA : compoundB;
        parts.push(clip(source, new paper.Rectangle(span[0], wide.y, span[1] - span[0], wide.height)));
      });
    } else {
      var rows = bands(cuts.h, -800, 1600);
      var cols = bands(cuts.v.map(function (line) { return line * advance; }), -advance * 0.2, advance * 1.2);
      rows.forEach(function (row, rowIndex) {
        cols.forEach(function (col, colIndex) {
          var source = (rowIndex + colIndex) % 2 === 0 ? compoundA : compoundB;
          parts.push(clip(source, new paper.Rectangle(col[0], row[0], col[1] - col[0], row[1] - row[0])));
        });
      });
    }
    var united = uniteAll(parts.filter(Boolean));
    } catch (error) {
      paper.project.clear();
      return { path: glyphA.path, advance: glyphA.advanceWidth || advance };
    }
    var path = united ? toOpentype(united) : glyphA.path;
    if (!path.commands.length) path = glyphA.path;
    paper.project.clear();
    return { path: path, advance: advance };
  }

  function buildFont(fontA, fontB, spec, chars, family) {
    var glyphs = [new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 500, path: new opentype.Path() })];
    chars.forEach(function (ch) {
      var made = remixChar(fontA, fontB, ch, spec);
      glyphs.push(new opentype.Glyph({
        name: ch === " " ? "space" : ch,
        unicode: ch.codePointAt(0),
        advanceWidth: made.advance || 500,
        path: made.path || new opentype.Path()
      }));
    });
    return new opentype.Font({
      familyName: family,
      styleName: gridById(spec.grid).label,
      unitsPerEm: fontA.unitsPerEm || 1000,
      ascender: fontA.ascender || 800,
      descender: fontA.descender || -200,
      glyphs: glyphs
    });
  }

  root.FontRemix = {
    grids: GRIDS,
    gridById: gridById,
    cloneSpec: cloneSpec,
    remixChar: remixChar,
    buildFont: buildFont
  };
}(window));
