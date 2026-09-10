// ═══════════════════════════════════════════════════════════════════
// LAB CODEMOD — P2-9: replace the Lab's Save/Copy-JSON hand-merge.
//
// The old promotion path (planet-lab.ts "Copy JSON" button) put the Lab's live
// state on the clipboard and asked a HUMAN to hand-paste values into three
// separate source files (presets.ts PRESETS, plates.ts MACRO, bake.ts
// DEFAULT_BAKE) plus lab-ideal.json. Nothing linted, diffed, or tested the
// merge — and it already shipped a real regression (see presets.ts:186-204,
// the F4 comment: a Continuum-only tuning value landed in the SHARED
// PRESETS.ocean object and thinned every Legacy ocean world too).
//
// This module reads/writes those TypeScript object literals via the TS
// compiler API (not regex) so ONLY the numeric/array/boolean VALUES change —
// every prose comment (including hard-won regression postmortems like the F4
// note) stays exactly where it was, because we only replace a field's
// PropertyAssignment initializer when its value actually differs, and we pass
// through the original node's `name`/position so the printer still finds its
// leading comment trivia.
// ═══════════════════════════════════════════════════════════════════

import ts from 'typescript';
import { readFileSync } from 'node:fs';

/** Resolve a literal expression to a plain JS value. `constMap` resolves bare
 *  identifiers (e.g. presets.ts's `const G0: RGB = [0, 0, 0]` reused as a
 *  shorthand for several fields) — returns `undefined` if unresolvable. */
export function exprToValue(expr, constMap) {
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteralLike(expr)) return expr.text;
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
    const inner = exprToValue(expr.operand, constMap);
    return typeof inner === 'number' ? -inner : undefined;
  }
  if (ts.isParenthesizedExpression(expr)) return exprToValue(expr.expression, constMap);
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression?.(expr)) return exprToValue(expr.expression, constMap);
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.map((e) => exprToValue(e, constMap));
  if (ts.isObjectLiteralExpression(expr)) {
    const out = {};
    for (const p of expr.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        out[p.name.text] = exprToValue(p.initializer, constMap);
      }
    }
    return out;
  }
  if (ts.isIdentifier(expr) && constMap?.has(expr.text)) return constMap.get(expr.text);
  return undefined;
}

/** Build a literal expression for a plain JS value (number/bool/string/array/object). */
export function valueToExpr(v) {
  if (typeof v === 'number') {
    if (v < 0 || Object.is(v, -0)) {
      return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, ts.factory.createNumericLiteral(Math.abs(v)));
    }
    return ts.factory.createNumericLiteral(v);
  }
  if (typeof v === 'boolean') return v ? ts.factory.createTrue() : ts.factory.createFalse();
  if (typeof v === 'string') return ts.factory.createStringLiteral(v);
  if (Array.isArray(v)) return ts.factory.createArrayLiteralExpression(v.map(valueToExpr), false);
  if (v && typeof v === 'object') {
    return ts.factory.createObjectLiteralExpression(
      Object.entries(v).map(([k, val]) => ts.factory.createPropertyAssignment(k, valueToExpr(val))),
      false,
    );
  }
  throw new Error(`valueToExpr: unsupported value ${JSON.stringify(v)}`);
}

function collectTopLevelConsts(sourceFile) {
  const map = new Map();
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const v = exprToValue(decl.initializer, map);
          if (v !== undefined) map.set(decl.name.text, v);
        }
      }
    }
  }
  return map;
}

export function valuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => valuesEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => valuesEqual(a[k], b[k]));
  }
  return false;
}

function parse(filePath) {
  const source = readFileSync(filePath, 'utf8');
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Read a top-level `export const <exportName> = { ... }` object literal into a
 * plain JS value (bare identifiers resolved against the file's own top-level
 * consts). Returns `undefined` if the export isn't found.
 */
export function readExportedObject(filePath, exportName) {
  const sourceFile = parse(filePath);
  const constMap = collectTopLevelConsts(sourceFile);
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === exportName && node.initializer) {
      found = exprToValue(node.initializer, constMap);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Patch a top-level `export const <exportName> = { ... }` object literal so
 * that ONLY fields whose value actually changed get a new initializer — every
 * unchanged field (and every comment) is untouched. Two shapes:
 *   flat=false (default): newValuesByKey is `{ archetype: { field: value } }`
 *     (PRESETS / MACRO — one Preset/MacroParams object per PlanetVisualType).
 *   flat=true: newValuesByKey is `{ field: value }` directly (DEFAULT_BAKE).
 * Returns `{ code, changes }` — does NOT write the file; caller decides.
 *
 * IMPLEMENTATION NOTE: this does NOT run the changed AST back through
 * `ts.createPrinter().printFile()` — that reprints the WHOLE file from the
 * tree and rewrites every line's formatting (blank lines, brace style, array
 * wrapping...), which would make every promotion an unreviewable full-file
 * diff. Instead it locates each changed field's exact source character span
 * via the AST, then text-splices ONLY that literal's substring into the
 * ORIGINAL source string — every byte outside a changed value (including
 * every comment) is untouched, so the diff is exactly the value(s) that
 * actually changed, and only those.
 */
export function patchExportedObject(filePath, exportName, newValuesByKey, { flat = false } = {}) {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constMap = collectTopLevelConsts(sourceFile);
  const changes = [];
  const printer = ts.createPrinter({ removeComments: false, newLine: ts.NewLineKind.LineFeed });
  /** [start, end) character spans to replace, collected then applied
   *  descending-by-start so earlier offsets never shift under us. */
  const edits = [];

  function patchFields(objLit, fieldValues, pathPrefix) {
    for (const p of objLit.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
      const key = p.name.text;
      if (!(key in fieldValues)) continue;
      const newVal = fieldValues[key];
      const curVal = exprToValue(p.initializer, constMap);
      if (curVal !== undefined && valuesEqual(curVal, newVal)) continue;
      changes.push({ path: `${pathPrefix}.${key}`, from: curVal, to: newVal });
      const newText = printer.printNode(ts.EmitHint.Expression, valueToExpr(newVal), sourceFile);
      edits.push({ start: p.initializer.getStart(sourceFile), end: p.initializer.getEnd(), text: newText });
    }
  }

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === exportName
      && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      if (flat) {
        patchFields(node.initializer, newValuesByKey, exportName);
        return;
      }
      for (const p of node.initializer.properties) {
        if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
        const archetype = p.name.text;
        if (!(archetype in newValuesByKey) || !ts.isObjectLiteralExpression(p.initializer)) continue;
        patchFields(p.initializer, newValuesByKey[archetype], `${exportName}.${archetype}`);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  edits.sort((a, b) => b.start - a.start);
  let code = source;
  for (const e of edits) code = code.slice(0, e.start) + e.text + code.slice(e.end);
  return { code, changes };
}

/**
 * JSON.stringify(v, null, 2) blows every array (including a 3-number RGB
 * triple) onto one line per element — a Prettier-formatted file (which is
 * what lab-ideal.json already is) instead collapses anything that fits on one
 * line. Without this, every promotion run would rewrite the ENTIRE file's
 * layout even when zero values actually changed, burying the real diff.
 * Reproduces that behaviour: primitive-only arrays always collapse; objects
 * collapse when the one-line form fits `width`, else expand one key per line.
 */
export function stringifyLikePrettier(value, width = 80) {
  function go(v, indentLevel) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    const ind = '  '.repeat(indentLevel);
    const indIn = '  '.repeat(indentLevel + 1);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      if (v.every((x) => x === null || typeof x !== 'object')) {
        return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
      }
      const items = v.map((x) => go(x, indentLevel + 1));
      return `[\n${items.map((s) => indIn + s).join(',\n')}\n${ind}]`;
    }
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const oneLine = `{ ${keys.map((k) => `${JSON.stringify(k)}: ${go(v[k], 0)}`).join(', ')} }`;
    if (!oneLine.includes('\n') && ind.length + oneLine.length <= width) return oneLine;
    const lines = keys.map((k) => `${indIn}${JSON.stringify(k)}: ${go(v[k], indentLevel + 1)}`);
    return `{\n${lines.join(',\n')}\n${ind}}`;
  }
  return go(value, 0);
}
