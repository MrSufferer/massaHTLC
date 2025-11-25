import { ethers } from "hardhat";
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { MassaHTLCBuilder, getMassaContractAddress } from './massa-client';

dotenv.config();

interface AtomicSwapOrder {
  orderId: string;
  timestamp: number;
  network: string;
  chainId: number;
  
  maker: {
    address: string;
    provides: {
      asset: "ETH" | "ERC20";
      amount: string;
      token?: string;
    };
    wants: {
      asset: "MASSA";
      amount: string;
      address: string;
    };
  };
  
  taker?: {
    address: string;
    massaAddress: string;
  };
  
  secret: string;
  hashlock: string;
  
  timelock: {
    withdrawalPeriod: number;
    cancellationPeriod: number;
  };
  
  status: "CREATED" | "FILLED" | "COMPLETED" | "CANCELLED";
  
  contracts: {
    btcEscrowFactory: string;
    accessToken: string;
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
}

async function main() {
  console.log("🎯 FILLING ATOMIC SWAP ORDER: EVM → MASSA");
  console.log("==========================================");
  console.log("💡 TAKER: Filling maker's order by creating Massa HTLC");

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

  if (order.status !== "CREATED") {
    throw new Error(`Order is not in CREATED status. Current status: ${order.status}`);
  }

  console.log("\n📋 ORDER INFO:");
  console.log("==============");
  console.log("👤 MAKER:", order.maker.address);
  console.log("💰 MAKER provides:", ethers.formatEther(order.maker.provides.amount), "ETH");
  console.log("🪙 MAKER wants:", (BigInt(order.maker.wants.amount) / BigInt(1e9)).toString(), "MASSA");
  console.log("🔒 Hashlock:", order.hashlock);

  const [taker] = await ethers.getSigners();
  console.log("\n👤 TAKER:", taker.address);

  const takerMassaAddress = process.env.MASSA_RECEIVER_ADDRESS;
  if (!takerMassaAddress) {
    throw new Error("MASSA_RECEIVER_ADDRESS must be set in .env file for taker");
  }

  console.log("🏠 TAKER Massa Address:", takerMassaAddress);

  console.log("\n🟣 CREATING MASSA HTLC:");
  console.log("=======================");

  const hashlockBytes = Buffer.from(order.hashlock.slice(2), 'hex');
  const timelockSeconds = parseInt(process.env.MASSA_TIMELOCK_SECONDS || '3600');
  const timelock = BigInt(Math.floor(Date.now() / 1000) + timelockSeconds);
  const amount = BigInt(order.maker.wants.amount);

  const massaHTLCConfig = {
    orderId: orderId,
    receiverAddress: order.maker.wants.address,
    hashlock: hashlockBytes,
    timelock: timelock,
    amount: amount,
  };

  const builder = new MassaHTLCBuilder(massaHTLCConfig);
  await builder.initialize();

  console.log("Creating Massa HTLC...");
  let htlcResult;
  try {
    htlcResult = await builder.createHTLC();
    console.log("✅ Massa HTLC created:", htlcResult);
  } catch (error) {
    const alreadyExists =
      error instanceof Error &&
      error.message.includes("HTLC already exists");
    if (!alreadyExists) {
      throw error;
    }
    console.log("⚠️ Massa HTLC already exists, continuing to funding...");
    htlcResult = {
      orderId,
      contractAddress: await getMassaContractAddress(),
      hashlock: hashlockBytes.toString("hex"),
      timelock: timelock.toString(),
      amount: amount.toString(),
    };
  }

  console.log("Funding Massa HTLC...");
  const fundResult = await builder.fundHTLC();
  console.log("✅ Massa HTLC funded:", fundResult);

  order.taker = {
    address: taker.address,
    massaAddress: takerMassaAddress,
  };

  order.massaHTLC = {
    orderId: orderId,
    contractAddress: htlcResult.contractAddress,
    hashlock: htlcResult.hashlock,
    timelock: htlcResult.timelock,
    amount: htlcResult.amount,
    secret: '',
    funded: true,
    status: 'Active',
  };

  order.status = "FILLED";

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n✅ ORDER FILLED SUCCESSFULLY!");
  console.log("=============================");
  console.log("📄 Order ID:", orderId);
  console.log("🟣 Massa HTLC Address:", order.massaHTLC.contractAddress);
  console.log("💾 Order updated:", orderPath);

  console.log("\n🎯 NEXT STEPS:");
  console.log("==============");
  console.log("1. 🔵 MAKER creates EVM escrow:");
  console.log("   ORDER_ID=" + orderId + " npm run maker:escrow-massa");
  console.log("2. 🔵 TAKER funds Massa HTLC (already done above)");
  console.log("3. 🔵 MAKER claims MASSA (reveals secret):");
  console.log("   ORDER_ID=" + orderId + " npm run maker:claim-massa");
  console.log("4. 🔵 TAKER claims ETH (using revealed secret):");
  console.log("   ORDER_ID=" + orderId + " npm run taker:claim");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

