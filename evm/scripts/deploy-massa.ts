import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentConfig {
  accessTokenAddress?: string;
  owner?: string;
  rescueDelaySrc: number;
  rescueDelayDst: number;
  creationFee: string;
  treasury?: string;
  bitcoinConfig: {
    minConfirmations: number;
    dustThreshold: number;
    maxAmount: number;
  };
}

interface DeploymentResult {
  network: string;
  chainId: number;
  contracts: {
    accessToken: string;
    btcEscrowFactory: string;
    btcEscrowSrcImplementation: string;
    btcEscrowDstImplementation: string;
  };
  config: DeploymentConfig;
  deployedAt: string;
  gasUsed: Record<string, string>;
}

const CONFIG_PATH = path.join(__dirname, "../deploy-config-massa.json");
const DEPLOYMENTS_DIR = path.join(__dirname, "../deployments");

function loadConfig(): DeploymentConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }
  const defaults: DeploymentConfig = {
    rescueDelaySrc: 7 * 24 * 3600,
    rescueDelayDst: 7 * 24 * 3600,
    creationFee: "0.001",
    bitcoinConfig: {
      minConfirmations: 1,
      dustThreshold: 546,
      maxAmount: 100000000000,
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
  return defaults;
}

function ensureDeploymentsDir() {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) {
    fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
}

async function saveResult(result: DeploymentResult) {
  ensureDeploymentsDir();
  const detailedPath = path.join(
    DEPLOYMENTS_DIR,
    `massa-${result.network}-${result.chainId}.json`,
  );
  fs.writeFileSync(detailedPath, JSON.stringify(result, null, 2));
  const addressesPath = path.join(
    DEPLOYMENTS_DIR,
    `addresses-massa-${result.network}-${result.chainId}.json`,
  );
  const addresses = {
    network: result.network,
    chainId: result.chainId,
    ...result.contracts,
    deployedAt: result.deployedAt,
  };
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log(`Saved deployment to ${detailedPath}`);
  console.log(`Saved addresses to ${addressesPath}`);
}

async function deployAccessToken(config: DeploymentConfig) {
  if (config.accessTokenAddress) {
    console.log(`Using existing access token ${config.accessTokenAddress}`);
    return { address: config.accessTokenAddress, gas: 0n };
  }
  console.log("Deploying access token");
  const AccessToken = await ethers.getContractFactory("MockERC20");
  const accessToken = await AccessToken.deploy("Access Token", "ACCESS");
  await accessToken.waitForDeployment();
  const tx = accessToken.deploymentTransaction();
  const receipt = await tx?.wait();
  const gasUsed = receipt?.gasUsed || 0n;
  const address = await accessToken.getAddress();
  console.log(`Access token deployed at ${address}`);
  return { address, gas: gasUsed };
}

async function deployFactory(config: DeploymentConfig, accessToken: string) {
  console.log("Deploying BTC escrow factory");
  const BTCEscrowFactory = await ethers.getContractFactory("BTCEscrowFactory");
  const factory = await BTCEscrowFactory.deploy(
    accessToken,
    config.owner || (await ethers.getSigners())[0].address,
    config.rescueDelaySrc,
    config.rescueDelayDst,
    ethers.parseEther(config.creationFee),
    config.treasury || (await ethers.getSigners())[0].address,
    {
      minConfirmations: config.bitcoinConfig.minConfirmations,
      dustThreshold: config.bitcoinConfig.dustThreshold,
      maxAmount: config.bitcoinConfig.maxAmount,
    },
  );
  await factory.waitForDeployment();
  const tx = factory.deploymentTransaction();
  const receipt = await tx?.wait();
  const gasUsed = receipt?.gasUsed || 0n;
  const address = await factory.getAddress();
  const srcImpl = await factory.BTC_ESCROW_SRC_IMPLEMENTATION();
  const dstImpl = await factory.BTC_ESCROW_DST_IMPLEMENTATION();
  console.log(`Factory deployed at ${address}`);
  return { address, gas: gasUsed, srcImpl, dstImpl };
}

async function main() {
  console.log("Deploying Massa escrow stack");
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log(`Deployer ${deployer.address}`);
  console.log(`Balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`Network ${network.name} (${network.chainId})`);

  const config = loadConfig();
  let totalGas = 0n;
  const gasMap: Record<string, string> = {};

  const accessToken = await deployAccessToken(config);
  totalGas += accessToken.gas;
  gasMap.accessToken = accessToken.gas.toString();

  const factory = await deployFactory(config, accessToken.address);
  totalGas += factory.gas;
  gasMap.btcEscrowFactory = factory.gas.toString();
  gasMap.total = totalGas.toString();

  const result: DeploymentResult = {
    network: network.name,
    chainId: Number(network.chainId),
    contracts: {
      accessToken: accessToken.address,
      btcEscrowFactory: factory.address,
      btcEscrowSrcImplementation: factory.srcImpl,
      btcEscrowDstImplementation: factory.dstImpl,
    },
    config,
    deployedAt: new Date().toISOString(),
    gasUsed: gasMap,
  };

  await saveResult(result);

  console.log("Deployment complete");
  console.log(`Factory ${factory.address}`);
  console.log(`Access token ${accessToken.address}`);
  console.log(`Gas used ${totalGas.toString()}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export default main;

