#!/usr/bin/env node

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface ReverseAtomicSwapOrder {
  orderId: string;
  timestamp: number;
  network: string;
  chainId: number;
  
  maker: {
    address: string;
    massaAddress: string;
    provides: {
      asset: "MASSA";
      amount: string; // in nanoMAS
    };
    wants: {
      asset: "ETH" | "ERC20";
      amount: string;
      token?: string;
    };
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
}

async function main() {
  console.log("🔄 CREATING REVERSE ATOMIC SWAP ORDER (MASSA → ETH)");
  console.log("===================================================");
  
  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = chainId === 11155111 ? "sepolia" : "unknown";
  
  console.log("🌐 Network:", networkName);
  console.log("🔗 Chain ID:", chainId);
  
  // Get maker account
  const [maker] = await ethers.getSigners();
  console.log("👤 MAKER (EVM Address):", maker.address);
  
  const makerBalance = await ethers.provider.getBalance(maker.address);
  console.log("💰 MAKER ETH Balance:", ethers.formatEther(makerBalance), "ETH");
  
  // Get maker's Massa address from env
  const makerMassaAddress = process.env.MASSA_RECEIVER_ADDRESS;
  if (!makerMassaAddress) {
    throw new Error("MASSA_RECEIVER_ADDRESS must be set in .env file for maker");
  }
  
  // Generate secure random secret
  const secretBytes = crypto.randomBytes(32);
  const secret = "0x" + secretBytes.toString("hex");
  const hashlock = ethers.sha256(secret);
  
  console.log("\n🔐 CRYPTOGRAPHIC SETUP:");
  console.log("=======================");
  console.log("🔑 Secret:", secret);
  console.log("🔒 Hashlock:", hashlock);
  
  // Get deployed contracts
  const factoryAddress = "0x46dD29f29FB4816A4E7bd1Dc6458d1dFCA097993";
  const accessTokenAddress = "0x0843b69626d78874Dc1A2A576102E081d8bc5438";
  
  console.log("\n📋 CONTRACTS:");
  console.log("=============");
  console.log("🏭 Factory:", factoryAddress);
  console.log("🎫 Access Token:", accessTokenAddress);
  
  // Create reverse order with IMMEDIATE withdrawal
  const orderId = `reverse_massa_order_${Date.now()}`;
  const timestamp = Date.now();
  
  const order: ReverseAtomicSwapOrder = {
    orderId,
    timestamp,
    network: networkName,
    chainId,
    
    maker: {
      address: maker.address,
      massaAddress: makerMassaAddress,
      provides: {
        asset: "MASSA",
        amount: "1000000000" // 1 MAS = 10^9 nanoMAS
      },
      wants: {
        asset: "ETH",
        amount: ethers.parseEther("0.01").toString() // 0.01 ETH
      }
    },
    
    secret,
    hashlock,
    
    timelock: {
      withdrawalPeriod: 0,     // 🎯 IMMEDIATE WITHDRAWAL!
      cancellationPeriod: 3600 // 1 hour cancellation period
    },
    
    status: "CREATED",
    
    contracts: {
      btcEscrowFactory: factoryAddress,
      accessToken: accessTokenAddress
    }
  };
  
  console.log("\n📋 REVERSE ORDER DETAILS:");
  console.log("=========================");
  console.log("📄 Order ID:", orderId);
  console.log("👤 MAKER (EVM):", order.maker.address);
  console.log("🟣 MAKER (Massa):", order.maker.massaAddress);
  console.log("🪙 MAKER provides:", (BigInt(order.maker.provides.amount) / BigInt(1e9)).toString(), "MASSA");
  console.log("💰 MAKER wants:", ethers.formatEther(order.maker.wants.amount), "ETH");
  console.log("⏰ Withdrawal period:", order.timelock.withdrawalPeriod, "seconds (IMMEDIATE!)");
  console.log("⏰ Cancellation period:", order.timelock.cancellationPeriod, "seconds");
  
  // Save order to file
  const ordersDir = path.join(__dirname, "../orders");
  if (!fs.existsSync(ordersDir)) {
    fs.mkdirSync(ordersDir, { recursive: true });
  }
  
  const orderPath = path.join(ordersDir, `${orderId}.json`);
  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));
  
  console.log("\n✅ REVERSE ORDER CREATED SUCCESSFULLY!");
  console.log("=====================================");
  console.log("📄 Order ID:", orderId);
  console.log("🔑 Secret:", secret);
  console.log("🔒 Hashlock:", hashlock);
  console.log("💾 Order saved to:", orderPath);
  
  console.log("\n🎯 NEXT STEPS (REVERSE FLOW):");
  console.log("=============================");
  console.log("1. 🔵 MAKER creates Massa HTLC with MASSA:");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:maker:htlc-massa");
  console.log("2. 🔵 MAKER funds Massa HTLC:");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:maker:fund-massa");
  console.log("3. 🔵 TAKER creates EVM escrow with ETH:");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:taker:escrow-massa");
  console.log("4. 🔵 MAKER claims ETH (reveals secret):");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:maker:claim-eth-massa");
  console.log("5. 🔵 TAKER claims MASSA (using revealed secret):");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:taker:claim-massa");
  
  console.log("\n🔄 REVERSE ATOMIC SWAP READY!");
  console.log("==============================");
  console.log("🔸 Trade:", (BigInt(order.maker.provides.amount) / BigInt(1e9)).toString(), "MASSA → ", ethers.formatEther(order.maker.wants.amount), "ETH");
  console.log("🔸 MAKER provides: MASSA");
  console.log("🔸 TAKER provides: ETH");
  console.log("🔸 Withdrawal: IMMEDIATE (0 seconds)");
  console.log("🔸 Cancellation: 1 hour safety period");
  
  return order;
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

