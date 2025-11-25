import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Args,
  Mas,
  OperationStatus,
  SmartContract,
} from '@massalabs/massa-web3';
import { getAccountProvider, getContractAddress, generateSecret } from './utils.js';

interface MassaHTLCConfig {
  orderId: string;
  receiverAddress: string;
  hashlock: Buffer;
  timelock: bigint;
  amount: bigint; // in nanoMAS (1 MAS = 10^9 nanoMAS)
}

export class MassaHTLCBuilder {
  private provider: any;
  private contractAddress: string;
  private config: MassaHTLCConfig;

  constructor(config: MassaHTLCConfig) {
    this.config = config;
  }

  async initialize() {
    this.provider = await getAccountProvider();
    this.contractAddress = await getContractAddress();
  }

  async createHTLC() {
    const contract = new SmartContract(this.provider, this.contractAddress);

    const args = new Args()
      .addString(this.config.orderId)
      .addString(this.config.receiverAddress)
      .addBytes(this.config.hashlock)
      .addU64(this.config.timelock)
      .addU64(this.config.amount);

    console.log('Creating Massa HTLC...');
    const operation = await contract.call('create_htlc', args.serialize());

    console.log('HTLC creation operation id:', operation.id);
    console.log('Waiting for operation to be finalized...');

    const status = await operation.waitFinalExecution();
    console.log('Operation status:', OperationStatus[status]);

    if (status !== OperationStatus.Success) {
      throw new Error('HTLC creation failed');
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
      orderId: this.config.orderId,
      contractAddress: this.contractAddress,
      hashlock: this.config.hashlock.toString('hex'),
      timelock: this.config.timelock.toString(),
      amount: this.config.amount.toString(),
    };
  }

  async fundHTLC() {
    const contract = new SmartContract(this.provider, this.contractAddress);

    const args = new Args().addString(this.config.orderId);

    console.log('Funding Massa HTLC...');
    const operation = await contract.call(
      'fund_htlc',
      args.serialize(),
      {
        coins: Mas.fromNano(this.config.amount.toString()),
      },
    );

    console.log('HTLC funding operation id:', operation.id);
    console.log('Waiting for operation to be finalized...');

    const status = await operation.waitFinalExecution();
    console.log('Operation status:', OperationStatus[status]);

    if (status !== OperationStatus.Success) {
      throw new Error('HTLC funding failed');
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
      orderId: this.config.orderId,
      status: 'funded',
    };
  }

  static saveHTLCData(orderId: string, data: any) {
    const outputDir = path.join(__dirname, '../../orders');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.join(outputDir, `${orderId}.json`);

    // Load existing order data if it exists
    let orderData: any = {};
    if (fs.existsSync(filePath)) {
      orderData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    // Merge Massa HTLC data
    orderData = {
      ...orderData,
      massaHTLC: data,
    };

    fs.writeFileSync(filePath, JSON.stringify(orderData, null, 2));
    console.log(`Massa HTLC data saved to ${filePath}`);
  }
}

async function main() {
  const orderId = process.env.ORDER_ID || `order_${Date.now()}`;

  // Generate or load secret
  const { secret, hashlock } = generateSecret();

  const receiverAddress = process.env.MASSA_RECEIVER_ADDRESS;
  if (!receiverAddress) {
    throw new Error('MASSA_RECEIVER_ADDRESS is not set in .env file');
  }

  const timelockSeconds = parseInt(process.env.MASSA_TIMELOCK_SECONDS || '3600');
  const timelock = BigInt(Math.floor(Date.now() / 1000) + timelockSeconds);

  const amountNanoMAS = process.env.MASSA_AMOUNT_NANOMAS || '1000000000'; // 1 MAS default
  const amount = BigInt(amountNanoMAS);

  const config: MassaHTLCConfig = {
    orderId,
    receiverAddress,
    hashlock,
    timelock,
    amount,
  };

  const builder = new MassaHTLCBuilder(config);
  await builder.initialize();

  // Create HTLC
  console.log('Creating Massa HTLC...');
  const htlcResult = await builder.createHTLC();
  console.log('HTLC created:', htlcResult);

  // Fund HTLC
  console.log('Funding HTLC...');
  const fundResult = await builder.fundHTLC();
  console.log('HTLC funded:', fundResult);

  // Save data
  MassaHTLCBuilder.saveHTLCData(orderId, {
    ...htlcResult,
    secret: secret.toString('hex'),
    funded: true,
    status: 'Active',
  });
}

if (require.main === module) {
  main().catch(console.error);
}

