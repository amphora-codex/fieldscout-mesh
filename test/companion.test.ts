import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeChannelDataRecv, encodeSendChannelData, MAX_CHANNEL_DATA_BYTES } from '../src/companion.ts';
import { CHECKIN_DATA_TYPE, decodeCheckin, encodeCheckin } from '../src/checkin.ts';

describe('companion framing for group datagrams', () => {
  test('send is [0x3E][channel][0xFF flood][type lo][type hi][payload]', () => {
    assert.deepEqual(Array.from(encodeSendChannelData(2, 0xff46, new Uint8Array([9, 8, 7]))), [0x3e, 2, 0xff, 0x46, 0xff, 9, 8, 7]);
  });

  test('rejects the reserved type 0 and payloads over the firmware limit', () => {
    assert.throws(() => encodeSendChannelData(1, 0, new Uint8Array(1)));
    assert.throws(() => encodeSendChannelData(1, 0xff46, new Uint8Array(MAX_CHANNEL_DATA_BYTES + 1)));
    assert.equal(encodeSendChannelData(1, 0xff46, new Uint8Array(MAX_CHANNEL_DATA_BYTES)).length, 5 + 165);
  });

  test('receive is [0x1B][snr×4][2 reserved][channel][path_len][type LE][len][payload]', () => {
    assert.deepEqual(decodeChannelDataRecv(new Uint8Array([0x1b, 0xf4, 0, 0, 3, 1, 0x46, 0xff, 2, 0xaa, 0xbb, 0xcc])), {
      snr: -3,
      channelIdx: 3,
      pathLen: 1,
      dataType: 0xff46,
      payload: new Uint8Array([0xaa, 0xbb]),
    });
  });

  test('other frames, and frames shorter than their stated length, are not datagrams', () => {
    assert.equal(decodeChannelDataRecv(new Uint8Array([0x1b, 0, 0, 0, 1, 0, 0x46, 0xff, 5, 1, 2])), null);
    assert.equal(decodeChannelDataRecv(new Uint8Array([0x11, 0, 0, 0, 1, 0, 0x46, 0xff, 0])), null);
  });

  test('a check-in survives the trip: app → radio frame → air → radio frame → app', () => {
    const sent = {
      id: 0x0b0b, status: 'help' as const, sentAt: 1_795_000_000, senderPrefix: '112233445566',
      name: 'Basecamp', note: 'by the river', lat: 33.4484, lng: -112.074,
    };
    const out = encodeSendChannelData(1, CHECKIN_DATA_TYPE, encodeCheckin(sent));
    // What the receiving radio hands its app: same type and payload, wrapped in a 0x1B frame.
    const payload = out.subarray(5);
    const inbound = new Uint8Array([0x1b, 20, 0, 0, 1, 0, out[3], out[4], payload.length, ...payload]);
    const got = decodeChannelDataRecv(inbound);
    assert.equal(got?.dataType, CHECKIN_DATA_TYPE);
    assert.deepEqual(decodeCheckin(got!.payload), sent);
  });
});
