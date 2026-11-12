// The part of an author's SVG that the directory draws.
//
// The SVG is parsed once as XML (htmlparser2 in XML mode, held to
// well-formedness here) and walked against a list of the elements and
// attributes that plain icons, banners and screenshots use. The file is
// refused when it holds anything that could make librsvg read a second
// document, run CSS or draw something not checked here: a DOCTYPE or
// entity, a processing instruction other than the XML declaration, XInclude,
// an SVG element not on the list (<style>, <script>, <image>,
// <foreignObject>, <switch>, ...), an event handler, an href or url() that
// is not a same-document #id, a filter that is not a <filter> element, and a
// CSS escape, comment, at-rule or block in an attribute or style
// declaration. Each refusal says what the author can change.
//
// What draws nothing is left out and the rest goes on: <metadata>, every
// element in another namespace (what drawing programs save for themselves,
// such as sodipodi:namedview or Illustrator's i:pgf) with everything inside
// it, SVG elements included, attributes of other namespaces, and attributes
// and style properties not on the list.
//
// The tree is also held to limits on what drawing it costs: the number of
// elements, of filter primitives per filter, of shapes drawn once use,
// clip-path and mask references are followed, and of filter primitives run.
//
// What librsvg gets is the checked tree written out again (`svg` of the
// result), never the author's text.
import { Parser } from "htmlparser2";

/** `filtered`: the drawing runs a filter, which needs a few canvases' worth of memory. */
export type CheckedSvg = { ok: true; svg: string; filtered: boolean } | { ok: false; reason: string };

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XINCLUDE_NS = "http://www.w3.org/2001/XInclude";

/** Elements a drawing may hold; svg only as the root. */
const ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "use", "text", "tspan",
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feFuncA",
  "feComposite", "feDropShadow", "feFlood", "feGaussianBlur", "feMerge", "feMergeNode", "feOffset", "feTurbulence",
]);
/** Elements whose href may name another element of the same document. */
const LINKING = new Set(["use", "linearGradient", "radialGradient"]);

/** Presentation properties, drawn as attributes and as style declarations. */
const PROPERTIES = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "color", "paint-order", "vector-effect",
  "shape-rendering", "clip-rule", "clip-path", "mask", "filter", "visibility", "display", "isolation", "mix-blend-mode",
  "stop-color", "stop-opacity", "flood-color", "flood-opacity", "color-interpolation", "color-interpolation-filters",
  "font", "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch", "text-anchor",
  "dominant-baseline", "alignment-baseline", "baseline-shift", "letter-spacing", "word-spacing", "text-decoration",
  "text-rendering",
]);
/** Every attribute that is drawn, besides href, style and xml:space. */
const ATTRIBUTES = new Set([
  ...PROPERTIES,
  "id", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "fx", "fy", "fr", "x1", "y1", "x2", "y2",
  "d", "points", "pathLength", "transform", "viewBox", "preserveAspectRatio",
  "offset", "gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits",
  "dx", "dy", "rotate", "textLength", "lengthAdjust",
  "filterUnits", "primitiveUnits", "in", "in2", "result", "type", "values", "operator", "k1", "k2", "k3", "k4", "mode",
  "stdDeviation", "edgeMode", "baseFrequency", "numOctaves", "seed", "stitchTiles", "tableValues", "slope", "intercept",
  "amplitude", "exponent",
]);
/** Properties that may point at a gradient, clip path, mask or filter of the document. */
const REFERENCES = new Set(["fill", "stroke", "clip-path", "mask", "filter"]);

const ID = "[A-Za-z0-9_.:-]+";
const HREF = new RegExp(`^#${ID}$`);
/** url(#id), optionally quoted, with an optional plain fallback paint. */
const URL_REFERENCE = new RegExp(`^url\\(\\s*(['"]?)#${ID}\\1\\s*\\)(\\s+[#\\w.%-]+)?$`);
/**
 * The filter property: a <filter> element of the document, or none. librsvg
 * also runs CSS filter functions (blur(), drop-shadow(), ...), which the
 * limits on filter steps below would not see.
 */
const FILTER_VALUE = new RegExp(`^(none|url\\(\\s*(['"]?)#${ID}\\2\\s*\\))$`);
/** What starts a CSS escape, comment, at-rule, block or !important, or markup. */
const NOT_PLAIN = /[\\@{}<!]|\/\*/;
/** Characters XML doesn't allow: control characters but tab and line breaks, U+FFFE, U+FFFF. */
const NOT_XML_CHARACTER = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(0x0b, 0x0c)}${String.fromCharCode(0x0e)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0xfffe, 0xffff)}]`,
);
const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const MAX_DEPTH = 64;
// The official images have at most 25 elements, 3 primitives per filter and
// one filtered shape; these leave room for any honest drawing.
export const MAX_ELEMENTS = 2000;
export const MAX_FILTER_PRIMITIVES = 8;
/** Shapes drawn, counting each use, clip-path and mask reference as a copy of what it names. */
export const MAX_DRAWN = 10_000;
/** Filter primitives run, counting each filtered shape once per primitive of its filter. */
export const MAX_FILTER_RUNS = 64;

// What the author reads on the submission (after "icon: ", "banner: ", ...).
const MALFORMED = "SVG is not well-formed XML: check that every tag is closed and every attribute value is quoted";
const NOT_SVG = "Not an SVG image: the file needs an <svg> root element in the SVG namespace";
const DOCTYPE = "SVG must not contain a DOCTYPE or entities: delete the <!DOCTYPE ...> part (Illustrator's Save As > SVG writes one, Export As > SVG doesn't)";
const PROCESSING_INSTRUCTION = "SVG must not contain processing instructions such as <?xml-stylesheet?>: delete them and put the styles on the elements";
const XINCLUDE = "SVG must not include other files (XInclude): put their content into the file itself";
const SCRIPTS = "SVG must not contain scripts: remove <script> elements and event attributes such as onclick";
const LINK = 'SVG must not reference external files: a link (href) may only point to an element of the same file, as href="#id"';
const URL_OUTSIDE = "SVG must not reference external files: url() may only point to a gradient, clip path, mask or filter of the same file, as url(#id)";
const FILTER_FUNCTION = "SVG filters must be url(#id) references to a <filter> element; CSS filter functions such as blur() aren't accepted";
const ESCAPES = "SVG attribute values must not hold CSS escapes, comments or rules: write plain values, without backslashes, /* */, @, { } or !important";
const STYLE_ESCAPES = "SVG style must not hold CSS escapes, comments or rules: write plain property:value pairs, without backslashes, /* */, @, { } or !important";
const STYLE_UNREADABLE = "SVG style is not readable: write it as property:value pairs separated by semicolons";
const TOO_MANY_DRAWN = `SVG draws more than ${MAX_DRAWN} shapes once its references are followed: use fewer <use>, clip-path and mask copies, or send a PNG or WebP`;
const TOO_MANY_FILTER_RUNS = `SVG runs more than ${MAX_FILTER_RUNS} filter steps: apply filters to fewer shapes, or send a PNG or WebP`;

/** Why an SVG element is refused, and what to do instead. */
function notAccepted(element: string): string {
  switch (element) {
    case "style":
      return (
        "SVG has a <style> element, which isn't accepted: export the styles as presentation attributes " +
        '(Illustrator: Export As > SVG, Styling "Presentation Attributes"), or move the CSS rules onto the elements, ' +
        "for example with SVGO's inlineStyles plugin"
      );
    case "image":
    case "feImage":
      return `SVG has an <${element}> element: embedded or linked images aren't accepted in an SVG. Send the picture as a PNG, JPEG or WebP file, or turn it into paths`;
    case "foreignObject":
      return "SVG has a <foreignObject> element (HTML inside the drawing), which isn't accepted: remove it";
    case "switch":
      return 'SVG has a <switch> element, which isn\'t accepted: in Illustrator, use Export As > SVG instead of Save As, or turn off "Preserve Illustrator Editing Capabilities"';
    case "svg":
      return "SVG has an <svg> element inside the drawing, which isn't accepted: put the inner drawing in a <g> group instead";
    default:
      return `SVG element <${element}> isn't accepted: icons, banners and screenshots may use shapes, paths, text, gradients, clip paths, masks, <use> and <filter> elements`;
  }
}

class Refusal extends Error {}

interface SvgNode {
  name: string;
  attributes: [string, string][];
  children: (SvgNode | string)[];
}

interface Frame {
  /** null for an element left out with everything inside it. */
  node: SvgNode | null;
  /** The tag name as written, for matching its end tag. */
  rawName: string;
  /** Namespace prefixes in scope ("" for the default namespace). */
  namespaces: Map<string, string>;
}

function isXmlCharacter(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

/** Text or an attribute value with its character references resolved; null for a reference XML doesn't know. */
function decodeReferences(raw: string): string | null {
  if (!raw.includes("&")) return raw;
  let out = "";
  let pos = 0;
  for (;;) {
    const amp = raw.indexOf("&", pos);
    if (amp === -1) return out + raw.slice(pos);
    out += raw.slice(pos, amp);
    const semi = raw.indexOf(";", amp + 1);
    if (semi === -1 || semi - amp > 10) return null;
    const ref = raw.slice(amp + 1, semi);
    let decoded: string | undefined;
    if (/^#[0-9]{1,7}$/.test(ref) || /^#x[0-9a-fA-F]{1,6}$/.test(ref)) {
      const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!isXmlCharacter(code)) return null;
      decoded = String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(PREDEFINED, ref)) {
      decoded = PREDEFINED[ref];
    }
    if (decoded === undefined) return null;
    out += decoded;
    pos = semi + 1;
  }
}

/** A qualified name as [prefix, local name]. */
function qualifiedName(name: string): [string, string] {
  const parts = name.split(":");
  if (parts.length > 2 || parts.some((p) => !p)) throw new Refusal(MALFORMED);
  return parts.length === 2 ? [parts[0], parts[1]] : ["", parts[0]];
}

/** An attribute or property value that may be drawn as it is. */
function checkValue(name: string, value: string): void {
  if (NOT_PLAIN.test(value)) throw new Refusal(ESCAPES);
  // A filter value that points at another file gets the message about files below.
  if (name === "filter" && !FILTER_VALUE.test(value.trim()) && !/url\s*\(\s*['"]?(?!#)/i.test(value)) {
    throw new Refusal(FILTER_FUNCTION);
  }
  if (/url\s*\(/i.test(value) && !(REFERENCES.has(name) && URL_REFERENCE.test(value.trim()))) throw new Refusal(URL_OUTSIDE);
}

/** A style attribute reduced to the listed properties, each checked like an attribute. */
function checkedStyle(value: string): string {
  if (NOT_PLAIN.test(value)) throw new Refusal(STYLE_ESCAPES);
  const out: string[] = [];
  for (const declaration of value.split(";")) {
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(":");
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const propertyValue = declaration.slice(colon + 1).trim();
    // A quote left open would have hidden a ";" from the split above.
    if (colon < 0 || !/^-?[a-z][a-z-]*$/.test(property) || !propertyValue || (propertyValue.match(/["']/g)?.length ?? 0) % 2) {
      throw new Refusal(STYLE_UNREADABLE);
    }
    if (!PROPERTIES.has(property)) continue;
    checkValue(property, propertyValue);
    out.push(`${property}:${propertyValue}`);
  }
  return out.join(";");
}

/** The attributes of one element that are drawn, checked. */
function checkedAttributes(element: string, raw: [string, string][], namespaces: Map<string, string>): [string, string][] {
  const out: [string, string][] = [];
  for (const [rawName, rawValue] of raw) {
    if (rawName === "xmlns" || rawName.startsWith("xmlns:")) continue;
    // Attribute-value normalisation: tabs and line breaks written as such are spaces.
    const value = decodeReferences(rawValue.replace(/\r\n|[\t\n\r]/g, " "));
    if (value === null) throw new Refusal(MALFORMED);
    const [prefix, local] = qualifiedName(rawName);
    let name = local;
    if (prefix) {
      const ns = prefix === "xml" ? XML_NS : namespaces.get(prefix);
      if (ns === undefined) throw new Refusal(MALFORMED);
      if (ns === XLINK_NS && local === "href") name = "href";
      else if (ns === XML_NS && local === "space" && (value === "default" || value === "preserve")) name = "xml:space";
      else continue;
    }
    if (/^on/i.test(name)) throw new Refusal(SCRIPTS);
    let drawn = value;
    if (name === "href") {
      if (!HREF.test(value)) throw new Refusal(LINK);
      if (!LINKING.has(element)) continue;
    } else if (name === "style") {
      drawn = checkedStyle(value);
      if (!drawn) continue;
    } else if (name !== "xml:space") {
      if (!ATTRIBUTES.has(name)) continue;
      checkValue(name, value);
    }
    if (out.some(([n]) => n === name)) throw new Refusal(MALFORMED);
    out.push([name, drawn]);
  }
  return out;
}

/**
 * htmlparser2 with what XML requires on top: every end tag closes the
 * element open at that point (htmlparser2 alone closes elements in between,
 * or skips an end tag that matches nothing). The input is parsed in one
 * call, so the indices it reports are positions in it.
 */
class StrictParser extends Parser {
  /** Set while htmlparser2 handles "/>": that close is not an implied one. */
  selfClosing = false;

  constructor(
    handler: ConstructorParameters<typeof Parser>[0],
    private readonly input: string,
    private readonly openName: () => string | undefined,
  ) {
    super(handler, { xmlMode: true, decodeEntities: false });
  }

  override onselfclosingtag(endIndex: number): void {
    this.selfClosing = true;
    try {
      super.onselfclosingtag(endIndex);
    } finally {
      this.selfClosing = false;
    }
  }

  override onclosetag(start: number, endIndex: number): void {
    if (this.input.slice(start, endIndex) !== this.openName()) throw new Refusal(MALFORMED);
    super.onclosetag(start, endIndex);
  }
}

function parse(text: string): SvgNode {
  if (NOT_XML_CHARACTER.test(text)) throw new Refusal(MALFORMED);
  const stack: Frame[] = [];
  let root: SvgNode | null = null;
  let rootClosed = false;
  let withoutNamespace = false;
  let started = false;
  let cdata = false;
  let pendingText = "";
  let tag: { attributes: [string, string][]; names: Set<string> } = { attributes: [], names: new Set() };

  const addText = (value: string) => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (/[^\t\n\r ]/.test(value)) throw new Refusal(MALFORMED);
      return;
    }
    if (!top.node) return;
    const children = top.node.children;
    const last = children[children.length - 1];
    if (typeof last === "string") children[children.length - 1] = last + value;
    else children.push(value);
  };
  // Text outside CDATA is decoded once it is complete.
  const flush = () => {
    if (!pendingText) return;
    const raw = pendingText;
    pendingText = "";
    if (raw.includes("<")) throw new Refusal(MALFORMED);
    const value = decodeReferences(raw.replace(/\r\n?/g, "\n"));
    if (value === null) throw new Refusal(MALFORMED);
    addText(value);
  };

  const parser = new StrictParser(
    {
      onprocessinginstruction(name: string) {
        flush();
        // The XML declaration (its encoding is checked before parsing), as the first thing only.
        if (name === "?xml" && !started) {
          started = true;
          return;
        }
        if (name.startsWith("!")) throw new Refusal(DOCTYPE);
        throw new Refusal(PROCESSING_INSTRUCTION);
      },
      oncomment() {
        flush();
        started = true;
      },
      oncdatastart() {
        flush();
        started = true;
        cdata = true;
      },
      oncdataend() {
        cdata = false;
      },
      ontext(data: string) {
        started = true;
        if (cdata) addText(data.replace(/\r\n?/g, "\n"));
        else pendingText += data;
      },
      onopentagname() {
        flush();
        started = true;
        tag = { attributes: [], names: new Set() };
      },
      onattribute(name: string, value: string, quote?: string | null) {
        if ((quote !== '"' && quote !== "'") || tag.names.has(name) || value.includes("<")) throw new Refusal(MALFORMED);
        tag.names.add(name);
        tag.attributes.push([name, value]);
      },
      onopentag(rawName: string) {
        if (rootClosed) throw new Refusal(MALFORMED);
        if (stack.length >= MAX_DEPTH) throw new Refusal(`SVG is nested too deeply (more than ${MAX_DEPTH} levels): ungroup some of its groups`);
        const parent = stack[stack.length - 1];
        let namespaces = parent?.namespaces ?? new Map<string, string>();
        let ownScope = !parent;
        for (const [name, value] of tag.attributes) {
          if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
          const uri = decodeReferences(value);
          if (uri === null) throw new Refusal(MALFORMED);
          if (!ownScope) {
            namespaces = new Map(namespaces);
            ownScope = true;
          }
          namespaces.set(name === "xmlns" ? "" : name.slice(6), uri);
        }
        const [prefix, local] = qualifiedName(rawName);
        // librsvg draws an SVG that declares no namespace at all; in such a
        // document, elements without a namespace count as SVG.
        if (!parent) withoutNamespace = !prefix && !namespaces.has("");
        const ns = namespaces.get(prefix) ?? (!prefix && withoutNamespace ? SVG_NS : undefined);
        if (prefix && ns === undefined) throw new Refusal(MALFORMED);
        if (!parent && (ns !== SVG_NS || local !== "svg")) throw new Refusal(NOT_SVG);
        if (ns === XINCLUDE_NS) throw new Refusal(XINCLUDE);
        // Left out with everything inside it: what a drawing program keeps for
        // itself (another namespace) and metadata. librsvg draws none of it, and
        // nothing inside it reaches the tree that is drawn.
        if (parent && (!parent.node || ns !== SVG_NS || local === "metadata")) {
          stack.push({ node: null, rawName, namespaces });
          return;
        }
        if (local === "script") throw new Refusal(SCRIPTS);
        if (!ELEMENTS.has(local) || (parent && local === "svg")) throw new Refusal(notAccepted(local));
        const node: SvgNode = { name: local, attributes: checkedAttributes(local, tag.attributes, namespaces), children: [] };
        if (parent?.node) parent.node.children.push(node);
        else root = node;
        stack.push({ node, rawName, namespaces });
      },
      onclosetag(_name: string, isImplied: boolean) {
        flush();
        // An implied close is an element left open: at the end, or before another element's end tag.
        if (isImplied && !parser.selfClosing) throw new Refusal(MALFORMED);
        stack.pop();
        if (stack.length === 0) rootClosed = true;
      },
    },
    text,
    () => stack[stack.length - 1]?.rawName,
  );
  parser.end(text);
  flush();
  if (!root) throw new Refusal(NOT_SVG);
  if (stack.length > 0) throw new Refusal(MALFORMED);
  return root;
}

const URL_ID = /url\(\s*['"]?#([^'")\s]+)/;

function filterPrimitives(filter: SvgNode): number {
  return filter.children.filter((child) => typeof child !== "string" && child.name.startsWith("fe")).length;
}

/** The ids an element points at: as a copy to draw (use, clip-path, mask) or as a filter to run. */
function references(node: SvgNode): ["copy" | "filter", string][] {
  const out: ["copy" | "filter", string][] = [];
  const add = (property: string, value: string) => {
    if (property !== "clip-path" && property !== "mask" && property !== "filter") return;
    const id = URL_ID.exec(value)?.[1];
    if (id) out.push([property === "filter" ? "filter" : "copy", id]);
  };
  for (const [name, value] of node.attributes) {
    if (name === "href") {
      if (node.name === "use") out.push(["copy", value.slice(1)]);
    } else if (name === "style") {
      for (const declaration of value.split(";")) {
        const colon = declaration.indexOf(":");
        add(declaration.slice(0, colon), declaration.slice(colon + 1));
      }
    } else {
      add(name, value);
    }
  }
  return out;
}

/** Refuses a drawing past the limits. Returns whether it runs a filter. */
function measure(root: SvgNode): boolean {
  const byId = new Map<string, SvgNode>();
  let elements = 0;
  const index = (node: SvgNode) => {
    if (++elements > MAX_ELEMENTS) throw new Refusal(`SVG has more than ${MAX_ELEMENTS} elements: simplify the drawing (for example with SVGO) or send a PNG or WebP`);
    const id = node.attributes.find(([name]) => name === "id")?.[1];
    if (id !== undefined && !byId.has(id)) byId.set(id, node);
    if (node.name === "filter" && filterPrimitives(node) > MAX_FILTER_PRIMITIVES) {
      throw new Refusal(`SVG filter has more than ${MAX_FILTER_PRIMITIVES} steps: simplify the effect or send a PNG or WebP`);
    }
    for (const child of node.children) if (typeof child !== "string") index(child);
  };
  index(root);

  // What an element costs: its subtree, plus a copy of every element it
  // points at. Counted once per element, and refused as soon as a part is
  // over a limit, so the count stays small however the references fan out.
  const known = new Map<SvgNode, { drawn: number; filterRuns: number }>();
  const open = new Set<SvgNode>();
  const cost = (node: SvgNode): { drawn: number; filterRuns: number } => {
    const done = known.get(node);
    if (done) return done;
    if (open.has(node)) throw new Refusal("SVG references form a loop: an element points back at itself through <use>, clip-path or mask");
    open.add(node);
    let drawn = 1;
    let filterRuns = 0;
    const parts = node.children.filter((child): child is SvgNode => typeof child !== "string");
    for (const [how, id] of references(node)) {
      const target = byId.get(id);
      if (!target) continue;
      if (how === "filter") filterRuns += filterPrimitives(target);
      else parts.push(target);
    }
    for (const part of parts) {
      const c = cost(part);
      drawn += c.drawn;
      filterRuns += c.filterRuns;
      if (drawn > MAX_DRAWN) throw new Refusal(TOO_MANY_DRAWN);
      if (filterRuns > MAX_FILTER_RUNS) throw new Refusal(TOO_MANY_FILTER_RUNS);
    }
    if (filterRuns > MAX_FILTER_RUNS) throw new Refusal(TOO_MANY_FILTER_RUNS);
    open.delete(node);
    const result = { drawn, filterRuns };
    known.set(node, result);
    return result;
  };
  return cost(root).filterRuns > 0;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<"\t\n\r]/g, (c) => ({ "&": "&amp;", "<": "&lt;", '"': "&quot;", "\t": "&#9;", "\n": "&#10;", "\r": "&#13;" })[c]!);
}

function escapeText(value: string): string {
  return value.replace(/[&<>\r]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\r": "&#13;" })[c]!);
}

/** The checked tree as plain XML: no comments, no declarations, only the escapes it needs. */
function serialize(node: SvgNode, isRoot: boolean): string {
  let out = `<${node.name}`;
  if (isRoot) out += ` xmlns="${SVG_NS}"`;
  for (const [name, value] of node.attributes) out += ` ${name}="${escapeAttribute(value)}"`;
  if (node.children.length === 0) return `${out}/>`;
  out += ">";
  for (const child of node.children) out += typeof child === "string" ? escapeText(child) : serialize(child, false);
  return `${out}</${node.name}>`;
}

/** The SVG to draw, or why it can't be drawn. Draw `svg`, not the text that came in. */
export function checkedSvg(text: string): CheckedSvg {
  try {
    const root = parse(text);
    const filtered = measure(root);
    return { ok: true, svg: serialize(root, true), filtered };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, reason: err.message };
    throw err;
  }
}
