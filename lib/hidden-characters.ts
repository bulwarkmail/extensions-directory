// Characters that change how code reads, or hide content, without showing:
// control and format characters (Cc, Cf), the bidirectional controls, every
// default-ignorable code point (zero-width characters, variation selectors,
// tag characters, the Hangul fillers that are valid in identifiers) and the
// line and paragraph separators. Tab, line feed and carriage return are left
// alone. The review page shows each as an escape; the scanner counts them.
// No server imports: the review page's client code uses it.

export const HIDDEN_CHARACTER_SOURCE =
  "(?![\\t\\n\\r])[\\p{Cc}\\p{Cf}\\p{Bidi_Control}\\p{Default_Ignorable_Code_Point}\\u2028\\u2029]";

const HIDDEN = new RegExp(HIDDEN_CHARACTER_SOURCE, "gu");

/** One code point as an escape: `\u200b` in the BMP, `\u{e0041}` above it. */
export function escapeCodePoint(char: string): string {
  const cp = char.codePointAt(0)!;
  return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, "0")}`;
}

/** The text with every hidden character written as an escape, in one pass. */
export function showHidden(text: string): string {
  return text.replace(HIDDEN, escapeCodePoint);
}
