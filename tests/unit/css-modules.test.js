import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STYLES_DIR = fileURLToPath(new URL("../../src/renderer/styles/", import.meta.url));
const RENDERER_DIR = fileURLToPath(new URL("../../src/renderer/", import.meta.url));
const TESTS_DIR = fileURLToPath(new URL("../", import.meta.url));
const INDEX_HTML = fileURLToPath(new URL("../../src/renderer/index.html", import.meta.url));

/** Characters that may precede a class-bearing string literal. */
const CLASS_LEAD = new Set(["(", ",", "?", ":"]);

/** Single- and double-quoted string literals; the escape runs keep the pattern linear. */
const QUOTED_LITERAL = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;

/** Template literals; the escape runs keep the pattern linear. */
const TEMPLATE_LITERAL = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;

/**
 * Reads every CSS module and returns its block name and class names.
 * @returns {Array<{block: string, file: string, classes: Set<string>}>} Modules.
 */
function readModules() {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((file) => {
      const css = readFileSync(`${STYLES_DIR}${file}`, "utf8");
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const withoutConditions = withoutComments.replace(
        /:has\([^)]*\)|:not\([^)]*\)|:is\([^)]*\)/g,
        "",
      );
      const classes = new Set(
        [...withoutConditions.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]),
      );
      return { block: file.slice(0, -".css".length), file, classes };
    });
}

/**
 * Lists every `.js` file below a directory.
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function listScripts(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return listScripts(`${path}/`);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

/**
 * Returns the index after the string or template literal that starts at `start`.
 * @param {string} source - Source text.
 * @param {number} start - Index of the opening quote.
 * @returns {number} Index after the closing quote, or -1 when unterminated.
 */
function skipString(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
    } else if (char === quote) {
      return i + 1;
    } else if (quote === "`" && char === "$" && source[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") depth -= 1;
        i += 1;
      }
      i -= 1;
    }
  }
  return -1;
}

/**
 * Reads a region that ends at the `)` matching the `(` before `start`.
 * @param {string} source - Source text.
 * @param {number} start - Index after the opening parenthesis.
 * @returns {string} Region between the parentheses.
 */
function callRegion(source, start) {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      const end = skipString(source, i);
      if (end === -1) break;
      i = end - 1;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return source.slice(start);
}

/**
 * Reads a region that ends at the next top-level `;`.
 * @param {string} source - Source text.
 * @param {number} start - Index after the `=`.
 * @returns {string} Region up to the statement end.
 */
function statementRegion(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      const end = skipString(source, i);
      if (end === -1) return source.slice(start);
      i = end - 1;
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    } else if (char === ";" && depth === 0) {
      return source.slice(start, i);
    }
  }
  return source.slice(start);
}

/**
 * Splits a literal body into class tokens.
 * @param {string} body - Literal text without quotes.
 * @returns {string[]} Class tokens.
 */
function tokens(body) {
  return body.split(/\s+/).filter(Boolean);
}

/**
 * Extracts the class tokens of a class-argument region. Literals used in a
 * comparison (`x === "slide"`) are not class tokens.
 * @param {string} region - Argument region of a classList/className call.
 * @returns {string[]} Class tokens.
 */
function regionTokens(region) {
  const found = [];
  for (const match of region.matchAll(QUOTED_LITERAL)) {
    const lead = region.slice(0, match.index).replace(/\s+$/, "").slice(-1);
    if (lead !== "" && !CLASS_LEAD.has(lead)) continue;
    found.push(...tokens(match[1] ?? match[2]));
  }
  for (const match of region.matchAll(TEMPLATE_LITERAL)) {
    found.push(...tokens(match[1].replace(/\$\{[^}]*\}/g, " ")));
  }
  return found;
}

/**
 * Collects the classes referenced by the HTML and the scripts.
 * @param {string[]} scripts - Script files to scan.
 * @returns {{used: Set<string>, families: Set<string>}} Referenced classes and
 * dynamic `block--` prefixes built from template literals.
 */
function readUsages(scripts) {
  const used = new Set();
  const families = new Set();
  const add = (token) => {
    if (token.endsWith("--")) families.add(token);
    else used.add(token);
  };

  for (const match of readFileSync(INDEX_HTML, "utf8").matchAll(/class="([^"]*)"/g)) {
    for (const token of tokens(match[1])) add(token);
  }

  for (const script of scripts) {
    const source = readFileSync(script, "utf8");

    for (const match of source.matchAll(/classList\.(?:add|remove|toggle|contains)\(/g)) {
      for (const token of regionTokens(callRegion(source, match.index + match[0].length))) {
        add(token);
      }
    }
    for (const match of source.matchAll(/className\s*=[^=]/g)) {
      for (const token of regionTokens(statementRegion(source, match.index + match[0].length))) {
        add(token);
      }
    }
    for (const match of source.matchAll(
      /(?:querySelector(?:All)?|closest\??\.|matches|locator)\(\s*["']([^"']*)["']/g,
    )) {
      for (const cls of match[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) used.add(cls[1]);
    }
  }

  return { used, families };
}

const modules = readModules();
const defined = new Set(modules.flatMap((module) => [...module.classes]));
const { used, families } = readUsages([
  ...listScripts(RENDERER_DIR).filter((file) => !file.includes("styles")),
  ...listScripts(TESTS_DIR).filter((file) => !file.endsWith("css-modules.test.js")),
]);

describe("CSS modules", () => {
  it("keeps every class in a module namespaced to that module's block", () => {
    const foreign = [];
    for (const { block, file, classes } of modules) {
      for (const cls of classes) {
        const own = cls === block || cls.startsWith(`${block}__`) || cls.startsWith(`${block}--`);
        if (!own) foreign.push(`${file}: .${cls}`);
      }
    }
    expect(foreign).toEqual([]);
  });

  it("defines every class used by the HTML and the scripts", () => {
    const missing = [...used].filter((cls) => {
      const hasModifier = [...defined].some((candidate) => candidate.startsWith(`${cls}--`));
      return !defined.has(cls) && !hasModifier;
    });
    expect(missing.sort()).toEqual([]);
  });

  it("uses every class defined in a module", () => {
    const isUsed = (cls) => used.has(cls) || [...families].some((prefix) => cls.startsWith(prefix));
    expect([...defined].filter((cls) => !isUsed(cls)).sort()).toEqual([]);
  });
});
