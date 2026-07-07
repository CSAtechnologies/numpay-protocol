// Saved recipients ("contacts"), a persisted list keyed for the Send page. Saved
// addresses cut re-pasting (a phishing/typo vector) and let the user pick a known
// destination instead of a raw hex string. Addresses are stored verbatim; the
// Send page still validates a picked address against the active chain before it
// can become a send target.

import { getItem, setItem } from "./storage";

const KEY = "numpay_contacts";
const CAP = 200;

export interface Contact {
  id: string;
  name: string;
  address: string;
  // The chain the contact was saved on (for labelling); undefined = unscoped.
  chainId?: string;
}

export async function loadContacts(): Promise<Contact[]> {
  try {
    const raw = await getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((c) => c && c.address && c.name) : [];
  } catch {
    return [];
  }
}

/** Add or update a contact (dedupe by lowercased address). Returns the new list. */
export async function saveContact(c: Omit<Contact, "id"> & { id?: string }): Promise<Contact[]> {
  const list = await loadContacts();
  const addrL = c.address.trim().toLowerCase();
  const id = c.id || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const entry: Contact = { id, name: c.name.trim(), address: c.address.trim(), chainId: c.chainId };
  const next = [entry, ...list.filter((e) => e.address.trim().toLowerCase() !== addrL)].slice(0, CAP);
  try { await setItem(KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}

export async function deleteContact(id: string): Promise<Contact[]> {
  const list = await loadContacts();
  const next = list.filter((c) => c.id !== id);
  try { await setItem(KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}

/** Is this address already saved? (case-insensitive) */
export function isSaved(list: Contact[], address: string): boolean {
  const a = address.trim().toLowerCase();
  return !!a && list.some((c) => c.address.trim().toLowerCase() === a);
}
