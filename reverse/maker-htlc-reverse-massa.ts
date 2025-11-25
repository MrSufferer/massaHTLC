import * as fs from 'fs';
import * as path from 'path';
import { MassaHTLCBuilder } from '../evm/scripts/massa-client';

interface ReverseAtomicSwapOrder {
  orderId: string;
  secret: string;
  hashlock: string;
  maker: {
    massaAddress: string;
    provides: {
      asset: "MASSA";
      amount: string;
    };
  };
  massaHTLC?: {
    orderId: string;
    contractAddress: string;
    hashlock: string;
    timelock: string;
    amount: string;
    secret: string;
    funded: boolean;
    status: string;
  };
  status: string;
}

async function main() {
  console.log("🔄 MAKER: CREATING MASSA HTLC (REVERSE FLOW)");
  console.log("=============================================");
  console.log("💡 MAKER: Creating Massa HTLC with MASSA for MASSA→ETH swap");

  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error("ORDER_ID environment variable required");
  }

  const orderPath = path.join(__dirname, "../orders", `${orderId}.json`);

  if (!fs.existsSync(orderPath)) {
    throw new Error(`Order file not found: ${orderPath}`);
  }

  const order: ReverseAtomicSwapOrder = JSON.parse(fs.readFileSync(orderPath, "utf8"));

  console.log("📄 Loaded order:", orderId);

  if (order.status !== "CREATED") {
    throw new Error(`Order status is ${order.status}, expected CREATED`);
  }

  // Get taker's Massa address (taker will receive MASSA)
  const takerMassaAddress = process.env.MASSA_RECEIVER_ADDRESS;
  if (!takerMassaAddress) {
    throw new Error("MASSA_RECEIVER_ADDRESS must be set in .env file (for taker)");
  }

  console.log("\n🟣 CREATING MASSA HTLC:");
  console.log("=======================");
  console.log("👤 Maker Massa Address:", order.maker.massaAddress);
  console.log("👤 Taker Massa Address:", takerMassaAddress);
  console.log("🪙 Amount:", (BigInt(order.maker.provides.amount) / BigInt(1e9)).toString(), "MASSA");
  console.log("🔒 Hashlock:", order.hashlock);

  // Create Massa HTLC using the hashlock from order
  const hashlockBytes = Buffer.from(order.hashlock.slice(2), 'hex'); // Remove 0x prefix
  const timelockSeconds = parseInt(process.env.MASSA_TIMELOCK_SECONDS || '3600');
  const timelock = BigInt(Math.floor(Date.now() / 1000) + timelockSeconds);
  const amount = BigInt(order.maker.provides.amount);

  const massaHTLCConfig = {
    orderId: orderId,
    receiverAddress: takerMassaAddress, // Taker receives MASSA
    hashlock: hashlockBytes,
    timelock: timelock,
    amount: amount,
  };

  const builder = new MassaHTLCBuilder(massaHTLCConfig);
  await builder.initialize();

  // Create HTLC
  console.log("\nCreating Massa HTLC...");
  const htlcResult = await builder.createHTLC();
  console.log("✅ Massa HTLC created:", htlcResult);

  // Update order with Massa HTLC data
  order.massaHTLC = {
    orderId: orderId,
    contractAddress: htlcResult.contractAddress,
    hashlock: htlcResult.hashlock,
    timelock: htlcResult.timelock,
    amount: htlcResult.amount,
    secret: order.secret, // Store secret for later claim
    funded: false,
    status: 'Active',
  };

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n✅ MASSA HTLC CREATED!");
  console.log("======================");
  console.log("🟣 Contract Address:", order.massaHTLC.contractAddress);
  console.log("📄 Order updated:", orderPath);

  console.log("\n🎯 NEXT STEP:");
  console.log("=============");
  console.log("🔵 MAKER funds Massa HTLC:");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:maker:fund-massa");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

