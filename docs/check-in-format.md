# FieldScout check-ins: MeshCore group data format

FieldScout sends family check-ins ("I'm safe", "Need help", optional location) as MeshCore group
datagrams (`PAYLOAD_TYPE_GRP_DATA`) on a private channel. This document is the wire format, so
other MeshCore apps can read or send the same check-ins.

Reference implementation: [`src/checkin.ts`](../src/checkin.ts). Tests: [`test/`](../test).

## Data type

| | |
|---|---|
| Data type (development) | `0xFF46`, inside MeshCore's `FF00–FFFF` testing range |
| Data type (permanent) | not allocated yet; see [Allocation](#allocation) |
| Sent with | companion command `CMD_SEND_CHANNEL_DATA` (0x3E), flood (`path_len = 0xFF`) |
| Received as | `RESP_CODE_CHANNEL_DATA_RECV` (0x1B), from `CMD_SYNC_NEXT_MESSAGE` |
| Channel | private (pre-shared key) channels only; FieldScout never sends this on the public channel |

## Payload, version 1

All integers are little-endian. A group datagram carries no sender and no timestamp, so both are
in the payload.

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | version | `1` |
| 1 | 1 | kind | `1` = check-in. Other values are reserved; ignore kinds you don't know |
| 2 | 1 | status | `1` I'm safe · `2` Need help · `3` On my way · `4` At the meeting point |
| 3 | 1 | flags | bit 0 = location present. Other bits are reserved: send 0, ignore on receive |
| 4 | 2 | id | random, never 0. Pairs the datagram with its text twin; drop repeats of an id |
| 6 | 4 | sent at | the sender's clock, Unix seconds |
| 10 | 6 | sender | first 6 bytes of the sender's public key |
| 16 | 4 | latitude | `int32`, degrees × 1,000,000. Present only when flags bit 0 is set |
| 20 | 4 | longitude | `int32`, degrees × 1,000,000. Present only when flags bit 0 is set |
| n | 1 | name length | 0–24 |
| n+1 | 0–24 | name | UTF-8, the sender's display name |
| … | 0–80 | note | UTF-8, runs to the end of the payload |

`n` is 16 without a location and 24 with one. The largest payload is 129 bytes, under MeshCore's
165-byte group-data limit.

A receiver must ignore a payload that is truncated, has a version, kind or status it doesn't know,
or carries a latitude outside ±90° or a longitude outside ±180°.

The sender's name and key prefix are claims, not proof. Anyone who holds the channel key can send
any name, exactly as with channel text messages.

### Example

"I'm safe", sent by "Basecamp" at 2026-11-18 11:06:40 UTC from 33.448376, −112.074036, with the
note "At home, power is out" (54 bytes):

```
01 01 01 01 f9 a3 c0 86 fd 6a 01 02 03 04 05 ff
b8 61 fe 01 cc e2 51 f9 08 42 61 73 65 63 61 6d
70 41 74 20 68 6f 6d 65 2c 20 70 6f 77 65 72 20
69 73 20 6f 75 74
```

| Bytes | Meaning |
|---|---|
| `01` | version 1 |
| `01` | kind: check-in |
| `01` | status: I'm safe |
| `01` | flags: location present |
| `f9 a3` | id `0xA3F9` |
| `c0 86 fd 6a` | sent at 1,795,000,000 |
| `01 02 03 04 05 ff` | sender key prefix |
| `b8 61 fe 01` | latitude 33,448,376 |
| `cc e2 51 f9` | longitude −112,074,036 |
| `08` | name is 8 bytes |
| `42 61 73 65 63 61 6d 70` | "Basecamp" |
| rest | "At home, power is out" |

## Text twin

People on apps that don't read this data type would see nothing. So FieldScout can also send one
ordinary channel text message per check-in (the sender can turn this off):

```
CHECK-IN: <status label>.[ <note>] [fs:<id as 4 lowercase hex digits>]
```

The example above as text: `CHECK-IN: I'm safe. At home, power is out [fs:a3f9]`

The status labels are exactly `I'm safe`, `Need help`, `On my way` and `At the meeting point`.
The text never contains the location. An app that reads the datagram should treat a text with the
same id as the same check-in and show it once, whichever arrives first.

## Versioning

Version 1's layout never changes. A different layout gets a new version number. A new message type
(live location, a meeting-point update) gets a new `kind` under version 1 if it can keep the
16-byte header, otherwise a new version.

## Allocation

MeshCore's [`docs/number_allocations.md`](https://github.com/meshcore-dev/MeshCore/blob/main/docs/number_allocations.md)
asks apps to use the `FF00–FFFF` range while developing and to request a permanent id by pull
request once the app works. FieldScout is requesting one id; when it is allocated this document
and `CHECKIN_DATA_TYPE` change to it. Until then, expect the type to change.
