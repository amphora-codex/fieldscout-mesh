# fieldscout-mesh

The wire format, and a small reference implementation, for the check-ins that
[FieldScout](https://amphoracodex.com/fieldscout) sends over [MeshCore](https://github.com/meshcore-dev/MeshCore) radios.

FieldScout is an offline emergency-preparedness app for iPhone and Android. Paired with a MeshCore
companion radio, it lets a family tell each other "I'm safe" or "Need help", with an optional
location, when there is no phone service. A check-in travels radio to radio as one small binary
packet on a private channel.

This repository documents that packet so anyone can check what FieldScout puts on the air, and so
other MeshCore apps can read or send the same check-ins.

## What's here

| | |
|---|---|
| [`docs/check-in-format.md`](docs/check-in-format.md) | The format: every byte, an annotated example, the text fallback, versioning |
| [`src/checkin.ts`](src/checkin.ts) | Encoder and decoder for the check-in payload and its text twin |
| [`src/companion.ts`](src/companion.ts) | The two companion-protocol frames that carry a datagram to and from a radio |
| [`test/`](test) | Tests that pin the bytes |

The code is TypeScript with no runtime dependencies and no I/O. It is the same logic FieldScout
ships; it is published here as a reference, not as an npm package.

## The format in brief

- **Transport:** MeshCore group datagrams (`PAYLOAD_TYPE_GRP_DATA`), flooded on a private channel.
- **Data type:** `0xFF46`, in MeshCore's development range. A permanent id is being requested;
  the type will change when it is allocated.
- **Payload:** a 16-byte header (version, kind, status, flags, id, time, sender key prefix), an
  optional 8-byte location, then the sender's name and a short note. At most 129 bytes.
- **Text twin:** an optional plain channel message, `CHECK-IN: I'm safe. note [fs:a3f9]`, for
  people on apps that don't read the datagram. It carries the same id and never the location.

## Example

```ts
import { CHECKIN_DATA_TYPE, encodeCheckin, decodeCheckin, newCheckinId } from './src/checkin.ts';
import { encodeSendChannelData, decodeChannelDataRecv } from './src/companion.ts';

// Send: build the payload, wrap it in the companion frame, write that to the radio.
const payload = encodeCheckin({
  id: newCheckinId(),
  status: 'safe',
  sentAt: Math.floor(Date.now() / 1000),
  senderPrefix: '0102030405ff', // first 6 bytes of your radio's public key, hex
  name: 'Basecamp',
  note: 'At home, power is out',
  lat: 33.448376,
  lng: -112.074036,
});
const frame = encodeSendChannelData(1, CHECKIN_DATA_TYPE, payload); // channel index 1

// Receive: a 0x1B frame from the radio's message queue.
const datagram = decodeChannelDataRecv(frameFromRadio);
if (datagram?.dataType === CHECKIN_DATA_TYPE) {
  const checkin = decodeCheckin(datagram.payload); // null if it isn't a valid v1 check-in
}
```

## Run the tests

Needs Node 22 or newer.

```sh
npm install
npm test
```

## Privacy

FieldScout sends check-ins only on private (pre-shared key) channels, never on the public channel,
because a check-in can carry a location. The location is included only when the sender chooses
to. Nothing in this format involves a server: packets go from radio to radio.

The sender's name and key prefix inside a check-in are not authenticated beyond the channel key.
Anyone who holds the channel key can send any name, the same as with channel text messages.

## Status

Check-ins are in FieldScout 1.1.4 test builds and have been exchanged on the air between two
radios. They have not shipped in a store release yet.

## Contact

Amphora LLC · hello@amphoracodex.com · https://amphoracodex.com/fieldscout

Issues and pull requests about the format are welcome. FieldScout itself is not open source.

## License

[MIT](LICENSE)
