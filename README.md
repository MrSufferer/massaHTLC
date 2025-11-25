# 🌉 EVM ↔ Massa Atomic Swap System

A complete, production-ready atomic swap implementation enabling trustless exchanges between EVM chains (Ethereum, Polygon, BSC, etc.) and Massa. Built on battle-tested 1inch smart contracts with real Massa HTLC integration.

## 🏗️ Architecture Overview

This system implements **Hash Time Locked Contracts (HTLCs)** on both chains to enable atomic swaps:

- **EVM Side**: Smart contracts based on 1inch's proven escrow system
- **Massa Side**: Native Massa Script HTLCs
- **Atomic Guarantee**: Either both parties get their desired assets, or both get refunded

### 🔄 Supported Swap Directions

1. **EVM → Massa**: Trade ETH/ERC20 tokens for MAS
2. **Massa → EVM**: Trade MAS for ETH/ERC20 tokens

## 🚀 Quick Start

### Prerequisites
```bash
# Node.js 16+
node --version

# Git
git --version
```

### Environment Setup
Create `.env` file:
```bash
# EVM Configuration
PRIVATE_KEY=your_ethereum_private_key
SEPOLIA_RPC_URL=https://sepolia.drpc.org
ETHERSCAN_API_KEY=your_etherscan_key

# Massa Configuration
MASSA_PRIVATE_KEY=your_massa_private_key
MASSA_HTLC_CONTRACT_ADDRESS=AS12iLKjMogXvxVcspy8JWzZfMxy3QmAt6PPuxaBVWwsFwJvxHq7m  # Current buildnet HTLC
MASSA_JSON_RPC_URL=https://buildnet.massa.net/api/v2  # Or another public RPC
# OR for localnet:
# MASSA_JSON_RPC_URL=http://127.0.0.1:33035
MASSA_RECEIVER_ADDRESS=AU12...  # Receiver address for HTLC
MASSA_AMOUNT_NANOMAS=1000000000  # 1 MAS = 10^9 nanoMAS
MASSA_TIMELOCK_SECONDS=3600  # Timelock in seconds
MASSA_REVERSE_SAFETY_DEPOSIT=0.001  # Optional; ETH deposit for reverse taker escrow
```

### Get Testnet Funds
- **Sepolia ETH**: [Sepolia Faucet](https://sepoliafaucet.com/)
- **Massa Buildnet**: [Massa Buildnet Faucet](https://docs.massa.net/docs/build/networks-faucets/public-networks)

## 💱 Swap Flows

### 🟣 EVM → MASSA Flow

**Participants**: MAKER (provides ETH), TAKER (provides MASSA)

```bash
# 1. MAKER creates order (wants MASSA)
npm run maker:create-massa

# 2. TAKER fills order (creates Massa HTLC)
ORDER_ID=order_massa_123 npm run taker:fill-massa

# 3. MAKER creates EVM escrow
ORDER_ID=order_massa_123 npm run maker:escrow-massa

# 4. MAKER claims MASSA (reveals secret)
ORDER_ID=order_massa_123 npm run maker:claim-massa

# 5. TAKER claims ETH (using revealed secret from Massa)
ORDER_ID=order_massa_123 npm run taker:claim-eth-massa
```

### 🔄 MASSA → EVM Flow (Reverse)

**Participants**: MAKER (provides MASSA), TAKER (provides ETH)

```bash
# 1. MAKER creates reverse order
npm run reverse:create-massa

# 2. MAKER creates Massa HTLC
ORDER_ID=reverse_massa_order_123 npm run reverse:maker:htlc-massa

# 3. MAKER funds Massa HTLC
ORDER_ID=reverse_massa_order_123 npm run reverse:maker:fund-massa

# 4. TAKER creates EVM escrow
ORDER_ID=reverse_massa_order_123 npm run reverse:taker:escrow-massa

# 5. MAKER claims ETH (reveals secret)
ORDER_ID=reverse_massa_order_123 npm run reverse:maker:claim-eth-massa

# 6. TAKER claims MASSA (using revealed secret)
ORDER_ID=reverse_massa_order_123 npm run reverse:taker:claim-massa
```

## 🔐 Cryptographic Flow

### Secret & Hashlock Generation
```javascript
// 1. Generate random 32-byte secret
const secret = crypto.randomBytes(32);
const secretHex = "0x" + secret.toString("hex");

// 2. Create SHA-256 hashlock
const hashlock = ethers.sha256(secretHex);

// 3. Use in both EVM contracts and Bitcoin HTLCs
```

### Atomic Swap Guarantee
1. **Setup Phase**: Both parties lock assets using same hashlock
2. **Claim Phase**: First claimer reveals secret, second uses revealed secret
3. **Safety**: If either fails, both get refunded after timelock

## 📝 Example: Complete EVM→BTC Swap

```bash
# Terminal 1 (MAKER)
npm run maker:create
# Output: ORDER_ID=order_1751234567890

# Terminal 2 (TAKER)  
ORDER_ID=order_1751234567890 npm run taker:fill

# Terminal 1 (MAKER)
ORDER_ID=order_1751234567890 npm run maker:escrow

# Terminal 2 (TAKER)
ORDER_ID=order_1751234567890 npm run taker:fund

# Terminal 1 (MAKER) - Claims BTC, reveals secret
ORDER_ID=order_1751234567890 npm run maker:claim
# Secret now public on Bitcoin blockchain!

# Terminal 2 (TAKER) - Uses revealed secret to claim ETH
ORDER_ID=order_1751234567890 npm run taker:claim
# ✅ Atomic swap complete!
```

## 🛡️ Security Features

### Hash Time Locked Contracts (HTLCs)
- **Hashlock**: SHA-256 hash ensures atomic execution
- **Timelock**: Automatic refunds prevent fund loss
- **Script Verification**: Bitcoin Script validates all conditions

### Key Protections
- **No Counterparty Risk**: Trustless execution
- **Atomic Guarantee**: Both succeed or both fail
- **Replay Protection**: Each swap uses unique secret
- **Time Boundaries**: Configurable timelock periods

### Tested Edge Cases
- ✅ Invalid signatures
- ✅ Wrong secrets  
- ✅ Timeout scenarios
- ✅ Network failures
- ✅ Gas price spikes

## 🔧 Configuration

### Timelock Settings
```javascript
timelock: {
  withdrawalPeriod: 0,      // Immediate withdrawal
  cancellationPeriod: 3600  // 1 hour safety period
}
```

### Network Support
- **EVM**: Sepolia (testnet), easily extendable to mainnet
- **Bitcoin**: Testnet4, ready for mainnet
- **Massa**: Buildnet (testnet), localnet, ready for mainnet

## 📄 Smart Contract Details

### BTCEscrowFactory
```solidity
// Create source escrow (EVM→BTC)
function createSrcEscrow(Immutables memory immutables) 
    external payable returns (address)

// Create destination escrow (BTC→EVM)  
function createDstEscrow(Immutables memory immutables)
    external payable returns (address)
```

### Immutables Structure
```solidity
struct Immutables {
    bytes32 orderHash;    // Unique order identifier
    bytes32 hashlock;     // SHA-256 hash of secret
    uint256 maker;        // Maker address as uint256
    uint256 taker;        // Taker address as uint256
    uint256 token;        // Token address (0 = ETH)
    uint256 amount;       // Amount in wei
    uint256 safetyDeposit;// Safety deposit
    uint256 timelocks;    // Packed timelock data
}
```

## 🐛 Troubleshooting

### Common Issues

**"Non-canonical DER signature"**
```bash
# Fixed in current version - signatures now properly DER-encoded
```

**"Order missing taker info"**
```bash
# Check flow order - ensure previous steps completed
# Verify order file exists in orders/ directory
```

**"Insufficient balance"**
```bash
# Check both ETH and BTC testnet balances
# Ensure sufficient gas fees
```

**"HTLC address not found"**
```bash
# Verify Bitcoin HTLC was created successfully
# Check order file has bitcoinHTLC.address field
```

### Debug Commands
```bash
# Check order status
cat orders/order_123.json | jq '.status'

# Verify contract deployment
npm run debug:timelock

# Check Bitcoin HTLC
ls btc/output/htlc_*_testnet4.json
```

## 🟣 Massa HTLC Integration

### Prerequisites

1. **Node.js 16+** and npm
2. **Massa Private Key**: Generate or use an existing Massa wallet
3. **Massa Node** (for localnet) or **Buildnet RPC** (for testnet)
4. **Deployed HTLC Contract**: Deploy to buildnet first (see deployment guide below)

### Build and Deploy Massa HTLC Contract

**First Time Setup:**
1. Get buildnet funds from [Massa Buildnet Faucet](https://docs.massa.net/docs/build/networks-faucets/public-networks)
2. Set `MASSA_PRIVATE_KEY` in `.env`
3. Set `MASSA_JSON_RPC_URL=https://test.massa.net/api/v2:33035` in `.env`
4. Build and deploy:

```bash
# Navigate to massa directory
cd massa

# Install dependencies (if not already done)
npm install

# Build the contract
npm run build

# Deploy to network (requires MASSA_PRIVATE_KEY in .env)
npm run deploy
# Or use the root script:
# ts-node scripts/deploy.ts
```

The deploy script will output the contract address. Add it to your `.env`:
```bash
MASSA_HTLC_CONTRACT_ADDRESS=AS1xxx...
```

### Localnet Setup (Optional)

For local development, you can run a local Massa node:

```bash
# Install Massa node (see https://docs.massa.net/docs/build/networks-faucets/local-network)
# Start local node
massa-node --buildnet

# The node will run on http://127.0.0.1:33035
# Update .env:
MASSA_JSON_RPC_URL=http://127.0.0.1:33035
```

### Massa HTLC Workflows

#### Create and Fund HTLC
```bash
# Set environment variables
export MASSA_RECEIVER_ADDRESS=AU12...
export MASSA_AMOUNT_NANOMAS=1000000000  # 1 MAS
export MASSA_TIMELOCK_SECONDS=3600  # 1 hour

# Create and fund HTLC
npm run massa:create
```

#### Claim HTLC (Maker or Taker)
```bash
# Maker claims (reveals secret)
ORDER_ID=order_123 npm run massa:maker:claim

# Taker claims (uses revealed secret)
ORDER_ID=order_123 npm run massa:taker:claim
```

#### Refund Expired HTLC
```bash
ORDER_ID=order_123 npm run massa:refund
```

#### Monitor HTLC Status
```bash
# Monitor for secret revelation
ORDER_ID=order_123 npm run massa:monitor

# Check if secret is revealed
ORDER_ID=order_123 npm run massa:check-secret
```

## ✅ Sepolia ↔ Massa Reference Runs

### Forward flow (`order_massa_1764052717779`)
- `npm run maker:create-massa` emitted secret `0x58a610b73445925153c0464c6ccef4e925fda21ce81f36c7e548c67fdd39b03f` and hashlock `0x0f20622785d3a1b6ed8bc49acd68a18663d24c6b64b33001e0b007eae9031335`
- `ORDER_ID=order_massa_1764052717779 npm run taker:fill-massa` → Massa ops `O12d3WJebjiLhaUoDgpYLKAxLhpfBCDbJdYazWTt6GKZ59yWNunp` (create) and `O12FbcjoyeFH2boSGCXgST6k1VPLPVFeJENNn6SeXeRk8gdF4WYu` (fund)
- `ORDER_ID=order_massa_1764052717779 npm run maker:escrow-massa` → Sepolia tx `0xe9146472ce852b5b16da7f3d011e893133e8bb9b7e31b0ec943ce52ba5f89c05` (`0xaEDA75c98e836417972D6300471e17479757aD0a` escrow)
- `ORDER_ID=order_massa_1764052717779 npm run maker:claim-massa` → Massa op `O1NyNkv3craQCqrHhf1jPmcNiQqRSyPsqT4ZbSkme9fcK1K5ZNn`
- `ORDER_ID=order_massa_1764052717779 npm run taker:claim-eth-massa` → Sepolia tx `0x3bb81211cad7e379385e0663230af82b8e2e7f58859b1ecf535f76a5418e164a`
- Artifacts captured in `orders/order_massa_1764052717779.json` for regression replay

### Reverse flow (`reverse_massa_order_1764055236365`)
- `npm run reverse:create-massa` generated secret `0x5e1c1fa4d8558125957e805297354d9489e2587156f925a3ddf375f475805081` and hashlock `0xa0ba81b2394fa73ce6ef7d89f10b7069ed4068b323718f34e80d4e18954b6240`
- `ORDER_ID=reverse_massa_order_1764055236365 npm run reverse:maker:htlc-massa` → Massa op `O1Mo26VEeavCsaFg1RkEEqn9z8BkSHgQo19Wz1oGVJqW9Z94g7G`
- `ORDER_ID=reverse_massa_order_1764055236365 npm run reverse:maker:fund-massa` → Massa op `O12TWkq4GCtU8ZcNCMDMTRqvgGKhTJceJgEX8CbCxk6xLGczgniv`
- `ORDER_ID=reverse_massa_order_1764055236365 npm run reverse:taker:escrow-massa` → Sepolia tx `0x1b1fdbf28d098d46ec3f5d6ec885990c81c73c144887a58b63f08cfaf7704bbc` (`0x44A16C01a1ce45cdfEdb78DDFf39924BE9185a8A` escrow)
- `ORDER_ID=reverse_massa_order_1764055236365 npm run reverse:maker:claim-eth-massa` → Sepolia tx `0xe3e3100be6837b3e107c248e12b9b99771d1d84761436df4a37ebb9a72a826e7`
- `ORDER_ID=reverse_massa_order_1764055236365 npm run reverse:taker:claim-massa` → Massa op `O1bXgGsmPZ4GeLnptNnEmCV385ddpXPhoF1t5bcm1xrikoePtMJ`
- Artifacts captured in `orders/reverse_massa_order_1764055236365.json` with cached dst escrow immutables

### Massa Order Schema

The Massa HTLC data is stored in `orders/<orderId>.json`:

```json
{
  "massaHTLC": {
    "orderId": "order_123",
    "contractAddress": "AS1xxx...",
    "hashlock": "0x...",
    "timelock": "1732819200",
    "amount": "1000000000",
    "secret": "hex_secret_here",
    "funded": true,
    "status": "Active"
  }
}
```

### Massa Development Workflow

1. **Build contract**: `cd massa && npm run build`
2. **Run tests**: `cd massa && npm test`
3. **Deploy contract**: `npm run massa:deploy` (first time only)
4. **Optional Sepolia factory deployment**: `npm run deploy:massa-evm`
4. **Create HTLC**: `npm run massa:create` (standalone) or use swap flows below
5. **Monitor/Claim**: Use the scripts above

### EVM ↔ MASSA Atomic Swap Flows

The system supports full atomic swaps between EVM chains and Massa:

**EVM → MASSA Flow:**
- Maker provides ETH, wants MASSA
- Taker provides MASSA, wants ETH
- Uses shared hashlock for atomic execution

**MASSA → EVM Flow:**
- Maker provides MASSA, wants ETH  
- Taker provides ETH, wants MASSA
- Reverse flow with same atomic guarantees

See the swap flows section above for detailed commands.

### Massa Resources

- [Massa Smart Contract Docs](https://docs.massa.net/docs/build/smart-contract/intro)
- [Massa Web3 SDK](https://docs.massa.net/docs/build/massa-web3/intro)
- [Massa Buildnet](https://docs.massa.net/docs/build/networks-faucets/public-networks)
- [Massa Local Network](https://docs.massa.net/docs/build/networks-faucets/local-network)
