// Networks LEASH is allowed to touch. Anything else is refused before a key is even loaded.
import { foundry, sepolia } from 'viem/chains';

export const NETWORKS = {
  local: {
    chain: foundry,
    rpc: process.env.LEASH_LOCAL_RPC ?? 'http://127.0.0.1:8545',
    explorer: null,
    pollMs: 250, // anvil mines at once; viem's 4 s default made A9 (5 txs) take 20 s
    oracle: null, // a MockAggregator is deployed locally
  },
  sepolia: {
    chain: sepolia,
    rpc: process.env.LEASH_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    // Audits read old receipts: publicnode stopped returning ours about a day after they were mined (2026-10-16).
    historyRpc: process.env.LEASH_SEPOLIA_RPC ?? 'https://sepolia.drpc.org',
    explorer: 'https://sepolia.etherscan.io',
    // Etherscan shows our refusals only as "execution reverted" (sources are on Sourcify); Blockscout decodes them.
    decoder: 'https://eth-sepolia.blockscout.com',
    oracle: '0x694AA1769357215DE4FAC081bf1f309aDC325306', // Chainlink ETH / USD
  },
};

export const ALLOWED_CHAIN_IDS = new Set([31337, 11155111]);

// The mandate written into the vault at deployment (human units).
export const MANDATE = {
  agentDays: 14,
  // The key's whole-life budget for tier-1 payments: two weeks of bills (rent 800, electricity 120), 8 % of the vault.
  agentBudget: 1000,
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
