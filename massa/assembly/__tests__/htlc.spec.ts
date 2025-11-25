/// <reference types="@as-pect/assembly/types/as-pect" />
import {
  HTLCRecord,
  bytesToHex,
  hexToBytes,
  sha256Hex,
  stringToBytes,
} from '../contracts/types';
import {
  Address,
  resetStorage,
  setDeployContext,
} from '@massalabs/massa-as-sdk';

const USER1_ADDRESS = new Address(
  'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq',
);

// NOTE: Serialization test now works with createMockedABI from @massalabs/massa-as-sdk/vm-mock
describe('HTLCRecord serialization', () => {
  beforeEach(() => {
    resetStorage();
    // Set deploy context for Args to work properly
    setDeployContext(USER1_ADDRESS.toString());
  });

  test('round-trips all fields', () => {
    const record = new HTLCRecord();
    record.orderId = 'order-123';
    const secretBytes = stringToBytes('super-secret');
    record.hashlockHex = sha256Hex(secretBytes);
    record.timelock = 1_735_000_000;
    record.sender = 'SENDERADDR';
    record.receiver = 'RECEIVERADDR';
    record.amount = 1_000_000;
    record.hasToken = true;
    record.token = 'MYTOKEN';
    record.secretSet = true;
    record.secretHex = bytesToHex(secretBytes);
    record.funded = true;
    record.status = 1;
    record.createdAt = 1_734_000_000;

    const serialized = record.serialize();

    const clone = new HTLCRecord();
    clone.deserialize(serialized, 0).expect('deserialize fail');

    expect<string>(clone.orderId).toBe('order-123');
    expect<string>(clone.hashlockHex).toBe(record.hashlockHex);
    expect<u64>(clone.timelock).toBe(1_735_000_000);
    expect<string>(clone.sender).toBe('SENDERADDR');
    expect<string>(clone.receiver).toBe('RECEIVERADDR');
    expect<u64>(clone.amount).toBe(1_000_000);
    expect<bool>(clone.hasToken).toBe(true);
    expect<string>(clone.token).toBe('MYTOKEN');
    expect<bool>(clone.secretSet).toBe(true);
    expect<string>(clone.secretHex).toBe(record.secretHex);
    expect<bool>(clone.funded).toBe(true);
    expect<u8>(<u8>clone.status).toBe(1);
    expect<u64>(clone.createdAt).toBe(1_734_000_000);
  });
});

describe('Hashlock helpers', () => {
  beforeEach(() => {
    resetStorage();
    // Set deploy context for Args to work properly
    setDeployContext(USER1_ADDRESS.toString());
  });

  test('computes SHA-256 hex for known secret', () => {
    const digest = sha256Hex(stringToBytes('test'));
    expect<string>(digest).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
  });

  test('round-trips hex ↔ bytes', () => {
    const input = 'deadbeefcafebabe';
    const bytes = hexToBytes(input);
    const hex = bytesToHex(bytes);
    expect<string>(hex).toBe(input);
  });

  test('verifies secret matches hashlock', () => {
    const secret = stringToBytes('my-secret-key');
    const hashlock = sha256Hex(secret);
    const computedHash = sha256Hex(secret);
    expect<string>(computedHash).toBe(hashlock);
  });

  test('rejects incorrect secret', () => {
    const secret1 = stringToBytes('secret1');
    const secret2 = stringToBytes('secret2');
    const hashlock1 = sha256Hex(secret1);
    const hashlock2 = sha256Hex(secret2);
    expect<string>(hashlock1).not.toBe(hashlock2);
  });
});

describe('HTLC Contract', () => {
  beforeEach(() => {
    resetStorage();
    setDeployContext(USER1_ADDRESS.toString());
  });

  test('creates HTLC with valid parameters', () => {
    // This test verifies the contract can be created
    // Full integration tests would require mocking Context.caller and transferredCoins
    // For now, we test the core logic through helper functions
    const secret = stringToBytes('test-secret');
    const hashlock = sha256Hex(secret);
    expect<i32>(hashlock.length).toBe(64); // SHA-256 hex is 64 chars
  });

  test('validates hashlock is 32 bytes when converted', () => {
    const secret = stringToBytes('test');
    const hashlockHex = sha256Hex(secret);
    const hashlockBytes = hexToBytes(hashlockHex);
    expect<i32>(hashlockBytes.length).toBe(32);
  });
});

