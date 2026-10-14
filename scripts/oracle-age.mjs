// Reads the Sepolia Chainlink ETH/USD feed and prints the age of its last answers.
// Usage: node scripts/oracle-age.mjs [rounds]
import { createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';

const FEED = '0x694AA1769357215DE4FAC081bf1f309aDC325306';
const abi = parseAbi([
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
  'function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)',
]);
const pub = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
const n = Number(process.argv[2] ?? 12);

const now = BigInt(Math.floor(Date.now() / 1000));
let [id, answer, , updatedAt] = await pub.readContract({ address: FEED, abi, functionName: 'latestRoundData' });
console.log(`latest ${Number(answer) / 1e8} USD, ${now - updatedAt}s old`);
const gaps = [];
for (let i = 0; i < n; i++) {
  const [, , , prev] = await pub.readContract({ address: FEED, abi, functionName: 'getRoundData', args: [id - 1n] });
  gaps.push(Number(updatedAt - prev));
  id -= 1n;
  updatedAt = prev;
}
console.log(`gaps between the last ${n} rounds (s): ${gaps.join(' ')}`);
console.log(`max gap ${Math.max(...gaps)} s`);
