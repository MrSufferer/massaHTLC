import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Args,
  OperationStatus,
  SmartContract,
  bytesToStr,
} from '@massalabs/massa-web3';
import { getAccountProvider, getContractAddress } from './utils.js';

export class MassaHTLCClaimer {
  private provider: any;
  private contractAddress: string;

  constructor() {
    this.contractAddress = '';
  }

  async initialize() {
    this.provider = await getAccountProvider();
    this.contractAddress = await getContractAddress();
  }

  async claimWithSecret(orderId: string, secret: Buffer) {
    const contract = new SmartContract(this.provider, this.contractAddress);

    const args = new Args()
      .addString(orderId)
      .addBytes(secret);

    console.log('Claiming Massa HTLC with secret...');
    const operation = await contract.call('claim_with_secret', args.serialize());

    console.log('HTLC claim operation id:', operation.id);
    console.log('Waiting for operation to be finalized...');

    const status = await operation.waitFinalExecution();
    console.log('Operation status:', OperationStatus[status]);

    if (status !== OperationStatus.Success) {
      throw new Error('HTLC claim failed');
    }

    // Get events
    const events = await this.provider.getEvents({
      smartContractAddress: this.contractAddress,
      operationId: operation.id,
    });

    for (const event of events) {
      console.log('Event:', event.data);
    }

    // Read the returned secret
    const result = await contract.read(
      'claim_with_secret',
      args.serialize(),
    );

    return {
      orderId,
      status: 'claimed',
      revealedSecret: bytesToStr(result.value),
    };
  }

  async getRevealedSecret(orderId: string): Promise<string | null> {
    const contract = new SmartContract(this.provider, this.contractAddress);

    const args = new Args().addString(orderId);

    try {
      const result = await contract.read('get_revealed_secret', args.serialize());
      if (result.value && result.value.length > 0) {
        return bytesToStr(result.value);
      }
      return null;
    } catch (error) {
      console.error('Failed to get revealed secret:', error);
      return null;
    }
  }
}

// Maker claims Massa (reveals secret) - for EVM→Massa flow
async function makerClaimMassa() {
  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error('ORDER_ID environment variable is required');
  }

  // Load order data
  const orderPath = path.join(__dirname, '../../orders', `${orderId}.json`);
  if (!fs.existsSync(orderPath)) {
    throw new Error(`Order file not found: ${orderPath}`);
  }

  const orderData = JSON.parse(fs.readFileSync(orderPath, 'utf8'));

  if (!orderData.massaHTLC) {
    throw new Error('Massa HTLC data not found in order');
  }

  if (!orderData.massaHTLC.secret) {
    throw new Error('Secret not found in order data');
  }

  const claimer = new MassaHTLCClaimer();
  await claimer.initialize();

  console.log('Claiming Massa with secret...');
  const secret = Buffer.from(orderData.massaHTLC.secret, 'hex');
  const result = await claimer.claimWithSecret(orderId, secret);

  console.log('Massa claimed successfully!');
  console.log('Revealed secret:', result.revealedSecret);

  // Update order data
  orderData.massaHTLC.claimed = true;
  orderData.massaHTLC.claimedAt = new Date().toISOString();
  fs.writeFileSync(orderPath, JSON.stringify(orderData, null, 2));

  return result;
}

// Taker claims Massa using revealed secret - for Massa→EVM flow
async function takerClaimMassaWithRevealedSecret() {
  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error('ORDER_ID environment variable is required');
  }

  const orderPath = path.join(__dirname, '../../orders', `${orderId}.json`);
  const orderData = JSON.parse(fs.readFileSync(orderPath, 'utf8'));

  const claimer = new MassaHTLCClaimer();
  await claimer.initialize();

  // First, try to get the revealed secret from the Massa contract
  console.log('Checking for revealed secret on Massa...');
  const revealedSecret = await claimer.getRevealedSecret(orderId);

  if (!revealedSecret) {
    throw new Error('Secret not yet revealed on Massa. Maker must claim first.');
  }

  console.log('Found revealed secret:', revealedSecret);

  // Use the revealed secret to claim
  const secret = Buffer.from(revealedSecret, 'hex');
  const result = await claimer.claimWithSecret(orderId, secret);

  console.log('Massa claimed successfully using revealed secret!');

  // Update order data
  orderData.massaHTLC.takerClaimed = true;
  orderData.massaHTLC.takerClaimedAt = new Date().toISOString();
  fs.writeFileSync(orderPath, JSON.stringify(orderData, null, 2));

  return result;
}

// Determine which function to run based on command line args
if (require.main === module) {
  const action = process.argv[2];

  switch (action) {
    case 'maker-claim':
      makerClaimMassa().catch(console.error);
      break;
    case 'taker-claim':
      takerClaimMassaWithRevealedSecret().catch(console.error);
      break;
    default:
      console.error('Usage: ts-node claim-htlc.ts [maker-claim|taker-claim]');
      process.exit(1);
  }
}

