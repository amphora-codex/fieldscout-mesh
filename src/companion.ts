/**
 * MeshCore companion-protocol framing for group datagrams — the two frames an
 * app needs to send and receive FieldScout check-ins through a companion
 * radio (Bluetooth, USB or TCP).
 *
 * Byte layouts follow meshcore-dev/MeshCore `examples/companion_radio/MyMesh.cpp`
 * and `docs/companion_protocol.md`.
 */

/** Companion command: send a datagram to a channel. */
export const CMD_SEND_CHANNEL_DATA = 0x3e;
/** Companion response: a datagram received on a channel (fetched with CMD_SYNC_NEXT_MESSAGE, 0x0A). */
export const RESP_CODE_CHANNEL_DATA_RECV = 0x1b;
/** Largest payload a group datagram can carry (firmware MAX_GROUP_DATA_LENGTH). */
export const MAX_CHANNEL_DATA_BYTES = 165;

/**
 * `[0x3E][channel_idx][path_len = 0xFF (flood)][data_type: u16 LE][payload]`
 *
 * The radio answers OK, or ERR: NOT_FOUND (no such channel), ILLEGAL_ARG
 * (data type 0, payload too long), TABLE_FULL (no free packet), or
 * UNSUPPORTED_CMD on firmware that predates datagrams.
 */
export function encodeSendChannelData(channelIdx: number, dataType: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(channelIdx) || channelIdx < 0 || channelIdx > 255) throw new Error('Bad channel index');
  if (!Number.isInteger(dataType) || dataType < 1 || dataType > 0xffff) throw new Error('Bad data type');
  if (payload.length > MAX_CHANNEL_DATA_BYTES) {
    throw new Error(`Datagram too long (${payload.length} > ${MAX_CHANNEL_DATA_BYTES} bytes)`);
  }
  const out = new Uint8Array(5 + payload.length);
  out[0] = CMD_SEND_CHANNEL_DATA;
  out[1] = channelIdx;
  out[2] = 0xff;
  out[3] = dataType & 0xff;
  out[4] = dataType >> 8;
  out.set(payload, 5);
  return out;
}

export interface ChannelDatagram {
  /** Signal-to-noise ratio in dB (the frame carries it ×4). */
  snr: number;
  channelIdx: number;
  /** Hops the packet took when flooded; 0xFF when it came direct. */
  pathLen: number;
  dataType: number;
  payload: Uint8Array;
}

/**
 * `[0x1B][snr×4: i8][reserved: 2][channel_idx][path_len][data_type: u16 LE][len][payload]`
 *
 * Returns null for any other frame, or one shorter than its stated length.
 */
export function decodeChannelDataRecv(frame: Uint8Array): ChannelDatagram | null {
  if (frame.length < 9 || frame[0] !== RESP_CODE_CHANNEL_DATA_RECV) return null;
  const len = frame[8];
  if (frame.length < 9 + len) return null;
  const snrRaw = frame[1] > 127 ? frame[1] - 256 : frame[1];
  return {
    snr: snrRaw / 4,
    channelIdx: frame[4],
    pathLen: frame[5],
    dataType: frame[6] | (frame[7] << 8),
    payload: frame.slice(9, 9 + len),
  };
}
