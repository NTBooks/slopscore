// Mail headers that survive a strict receiver.
//
// A mail header is ASCII. Anything else has to be wrapped in an RFC 2047 encoded-word, and a receiver that
// enforces it does not warn you — it rejects the whole message with a 550 and the mail is gone. We found this
// the way everyone finds it: a subject containing "·" and "—", both of which this site's voice puts in almost
// every sentence, bounced off a mailbox provider that checks.
//
// The reason this lives in its own file rather than being fixed where it bit us: four places in this codebase
// build a Subject, and one of them (routes/contact.tsx) interpolates text a stranger typed into a form. That
// one is the dangerous one. An emoji in a contact form subject, an accented name, a curly quote pasted from a
// word processor — each one silently destroys the notification that a human was trying to reach a moderator,
// and nothing anywhere would have said so.
//
// Deliberately not a general MIME library. It encodes a header value correctly and does nothing else.

/**
 * Bytes per encoded-word.
 *
 * RFC 2047 caps an encoded-word at 75 characters. `=?UTF-8?B?` and `?=` spend 12 of them, leaving 63 for the
 * base64, and base64 is 4 characters per 3 bytes — so 45 bytes is the largest multiple of 3 that fits. Using a
 * multiple of 3 also means no chunk needs padding except the last, which keeps every word the same shape.
 */
const MAX_BYTES = 45;

const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

/** One chunk as an encoded-word. */
function encodedWord(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/**
 * A string safe to put after `Subject:` (or any other unstructured header).
 *
 * Pure ASCII passes through untouched, so the common case stays readable in a raw message. Anything else is
 * split into RFC 2047 encoded-words and folded, and the split is by code point rather than by byte — a chunk
 * boundary through the middle of a multi-byte character produces a word that decodes to a replacement char,
 * which is the kind of bug that only shows up in somebody else's mail client.
 *
 * Newlines and tabs are flattened first, always: a header value containing CRLF is not a mangled subject, it
 * is an injected header, and `To:` is one of the headers a stranger could add that way.
 */
export function encodeHeader(value: string, maxChars = 200): string {
  const flat = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxChars);
  if (!flat) return "";
  if (ASCII_PRINTABLE.test(flat)) return flat;

  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const ch of flat) {                       // by code point, not by UTF-16 unit
    const n = encoder.encode(ch).length;
    if (bytes + n > MAX_BYTES) {
      words.push(encodedWord(chunk));
      chunk = "";
      bytes = 0;
    }
    chunk += ch;
    bytes += n;
  }
  if (chunk) words.push(encodedWord(chunk));
  // Folding: CRLF followed by whitespace continues a header value. The message builders join their lines with
  // CRLF already, so this is the same convention rather than a second one.
  return words.join("\r\n ");
}
