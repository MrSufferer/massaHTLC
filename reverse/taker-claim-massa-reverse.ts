import { ethers } from "hardhat";
import * as fs from 'fs';
import * as path from 'path';
import { MassaHTLCClaimer } from '../evm/scripts/massa-client';

interface ReverseAtomicSwapOrder {
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
  };
  transactions?: {
    evmEscrowClaim?: string;
  };
  status: string;
}

async function main() {
  console.log("🔄 TAKER: CLAIMING MASSA (USING REVEALED SECRET - REVERSE FLOW)");
  console.log("===============================================================");
  console.log("💡 TAKER: Extracting secret from EVM and using it to claim MASSA!");

  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error("ORDER_ID environment variable required");
  }

  const orderPath = path.join(__dirname, "../orders", `${orderId}.json`);

  if (!fs.existsSync(orderPath)) {
    throw new Error(`Order file not found: ${orderPath}`);
  }

  const order: ReverseAtomicSwapOrder = JSON.parse(fs.readFileSync(orderPath, "utf8"));

  if (!order.massaHTLC) {
    throw new Error("Massa HTLC not found in order");
  }

  if (!order.evmEscrow) {
    throw new Error("EVM escrow not found. Taker must create escrow first.");
  }

  if (!order.transactions?.evmEscrowClaim) {
    throw new Error("EVM escrow not yet claimed. Maker must claim ETH first to reveal secret.");
  }

  // Extract revealed secret from order (maker revealed it when claiming ETH)
  let revealedSecret: string | null = null;

  if (order.massaHTLC.revealedSecret) {
    revealedSecret = order.massaHTLC.revealedSecret;
    console.log("✅ Found revealed secret in order file");
  } else if (order.massaHTLC.secret) {
    revealedSecret = order.massaHTLC.secret;
    console.log("✅ Found secret in order file");
  } else {
    // Secret should be in order.secret (maker revealed it)
    revealedSecret = order.secret;
    console.log("✅ Using secret from order");
  }

  if (!revealedSecret) {
    throw new Error("Secret not found. Maker must claim ETH first to reveal secret.");
  }

  console.log("\n🔐 EXTRACTED SECRET:");
  console.log("====================");
  console.log("🔑 Secret:", revealedSecret);
  console.log("🔒 Hashlock:", order.hashlock);

  // Verify secret matches hashlock
  const secretHex = revealedSecret.startsWith('0x') ? revealedSecret : '0x' + revealedSecret;
  const computedHashlock = ethers.sha256(secretHex);
  if (computedHashlock.toLowerCase() !== order.hashlock.toLowerCase()) {
    throw new Error("Secret does not match hashlock!");
  }
  console.log("✅ Hashlock verified");

  // Claim Massa HTLC with secret
  console.log("\n🟣 CLAIMING MASSA HTLC:");
  console.log("=======================");

  const claimer = new MassaHTLCClaimer();
  await claimer.initialize();

  const secretBytes = Buffer.from(secretHex.slice(2), 'hex'); // Remove 0x prefix
  console.log("Claiming Massa HTLC with secret...");
  const result = await claimer.claimWithSecret(orderId, secretBytes);
  const persistedSecret =
    result.revealedSecret && result.revealedSecret !== "0x"
      ? result.revealedSecret
      : secretHex;

  console.log("\n✅ MASSA CLAIMED SUCCESSFULLY!");
  console.log("==============================");
  console.log("🟣 Revealed secret:", persistedSecret);
  console.log("📄 Order ID:", result.orderId);

  // Update order
  order.status = "COMPLETED";
  if (order.massaHTLC) {
    order.massaHTLC.revealedSecret = persistedSecret;
  }

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n🎉 ATOMIC SWAP COMPLETED!");
  console.log("========================");
  console.log("✅ Taker received MASSA from Massa HTLC");
  console.log("✅ Maker received ETH from EVM escrow");
  console.log("✅ Secret was revealed and used successfully");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

