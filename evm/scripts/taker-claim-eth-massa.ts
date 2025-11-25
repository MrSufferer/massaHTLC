import { ethers } from "hardhat";
import { BTCEscrowSrc__factory, BTCEscrowFactory__factory } from "../typechain-types";
import * as fs from 'fs';
import * as path from 'path';
import { MassaHTLCClaimer } from './massa-client';

interface AtomicSwapOrder {
  orderId: string;
  secret: string;
  hashlock: string;
  massaHTLC?: {
    orderId: string;
    contractAddress: string;
    secret?: string;
    revealedSecret?: string;
  };
  evmEscrow?: {
    address: string;
    txHash?: string;
    immutables?: any;
  };
  transactions?: {
    evmEscrowCreation?: string;
    evmEscrowClaim?: string;
  };
  status: string;
}

async function loadImmutables(order: AtomicSwapOrder) {
  if (order.evmEscrow?.immutables) {
    return order.evmEscrow.immutables;
  }

  const creationTxHash = order.transactions?.evmEscrowCreation || order.evmEscrow?.txHash;
  if (!creationTxHash) {
    throw new Error("Missing escrow creation transaction hash");
  }

  const tx = await ethers.provider.getTransaction(creationTxHash);
  if (!tx) {
    throw new Error(`Unable to load creation transaction ${creationTxHash}`);
  }

  const receipt = await ethers.provider.getTransactionReceipt(creationTxHash);
  if (!receipt) {
    throw new Error(`Unable to load receipt for ${creationTxHash}`);
  }

  const block = await ethers.provider.getBlock(receipt.blockNumber);
  if (!block) {
    throw new Error(`Unable to load block ${receipt.blockNumber}`);
  }

  const iface = BTCEscrowFactory__factory.createInterface();
  const decoded = iface.decodeFunctionData("createSrcEscrow", tx.data);
  const [immutables] = decoded;

  const originalTimelocks = BigInt(immutables.timelocks.toString());
  const lowerMask = (1n << 224n) - 1n;
  const lowerBits = originalTimelocks & lowerMask;
  const deployedAt = BigInt(block.timestamp);
  const patchedTimelocks = (deployedAt << 224n) | lowerBits;

  return {
    orderHash: immutables.orderHash,
    hashlock: immutables.hashlock,
    maker: immutables.maker,
    taker: immutables.taker,
    token: immutables.token,
    amount: immutables.amount,
    safetyDeposit: immutables.safetyDeposit,
    timelocks: patchedTimelocks,
  };
}

async function main() {
  console.log("🎯 TAKER: CLAIMING ETH (USING SECRET FROM MASSA)");
  console.log("==================================================");
  console.log("💡 TAKER: Extracting secret from Massa and using it to claim ETH!");

  const orderId = process.env.ORDER_ID || process.argv[2];
  if (!orderId) {
    throw new Error("ORDER_ID environment variable or argument is required");
  }

  console.log("📄 Order ID:", orderId);

  const ordersDir = path.join(__dirname, '..', '..', 'orders');
  const orderPath = path.join(ordersDir, `${orderId}.json`);
  
  if (!fs.existsSync(orderPath)) {
    throw new Error(`Order not found: ${orderPath}`);
  }
  
  const order: AtomicSwapOrder = JSON.parse(fs.readFileSync(orderPath, 'utf8'));

  if (!order.evmEscrow) {
    throw new Error("EVM escrow not found. Maker must create escrow first.");
  }

  if (!order.massaHTLC) {
    throw new Error("Massa HTLC not found. Taker must fill order first.");
  }

  console.log("\n🟣 EXTRACTING SECRET FROM MASSA:");
  console.log("=================================");
  
  const claimer = new MassaHTLCClaimer();
  await claimer.initialize();

  let revealedSecret: string | null = null;
  
  if (order.massaHTLC.revealedSecret) {
    revealedSecret = order.massaHTLC.revealedSecret;
    console.log("✅ Found revealed secret in order file");
  } else {
    console.log("Checking Massa contract for revealed secret...");
    revealedSecret = await claimer.getRevealedSecret(orderId);
    
    if (!revealedSecret) {
      throw new Error("Secret not yet revealed on Massa. Maker must claim Massa HTLC first.");
    }
    
    if (order.massaHTLC) {
      order.massaHTLC.revealedSecret = revealedSecret;
    }
    fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));
    console.log("✅ Extracted secret from Massa contract");
  }

  console.log("🔑 Revealed secret:", revealedSecret);

  const secretHex = revealedSecret.startsWith('0x') ? revealedSecret : '0x' + revealedSecret;
  const secretBytes = ethers.getBytes(secretHex);

  console.log("\n🔵 CLAIMING ETH FROM EVM ESCROW:");
  console.log("================================");
  console.log("📄 Escrow address:", order.evmEscrow.address);
  console.log("🔗 Escrow on Etherscan:", `https://sepolia.etherscan.io/address/${order.evmEscrow.address}`);
  console.log("🔑 Using secret:", secretHex);

  const [taker] = await ethers.getSigners();
  console.log("👤 TAKER:", taker.address);

  const escrow = BTCEscrowSrc__factory.connect(order.evmEscrow.address, taker);

  const computedHashlock = ethers.sha256(secretHex);
  if (computedHashlock.toLowerCase() !== order.hashlock.toLowerCase()) {
    throw new Error("Secret does not match hashlock!");
  }

  console.log("✅ Hashlock verified");

  const immutables = await loadImmutables(order);

  console.log("\nClaiming ETH from escrow...");
  const tx = await escrow.withdraw(secretBytes, immutables, {
    gasLimit: 500000,
  });

  console.log("⏳ Transaction sent:", tx.hash);
  console.log("🔗 View tx:", `https://sepolia.etherscan.io/tx/${tx.hash}`);
  console.log("⏳ Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log("✅ Transaction confirmed!");

  order.status = "COMPLETED";
  if (!order.transactions) {
    order.transactions = {};
  }
  order.transactions.evmEscrowClaim = receipt!.hash;

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n✅ ETH CLAIMED SUCCESSFULLY!");
  console.log("============================");
  console.log("📄 Transaction hash:", receipt!.hash);
  console.log("🔗 Etherscan:", `https://sepolia.etherscan.io/tx/${receipt!.hash}`);
  console.log("💰 Taker received ETH from escrow");
  console.log("🎉 Atomic swap completed!");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

