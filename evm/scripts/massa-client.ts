import * as dotenv from 'dotenv';
import {
  Account,
  Args,
  Mas,
  OperationStatus,
  SmartContract,
  Web3Provider,
} from '@massalabs/massa-web3';

dotenv.config();

const MASSA_EXPLORER_BASE = 'https://buildnet-explorer.massa.net/#explorer?explore=';

function logMassaExplorer(operationId: string) {
  console.log('🔗 Massa explorer:', `${MASSA_EXPLORER_BASE}${operationId}`);
}

export interface MassaHTLCConfig {
  orderId: string;
  receiverAddress: string;
  hashlock: Buffer;
  timelock: bigint;
  amount: bigint;
}

export async function getMassaContractAddress(): Promise<string> {
  const address = process.env.MASSA_HTLC_CONTRACT_ADDRESS;
  if (!address) {
    throw new Error('MASSA_HTLC_CONTRACT_ADDRESS is not set in .env file');
  }
  return address;
}

export async function getMassaProvider(): Promise<Web3Provider> {
  const account = await Account.fromEnv('MASSA_PRIVATE_KEY').catch(() => {
    throw new Error('MASSA_PRIVATE_KEY is not set in .env file');
  });

  if (process.env.MASSA_JSON_RPC_URL) {
    return Web3Provider.fromRPCUrl(process.env.MASSA_JSON_RPC_URL, account);
  }

  if (!process.env.MASSA_NETWORK || process.env.MASSA_NETWORK === 'buildnet') {
    return Web3Provider.buildnet(account);
  }

  return Web3Provider.fromRPCUrl('http://127.0.0.1:33035', account);
}

export class MassaHTLCBuilder {
  private provider: Web3Provider | null = null;
  private contractAddress: string | null = null;

  constructor(private readonly config: MassaHTLCConfig) {}

  async initialize() {
    this.provider = await getMassaProvider();
    this.contractAddress = await getMassaContractAddress();
  }

  private getContract() {
    if (!this.provider || !this.contractAddress) {
      throw new Error('Massa HTLC builder not initialized');
    }
    return new SmartContract(this.provider, this.contractAddress);
  }

  async createHTLC() {
    const contract = this.getContract();
    const args = new Args();
    args.addString(this.config.orderId);
    args.addString(this.config.receiverAddress);
    args.addUint8Array(this.config.hashlock);
    args.addU64(this.config.timelock);
    args.addU64(this.config.amount);

    const operation = await contract.call('create_htlc', args.serialize());
    console.log('HTLC creation operation id:', operation.id);
    logMassaExplorer(operation.id);
    const status = await operation.waitFinalExecution();
    console.log('Operation status:', OperationStatus[status]);

    if (status !== OperationStatus.Success) {
      throw new Error('HTLC creation failed');
    }

    const events = await this.provider!.getEvents({
      smartContractAddress: this.contractAddress!,
      operationId: operation.id,
    });

    for (const event of events) {
      console.log('Event:', event.data);
    }

    return {
      orderId: this.config.orderId,
      contractAddress: this.contractAddress!,
      hashlock: this.config.hashlock.toString('hex'),
      timelock: this.config.timelock.toString(),
      amount: this.config.amount.toString(),
    };
  }

  async fundHTLC() {
    const contract = this.getContract();
    const args = new Args();
    args.addString(this.config.orderId);

    const operation = await contract.call('fund_htlc', args.serialize(), {
      coins: Mas.fromNanoMas(this.config.amount),
    });
    console.log('HTLC funding operation id:', operation.id);
    logMassaExplorer(operation.id);
    const status = await operation.waitFinalExecution();
    console.log('Operation status:', OperationStatus[status]);

    if (status !== OperationStatus.Success) {
      throw new Error('HTLC funding failed');
    }

    const events = await this.provider!.getEvents({
      smartContractAddress: this.contractAddress!,
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
}

export class MassaHTLCClaimer {
  private provider: Web3Provider | null = null;
  private contractAddress: string | null = null;

  async initialize() {
    this.provider = await getMassaProvider();
    this.contractAddress = await getMassaContractAddress();
  }

  private getContract() {
    if (!this.provider || !this.contractAddress) {
      throw new Error('Massa HTLC claimer not initialized');
    }
    return new SmartContract(this.provider, this.contractAddress);
  }

  async claimWithSecret(orderId: string, secret: Buffer) {
    const contract = this.getContract();
    const args = new Args();
    args.addString(orderId);
    args.addUint8Array(secret);

    const operation = await contract.call('claim_with_secret', args.serialize());
    console.log('HTLC claim operation id:', operation.id);
    logMassaExplorer(operation.id);
    const status = await operation.waitFinalExecution();
    console.log('Operation status:', OperationStatus[status]);

    if (status !== OperationStatus.Success) {
      throw new Error('HTLC claim failed');
    }

    const events = await this.provider!.getEvents({
      smartContractAddress: this.contractAddress!,
      operationId: operation.id,
    });

    for (const event of events) {
      console.log('Event:', event.data);
    }

    const result = await contract.read('claim_with_secret', args.serialize());
    const revealedSecret = `0x${Buffer.from(result.value).toString('hex')}`;

    return {
      orderId,
      status: 'claimed',
      revealedSecret,
    };
  }

  async getRevealedSecret(orderId: string): Promise<string | null> {
    const contract = this.getContract();
    const args = new Args();
    args.addString(orderId);

    try {
      const result = await contract.read('get_revealed_secret', args.serialize());
      if (result.value && result.value.length > 0) {
        return `0x${Buffer.from(result.value).toString('hex')}`;
      }
      return null;
    } catch (error) {
      console.error('Failed to get revealed secret:', error);
      return null;
    }
  }
}

