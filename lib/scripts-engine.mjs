import { parse } from "acorn";
import { ema, highest, lowest, rma, rsi, sma, wma } from "./indicators.mjs";

const variables = ["open", "high", "low", "close", "volume"];
const seriesFunctions = { sma, ema, wma, rma, rsi, highest, lowest };
const mathFunctions = { abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, pow: Math.pow, round: Math.round, floor: Math.floor, ceil: Math.ceil, log: Math.log, exp: Math.exp };
const binary = new Set(["+", "-", "*", "/", "%", "**", "<", "<=", ">", ">=", "==", "===", "!=", "!=="]);
const names = /^[a-zA-Z_]\w*$/;
const allowedMath = new Set(Object.keys(mathFunctions));
const allowedSeries = new Set(Object.keys(seriesFunctions));
const valueLimits = { source: 300000, nodes: 10000, consumable: 4000000, plots: 16 };

const diagnostic = (line, message) => new Error("Baris " + line + " · " + message);
const finite = value => typeof value === "number" && Number.isFinite(value);
const title = (source, defaultName) => source.match(/["']([^"']+)["']/)?.[1]?.slice(0, 80) ?? defaultName;

function removeComment(line) {
  let delimiter = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (delimiter) {
      if (char === "\\") i++;
      else if (char === delimiter) delimiter = null;
    } else if (char === '"' || char === "'") delimiter = char;
    else if (char === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function asExpression(source, available, line, counter) {
  let parsed;
  try {
    const program = parse(source, { ecmaVersion: 2023 });
    if (program.body.length !== 1 || program.body[0].type !== "ExpressionStatement") throw Error();
    parsed = program.body[0].expression;
  } catch { throw diagnostic(line, "Ekspresi tidak dapat diurai."); }
  function validate(node, depth = 0) {
    if (++counter.count > valueLimits.nodes || depth > 100) throw diagnostic(line, "Kompleksitas ekspresi melampaui anggaran kompilasi.");
    const check = value => validate(value, depth + 1);
    switch (node.type) {
      case "Literal":
        if (typeof node.value === "boolean" || node.value === null || finite(node.value)) return;
        break;
      case "Identifier":
        if (available.has(node.name)) return;
        throw diagnostic(line, "Variabel tidak dikenal: " + node.name + ".");
      case "UnaryExpression":
        if (["+", "-", "!"].includes(node.operator)) { check(node.argument); return; }
        break;
      case "BinaryExpression":
        if (binary.has(node.operator)) { check(node.left); check(node.right); return; }
        break;
      case "LogicalExpression":
        if (["&&", "||", "??"].includes(node.operator)) { check(node.left); check(node.right); return; }
        break;
      case "ConditionalExpression":
        check(node.test); check(node.consequent); check(node.alternate); return;
      case "MemberExpression":
        if (node.computed && node.object.type === "Identifier" && available.has(node.object.name)
          && node.property.type === "Literal" && Number.isInteger(node.property.value) && node.property.value >= 0 && node.property.value <= 12000) return;
        break;
      case "CallExpression": {
        const name = functionName(node.callee);
        if (allowedSeries.has(name)) {
          if (node.arguments.length !== 2 || node.arguments[0].type !== "Identifier"
            || !available.has(node.arguments[0].name)
            || !["Identifier", "Literal"].includes(node.arguments[1].type)) throw diagnostic(line, "Fungsi series memerlukan nama series dan periode konstan.");
          node.arguments.forEach(check);
          return;
        }
        if (name === "crossover" || name === "crossunder") {
          if (node.arguments.length !== 2 || node.arguments.some(value => value.type !== "Identifier")) throw diagnostic(line, "Cross memerlukan dua series.");
          node.arguments.forEach(check);
          return;
        }
        if (allowedMath.has(name) || name === "nz" || name === "isna") {
          node.arguments.forEach(check);
          return;
        }
        throw diagnostic(line, "Fungsi belum didukung: " + (name || node.callee.type) + ".");
      }
    }
    throw diagnostic(line, "Sintaks belum didukung: " + node.type + ".");
  }
  validate(parsed);
  return parsed;
}

function functionName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier"
    && ["ta", "math", "Math"].includes(callee.object.name)) return callee.property.name;
  return null;
}

function splitArguments(source) {
  return parse("fn(" + source + ")", { ecmaVersion: 2023 }).body[0].expression.arguments
    .map(arg => source.slice(arg.start - 3, arg.end - 3));
}

const pineSyntax = source => source.replace(/\band\b/g, "&&").replace(/\bor\b/g, "||")
  .replace(/\bnot\b/g, "!").replace(/\bna\s*\(/g, "isna(").replace(/\bna\b/g, "null");
const pinetones = { red: "#ec8193", blue: "#8ca8ff", lime: "#84dea5", green: "#58c894", orange: "#f0b36e", purple: "#c09aec", white: "#e4e6ec", yellow: "#eacc78", aqua: "#73e3db", gray: "#a1a8b6" };

export function goldGuardFeatures(source) {
  return [
    ["request.security_lower_tf", /\brequest\.security_lower_tf\s*\(/g],
    ["request.security", /\brequest\.security\s*\(/g],
    ["varip", /\bvarip\b/g],
    ["persistent var", /\bvar\s+/g],
    ["custom types", /^type\s+\w+/gm],
    ["arrays", /\barray\./g],
    ["visual objects", /\b(?:box|table|label|line)\./g],
    ["alerts", /\b(?:alert|alertcondition)\s*\(/g],
  ].flatMap(([name, regex]) => {
    const matches = [...source.matchAll(regex)];
    return matches.length ? [{ name, count: matches.length, line: source.slice(0, matches[0].index).split("\n").length }] : [];
  });
}

function compilePine(source) {
  if (/^indicator\(["']GoldGuard v2\.0\.0 Stable Reload/m.test(source)) {
    const error = new Error("Runtime Pine AzusaTrade belum kompatibel dengan GoldGuard.");
    error.features = goldGuardFeatures(source);
    throw error;
  }
  const available = new Set(variables);
  const counter = { count: 0 };
  const declarations = [];
  const plots = [];
  let name = "Pine Indicator", overlay = false;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = index + 1;
    const statement = removeComment(raw).trim();
    if (!statement) continue;
    const header = statement.match(/^indicator\((.*)\)\s*$/);
    if (header) {
      name = title(header[1], name);
      overlay = /\boverlay\s*=\s*true\b/.test(header[1]);
      const remainder = header[1].replace(/^["'][^"']*["']\s*/, "").replace(/^\s*,\s*overlay\s*=\s*(true|false)\s*$/, "");
      if (remainder) throw diagnostic(line, "Deklarasi indicator() mendukung judul dan overlay.");
      continue;
    }
    const plot = statement.match(/^(plot|hline)\((.*)\)$/);
    if (plot) {
      let args;
      try { args = splitArguments(pineSyntax(plot[2])); }
      catch { throw diagnostic(line, "Argumen plot belum dapat diurai."); }
      if (plots.length >= valueLimits.plots) throw diagnostic(line, "Maksimal 16 plot per indikator.");
      if (!args[0]) throw diagnostic(line, "Plot membutuhkan nilai.");
      const colorArg = args.find(arg => /^color\s*=/.test(arg))?.match(/color\.(\w+)/)?.[1];
      const label = args.find(arg => /^title\s*=/.test(arg)) ?? args.find(arg => /^["']/.test(arg)) ?? "";
      if (args.slice(1).some(arg => !/^(?:title\s*=\s*)?["'].*["']$|^color\s*=\s*color\.\w+$/.test(arg)) || colorArg && !Object.hasOwn(pinetones, colorArg)) {
        throw diagnostic(line, "Plot mendukung title dan warna bawaan Pine.");
      }
      plots.push({ name: title(label, plot[1]), color: pinetones[colorArg], expression: asExpression(args[0], available, line, counter) });
      continue;
    }
    const assignment = statement.match(/^(?:(?:float|int|bool)\s+)?([a-zA-Z_]\w*)\s*=\s*(.+)$/);
    if (assignment) {
      const [, id, expression] = assignment;
      if (available.has(id)) throw diagnostic(line, "Nama variabel sudah dipakai: " + id + ".");
      const input = expression.match(/^input(?:\.(?:int|float|bool))?\((.*)\)$/);
      let value = expression;
      if (input) {
        value = input[1].match(/^\s*(-?\d+(?:\.\d+)?|true|false)\s*(?:,.*)?$/)?.[1];
        if (value === undefined) throw diagnostic(line, "Input hanya mendukung nilai awal angka atau boolean pada subset ini.");
      }
      declarations.push({ id, expression: asExpression(pineSyntax(value), available, line, counter) });
      available.add(id);
      continue;
    }
    throw diagnostic(line, "Statement Pine ini belum didukung.");
  }
  if (!plots.length) throw new Error("Indikator membutuhkan setidaknya satu plot().");
  return { name, overlay, declarations, plots, language: "pine" };
}

function compileJs(source) {
  const tree = parse(source, { ecmaVersion: 2023, locations: true });
  const available = new Set(variables);
  const counter = { count: 0 };
  const declarations = [];
  const plots = [];
  let name = "Custom Indicator", overlay = true;
  for (const statement of tree.body) {
    const line = statement.loc.start.line;
    const expression = node => asExpression(source.slice(node.start, node.end), available, line, counter);
    if (statement.type === "VariableDeclaration" && statement.kind === "const") {
      for (const item of statement.declarations) {
        if (item.id.type !== "Identifier" || !item.init || available.has(item.id.name)) throw diagnostic(line, "Deklarasi const membutuhkan nama unik dan ekspresi.");
        declarations.push({ id: item.id.name, expression: expression(item.init) });
        available.add(item.id.name);
      }
    } else if (statement.type === "ExpressionStatement" && statement.expression.type === "CallExpression") {
      const call = statement.expression;
      const [first, second, third] = call.arguments;
      if (functionName(call.callee) === "indicator" && typeof first?.value === "string"
        && call.arguments.length <= 2 && (second === undefined || typeof second.value === "boolean")) {
        name = first.value.slice(0, 80);
        overlay = second?.value ?? true;
      } else if (functionName(call.callee) === "plot" && first && typeof second?.value === "string" && call.arguments.length <= 3) {
        if (plots.length >= valueLimits.plots) throw diagnostic(line, "Maksimal 16 plot per indikator.");
        const color = typeof third?.value === "string" && /^#[\da-f]{6}$/i.test(third.value) ? third.value : undefined;
        plots.push({ name: second.value.slice(0, 80), color, expression: expression(first) });
      } else throw diagnostic(line, "Hanya indicator() dan plot() yang diizinkan sebagai statement.");
    } else throw diagnostic(line, "Hanya const dan plot deklaratif yang didukung.");
  }
  if (!plots.length) throw new Error("Indikator membutuhkan setidaknya satu plot().");
  return { name, overlay, declarations, plots, language: "javascript" };
}

function unsigned(value) {
  const output = [];
  do {
    const part = value & 127;
    value >>>= 7;
    output.push(part | (value ? 128 : 0));
  } while (value);
  return output;
}

function wasmFormula(expression) {
  const opcodes = { "+": 0xa0, "-": 0xa1, "*": 0xa2, "/": 0xa3 };
  function emit(node) {
    if (node.type === "Identifier") return [0x20, ...unsigned(variables.indexOf(node.name))];
    if (node.type === "Literal" && finite(node.value)) {
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, node.value, true);
      return [0x44, ...new Uint8Array(buffer)];
    }
    if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator)) return [...emit(node.argument), ...(node.operator === "-" ? [0x9a] : [])];
    if (node.type === "BinaryExpression" && Object.hasOwn(opcodes, node.operator)) return [...emit(node.left), ...emit(node.right), opcodes[node.operator]];
    throw new Error("C/Wasm mendukung angka, variabel OHLCV, tanda, dan operator +, −, ×, ÷.");
  }
  const section = (id, bytes) => [id, ...unsigned(bytes.length), ...bytes];
  const body = [0, ...emit(expression), 0x0b];
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 5, 0x7c, 0x7c, 0x7c, 0x7c, 0x7c, 1, 0x7c]),
    ...section(3, [1, 0]),
    ...section(7, [1, 9, ...Array.from("indicator", char => char.charCodeAt(0)), 0, 0]),
    ...section(10, [1, ...unsigned(body.length), ...body])]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.indicator;
}

function compileFormula(source, language) {
  const signature = "double\\s+indicator\\s*\\(\\s*" + variables.map(name => "double\\s+" + name).join("\\s*,\\s*") + "\\s*\\)\\s*\\{\\s*return\\s+([^;{}]+);\\s*\\}";
  const expressionText = source.match(new RegExp(language === "c" ? "^\\s*" + signature + "\\s*$"
    : "^\\s*(?:public\\s+)?class\\s+Indicator\\s*\\{\\s*(?:public\\s+)?static\\s+" + signature + "\\s*\\}\\s*$"))?.[1];
  if (!expressionText) throw new Error("Gunakan template fungsi indicator() OHLCV dengan satu ekspresi return. API file, kelas tambahan, dan loop tidak didukung.");
  const expression = asExpression(expressionText.trim(), new Set(variables), 1, { count: 0 });
  const result = { name: language === "c" ? "C · WebAssembly" : "Java · Formula", overlay: true, declarations: [], plots: [{ name: "Formula", expression }], language };
  if (language === "c") result.runFormula = wasmFormula(expression);
  return result;
}

export function compileScript(language, source) {
  if (typeof source !== "string" || source.length > valueLimits.source) throw new Error("Ukuran file indikator melebihi anggaran impor.");
  if (language === "pine") return compilePine(source);
  if (language === "javascript" || language === "typescript") return compileJs(language === "typescript"
    ? source.replace(/\bconst\s+([A-Za-z_]\w*)\s*:\s*(?:number|boolean)\s*=/g, "const $1 =") : source);
  if (["c", "java"].includes(language)) return compileFormula(source, language);
  throw new Error("Bahasa ini tidak tersedia.");
}

function arithmetic(operator, left, right) {
  if (["==", "===", "!=", "!=="].includes(operator)) return operator[0] === "=" ? left === right : left !== right;
  if (!finite(left) || !finite(right)) return null;
  switch (operator) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return right ? left / right : null;
    case "%": return right ? left % right : null;
    case "**": return left ** right;
    case "<": return left < right;
    case "<=": return left <= right;
    case ">": return left > right;
    case ">=": return left >= right;
    default: return null;
  }
}

export function runScript(compiled, bars) {
  if (compiled.runFormula) return compiled.plots.map(plot => ({ name: plot.name, type: "line", values: bars.map(bar => {
    const result = compiled.runFormula(...variables.map(name => bar[name] ?? NaN));
    return finite(result) ? result : null;
  }) }));
  const data = new Map(variables.map(name => [name, bars.map(bar => bar[name] ?? null)]));
  const prepared = new Map();
  let budget = valueLimits.consumable;
  function value(node, index) {
    if (--budget < 0) throw new Error("Indikator melampaui anggaran evaluasi.");
    const read = position => value(position, index);
    switch (node.type) {
      case "Literal": return node.value;
      case "Identifier": return data.get(node.name)?.[index] ?? null;
      case "MemberExpression": return data.get(node.object.name)?.[index - node.property.value] ?? null;
      case "UnaryExpression": {
        const input = read(node.argument);
        return node.operator === "!" ? !input : finite(input) ? (node.operator === "-" ? -input : input) : null;
      }
      case "BinaryExpression": return arithmetic(node.operator, read(node.left), read(node.right));
      case "LogicalExpression": {
        const left = read(node.left);
        if (node.operator === "&&") return left && read(node.right);
        if (node.operator === "||") return left || read(node.right);
        return left ?? read(node.right);
      }
      case "ConditionalExpression": return read(node.test) ? read(node.consequent) : read(node.alternate);
      case "CallExpression": {
        const name = functionName(node.callee);
        if (allowedSeries.has(name)) {
          if (!prepared.has(node)) {
            const series = data.get(node.arguments[0].name);
            const periodNode = node.arguments[1];
            const period = periodNode.type === "Literal" ? periodNode.value : data.get(periodNode.name)?.[0];
            if (!Number.isInteger(period) || period < 1 || period > 500 || (periodNode.type === "Identifier"
              && data.get(periodNode.name).some(item => item !== period))) throw new Error("Periode series harus konstan dan berada pada 1–500.");
            budget -= series.length;
            if (budget < 0) throw new Error("Indikator melampaui anggaran series.");
            prepared.set(node, seriesFunctions[name](series, period));
          }
          return prepared.get(node)[index];
        }
        if (name === "crossover" || name === "crossunder") {
          const [left, right] = node.arguments.map(arg => data.get(arg.name));
          if (index === 0 || ![left[index], right[index], left[index-1], right[index-1]].every(finite)) return false;
          return name === "crossover" ? left[index] > right[index] && left[index-1] <= right[index-1]
            : left[index] < right[index] && left[index-1] >= right[index-1];
        }
        const args = node.arguments.map(read);
        if (name === "nz") return finite(args[0]) ? args[0] : args[1] ?? 0;
        if (name === "isna") return args[0] === null;
        return args.every(finite) ? mathFunctions[name](...args) : null;
      }
      default: return null;
    }
  }
  function run(expression) {
    return bars.map((_, index) => {
      const result = value(expression, index);
      return typeof result === "boolean" || finite(result) ? result : null;
    });
  }
  for (const item of compiled.declarations) data.set(item.id, run(item.expression));
  return compiled.plots.map(plot => ({ name: plot.name, color: plot.color, type: "line", values: run(plot.expression).map(item => typeof item === "boolean" ? Number(item) : item) }));
}
