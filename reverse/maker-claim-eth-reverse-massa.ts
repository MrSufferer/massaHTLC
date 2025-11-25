import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { BTCEscrowDst } from "../evm/typechain-types";
import { BTCEscrowFactory__factory } from "../evm/typechain-types";

interface ReverseAtomicSwapOrder {
  orderId: string;
  maker: {
    address: string;
  };
  secret: string;
  hashlock: string;
  massaHTLC?: {
    orderId: string;
    contractAddress: string;
    secret?: string;
  };
  evmEscrow?: {
    address: string;
    txHash?: string;
    immutables?: {
      orderHash: string;
      hashlock: string;
      maker: string;
      taker: string;
      token: string;
      amount: string;
      safetyDeposit: string;
      timelocks: string;
    };
  };
  status: string;
  transactions?: {
    evmEscrowClaim?: string;
  };
}

function normalizeAddress(value: any): string {
  if (typeof value === "string") {
    if (value === "" || value === "0x" || value === "0x0") {
      return ethers.ZeroAddress;
    }
    return ethers.getAddress(value);
  }

  if (typeof value === "bigint") {
    if (value === 0n) {
      return ethers.ZeroAddress;
    }
    return ethers.getAddress(ethers.toBeHex(value, 20));
  }

  if (value && typeof value.toString === "function") {
    const str = value.toString();
    if (str.startsWith("0x")) {
      if (str === "0x0") {
        return ethers.ZeroAddress;
      }
      return ethers.getAddress(str);
    }
    const asBigInt = BigInt(str);
    if (asBigInt === 0n) {
      return ethers.ZeroAddress;
    }
    return ethers.getAddress(ethers.toBeHex(asBigInt, 20));
  }

  throw new Error("Unsupported address value");
}

async function loadImmutables(order: ReverseAtomicSwapOrder) {
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

  const iface = BTCEscrowFactory__factory.createInterface();
  const decoded = iface.decodeFunctionData("createDstEscrow", tx.data);
  const [immutables] = decoded;

  return {
    orderHash: immutables.orderHash,
    hashlock: immutables.hashlock,
    maker: normalizeAddress(immutables.maker),
    taker: normalizeAddress(immutables.taker),
    token: normalizeAddress(immutables.token),
    amount: immutables.amount.toString(),
    safetyDeposit: immutables.safetyDeposit.toString(),
    timelocks: immutables.timelocks.toString(),
  };
}

async function main() {
  console.log("🔄 MAKER: CLAIMING ETH (REVEALS SECRET FROM MASSA - REVERSE FLOW)");
  console.log("==================================================================");
  console.log("💡 MAKER: Claiming ETH from EVM escrow using secret from Massa HTLC!");

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
    throw new Error("Massa HTLC not found. Maker must create and fund Massa HTLC first.");
  }

  if (!order.evmEscrow) {
    throw new Error("EVM escrow not found. Taker must create EVM escrow first.");
  }

  // Get maker account
  const [maker] = await ethers.getSigners();
  console.log("👤 MAKER:", maker.address);

  if (maker.address.toLowerCase() !== order.maker.address.toLowerCase()) {
    throw new Error("Signer address does not match maker address in order");
  }

  console.log("\n🔐 USING SECRET FROM MASSA HTLC:");
  console.log("=================================");
  console.log("🔑 Secret:", order.secret);
  console.log("🔒 Hashlock:", order.hashlock);
  console.log("🟣 Massa HTLC:", order.massaHTLC.contractAddress);

  // Connect to escrow
  const escrow = await ethers.getContractAt(
    "BTCEscrowDst",
    order.evmEscrow.address
  ) as BTCEscrowDst;

  console.log("\n🔵 CLAIMING ETH FROM EVM ESCROW:");
  console.log("=================================");
  console.log("📄 Escrow address:", order.evmEscrow.address);

  // Convert secret to bytes
  const secretBytes = ethers.getBytes(order.secret);

  // Verify hashlock matches
  const computedHashlock = ethers.sha256(order.secret);
  if (computedHashlock.toLowerCase() !== order.hashlock.toLowerCase()) {
    throw new Error("Secret does not match hashlock!");
  }

  console.log("✅ Hashlock verified");

  // Load immutables from creation tx (or cached order)
  const immutables = await loadImmutables(order);

  // Claim ETH
  console.log("\nClaiming ETH from escrow...");
  const tx = await escrow.withdraw(secretBytes, immutables, {
    gasLimit: 500000,
  });

  console.log("⏳ Transaction sent:", tx.hash);
  console.log("⏳ Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log("✅ ETH claimed successfully!");

  // Update order
  order.status = "COMPLETED";
  if (!order.transactions) {
    order.transactions = {};
  }
  order.transactions.evmEscrowClaim = receipt!.hash;
  if (order.evmEscrow) {
    order.evmEscrow.immutables = immutables;
  }

  // Store revealed secret in order (for taker to use)
  if (order.massaHTLC) {
    order.massaHTLC.secret = order.secret; // Secret is now revealed
  }

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n✅ ETH CLAIMED AND SECRET REVEALED!");
  console.log("===================================");
  console.log("📄 Transaction hash:", receipt!.hash);
  console.log("🔑 Secret revealed:", order.secret);
  console.log("💾 Order updated:", orderPath);

  console.log("\n🎯 NEXT STEP:");
  console.log("=============");
  console.log("🔵 TAKER claims MASSA using revealed secret:");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:taker:claim-massa");
  console.log("\n💡 The secret is now public on EVM blockchain!");
  console.log("💡 Taker can extract it and use it to claim MASSA from Massa HTLC");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

