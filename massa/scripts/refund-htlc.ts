import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Args,
  OperationStatus,
  SmartContract,
} from '@massalabs/massa-web3';
import { getAccountProvider, getContractAddress } from './utils.js';

export class MassaHTLCRefunder {
  private provider: any;
  private contractAddress: string;

  async initialize() {
    this.provider = await getAccountProvider();
    this.contractAddress = await getContractAddress();
  }

  async refundHTLC(orderId: string) {
    const contract = new SmartContract(this.provider, this.contractAddress);

    const args = new Args().addString(orderId);

    console.log('Refunding Massa HTLC...');
    const operation = await contract.call('refund_htlc', args.serialize());

    console.log('HTLC refund operation id:', operation.id);
    console.log('Waiting for operation to be finalized...');

    const status = await operation.waitFinalExecution();
    console.log('Operation status:', OperationStatus[status]);

    if (status !== OperationStatus.Success) {
      throw new Error('HTLC refund failed');
    }

    // Get events
    const events = await this.provider.getEvents({
      smartContractAddress: this.contractAddress,
      operationId: operation.id,
    });

    for (const event of events) {
      console.log('Event:', event.data);
    }

    return {
      orderId,
      status: 'refunded',
    };
  }
}

async function refundMassa() {
  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error('ORDER_ID environment variable is required');
  }

  const orderPath = path.join(__dirname, '../../orders', `${orderId}.json`);
  if (!fs.existsSync(orderPath)) {
    throw new Error(`Order file not found: ${orderPath}`);
  }

  const orderData = JSON.parse(fs.readFileSync(orderPath, 'utf8'));

  if (!orderData.massaHTLC) {
    throw new Error('Massa HTLC data not found in order');
  }

  const refunder = new MassaHTLCRefunder();
  await refunder.initialize();

  console.log('Attempting to refund Massa HTLC...');
  const result = await refunder.refundHTLC(orderId);

  console.log('Massa refunded successfully!');

  // Update order data
  orderData.massaHTLC.refunded = true;
  orderData.massaHTLC.refundedAt = new Date().toISOString();
  orderData.massaHTLC.status = 'Refunded';
  fs.writeFileSync(orderPath, JSON.stringify(orderData, null, 2));

  return result;
}

if (require.main === module) {
  refundMassa().catch(console.error);
}

