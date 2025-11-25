import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { BTCEscrowFactory } from "../evm/typechain-types";

interface ReverseAtomicSwapOrder {
  orderId: string;
  chainId: number;
  maker: {
    address: string;
    wants: {
      asset: "ETH" | "ERC20";
      amount: string;
    };
  };
  taker?: {
    address: string;
  };
  hashlock: string;
  timelock: {
    withdrawalPeriod: number;
    cancellationPeriod: number;
  };
  status: string;
  contracts: {
    btcEscrowFactory: string;
  };
  massaHTLC?: {
    contractAddress: string;
    funded: boolean;
  };
  evmEscrow?: {
    address: string;
    txHash: string;
    amount: string;
    safetyDeposit: string;
    creationFee: string;
  };
  transactions?: {
    evmEscrowCreation?: string;
  };
}

async function main() {
  console.log("🔄 TAKER: CREATING EVM ESCROW (REVERSE FLOW: MASSA→ETH)");
  console.log("========================================================");
  console.log("💡 TAKER: Creating EVM escrow with ETH for MASSA→ETH swap");
  
  const orderId = process.env.ORDER_ID;
  if (!orderId) {
    throw new Error("❌ ORDER_ID environment variable required");
  }
  
  const orderPath = path.join(__dirname, "../orders", `${orderId}.json`);
  
  if (!fs.existsSync(orderPath)) {
    throw new Error(`❌ Order file not found: ${orderPath}`);
  }
  
  const order: ReverseAtomicSwapOrder = JSON.parse(fs.readFileSync(orderPath, "utf8"));

  if (!order.massaHTLC || !order.massaHTLC.funded) {
    throw new Error("❌ Massa HTLC must be created and funded first");
  }

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== order.chainId) {
    throw new Error(`❌ Network mismatch. Order targets chain ${order.chainId}, connected to ${chainId}`);
  }

  const signers = await ethers.getSigners();
  const desiredTaker = process.env.TAKER_ADDRESS?.toLowerCase();
  const taker = desiredTaker
    ? signers.find((s) => s.address.toLowerCase() === desiredTaker)
    : signers[0];

  if (!taker) {
    throw new Error("❌ Unable to find configured taker signer");
  }

  console.log("👤 TAKER:", taker.address);

  const takerBalance = await ethers.provider.getBalance(taker.address);
  console.log("💰 TAKER Balance:", ethers.formatEther(takerBalance), "ETH");

  const factory = await ethers.getContractAt(
    "BTCEscrowFactory",
    order.contracts.btcEscrowFactory
  ) as BTCEscrowFactory;

  console.log("\n📋 ORDER INFO:");
  console.log("==============");
  console.log("👤 MAKER:", order.maker.address);
  console.log("💰 MAKER wants:", ethers.formatEther(order.maker.wants.amount), "ETH");
  console.log("🔒 Hashlock:", order.hashlock);
  console.log("🟣 Massa HTLC:", order.massaHTLC.contractAddress);

  const escrowAmount = BigInt(order.maker.wants.amount);
  const safetyDeposit = ethers.parseEther(process.env.MASSA_REVERSE_SAFETY_DEPOSIT || "0.001");
  const creationFee = await factory.creationFee();
  const totalRequired = escrowAmount + safetyDeposit + creationFee;

  if (takerBalance < totalRequired) {
    throw new Error(
      `❌ Insufficient balance. Need ${ethers.formatEther(totalRequired)} ETH`
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const dstWithdrawal = order.timelock.withdrawalPeriod;
  const dstPublicWithdrawal = order.timelock.withdrawalPeriod * 2;
  const dstCancellation = order.timelock.cancellationPeriod;
  const timelocks =
    (BigInt(now) << 224n) |
    (BigInt(dstCancellation) << 64n) |
    (BigInt(dstPublicWithdrawal) << 32n) |
    BigInt(dstWithdrawal);

  const immutables = {
    orderHash: ethers.keccak256(ethers.toUtf8Bytes(orderId)),
    hashlock: order.hashlock,
    maker: BigInt(order.maker.address),
    taker: BigInt(taker.address),
    token: BigInt(ethers.ZeroAddress),
    amount: escrowAmount,
    safetyDeposit,
    timelocks,
  };

  console.log("\n🔵 CREATING EVM ESCROW:");
  console.log("========================");
  const predictedEscrowAddress = await factory.addressOfEscrowDst(immutables);
  console.log("🏠 Predicted Escrow Address:", predictedEscrowAddress);

  const feeData = await ethers.provider.getFeeData();
  const baseGasPrice = feeData.gasPrice || ethers.parseUnits("2", "gwei");
  const gasPrice = baseGasPrice * 5n;

  const tx = await factory.connect(taker).createDstEscrow(immutables, {
    value: totalRequired,
    gasPrice,
  });

  console.log("⏳ Transaction sent:", tx.hash);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("❌ Escrow creation failed");
  }

  console.log("✅ EVM Escrow created!");
  console.log("📄 Escrow Address:", predictedEscrowAddress);
  console.log("📄 Transaction:", receipt.hash);

  order.taker = {
    address: taker.address,
  };

  order.evmEscrow = {
    address: predictedEscrowAddress,
    txHash: receipt.hash,
    amount: escrowAmount.toString(),
    safetyDeposit: safetyDeposit.toString(),
    creationFee: creationFee.toString(),
  };

  order.status = "READY_FOR_CLAIM";
  order.transactions = {
    ...(order.transactions || {}),
    evmEscrowCreation: receipt.hash,
  };

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n✅ ORDER UPDATED!");
  console.log("=================");
  console.log("📄 Order saved:", orderPath);

  console.log("\n🎯 NEXT STEP:");
  console.log("=============");
  console.log("🔵 MAKER claims ETH (reveals secret from Massa):");
  console.log("   ORDER_ID=" + orderId + " npm run reverse:maker:claim-eth-massa");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

