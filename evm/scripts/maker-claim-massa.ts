import { ethers } from "hardhat";
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
  };
}

async function main() {
  console.log("🟣 MAKER CLAIMS MASSA (REVEALS SECRET)");
  console.log("=======================================");

  const orderId = process.env.ORDER_ID || process.argv[2];
  if (!orderId) {
    throw new Error("ORDER_ID environment variable or argument is required");
  }

  console.log("📄 Order ID:", orderId);

  const ordersDir = path.join(__dirname, "../../orders");
  const orderPath = path.join(ordersDir, `${orderId}.json`);
  
  if (!fs.existsSync(orderPath)) {
    throw new Error(`Order file not found: ${orderPath}`);
  }

  const order: AtomicSwapOrder = JSON.parse(fs.readFileSync(orderPath, 'utf8'));

  if (!order.massaHTLC) {
    throw new Error("Massa HTLC not found in order. Taker must fill order first.");
  }

  if (!order.secret) {
    throw new Error("Secret not found in order");
  }

  console.log("\n🔐 CLAIMING WITH SECRET:");
  console.log("========================");
  console.log("🔑 Secret:", order.secret);
  console.log("🔒 Hashlock:", order.hashlock);

  const claimer = new MassaHTLCClaimer();
  await claimer.initialize();

  const secretBytes = Buffer.from(order.secret.slice(2), 'hex');
  console.log("\nClaiming Massa HTLC...");
  let result;
  try {
    result = await claimer.claimWithSecret(orderId, secretBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const alreadyClaimed = message.includes("HTLC is not active");
    if (!alreadyClaimed) {
      throw error;
    }
    console.log("⚠️ Massa HTLC already claimed, fetching revealed secret...");
    const revealedSecret = await claimer.getRevealedSecret(orderId);
    if (!revealedSecret) {
      throw error;
    }
    result = {
      orderId,
      status: 'claimed',
      revealedSecret,
    };
  }

  console.log("\n✅ MASSA CLAIMED SUCCESSFULLY!");
  console.log("==============================");
  console.log("🟣 Revealed secret:", result.revealedSecret);
  console.log("📄 Order ID:", result.orderId);

  if (order.massaHTLC) {
    order.massaHTLC.secret = result.revealedSecret;
  }

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n🎯 NEXT STEP:");
  console.log("=============");
  console.log("🔵 TAKER claims ETH using revealed secret:");
  console.log("   ORDER_ID=" + orderId + " npm run taker:claim-eth-massa");
  console.log("\n💡 The secret is now public on Massa blockchain!");
  console.log("💡 Taker can extract it and use it to claim ETH from EVM escrow");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

