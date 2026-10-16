// Networks LEASH is allowed to touch. Anything else is refused before a key is even loaded.
// Base mainnet holds real funds: it is refused unless LEASH_REAL_FUNDS names its chain id, and it signs
// with its own key file, never the testnet one.
import { base, foundry, sepolia } from 'viem/chains';

const BASE_ETH_USD = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'; // Chainlink ETH / USD on Base, read 2026-10-15

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
    // drpc then closed Sepolia to free use (2026-10-16 21:39 UTC). Tenderly returned run 1's receipt and replayed it at its block.
    historyRpc: process.env.LEASH_SEPOLIA_RPC ?? 'https://sepolia.gateway.tenderly.co',
    explorer: 'https://sepolia.etherscan.io',
    // Etherscan shows our refusals only as "execution reverted" (sources are on Sourcify); Blockscout decodes them.
    decoder: 'https://eth-sepolia.blockscout.com',
    oracle: '0x694AA1769357215DE4FAC081bf1f309aDC325306', // Chainlink ETH / USD
  },
  // Rehearsal of the Base run: anvil forking Base mainnet under chain id 31337, so the real Chainlink feed
  // answers but no real funds exist. Start it with:
  // anvil --fork-url https://mainnet.base.org --chain-id 31337 --port 8546
  basefork: {
    chain: foundry,
    rpc: process.env.LEASH_BASEFORK_RPC ?? 'http://127.0.0.1:8546',
    explorer: null,
    pollMs: 250,
    oracle: BASE_ETH_USD,
    fork: true, // balances are set with anvil_setBalance, like local
  },
  base: {
    chain: base,
    rpc: process.env.LEASH_BASE_RPC ?? 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    decoder: 'https://base.blockscout.com',
    oracle: BASE_ETH_USD,
    realFunds: true,
    keyFile: 'base-keys.json',
    minRoleEth: '0.0003', // gas is ~0.006 gwei on Base: Sepolia's 0.002 floor would lock ~4x the cost of the run in role keys
  },
};

export const ALLOWED_CHAIN_IDS = new Set([31337, 11155111]);
export const REAL_FUNDS_CHAIN_IDS = new Set([8453]);

// The mandate written into the vault at deployment (human units).
export const MANDATE = {
  agentDays: 14,
  // The key's whole-life budget for tier-1 payments: two weeks of bills (rent 800, electricity 120), 8 % of the vault.
  agentBudget: 1000,
  limits: { payPerTx: 1000, payDaily: 1500, swapPerTx: 500, swapDaily: 1000 },
  risk: { maxSlippageBps: 100, maxRiskBps: 4000, maxOracleAge: 7200 },
  payees: { landlord: 900, utility: 150 },
  // Creditors whose sealed invoices the agent may settle, and the total their seals may take (a semester of fees).
  seals: { school: 6000 },
  // How long a settled invoice stays contestable. The contract's default is a day; the test vaults use 2 minutes
  // so a run or a video can show the release. A real owner would keep a day or more.
  contestSeconds: 120,
  funding: { usd: 12000, eth: 1.2 },
  poolUsd: 500000,
};

export function network(name) {
  const n = NETWORKS[name];
  if (!n) throw new Error(`Unknown network "${name}". Use one of: ${Object.keys(NETWORKS).join(', ')}`);
  if (REAL_FUNDS_CHAIN_IDS.has(n.chain.id)) {
    if (process.env.LEASH_REAL_FUNDS !== String(n.chain.id)) {
      throw new Error(`Chain ${n.chain.id} (${n.chain.name}) holds real funds. Set LEASH_REAL_FUNDS=${n.chain.id} to accept that.`);
    }
  } else if (!ALLOWED_CHAIN_IDS.has(n.chain.id)) throw new Error(`Chain ${n.chain.id} is not a test chain.`);
  return { name, ...n };
}
