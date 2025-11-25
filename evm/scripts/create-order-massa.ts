#!/usr/bin/env node

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

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
      amount: string; // in nanoMAS
      address: string; // Massa address
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
  console.log("🚀 CREATING ATOMIC SWAP ORDER: EVM → MASSA");
  console.log("===========================================");
  
  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = chainId === 11155111 ? "sepolia" : "unknown";
  
  console.log("🌐 Network:", networkName);
  console.log("🔗 Chain ID:", chainId);
  
  // Get maker account
  const [maker] = await ethers.getSigners();
  console.log("👤 MAKER:", maker.address);
  
  const makerBalance = await ethers.provider.getBalance(maker.address);
  console.log("💰 MAKER Balance:", ethers.formatEther(makerBalance), "ETH");
  
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
  
  // Get Massa receiver address from env or use default
  const massaReceiverAddress = process.env.MASSA_RECEIVER_ADDRESS;
  if (!massaReceiverAddress) {
    throw new Error("MASSA_RECEIVER_ADDRESS must be set in .env file");
  }
  
  // Create order with IMMEDIATE withdrawal
  const orderId = `order_massa_${Date.now()}`;
  const timestamp = Date.now();
  
  const order: AtomicSwapOrder = {
    orderId,
    timestamp,
    network: networkName,
    chainId,
    
    maker: {
      address: maker.address,
      provides: {
        asset: "ETH",
        amount: ethers.parseEther("0.01").toString() // 0.01 ETH
      },
      wants: {
        asset: "MASSA",
        amount: "1000000000", // 1 MAS = 10^9 nanoMAS
        address: massaReceiverAddress
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
  
  console.log("\n📋 ORDER DETAILS:");
  console.log("=================");
  console.log("📄 Order ID:", orderId);
  console.log("👤 MAKER:", order.maker.address);
  console.log("💰 MAKER provides:", ethers.formatEther(order.maker.provides.amount), "ETH");
  console.log("🪙 MAKER wants:", (BigInt(order.maker.wants.amount) / BigInt(1e9)).toString(), "MASSA");
  console.log("🏠 Massa address:", order.maker.wants.address);
  console.log("⏰ Withdrawal period:", order.timelock.withdrawalPeriod, "seconds (IMMEDIATE!)");
  console.log("⏰ Cancellation period:", order.timelock.cancellationPeriod, "seconds");
  
  // Save order to file
  const ordersDir = path.join(__dirname, "../../orders");
  if (!fs.existsSync(ordersDir)) {
    fs.mkdirSync(ordersDir, { recursive: true });
  }
  
  const orderPath = path.join(ordersDir, `${orderId}.json`);
  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));
  
  console.log("\n✅ ORDER CREATED SUCCESSFULLY!");
  console.log("==============================");
  console.log("📄 Order ID:", orderId);
  console.log("🔑 Secret:", secret);
  console.log("🔒 Hashlock:", hashlock);
  console.log("💾 Order saved to:", orderPath);
  
  console.log("\n🎯 NEXT STEPS:");
  console.log("==============");
  console.log("1. 🔵 TAKER fills order by creating Massa HTLC:");
  console.log("   ORDER_ID=" + orderId + " npm run taker:fill-massa");
  console.log("2. 🔵 MAKER creates EVM escrow:");
  console.log("   ORDER_ID=" + orderId + " npm run maker:escrow-massa");
  console.log("3. 🔵 TAKER funds Massa HTLC:");
  console.log("   ORDER_ID=" + orderId + " npm run taker:fund-massa");
  console.log("4. 🔵 MAKER claims MASSA (reveals secret):");
  console.log("   ORDER_ID=" + orderId + " npm run maker:claim-massa");
  console.log("5. 🔵 TAKER claims ETH (using revealed secret):");
  console.log("   ORDER_ID=" + orderId + " npm run taker:claim");
  
  console.log("\n🎉 ATOMIC SWAP READY!");
  console.log("=====================");
  console.log("🔸 Trade:", ethers.formatEther(order.maker.provides.amount), "ETH ↔", (BigInt(order.maker.wants.amount) / BigInt(1e9)).toString(), "MASSA");
  console.log("🔸 Withdrawal: IMMEDIATE (0 seconds)");
  console.log("🔸 Cancellation: 1 hour safety period");
  
  return order;
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

