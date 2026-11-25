/**
 * FieldScout check-ins — "I'm safe", "Need help", optional location — as a
 * compact binary datagram on a private MeshCore channel.
 *
 * Transport: MeshCore group datagrams (`PAYLOAD_TYPE_GRP_DATA`), sent with the
 * companion command `CMD_SEND_CHANNEL_DATA` (0x3E) and received as
 * `RESP_CODE_CHANNEL_DATA_RECV` (0x1B); see ./companion.ts. A datagram
 * carries no sender and no timestamp, so both are inside the payload.
 *
 * The format is specified in docs/check-in-format.md. Version 1's layout
 * never changes: a different layout gets a new version number.
 *
 * People on apps that don't read this data type would see nothing, so a
 * check-in can also go out as one plain text line carrying the same id
 * (the "text twin"); a reader that understands both shows it once.
 *
 * This file has no dependencies and does no I/O.
 */

/**
 * Group data type. `FF00–FFFF` is MeshCore's range for apps in development
 * (MeshCore docs/number_allocations.md). This becomes the permanent id once
 * one is allocated; until then, expect it to change.
 */
export const CHECKIN_DATA_TYPE = 0xff46;

export const CHECKIN_VERSION = 1;
const KIND_CHECKIN = 1;
const FLAG_HAS_LOCATION = 0x01;

/** Firmware limit for a group datagram payload (MAX_GROUP_DATA_LENGTH). */
export const MAX_DATAGRAM_BYTES = 165;
export const MAX_NAME_BYTES = 24;
export const MAX_NOTE_BYTES = 80;

export type CheckinStatus = 'safe' | 'help' | 'moving' | 'arrived';

const STATUS_CODES: Record<CheckinStatus, number> = { safe: 1, help: 2, moving: 3, arrived: 4 };
const STATUS_BY_CODE: Record<number, CheckinStatus> = { 1: 'safe', 2: 'help', 3: 'moving', 4: 'arrived' };

export const CHECKIN_STATUSES: readonly { value: CheckinStatus; label: string; hint: string }[] = [
  { value: 'safe', label: "I'm safe", hint: 'All good where I am' },
  { value: 'help', label: 'Need help', hint: 'Come to me or call for help' },
  { value: 'moving', label: 'On my way', hint: 'Heading to you or the meeting point' },
  { value: 'arrived', label: 'At the meeting point', hint: "I've arrived" },
];

export function checkinLabel(status: CheckinStatus): string {
  return CHECKIN_STATUSES.find((s) => s.value === status)?.label ?? 'Checked in';
}

export interface Checkin {
  /** Random 16-bit id: ties the datagram to its text twin and stops duplicates. */
  id: number;
  status: CheckinStatus;
  /** Sender's clock, Unix seconds. */
  sentAt: number;
  /** First 6 bytes of the sender's public key, hex; '' when it came in as text. */
  senderPrefix: string;
  name: string;
  note: string;
  lat: number | null;
  lng: number | null;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

/** UTF-8 bytes of `text`, cut at a character boundary so it fits `max` bytes. */
function utf8Fit(text: string, max: number): Uint8Array {
  let s = text;
  let bytes = enc.encode(s);
  while (bytes.length > max) {
    s = Array.from(s).slice(0, -1).join('');
    bytes = enc.encode(s);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newCheckinId(): number {
  return Math.floor(Math.random() * 0xffff) + 1; // 1..65535, never 0
}

export function checkinIdHex(id: number): string {
  return (id & 0xffff).toString(16).padStart(4, '0');
}

/**
 * v1 payload:
 *   [0]      version = 1
 *   [1]      kind = 1 (check-in)
 *   [2]      status: 1 safe, 2 need help, 3 on my way, 4 at the meeting point
 *   [3]      flags: bit 0 = location present
 *   [4..5]   id, u16 LE
 *   [6..9]   sender time, Unix seconds, u32 LE
 *   [10..15] first 6 bytes of the sender's public key
 *   [16..23] latitude, longitude: i32 LE, degrees × 1e6   (only if bit 0 set)
 *   [n]      name length (0–24), then that many UTF-8 bytes
 *   [n..]    note, UTF-8, to the end of the payload (0–80 bytes)
 */
export function encodeCheckin(c: Checkin): Uint8Array {
  if (!/^[0-9a-f]{12}$/i.test(c.senderPrefix)) throw new Error('Check-in needs the 6-byte sender key prefix');
  const hasLoc = c.lat != null && c.lng != null;
  const name = utf8Fit(c.name.trim(), MAX_NAME_BYTES);
  const note = utf8Fit(c.note.trim(), MAX_NOTE_BYTES);
  const out = new Uint8Array(16 + (hasLoc ? 8 : 0) + 1 + name.length + note.length);
  const dv = new DataView(out.buffer);
  out[0] = CHECKIN_VERSION;
  out[1] = KIND_CHECKIN;
  out[2] = STATUS_CODES[c.status];
  out[3] = hasLoc ? FLAG_HAS_LOCATION : 0;
  dv.setUint16(4, c.id & 0xffff, true);
  dv.setUint32(6, c.sentAt >>> 0, true);
  out.set(hexToBytes(c.senderPrefix.toLowerCase()), 10);
  let i = 16;
  if (hasLoc) {
    dv.setInt32(i, Math.round((c.lat as number) * 1e6), true);
    dv.setInt32(i + 4, Math.round((c.lng as number) * 1e6), true);
    i += 8;
  }
  out[i++] = name.length;
  out.set(name, i);
  out.set(note, i + name.length);
  return out;
}

/** Null for anything that isn't a well-formed v1 check-in (other versions, other apps on the dev range, noise). */
export function decodeCheckin(bytes: Uint8Array): Checkin | null {
  if (bytes.length < 17 || bytes[0] !== CHECKIN_VERSION || bytes[1] !== KIND_CHECKIN) return null;
  const status = STATUS_BY_CODE[bytes[2]];
  if (!status) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hasLoc = (bytes[3] & FLAG_HAS_LOCATION) !== 0;
  let i = 16;
  let lat: number | null = null;
  let lng: number | null = null;
  if (hasLoc) {
    if (bytes.length < i + 9) return null;
    lat = dv.getInt32(i, true) / 1e6;
    lng = dv.getInt32(i + 4, true) / 1e6;
    i += 8;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  }
  const nameLen = bytes[i++];
  if (nameLen > MAX_NAME_BYTES || i + nameLen > bytes.length) return null;
  const name = dec.decode(bytes.subarray(i, i + nameLen));
  const note = dec.decode(bytes.subarray(i + nameLen, Math.min(bytes.length, i + nameLen + MAX_NOTE_BYTES)));
  return {
    id: dv.getUint16(4, true),
    status,
    sentAt: dv.getUint32(6, true),
    senderPrefix: bytesToHex(bytes.subarray(10, 16)),
    name,
    note,
    lat,
    lng,
  };
}

// ---- Plain-text twin (for people on other MeshCore apps) ----

const TEXT_PREFIX = 'CHECK-IN: ';

/** "CHECK-IN: I'm safe. At home [fs:a3f9]" — readable anywhere; the tag lets FieldScout pair it with the datagram. */
export function checkinFallbackText(c: Pick<Checkin, 'id' | 'status' | 'note'>): string {
  const note = c.note.trim().replace(/\s*\[fs:[0-9a-f]{4}\]\s*$/i, '');
  return `${TEXT_PREFIX}${checkinLabel(c.status)}.${note ? ` ${note}` : ''} [fs:${checkinIdHex(c.id)}]`;
}

export function parseCheckinFallback(text: string): Pick<Checkin, 'id' | 'status' | 'note'> | null {
  const m = /^CHECK-IN: (.+?)\.(?: (.*))? \[fs:([0-9a-f]{4})\]$/s.exec(text.trim());
  if (!m) return null;
  const status = CHECKIN_STATUSES.find((s) => s.label === m[1])?.value;
  if (!status) return null;
  return { id: parseInt(m[3], 16), status, note: (m[2] ?? '').trim() };
}
