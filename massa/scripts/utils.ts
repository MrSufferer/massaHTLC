import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Account, Web3Provider } from '@massalabs/massa-web3';
import * as crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

export async function getContractAddress(): Promise<string> {
  const contractAddress = process.env.MASSA_HTLC_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error('MASSA_HTLC_CONTRACT_ADDRESS is not set in .env file');
  }
  return contractAddress;
}

export async function getAccountProvider(): Promise<Web3Provider> {
  const account = await Account.fromEnv('MASSA_PRIVATE_KEY').catch((error: any) => {
    console.log('Error getting account:', error);
    throw new Error('MASSA_PRIVATE_KEY is not set in .env file');
  });

  let provider: Web3Provider;
  if (process.env.MASSA_JSON_RPC_URL) {
    const rpcUrl = process.env.MASSA_JSON_RPC_URL;
    provider = Web3Provider.fromRPCUrl(rpcUrl, account);
  } else if (process.env.MASSA_NETWORK === 'buildnet' || !process.env.MASSA_JSON_RPC_URL) {
    provider = Web3Provider.buildnet(account);
  } else {
    provider = Web3Provider.fromRPCUrl('http://127.0.0.1:33035', account);
  }
  return provider;
}

export function generateSecret(): { secret: Buffer; hashlock: Buffer } {
  const secret = crypto.randomBytes(32);
  const hashlock = crypto.createHash('sha256').update(secret).digest();
  return { secret, hashlock };
}

