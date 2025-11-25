/* eslint-disable no-console */
import { Args, Mas } from '@massalabs/massa-web3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getAccountProvider } from './utils.js';

function getScByteCode(folderName: string, fileName: string): Uint8Array {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const filePath = path.join(__dirname, '..', folderName, fileName);
  const buffer = readFileSync(filePath);
  return new Uint8Array(buffer);
}

async function deployContract() {
  const provider = await getAccountProvider();

  console.log('Deploying Massa HTLC contract...');

  const byteCode = getScByteCode('build', 'main.wasm');

  // HTLC constructor doesn't take arguments, just checks initialization
  const constructorArgs = new Args();

  const contract = await provider.deploySC({
    coins: Mas.fromString('1'), // 1 MAS for deployment
    byteCode,
    parameter: constructorArgs.serialize(),
  });

  console.log('✅ Contract deployed at:', contract.address);
  console.log(
    `\nYou should add the following to your .env file:\nMASSA_HTLC_CONTRACT_ADDRESS="${contract.address}"\n`,
  );

  // Wait a bit for events to be available
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const events = await provider.getEvents({
      smartContractAddress: contract.address,
    });

    if (events.length > 0) {
      console.log('Deployment events:');
      for (const event of events) {
        console.log('  Event:', event.data);
      }
    }
  } catch (error) {
    console.log('Note: Events may not be immediately available');
  }
}

await deployContract();

