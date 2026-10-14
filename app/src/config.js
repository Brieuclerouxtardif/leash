// Networks LEASH is allowed to touch. Anything else is refused before a key is even loaded.
import { foundry, sepolia } from 'viem/chains';

export const NETWORKS = {
  local: {
    chain: foundry,
    rpc: process.env.LEASH_LOCAL_RPC ?? 'http://127.0.0.1:8545',
    explorer: null,
    oracle: null, // a MockAggregator is deployed locally
  },
  sepolia: {
    chain: sepolia,
    rpc: process.env.LEASH_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    oracle: '0x694AA1769357215DE4FAC081bf1f309aDC325306', // Chainlink ETH / USD
  },
};

export const ALLOWED_CHAIN_IDS = new Set([31337, 11155111]);

// The mandate written into the vault at deployment (human units).
export const MANDATE = {
  agentDays: 14,
  limits: { payPerTx: 1000, payDaily: 1500, swapPerTx: 500, swapDaily: 1000 },
  risk: { maxSlippageBps: 100, maxRiskBps: 4000, maxOracleAge: 7200 },
  payees: { landlord: 900, utility: 150 },
  funding: { usd: 12000, eth: 1.2 },
  poolUsd: 500000,
};

export function network(name) {
  const n = NETWORKS[name];
  if (!n) throw new Error(`Unknown network "${name}". Use one of: ${Object.keys(NETWORKS).join(', ')}`);
  if (!ALLOWED_CHAIN_IDS.has(n.chain.id)) throw new Error(`Chain ${n.chain.id} is not a test chain.`);
  return { name, ...n };
}
