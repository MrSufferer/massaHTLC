import { Args, Result } from '@massalabs/as-types';
import { Serializable } from '@massalabs/as-types/assembly/serializable';

export enum HTLCStatus {
  Active = 0,
  Withdrawn = 1,
  Refunded = 2,
}

export class HTLCRecord implements Serializable {
  orderId: string = '';
  hashlockHex: string = '';
  timelock: u64 = 0;
  sender: string = '';
  receiver: string = '';
  amount: u64 = 0;
  token: string = '';
  hasToken: bool = false;
  secretHex: string = '';
  secretSet: bool = false;
  funded: bool = false;
  status: HTLCStatus = HTLCStatus.Active;
  createdAt: u64 = 0;

  serialize(): StaticArray<u8> {
    const args = new Args();
    args.add(this.orderId);
    args.add(this.hashlockHex);
    args.add<u64>(this.timelock);
    args.add(this.sender);
    args.add(this.receiver);
    args.add<u64>(this.amount);
    args.add<bool>(this.hasToken);
    if (this.hasToken) {
      args.add(this.token);
    }
    args.add<bool>(this.secretSet);
    if (this.secretSet) {
      args.add(this.secretHex);
    }
    args.add<bool>(this.funded);
    args.add<u8>(<u8>this.status);
    args.add<u64>(this.createdAt);
    return args.serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.orderId = args.nextString().expect('missing orderId');
    this.hashlockHex = args.nextString().expect('missing hashlock');
    this.timelock = args.nextU64().expect('missing timelock');
    this.sender = args.nextString().expect('missing sender');
    this.receiver = args.nextString().expect('missing receiver');
    this.amount = args.nextU64().expect('missing amount');
    this.hasToken = args.nextBool().expect('missing token flag');
    if (this.hasToken) {
      this.token = args.nextString().expect('missing token value');
    } else {
      this.token = '';
    }
    this.secretSet = args.nextBool().expect('missing secret flag');
    if (this.secretSet) {
      this.secretHex = args.nextString().expect('missing secret');
    } else {
      this.secretHex = '';
    }
    this.funded = args.nextBool().expect('missing funded flag');
    this.status = <HTLCStatus>(args.nextU8().expect('missing status') as u8);
    this.createdAt = args.nextU64().expect('missing createdAt');
    return new Result<i32>(args.offset);
  }
}

export function bytesToHex(bytes: StaticArray<u8>): string {
  const hexChars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];
    const high = (value >> 4) & 0x0f;
    const low = value & 0x0f;
    result = result
      .concat(hexChars.charAt(high))
      .concat(hexChars.charAt(low));
  }
  return result;
}

export function hexToBytes(hex: string): StaticArray<u8> {
  assert(hex.length % 2 == 0, 'Invalid hex string');
  const length = hex.length / 2;
  const output = new StaticArray<u8>(length);
  for (let i = 0; i < length; i++) {
    const high = nibble(hex.charCodeAt(i * 2));
    const low = nibble(hex.charCodeAt(i * 2 + 1));
    output[i] = <u8>((high << 4) | low);
  }
  return output;
}

export function stringToBytes(str: string): StaticArray<u8> {
  const output = new StaticArray<u8>(str.length);
  for (let i = 0; i < str.length; i++) {
    output[i] = <u8>str.charCodeAt(i);
  }
  return output;
}

function nibble(code: i32): u8 {
  if (code >= 48 && code <= 57) {
    return <u8>(code - 48);
  }
  if (code >= 97 && code <= 102) {
    return <u8>(code - 87);
  }
  if (code >= 65 && code <= 70) {
    return <u8>(code - 55);
  }
  assert(false, 'Invalid hex character');
  return 0;
}

export function sha256Hex(data: StaticArray<u8>): string {
  const digest = sha256(data);
  return bytesToHex(digest);
}

export function sha256(data: StaticArray<u8>): StaticArray<u8> {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const bytes = padMessage(data);

  let h0: u32 = 0x6a09e667;
  let h1: u32 = 0xbb67ae85;
  let h2: u32 = 0x3c6ef372;
  let h3: u32 = 0xa54ff53a;
  let h4: u32 = 0x510e527f;
  let h5: u32 = 0x9b05688c;
  let h6: u32 = 0x1f83d9ab;
  let h7: u32 = 0x5be0cd19;

  const w = new StaticArray<u32>(64);

  for (let i = 0; i < bytes.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      const index = i + j * 4;
      w[j] =
        ((bytes[index] as u32) << 24) |
        ((bytes[index + 1] as u32) << 16) |
        ((bytes[index + 2] as u32) << 8) |
        (bytes[index + 3] as u32);
    }

    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = add(add(add(w[j - 16], s0), w[j - 7]), s1);
    }

    let a: u32 = h0;
    let b: u32 = h1;
    let c: u32 = h2;
    let d: u32 = h3;
    let e: u32 = h4;
    let f: u32 = h5;
    let g: u32 = h6;
    let h: u32 = h7;

    for (let j = 0; j < 64; j++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = add(add(add(add(h, s1), ch), K[j] as u32), w[j]);
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = add(s0, maj);

      h = g;
      g = f;
      f = e;
      e = add(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add(temp1, temp2);
    }

    h0 = add(h0, a);
    h1 = add(h1, b);
    h2 = add(h2, c);
    h3 = add(h3, d);
    h4 = add(h4, e);
    h5 = add(h5, f);
    h6 = add(h6, g);
    h7 = add(h7, h);
  }

  const output = new StaticArray<u8>(32);
  const words: u32[] = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const index = i * 4;
    output[index] = <u8>((word >>> 24) & 0xff);
    output[index + 1] = <u8>((word >>> 16) & 0xff);
    output[index + 2] = <u8>((word >>> 8) & 0xff);
    output[index + 3] = <u8>(word & 0xff);
  }
  return output;
}

function padMessage(data: StaticArray<u8>): StaticArray<u8> {
  const originalLength = data.length;
  const bitLength = <u64>originalLength << 3;

  let paddingLength = 64 - ((originalLength + 9) % 64);
  if (paddingLength == 64) {
    paddingLength = 0;
  }

  const result = new StaticArray<u8>(originalLength + 9 + paddingLength);

  for (let i = 0; i < originalLength; i++) {
    result[i] = data[i];
  }
  result[originalLength] = 0x80;

  const bitLengthIndex = result.length - 8;
  for (let i = 0; i < 8; i++) {
    result[bitLengthIndex + i] = <u8>((bitLength >> ((7 - i) * 8)) & 0xff);
  }

  return result;
}

function rotr(value: u32, amount: u32): u32 {
  return (value >>> amount) | (value << (32 - amount));
}

function add(a: u32, b: u32): u32 {
  return a + b;
}

