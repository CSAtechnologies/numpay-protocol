// Decode helpers for Solana signMessage requests (P2). Dependency-light. A
// Solana signMessage payload is arbitrary bytes (carried as base64 over the
// transport and storage, since Uint8Array does not survive chrome.storage). The
// approval window renders this for the user, so decoding MUST NOT throw on
// hostile input.

// C0 control characters except tab/newline/CR (legitimate in sign-in messages).
function hasControlSoup(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

export interface DecodedSolMessage {
  base64: string; // normalised base64 of the message bytes
  bytes: Uint8Array;
  text: string; // UTF-8 decode when valid + readable, else the base64
  isUtf8: boolean;
}

// Decode a base64 Solana sign message into a readable form. Attempts a strict
// UTF-8 decode (the common case is a sign-in / authentication string); falls
// back to showing the base64 when the bytes are not readable text.
export function decodeSolSignMessage(base64: string): DecodedSolMessage {
  const bytes = base64ToBytes(base64);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length > 0 && !hasControlSoup(text)) {
      return { base64, bytes, text, isUtf8: true };
    }
  } catch {
    /* not valid UTF-8 */
  }
  return { base64, bytes, text: base64, isUtf8: false };
}
