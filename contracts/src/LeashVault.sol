// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface ILeashPool {
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to) external returns (uint256);
}

/// @title LeashVault — a two-asset vault an AI agent can operate but cannot drain.
/// @notice Tier 1: the agent acts alone inside on-chain limits. Tier 2: anything above needs an
/// EIP-712 mandate signed by the owner. Tier 3: everything else has no code path at all.
/// The rules live here, not in the agent's prompt, so they hold even if the agent key is stolen.
contract LeashVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Limits {
        uint128 payPerTx; // stable units
        uint128 payDaily; // stable units, autonomous payments per UTC day
        uint128 swapPerTx; // stable-value units
        uint128 swapDaily; // stable-value units per UTC day
    }

    struct Risk {
        uint16 maxSlippageBps; // max distance below the oracle-fair output
        uint16 maxRiskBps; // max share of vault value held in the risk asset after a buy
        uint32 maxOracleAge; // seconds
    }

    bytes32 public constant MANDATE_TYPEHASH =
        keccak256("Mandate(address to,uint256 amount,bytes32 opId,uint64 deadline,uint32 epoch)");

    address public immutable owner;
    IERC20 public immutable stable;
    IERC20 public immutable risky;
    IAggregatorV3 public immutable oracle; // risky / USD; stable is valued at 1 USD
    uint256 private immutable stableUnit;
    uint256 private immutable riskyUnit;
    uint256 private immutable oracleUnit;

    address public agent;
    uint64 public agentExpiry;
    address public guardian;
    bool public paused;
    uint32 public epoch; // bumping it voids every outstanding owner mandate
    ILeashPool public pool;
    Limits public limits;
    Risk public risk;

    mapping(address payee => uint256 cap) public payeeCap; // 0 = not a payee
    mapping(uint256 day => uint256) public paidOnDay;
    mapping(uint256 day => uint256) public swappedOnDay;
    mapping(bytes32 opId => bool) public used;

    event Paid(bytes32 indexed opId, address indexed to, uint256 amount, uint8 tier);
    event Swapped(bytes32 indexed opId, bool buyRisky, uint256 amountIn, uint256 amountOut, uint256 fairOut);
    event AgentSet(address agent, uint64 expiry);
    event PayeeSet(address indexed payee, uint256 cap);
    event LimitsSet(Limits limits);
    event RiskSet(Risk risk);
    event PoolSet(address pool);
    event GuardianSet(address guardian);
    event PausedSet(bool paused, address by);
    event EpochBumped(uint32 epoch);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotAgent();
    error NotGuardian();
    error AgentInactive();
    error VaultPaused();
    error ZeroAmount();
    error OpAlreadyUsed(bytes32 opId);
    error PayeeNotAllowed(address to);
    error AbovePayeeCap(uint256 amount, uint256 cap);
    error AbovePerTxLimit(uint256 amount, uint256 limit);
    error AboveDailyLimit(uint256 wouldBe, uint256 limit);
    error MandateExpired(uint64 deadline);
    error BadMandateSignature();
    error BadOraclePrice();
    error StaleOracle(uint256 updatedAt);
    error SlippageAboveMandate(uint256 minOut, uint256 floor);
    error InsufficientOutput(uint256 received, uint256 minOut);
    error ExposureAboveMandate(uint256 riskBps, uint256 maxRiskBps);
    error NoPool();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// Agent calls require: the agent key, an unexpired mandate, an unpaused vault, a fresh opId.
    modifier agentOp(bytes32 opId) {
        if (msg.sender != agent || agent == address(0)) revert NotAgent();
        if (block.timestamp > agentExpiry) revert AgentInactive();
        if (paused) revert VaultPaused();
        if (used[opId]) revert OpAlreadyUsed(opId);
        used[opId] = true;
        _;
    }

    constructor(address owner_, IERC20 stable_, IERC20 risky_, IAggregatorV3 oracle_) EIP712("LeashVault", "1") {
        require(owner_ != address(0) && address(stable_) != address(0), "zero");
        require(address(risky_) != address(0) && address(oracle_) != address(0), "zero");
        owner = owner_;
        stable = stable_;
        risky = risky_;
        oracle = oracle_;
        stableUnit = 10 ** IERC20Metadata(address(stable_)).decimals();
        riskyUnit = 10 ** IERC20Metadata(address(risky_)).decimals();
        oracleUnit = 10 ** oracle_.decimals();
    }

    // ---------------------------------------------------------------- agent, tier 1

    function pay(address to, uint256 amount, bytes32 opId) external nonReentrant agentOp(opId) {
        if (amount == 0) revert ZeroAmount();
        uint256 cap = payeeCap[to];
        if (cap == 0) revert PayeeNotAllowed(to);
        if (amount > cap) revert AbovePayeeCap(amount, cap);
        if (amount > limits.payPerTx) revert AbovePerTxLimit(amount, limits.payPerTx);
        uint256 day = block.timestamp / 1 days;
        uint256 wouldBe = paidOnDay[day] + amount;
        if (wouldBe > limits.payDaily) revert AboveDailyLimit(wouldBe, limits.payDaily);
        paidOnDay[day] = wouldBe;
        emit Paid(opId, to, amount, 1);
        stable.safeTransfer(to, amount);
    }

    function swap(bool buyRisky, uint256 amountIn, uint256 minOut, bytes32 opId)
        external
        nonReentrant
        agentOp(opId)
        returns (uint256 received)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (address(pool) == address(0)) revert NoPool();
        uint256 price = _price();
        _spendSwapBudget(buyRisky ? amountIn : _riskyToStable(amountIn, price));

        // The floor comes from the oracle, never from the agent: a manipulated pool cannot pass it.
        uint256 fair = buyRisky ? _stableToRisky(amountIn, price) : _riskyToStable(amountIn, price);
        uint256 floor = fair * (10_000 - risk.maxSlippageBps) / 10_000;
        if (minOut < floor) revert SlippageAboveMandate(minOut, floor);

        received = _executeSwap(buyRisky, amountIn, minOut);
        if (buyRisky) {
            uint256 bps = _riskBps(price);
            if (bps > risk.maxRiskBps) revert ExposureAboveMandate(bps, risk.maxRiskBps);
        }
        emit Swapped(opId, buyRisky, amountIn, received, fair);
    }

    // ---------------------------------------------------------------- agent, tier 2

    /// A payment outside tier 1 runs only with the owner's signature over this exact payment.
    function payWithMandate(address to, uint256 amount, bytes32 opId, uint64 deadline, bytes calldata signature)
        external
        nonReentrant
        agentOp(opId)
    {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert MandateExpired(deadline);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(MANDATE_TYPEHASH, to, amount, opId, deadline, epoch)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != owner) revert BadMandateSignature();
        emit Paid(opId, to, amount, 2);
        stable.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- owner and guardian

    /// A new agent key never inherits the old key's mandates.
    function setAgent(address agent_, uint64 expiry) external onlyOwner {
        bool rotated = agent_ != agent;
        agent = agent_;
        agentExpiry = expiry;
        emit AgentSet(agent_, expiry);
        if (rotated) _bumpEpoch();
    }

    /// Kill the agent and void every mandate it holds, in one transaction.
    function revokeAgent() external onlyOwner {
        agent = address(0);
        agentExpiry = 0;
        emit AgentSet(address(0), 0);
        _bumpEpoch();
    }

    function bumpEpoch() external onlyOwner {
        _bumpEpoch();
    }

    function setPayee(address payee, uint256 cap) external onlyOwner {
        payeeCap[payee] = cap;
        emit PayeeSet(payee, cap);
    }

    function setLimits(Limits calldata limits_) external onlyOwner {
        limits = limits_;
        emit LimitsSet(limits_);
    }

    function setRisk(Risk calldata risk_) external onlyOwner {
        require(risk_.maxSlippageBps <= 10_000 && risk_.maxRiskBps <= 10_000, "bps");
        risk = risk_;
        emit RiskSet(risk_);
    }

    function setPool(ILeashPool pool_) external onlyOwner {
        pool = pool_;
        emit PoolSet(address(pool_));
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// The guardian (a watcher bot or a second device) can stop the agent but never restart it.
    function pause() external {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardian();
        paused = true;
        emit PausedSet(true, msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedSet(false, msg.sender);
    }

    function withdraw(IERC20 token, address to, uint256 amount) external nonReentrant onlyOwner {
        require(to != address(0), "zero");
        emit Withdrawn(address(token), to, amount);
        token.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- views

    function today() external view returns (uint256 day, uint256 paid, uint256 swapped) {
        day = block.timestamp / 1 days;
        return (day, paidOnDay[day], swappedOnDay[day]);
    }

    function mandateDigest(address to, uint256 amount, bytes32 opId, uint64 deadline) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(MANDATE_TYPEHASH, to, amount, opId, deadline, epoch)));
    }

    function fairOut(bool buyRisky, uint256 amountIn) external view returns (uint256) {
        uint256 price = _price();
        return buyRisky ? _stableToRisky(amountIn, price) : _riskyToStable(amountIn, price);
    }

    function riskBps() external view returns (uint256) {
        return _riskBps(_price());
    }

    // ---------------------------------------------------------------- internals

    function _spendSwapBudget(uint256 notional) private {
        if (notional > limits.swapPerTx) revert AbovePerTxLimit(notional, limits.swapPerTx);
        uint256 day = block.timestamp / 1 days;
        uint256 wouldBe = swappedOnDay[day] + notional;
        if (wouldBe > limits.swapDaily) revert AboveDailyLimit(wouldBe, limits.swapDaily);
        swappedOnDay[day] = wouldBe;
    }

    function _executeSwap(bool buyRisky, uint256 amountIn, uint256 minOut) private returns (uint256 received) {
        (IERC20 tokenIn, IERC20 tokenOut) = buyRisky ? (stable, risky) : (risky, stable);
        uint256 before = tokenOut.balanceOf(address(this));
        tokenIn.forceApprove(address(pool), amountIn);
        // The pool's own return value is ignored on purpose: only the measured balance counts.
        // forge-lint: disable-next-line(unused-return)
        pool.swapExactIn(address(tokenIn), amountIn, minOut, address(this));
        tokenIn.forceApprove(address(pool), 0); // no allowance survives the call
        received = tokenOut.balanceOf(address(this)) - before;
        if (received < minOut) revert InsufficientOutput(received, minOut);
    }

    function _riskBps(uint256 price) private view returns (uint256) {
        uint256 riskyValue = _riskyToStable(risky.balanceOf(address(this)), price);
        uint256 total = riskyValue + stable.balanceOf(address(this));
        return total == 0 ? 0 : riskyValue * 10_000 / total;
    }

    function _bumpEpoch() private {
        epoch += 1;
        emit EpochBumped(epoch);
    }

    function _price() private view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        if (answer <= 0) revert BadOraclePrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > risk.maxOracleAge) revert StaleOracle(updatedAt);
        // casting to 'uint256' is safe because answer > 0 was checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(answer);
    }

    function _stableToRisky(uint256 amount, uint256 price) private view returns (uint256) {
        return amount * riskyUnit * oracleUnit / (price * stableUnit);
    }

    function _riskyToStable(uint256 amount, uint256 price) private view returns (uint256) {
        return amount * price * stableUnit / (riskyUnit * oracleUnit);
    }
}
