import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { BTCEscrowFactory } from "../typechain-types";

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
    evmEscrowClaim?: string;
  };
}

async function main() {
  console.log("🎯 MAKER: CREATING EVM ESCROW FOR MASSA SWAP");
  console.log("============================================");

  const orderId = process.env.ORDER_ID || process.argv[2];
  if (!orderId) {
    throw new Error("ORDER_ID environment variable or argument is required");
  }

  const ordersDir = path.join(__dirname, "../../orders");
  const orderPath = path.join(ordersDir, `${orderId}.json`);

  if (!fs.existsSync(orderPath)) {
    throw new Error(`Order file not found: ${orderPath}`);
  }

  const order: AtomicSwapOrder = JSON.parse(fs.readFileSync(orderPath, "utf8"));

  if (order.status !== "FILLED") {
    throw new Error(`Order status is ${order.status}, expected FILLED`);
  }

  if (!order.taker || !order.massaHTLC || !order.massaHTLC.funded) {
    throw new Error("Order must include funded Massa HTLC and taker info");
  }

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== order.chainId) {
    throw new Error(`Network mismatch. Order targets ${order.chainId}, connected to ${chainId}`);
  }

  const signers = await ethers.getSigners();
  const preferredMaker = process.env.MAKER_ADDRESS?.toLowerCase();
  const maker =
    preferredMaker ? signers.find((s) => s.address.toLowerCase() === preferredMaker) : signers[0];

  if (!maker) {
    throw new Error("Unable to resolve maker signer");
  }

  if (maker.address.toLowerCase() !== order.maker.address.toLowerCase()) {
    throw new Error(`Maker address mismatch. Expected ${order.maker.address}, got ${maker.address}`);
  }

  console.log("📄 Order:", orderId);
  console.log("👤 Maker:", maker.address);
  console.log("👤 Taker:", order.taker.address);
  console.log("💰 Maker provides:", ethers.formatEther(order.maker.provides.amount), "ETH");
  console.log("🪙 Maker wants:", (BigInt(order.maker.wants.amount) / BigInt(1e9)).toString(), "MASSA");
  console.log("🔗 Massa HTLC:", order.massaHTLC.contractAddress);

  const makerBalance = await ethers.provider.getBalance(maker.address);
  console.log("💼 Maker balance:", ethers.formatEther(makerBalance), "ETH");

  const factory = (await ethers.getContractAt(
    "BTCEscrowFactory",
    order.contracts.btcEscrowFactory
  )) as BTCEscrowFactory;
  console.log("🏭 Escrow factory:", await factory.getAddress());

  const now = Math.floor(Date.now() / 1000);
  const safetyDeposit = ethers.parseEther(process.env.MASSA_SAFETY_DEPOSIT || "0.001");
  const creationFee = await factory.creationFee();
  const escrowAmount = BigInt(order.maker.provides.amount);
  const totalRequired = escrowAmount + safetyDeposit + creationFee;

  console.log("💰 Escrow amount:", ethers.formatEther(escrowAmount), "ETH");
  console.log("🔐 Safety deposit:", ethers.formatEther(safetyDeposit), "ETH");
  console.log("🧾 Creation fee:", ethers.formatEther(creationFee), "ETH");
  console.log("📦 Total required:", ethers.formatEther(totalRequired), "ETH");

  if (makerBalance < totalRequired) {
    throw new Error(
      `Insufficient balance. Need ${ethers.formatEther(totalRequired)} ETH, have ${ethers.formatEther(
        makerBalance
      )} ETH`
    );
  }

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
    maker: BigInt(maker.address),
    taker: BigInt(order.taker.address),
    token: BigInt(ethers.ZeroAddress),
    amount: escrowAmount,
    safetyDeposit,
    timelocks,
  };

  const predictedEscrow = await factory.addressOfEscrowSrc(immutables);
  console.log("🏠 Predicted escrow:", predictedEscrow);
  console.log("🔗 Etherscan:", `https://sepolia.etherscan.io/address/${predictedEscrow}`);

  const feeData = await ethers.provider.getFeeData();
  const baseGasPrice = feeData.gasPrice || ethers.parseUnits("2", "gwei");
  const gasPrice = baseGasPrice * 8n;
  console.log("⛽ Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  const tx = await factory.connect(maker).createSrcEscrow(immutables, {
    value: totalRequired,
    gasPrice,
  });

  console.log("⏳ Transaction sent:", tx.hash);
  console.log("🔗 Etherscan tx:", `https://sepolia.etherscan.io/tx/${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("Escrow creation failed");
  }

  console.log("✅ Escrow confirmed");
  console.log("⛽ Gas used:", receipt.gasUsed.toString());

  const escrowAddress = await factory.addressOfEscrowSrc(immutables);
  console.log("🏠 Escrow address:", escrowAddress);

  order.evmEscrow = {
    address: escrowAddress,
    txHash: receipt.hash,
    amount: escrowAmount.toString(),
    safetyDeposit: safetyDeposit.toString(),
    creationFee: creationFee.toString(),
  };

  order.transactions = {
    ...(order.transactions || {}),
    evmEscrowCreation: receipt.hash,
  };

  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

  console.log("\n✅ EVM ESCROW READY");
  console.log("====================");
  console.log("📄 Order:", orderId);
  console.log("🏠 Escrow:", escrowAddress);
  console.log("💾 Saved:", orderPath);
  console.log("\n🎯 Next steps:");
  console.log("🔸 Maker claims MASSA to reveal the secret");
  console.log("   ORDER_ID=" + orderId + " npm run maker:claim-massa");
  console.log("🔸 Taker claims ETH using the revealed secret");
  console.log("   ORDER_ID=" + orderId + " npm run taker:claim-eth-massa");
}

if (require.main === module) {
  main().catch(console.error);
}

export default main;

