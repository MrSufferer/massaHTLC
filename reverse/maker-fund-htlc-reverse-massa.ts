import * as fs from 'fs';
import * as path from 'path';
import { MassaHTLCBuilder } from '../evm/scripts/massa-client';

interface ReverseAtomicSwapOrder {
  orderId: string;
  massaHTLC?: {
    orderId: string;
    contractAddress: string;
    funded: boolean;
  };
  status: string;
}

async function main() {
  console.log("🔄 MAKER: FUNDING MASSA HTLC (REVERSE FLOW)");
  console.log("============================================");

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
    throw new Error("Massa HTLC not found. Maker must create HTLC first.");
  }

  if (order.massaHTLC.funded) {
    console.log("⚠️  Massa HTLC already funded");
    return;
  }

  console.log("📄 Order ID:", orderId);
  console.log("🟣 Massa HTLC Address:", order.massaHTLC.contractAddress);

  // We need to reload the full order to get the actual config
  const fullOrder = JSON.parse(fs.readFileSync(orderPath, "utf8"));
  
  // Get taker's Massa address (taker receives MASSA in reverse flow)
  const takerMassaAddress = process.env.MASSA_RECEIVER_ADDRESS;
  if (!takerMassaAddress) {
    throw new Error("MASSA_RECEIVER_ADDRESS must be set in .env file (for taker)");
  }
  
  const massaHTLCConfig = {
    orderId: orderId,
    receiverAddress: takerMassaAddress, // Taker receives MASSA
    hashlock: Buffer.from(fullOrder.hashlock.slice(2), 'hex'),
    timelock: BigInt(fullOrder.massaHTLC.timelock),
    amount: BigInt(fullOrder.maker.provides.amount),
  };

  const builder = new MassaHTLCBuilder(massaHTLCConfig);
  await builder.initialize();

  // Fund HTLC
  console.log("\nFunding Massa HTLC...");
  const fundResult = await builder.fundHTLC();
  console.log("✅ Massa HTLC funded:", fundResult);

  // Update order
  if (order.massaHTLC) {
    order.massaHTLC.funded = true;
  }
  order.status = "FILLED";

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n✅ MASSA HTLC FUNDED!");
  console.log("=====================");
  console.log("📄 Order updated:", orderPath);

  console.log("\n🎯 NEXT STEP:");
  console.log("=============");
  console.log("🔵 TAKER creates EVM escrow:");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:taker:escrow-massa");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

