import { Args } from '@massalabs/as-types';
import {
  stringToBytes,
} from '@massalabs/as-types/assembly/serialization/strings';
import {
  Address,
  Storage,
  Context,
  transferCoins,
  generateEvent,
} from '@massalabs/massa-as-sdk';
import {
  HTLCRecord,
  HTLCStatus,
  bytesToHex,
  hexToBytes,
  sha256Hex,
} from './types';

const HTLC_PREFIX = 'htlc:';
const SENDER_INDEX_PREFIX = 'htlc:sender:';
const RECEIVER_INDEX_PREFIX = 'htlc:receiver:';

export function constructor(_: StaticArray<u8>): void {
  if (!Context.isDeployingContract()) {
    return;
  }
}

export function create_htlc(binArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binArgs);
  const orderId = args.nextString().expect('orderId is required');
  assert(orderId.length > 0, 'orderId must not be empty');
  assert(!Storage.has(orderKey(orderId)), 'HTLC already exists');

  const receiverStr = args.nextString().expect('receiver is required');
  const receiver = new Address(receiverStr);

  const hashlockBytes = args.nextBytes().expect('hashlock is required');
  assert(hashlockBytes.length == 32, 'Hashlock must be 32 bytes');
  const hashlockHex = bytesToHex(hashlockBytes);

  const timelock = args.nextU64().expect('timelock is required');
  const amount = args.nextU64().expect('amount is required');

  let token: string = '';
  let hasToken = false;
  if (args.offset < binArgs.length) {
    token = args.nextString().expect('token decode failure');
    hasToken = token.length > 0;
  }

  const nowSeconds = timestampSeconds();
  assert(timelock > nowSeconds, 'Timelock must be in the future');
  assert(amount > 0, 'Amount must be greater than zero');

  const sender = Context.caller();
  const record = new HTLCRecord();
  record.orderId = orderId;
  record.hashlockHex = hashlockHex;
  record.timelock = timelock;
  record.sender = sender.toString();
  record.receiver = receiver.toString();
  record.amount = amount;
  record.hasToken = hasToken;
  record.token = token;
  record.createdAt = nowSeconds;

  saveRecord(record);
  trackOrderForAddress(SENDER_INDEX_PREFIX, record.sender, orderId);
  trackOrderForAddress(RECEIVER_INDEX_PREFIX, record.receiver, orderId);
  emitEvent('HTLC_CREATED', orderId);

  const out = new Args();
  out.add(orderId);
  return out.serialize();
}

export function fund_htlc(binArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binArgs);
  const orderId = args.nextString().expect('orderId is required');
  const record = loadRecord(orderId);

  const callerAddress = Context.caller().toString();
  assert(
    callerAddress == record.sender,
    'Only the sender can fund the HTLC',
  );
  assert(!record.funded, 'HTLC already funded');

  const transferred = Context.transferredCoins();
  assert(
    transferred == record.amount,
    'Transferred coins must match the HTLC amount',
  );

  record.funded = true;
  saveRecord(record);
  emitEvent('HTLC_FUNDED', orderId);

  const out = new Args();
  out.add(orderId);
  return out.serialize();
}

export function claim_with_secret(binArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binArgs);
  const orderId = args.nextString().expect('orderId is required');
  const secret = args.nextBytes().expect('secret is required');

  const record = loadRecord(orderId);
  const callerAddress = Context.caller().toString();
  assert(
    callerAddress == record.receiver,
    'Only the receiver can claim the HTLC',
  );
  assert(record.funded, 'HTLC is not funded');
  assert(record.status == HTLCStatus.Active, 'HTLC is not active');
  assert(
    timestampSeconds() < record.timelock,
    'HTLC has expired and cannot be claimed',
  );

  const computedHash = sha256Hex(secret);
  assert(
    computedHash == record.hashlockHex,
    'Secret does not match hashlock',
  );

  record.status = HTLCStatus.Withdrawn;
  record.secretHex = bytesToHex(secret);
  record.secretSet = true;
  saveRecord(record);

  transferCoins(new Address(record.receiver), record.amount);
  emitEvent('HTLC_CLAIMED', orderId);

  const out = new Args();
  out.add(secret);
  return out.serialize();
}

export function refund_htlc(binArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binArgs);
  const orderId = args.nextString().expect('orderId is required');
  const record = loadRecord(orderId);

  const callerAddress = Context.caller().toString();
  assert(
    callerAddress == record.sender,
    'Only the sender can refund the HTLC',
  );
  assert(record.funded, 'HTLC is not funded');
  assert(record.status == HTLCStatus.Active, 'HTLC is not active');
  assert(
    timestampSeconds() >= record.timelock,
    'Timelock has not expired yet',
  );

  record.status = HTLCStatus.Refunded;
  saveRecord(record);

  transferCoins(new Address(record.sender), record.amount);
  emitEvent('HTLC_REFUNDED', orderId);

  const out = new Args();
  out.add(orderId);
  return out.serialize();
}

export function get_htlc(binArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binArgs);
  const orderId = args.nextString().expect('orderId is required');
  const record = loadRecord(orderId);

  const out = new Args();
  out.add(record);
  return out.serialize();
}

export function get_revealed_secret(
  binArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binArgs);
  const orderId = args.nextString().expect('orderId is required');
  const record = loadRecord(orderId);
  assert(record.secretSet, 'Secret not revealed');
  return hexToBytes(record.secretHex);
}

export function list_user_htlcs(binArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binArgs);
  const target = args.nextString().expect('address is required');

  const orderIds = new Array<string>();
  appendUnique(orderIds, readIndex(SENDER_INDEX_PREFIX + target));
  appendUnique(orderIds, readIndex(RECEIVER_INDEX_PREFIX + target));

  const records = new Array<HTLCRecord>();
  for (let i = 0; i < orderIds.length; i++) {
    const orderId = orderIds[i];
    if (Storage.has(orderKey(orderId))) {
      records.push(loadRecord(orderId));
    }
  }

  const out = new Args();
  out.addSerializableObjectArray(records);
  return out.serialize();
}

function orderKey(orderId: string): StaticArray<u8> {
  return stringToBytes(HTLC_PREFIX + orderId);
}

function saveRecord(record: HTLCRecord): void {
  Storage.set(orderKey(record.orderId), record.serialize());
}

function loadRecord(orderId: string): HTLCRecord {
  assert(Storage.has(orderKey(orderId)), 'HTLC not found');
  const data = Storage.get(orderKey(orderId));
  const record = new HTLCRecord();
  record.deserialize(data, 0).expect('failed to deserialize HTLC');
  return record;
}

function timestampSeconds(): u64 {
  return Context.timestamp() / 1000;
}

function emitEvent(event: string, orderId: string): void {
  generateEvent(`{ "event": "${event}", "orderId": "${orderId}" }`);
}

function trackOrderForAddress(
  prefix: string,
  address: string,
  orderId: string,
): void {
  const key = stringToBytes(prefix + address);
  const existing = readIndex(prefix + address);
  if (!arrayIncludes(existing, orderId)) {
    existing.push(orderId);
    const args = new Args();
    args.add(existing);
    Storage.set(key, args.serialize());
  }
}

function readIndex(key: string): Array<string> {
  const storageKey = stringToBytes(key);
  if (!Storage.has(storageKey)) {
    return new Array<string>();
  }
  const data = Storage.get(storageKey);
  if (data.length == 0) {
    return new Array<string>();
  }
  const args = new Args(data);
  return args.nextStringArray().expect('index decode failure');
}

function arrayIncludes(collection: Array<string>, target: string): bool {
  for (let i = 0; i < collection.length; i++) {
    if (collection[i] == target) {
      return true;
    }
  }
  return false;
}

function appendUnique(target: Array<string>, values: Array<string>): void {
  for (let i = 0; i < values.length; i++) {
    const id = values[i];
    if (!arrayIncludes(target, id)) {
      target.push(id);
    }
  }
}

function toUint8Array(data: StaticArray<u8>): Uint8Array {
  const output = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    output[i] = data[i];
  }
  return output;
}

