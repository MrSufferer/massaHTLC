import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Args,
  SmartContract,
  bytesToStr,
} from '@massalabs/massa-web3';
import { getAccountProvider, getContractAddress } from './utils.js';

export class MassaHTLCMonitor {
  private provider: any;
  private contractAddress: string;

  async initialize() {
    this.provider = await getAccountProvider();
    this.contractAddress = await getContractAddress();
  }

  async getHTLC(orderId: string): Promise<any> {
    const contract = new SmartContract(this.provider, this.contractAddress);

    const args = new Args().addString(orderId);

    try {
      const result = await contract.read('get_htlc', args.serialize());
      
      // The result contains serialized HTLCRecord
      // We need to deserialize it - for now, return the raw bytes
      // In a real implementation, you'd deserialize the Args
      return result.value;
    } catch (error) {
      console.error('Failed to get HTLC:', error);
      throw error;
    }
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

  async listUserHTLCs(address: string): Promise<any> {
    const contract = new SmartContract(this.provider, this.contractAddress);

    const args = new Args().addString(address);

    try {
      const result = await contract.read('list_user_htlcs', args.serialize());
      return result.value;
    } catch (error) {
      console.error('Failed to list user HTLCs:', error);
      throw error;
    }
  }
}

async function monitorHTLC() {
  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error('ORDER_ID environment variable is required');
  }

  const monitor = new MassaHTLCMonitor();
  await monitor.initialize();

  console.log(`Monitoring HTLC: ${orderId}`);

  // Check for revealed secret
  const secret = await monitor.getRevealedSecret(orderId);
  if (secret) {
    console.log('Secret revealed:', secret);
    
    // Update order file if it exists
    const orderPath = path.join(__dirname, '../../orders', `${orderId}.json`);
    if (fs.existsSync(orderPath)) {
      const orderData = JSON.parse(fs.readFileSync(orderPath, 'utf8'));
      if (orderData.massaHTLC) {
        orderData.massaHTLC.revealedSecret = secret;
        orderData.massaHTLC.secretRevealedAt = new Date().toISOString();
        fs.writeFileSync(orderPath, JSON.stringify(orderData, null, 2));
        console.log('Order file updated with revealed secret');
      }
    }
  } else {
    console.log('Secret not yet revealed');
  }
}

async function checkSecret() {
  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error('ORDER_ID environment variable is required');
  }

  const monitor = new MassaHTLCMonitor();
  await monitor.initialize();

  const secret = await monitor.getRevealedSecret(orderId);
  if (secret) {
    console.log('Secret:', secret);
    return secret;
  } else {
    console.log('Secret not yet revealed');
    return null;
  }
}

if (require.main === module) {
  const action = process.argv[2];

  switch (action) {
    case 'monitor':
      monitorHTLC().catch(console.error);
      break;
    case 'check-secret':
      checkSecret().catch(console.error);
      break;
    default:
      console.error('Usage: ts-node monitor-htlc.ts [monitor|check-secret]');
      process.exit(1);
  }
}

