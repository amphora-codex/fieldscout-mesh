import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKIN_DATA_TYPE,
  MAX_DATAGRAM_BYTES,
  checkinFallbackText,
  decodeCheckin,
  encodeCheckin,
  parseCheckinFallback,
  type Checkin,
} from '../src/checkin.ts';

const base: Checkin = {
  id: 0xa3f9,
  status: 'safe',
  sentAt: 1_795_000_000,
  senderPrefix: '0102030405ff',
  name: 'Basecamp',
  note: 'At home, power is out',
  lat: 33.448376,
  lng: -112.074036,
};

describe('check-in payload v1', () => {
  test('uses the MeshCore development data-type range until an id is allocated', () => {
    assert.ok(CHECKIN_DATA_TYPE >= 0xff00 && CHECKIN_DATA_TYPE <= 0xffff);
  });

  test('exact bytes of the documented example', () => {
    const b = encodeCheckin(base);
    assert.deepEqual(Array.from(b.subarray(0, 4)), [1, 1, 1, 1]); // version, kind, status (safe), flags (location)
    assert.deepEqual(Array.from(b.subarray(4, 6)), [0xf9, 0xa3]); // id, little-endian
    assert.deepEqual(Array.from(b.subarray(10, 16)), [1, 2, 3, 4, 5, 0xff]);
    const dv = new DataView(b.buffer);
    assert.equal(dv.getUint32(6, true), 1_795_000_000);
    assert.equal(dv.getInt32(16, true), 33_448_376);
    assert.equal(dv.getInt32(20, true), -112_074_036);
    assert.equal(b[24], 8); // name length
    assert.equal(b.length, 16 + 8 + 1 + 8 + 21);
  });

  test('matches the annotated example in docs/check-in-format.md byte for byte', () => {
    const hex = Array.from(encodeCheckin(base), (b) => b.toString(16).padStart(2, '0')).join(' ');
    assert.equal(
      hex,
      '01 01 01 01 f9 a3 c0 86 fd 6a 01 02 03 04 05 ff ' +
        'b8 61 fe 01 cc e2 51 f9 08 42 61 73 65 63 61 6d ' +
        '70 41 74 20 68 6f 6d 65 2c 20 70 6f 77 65 72 20 ' +
        '69 73 20 6f 75 74',
    );
  });

  test('round-trips with and without a location', () => {
    assert.deepEqual(decodeCheckin(encodeCheckin(base)), base);
    const noLoc: Checkin = { ...base, status: 'help', lat: null, lng: null, note: '' };
    const bytes = encodeCheckin(noLoc);
    assert.equal(bytes[3], 0);
    assert.equal(bytes.length, 16 + 1 + 8);
    assert.deepEqual(decodeCheckin(bytes), noLoc);
  });

  test('always fits one datagram: name and note are cut at a character boundary', () => {
    const bytes = encodeCheckin({ ...base, name: 'Ñ'.repeat(40), note: '🔥'.repeat(60) });
    assert.ok(bytes.length <= MAX_DATAGRAM_BYTES);
    const back = decodeCheckin(bytes);
    assert.equal(back?.name, 'Ñ'.repeat(12)); // 24 bytes
    assert.equal(back?.note, '🔥'.repeat(20)); // 80 bytes
  });

  test('ignores other versions, kinds, unknown statuses, and truncated or absurd payloads', () => {
    const good = encodeCheckin(base);
    const mutate = (i: number, v: number) => {
      const b = good.slice();
      b[i] = v;
      return b;
    };
    assert.equal(decodeCheckin(mutate(0, 2)), null);
    assert.equal(decodeCheckin(mutate(1, 9)), null);
    assert.equal(decodeCheckin(mutate(2, 77)), null);
    assert.equal(decodeCheckin(good.subarray(0, 20)), null);
    assert.equal(decodeCheckin(mutate(24, 200)), null); // name longer than the payload
    assert.equal(decodeCheckin(new Uint8Array(0)), null);
    const badLat = good.slice();
    new DataView(badLat.buffer).setInt32(16, 95_000_000, true);
    assert.equal(decodeCheckin(badLat), null);
  });

  test('needs the sender key prefix', () => {
    assert.throws(() => encodeCheckin({ ...base, senderPrefix: '' }));
  });
});

describe('text twin', () => {
  test('reads as a sentence and carries the id', () => {
    assert.equal(checkinFallbackText(base), "CHECK-IN: I'm safe. At home, power is out [fs:a3f9]");
    assert.equal(checkinFallbackText({ id: 7, status: 'help', note: '' }), 'CHECK-IN: Need help. [fs:0007]');
  });

  test('parses back to the same id, status and note', () => {
    assert.deepEqual(parseCheckinFallback(checkinFallbackText(base)), {
      id: 0xa3f9,
      status: 'safe',
      note: 'At home, power is out',
    });
    assert.deepEqual(parseCheckinFallback('CHECK-IN: Need help. [fs:0007]'), { id: 7, status: 'help', note: '' });
    assert.deepEqual(parseCheckinFallback('CHECK-IN: At the meeting point. by the gate [fs:00ff]'), {
      id: 255,
      status: 'arrived',
      note: 'by the gate',
    });
  });

  test('ordinary chat is not mistaken for a check-in', () => {
    assert.equal(parseCheckinFallback("I'm safe"), null);
    assert.equal(parseCheckinFallback('CHECK-IN: Feeling great. [fs:a3f9]'), null);
    assert.equal(parseCheckinFallback("CHECK-IN: I'm safe. no tag"), null);
  });
});
