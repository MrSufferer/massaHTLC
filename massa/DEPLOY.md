# Massa HTLC Contract Deployment Guide

## Prerequisites

1. **Get Massa Buildnet Funds**
   - Visit [Massa Buildnet Faucet](https://docs.massa.net/docs/build/networks-faucets/public-networks)
   - Or use the MassaStation wallet to get testnet funds
   - You need at least 1-2 MAS for deployment and testing

2. **Set Up Environment Variables**
   ```bash
   # In your .env file (root directory)
   MASSA_PRIVATE_KEY=your_private_key_here
   MASSA_JSON_RPC_URL=https://buildnet.massa.net/api/v2
   ```

3. **Build the Contract**
   ```bash
   cd massa
   npm install
   npm run build
   ```

## Deploy to Buildnet

```bash
# From root directory
npm run massa:deploy

# Or from massa directory
cd massa
ts-node scripts/deploy.ts
```

The script will:
1. Connect to buildnet
2. Deploy the HTLC contract
3. Output the contract address
4. Show deployment events

## Save Contract Address

After deployment, add the contract address to your `.env`:

```bash
MASSA_HTLC_CONTRACT_ADDRESS=AS12iLKjMogXvxVcspy8JWzZfMxy3QmAt6PPuxaBVWwsFwJvxHq7m
```
The address above is the currently deployed buildnet HTLC (2025‑11‑25). Reuse it unless you intentionally redeploy.

## Verify Deployment

You can verify the contract is deployed by checking events or calling a read function:

```bash
# Check contract exists (this will fail if contract doesn't exist)
ORDER_ID=test npm run massa:monitor
```

## Next Steps

After deployment, you can:
1. Create HTLCs: `npm run massa:create`
2. Run `cd massa && npm run test:integration` to replay recorded orders
3. Execute the documented Sepolia↔Massa swap flows using the shared artifacts

## Reference Deployment Artifacts

- **Contract**: `AS12iLKjMogXvxVcspy8JWzZfMxy3QmAt6PPuxaBVWwsFwJvxHq7m`
- **Forward swap** (`order_massa_1764052717779`):
  - Massa ops `O12d3WJebjiLhaUoDgpYLKAxLhpfBCDbJdYazWTt6GKZ59yWNunp` / `O12FbcjoyeFH2boSGCXgST6k1VPLPVFeJENNn6SeXeRk8gdF4WYu`
  - Sepolia txs `0xe9146472ce852b5b16da7f3d011e893133e8bb9b7e31b0ec943ce52ba5f89c05`, `0x3bb81211cad7e379385e0663230af82b8e2e7f58859b1ecf535f76a5418e164a`
- **Reverse swap** (`reverse_massa_order_1764055236365`):
  - Massa ops `O1Mo26VEeavCsaFg1RkEEqn9z8BkSHgQo19Wz1oGVJqW9Z94g7G`, `O12TWkq4GCtU8ZcNCMDMTRqvgGKhTJceJgEX8CbCxk6xLGczgniv`, `O1bXgGsmPZ4GeLnptNnEmCV385ddpXPhoF1t5bcm1xrikoePtMJ`
  - Sepolia txs `0x1b1fdbf28d098d46ec3f5d6ec885990c81c73c144887a58b63f08cfaf7704bbc`, `0xe3e3100be6837b3e107c248e12b9b99771d1d84761436df4a37ebb9a72a826e7`

