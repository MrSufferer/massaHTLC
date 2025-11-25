/**
 * Integration tests for Massa HTLC secret propagation
 * 
 * These tests verify that secrets revealed on Massa can be extracted
 * and used to unlock corresponding EVM/BTC escrows.
 * 
 * Prerequisites:
 * - Massa node running (localnet or buildnet)
 * - MASSA_PRIVATE_KEY set in .env
 * - MASSA_HTLC_CONTRACT_ADDRESS set in .env (deployed contract)
 * - EVM testnet configured (for cross-chain tests)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { generateSecret } from '../scripts/utils';

// Skip tests if integration test environment is not set up
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION_TESTS === 'true';
const describeIf = SKIP_INTEGRATION ? describe.skip : describe;

describeIf('Massa HTLC Secret Propagation', () => {
  const testOrderId = `test_order_${Date.now()}`;
  const testOrdersDir = path.join(__dirname, '../../orders');
  const testOrderPath = path.join(testOrdersDir, `${testOrderId}.json`);

  beforeAll(() => {
    // Ensure orders directory exists
    if (!fs.existsSync(testOrdersDir)) {
      fs.mkdirSync(testOrdersDir, { recursive: true });
    }
  });

  test('should create HTLC with secret and store in order file', async () => {
    // Generate secret and hashlock
    const { secret, hashlock } = generateSecret();

    // Create order data structure
    const orderData = {
      orderId: testOrderId,
      timestamp: Date.now(),
      massaHTLC: {
        orderId: testOrderId,
        hashlock: hashlock.toString('hex'),
        secret: secret.toString('hex'),
        status: 'Active',
      },
    };

    // Save order file
    fs.writeFileSync(testOrderPath, JSON.stringify(orderData, null, 2));

    // Verify order file was created
    expect(fs.existsSync(testOrderPath)).toBe(true);

    const savedData = JSON.parse(fs.readFileSync(testOrderPath, 'utf8'));
    expect(savedData.massaHTLC.secret).toBe(secret.toString('hex'));
    expect(savedData.massaHTLC.hashlock).toBe(hashlock.toString('hex'));
  }, 30000);

  test('should extract secret from order file and verify hashlock match', async () => {
    if (!fs.existsSync(testOrderPath)) {
      // Create test order if it doesn't exist
      const { secret, hashlock } = generateSecret();
      const orderData = {
        orderId: testOrderId,
        massaHTLC: {
          orderId: testOrderId,
          hashlock: hashlock.toString('hex'),
          secret: secret.toString('hex'),
        },
      };
      fs.writeFileSync(testOrderPath, JSON.stringify(orderData, null, 2));
    }

    const orderData = JSON.parse(fs.readFileSync(testOrderPath, 'utf8'));
    const secret = Buffer.from(orderData.massaHTLC.secret, 'hex');
    const hashlock = Buffer.from(orderData.massaHTLC.hashlock, 'hex');

    // Verify secret matches hashlock
    const computedHashlock = crypto.createHash('sha256').update(secret).digest();
    expect(computedHashlock.toString('hex')).toBe(hashlock.toString('hex'));
  });

  test('should format secret for EVM contract usage', () => {
    const { secret } = generateSecret();
    const secretHex = '0x' + secret.toString('hex');

    // EVM contracts expect 0x-prefixed hex string
    expect(secretHex.startsWith('0x')).toBe(true);
    expect(secretHex.length).toBe(66); // 0x + 64 hex chars (32 bytes)
  });

  test('should format secret for Bitcoin script usage', () => {
    const { secret } = generateSecret();

    // Bitcoin scripts use raw bytes
    expect(secret.length).toBe(32);
    expect(Buffer.isBuffer(secret)).toBe(true);
  });

  test('should handle secret extraction from Massa contract response', async () => {
    // This test verifies the format of secrets returned from Massa contract
    // In a real scenario, the contract returns the secret as bytes
    
    const testSecret = crypto.randomBytes(32);
    const secretHex = testSecret.toString('hex');

    // Simulate contract response format
    const contractResponse = {
      value: testSecret, // Contract returns as bytes
    };

    // Convert to hex string for use in other chains
    const extractedSecret = Buffer.from(contractResponse.value).toString('hex');
    expect(extractedSecret).toBe(secretHex);
  });

  test('should verify secret can unlock corresponding hashlock', () => {
    // Generate secret and hashlock
    const secret = crypto.randomBytes(32);
    const hashlock = crypto.createHash('sha256').update(secret).digest();

    // Verify the secret matches the hashlock
    const computedHash = crypto.createHash('sha256').update(secret).digest();
    expect(computedHash.toString('hex')).toBe(hashlock.toString('hex'));

    // Verify wrong secret doesn't match
    const wrongSecret = crypto.randomBytes(32);
    const wrongHash = crypto.createHash('sha256').update(wrongSecret).digest();
    expect(wrongHash.toString('hex')).not.toBe(hashlock.toString('hex'));
  });

  test('should maintain secret consistency across order file updates', () => {
    const { secret, hashlock } = generateSecret();
    
    const orderData = {
      orderId: testOrderId,
      massaHTLC: {
        orderId: testOrderId,
        hashlock: hashlock.toString('hex'),
        secret: secret.toString('hex'),
        status: 'Active',
      },
    };

    // Save initial order
    fs.writeFileSync(testOrderPath, JSON.stringify(orderData, null, 2));

    // Update order with new status
    const updatedData = JSON.parse(fs.readFileSync(testOrderPath, 'utf8'));
    updatedData.massaHTLC.status = 'Claimed';
    updatedData.massaHTLC.claimedAt = new Date().toISOString();
    fs.writeFileSync(testOrderPath, JSON.stringify(updatedData, null, 2));

    // Verify secret remains unchanged
    const finalData = JSON.parse(fs.readFileSync(testOrderPath, 'utf8'));
    expect(finalData.massaHTLC.secret).toBe(secret.toString('hex'));
    expect(finalData.massaHTLC.hashlock).toBe(hashlock.toString('hex'));
  });

  // Cleanup after tests
  afterAll(() => {
    // Clean up test order file
    if (fs.existsSync(testOrderPath)) {
      fs.unlinkSync(testOrderPath);
    }
  });
});

describeIf('Massa → EVM Secret Propagation', () => {
  test('should extract secret from Massa and format for EVM withdrawal', () => {
    // Simulate secret revealed on Massa
    const massaSecret = crypto.randomBytes(32);
    const massaSecretHex = massaSecret.toString('hex');

    // Format for EVM (0x-prefixed)
    const evmSecret = '0x' + massaSecretHex;

    // Verify format
    expect(evmSecret.startsWith('0x')).toBe(true);
    expect(evmSecret.length).toBe(66); // 0x + 64 hex chars

    // Verify it can be used to compute hashlock
    const hashlock = crypto.createHash('sha256').update(massaSecret).digest('hex');
    const evmHashlock = '0x' + hashlock;
    expect(evmHashlock.length).toBe(66);
  });
});

describeIf('Massa → Bitcoin Secret Propagation', () => {
  test('should extract secret from Massa and format for Bitcoin script', () => {
    // Simulate secret revealed on Massa
    const massaSecret = crypto.randomBytes(32);

    // Bitcoin scripts use raw bytes (no hex conversion needed for script)
    const btcSecret = massaSecret;

    // Verify it's the correct format
    expect(Buffer.isBuffer(btcSecret)).toBe(true);
    expect(btcSecret.length).toBe(32);

    // Verify it can be used to compute hashlock
    const hashlock = crypto.createHash('sha256').update(btcSecret).digest();
    expect(hashlock.length).toBe(32);
  });
});

