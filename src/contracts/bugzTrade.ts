import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  parseEther,
  parseUnits
} from "ethers";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";

import { appChain, chainConfig } from "../config/chains";
import { authController } from "../services";
import type { HexString } from "../types/domain";
import { normalizeAddress } from "../lib/utils";

import { clearBugzTokenCache, getBugzTokenMetadata } from "./bugzToken";

const BASE_CHAIN_ID = 8453;
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const PERMIT2_BASE = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const UNISWAP_V4_QUOTER_BASE = "0x0d5e0f971ed27fbff6c2837bf31316121532048d";
const UNISWAP_UNIVERSAL_ROUTER_211_BASE = "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7";
const SLIPPAGE_DENOMINATOR = 10_000n;
const MAX_UINT160 = (1n << 160n) - 1n;
const PERMIT2_EXPIRATION_SECONDS = 60 * 60 * 24 * 30;
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

const COMMAND_WRAP_ETH = "0b";
const COMMAND_UNWRAP_WETH = "0c";
const COMMAND_V4_SWAP = "10";
const ACTION_SWAP_EXACT_IN_SINGLE = "06";
const ACTION_SETTLE = "0b";
const ACTION_SETTLE_ALL = "0c";
const ACTION_TAKE = "0e";
const ACTION_TAKE_ALL = "0f";

const abiCoder = AbiCoder.defaultAbiCoder();
const poolKeyAbiType =
  "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const exactInputSingleAbiType =
  `tuple(${poolKeyAbiType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`;

const quoterV4Abi = [
  `function quoteExactInputSingle((${poolKeyAbiType} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`
];

const universalRouterAbi = ["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"];

const erc20TradeAbi = [
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 value) returns (bool)"
];

const permit2Abi = [
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)"
];

export type BugzTradeSide = "buy" | "sell";

export type BugzPoolKey = {
  currency0: HexString;
  currency1: HexString;
  fee: number;
  tickSpacing: number;
  hooks: HexString;
};

export type BugzPool = {
  id: HexString | "";
  protocol: "Uniswap v4";
  pairedToken: HexString;
  key: BugzPoolKey;
};

export type BugzTradeQuote = {
  side: BugzTradeSide;
  pool: BugzPool;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMinimum: bigint;
  inputSymbol: string;
  outputSymbol: string;
  inputDecimals: number;
  outputDecimals: number;
};

export type BugzTradeResult = {
  txHash: HexString;
  approvalTxHashes?: HexString[];
  quote: BugzTradeQuote;
};

const readProvider = new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.id);
let poolCache: { value: BugzPool; expiresAt: number } | null = null;

const assertBaseTrading = () => {
  if (chainConfig.id !== BASE_CHAIN_ID) {
    throw new Error("BUGZ onchain trading is only configured for Base mainnet.");
  }
  if (!chainConfig.bugzTokenAddress) {
    throw new Error("BUGZ token address is not configured.");
  }
};

const connectedAddress = (): HexString => {
  const address = authController.getSession().address;
  if (!address) {
    throw new Error("Connect a wallet before trading BUGZ.");
  }
  return address;
};

const getWriteSigner = async () => {
  const account = authController.getActiveAccount();
  if (account) {
    return ethers6Adapter.signer.toEthers({
      client: authController.requireClient(),
      chain: appChain,
      account
    });
  }

  const session = authController.getSession();
  const localIdentity = authController.getLocalIdentity();
  if (session.mode === "local" && localIdentity && session.address === localIdentity.address) {
    return new Wallet(localIdentity.privateKey, readProvider);
  }

  throw new Error("Connect with a wallet that can sign Base transactions before trading BUGZ.");
};

const addressAsBigInt = (value: string): bigint => BigInt(value.toLowerCase());

const buildPoolKey = (): BugzPoolKey => {
  if (
    !chainConfig.bugzV4PoolHook ||
    !chainConfig.bugzV4PairedToken ||
    !chainConfig.bugzV4PoolFee ||
    !chainConfig.bugzV4TickSpacing
  ) {
    throw new Error("BUGZ v4 pool settings are not configured for this token.");
  }

  if (chainConfig.bugzV4PairedToken.toLowerCase() !== WETH_BASE.toLowerCase()) {
    throw new Error("BUGZ trading currently expects a WETH-paired Clanker pool.");
  }

  const tokenAddress = chainConfig.bugzTokenAddress;
  const pairedToken = chainConfig.bugzV4PairedToken;
  const tokenIsCurrency0 = addressAsBigInt(tokenAddress) < addressAsBigInt(pairedToken);

  return {
    currency0: normalizeAddress(tokenIsCurrency0 ? tokenAddress : pairedToken),
    currency1: normalizeAddress(tokenIsCurrency0 ? pairedToken : tokenAddress),
    fee: chainConfig.bugzV4PoolFee,
    tickSpacing: chainConfig.bugzV4TickSpacing,
    hooks: normalizeAddress(chainConfig.bugzV4PoolHook)
  };
};

export const getBugzTradingPool = async (): Promise<BugzPool> => {
  assertBaseTrading();
  if (poolCache && poolCache.expiresAt > Date.now()) {
    return poolCache.value;
  }

  const pool = {
    id: chainConfig.bugzV4PoolId,
    protocol: "Uniswap v4",
    pairedToken: normalizeAddress(chainConfig.bugzV4PairedToken || WETH_BASE),
    key: buildPoolKey()
  } satisfies BugzPool;

  poolCache = { value: pool, expiresAt: Date.now() + 30_000 };
  return pool;
};

const slippageBps = (raw: string): bigint => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 100n;
  }
  return BigInt(Math.max(1, Math.min(5_000, Math.round(parsed * 100))));
};

export const parseSlippageBps = (raw: string): bigint => slippageBps(raw);

const isInputCurrency0 = (pool: BugzPool, side: BugzTradeSide): boolean => {
  const input = side === "buy" ? pool.pairedToken : normalizeAddress(chainConfig.bugzTokenAddress);
  return input.toLowerCase() === pool.key.currency0.toLowerCase();
};

const quoteV4ExactInput = async (pool: BugzPool, side: BugzTradeSide, amountIn: bigint): Promise<bigint> => {
  const quoter = new Contract(UNISWAP_V4_QUOTER_BASE, quoterV4Abi, readProvider);
  const quoted = (await quoter.quoteExactInputSingle.staticCall({
    poolKey: pool.key,
    zeroForOne: isInputCurrency0(pool, side),
    exactAmount: amountIn,
    hookData: "0x"
  })) as [bigint, bigint];
  return quoted[0];
};

export const quoteBugzTrade = async (
  side: BugzTradeSide,
  rawAmount: string,
  rawSlippagePercent: string
): Promise<BugzTradeQuote> => {
  assertBaseTrading();
  const metadata = await getBugzTokenMetadata();
  const tokenDecimals = metadata?.decimals ?? 18;
  const pool = await getBugzTradingPool();
  const amountIn = side === "buy" ? parseEther(rawAmount || "0") : parseUnits(rawAmount || "0", tokenDecimals);
  if (amountIn <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }

  const amountOut = await quoteV4ExactInput(pool, side, amountIn);
  if (amountOut <= 0n) {
    throw new Error("The BUGZ pool returned a zero quote.");
  }

  const bps = parseSlippageBps(rawSlippagePercent);
  const amountOutMinimum = (amountOut * (SLIPPAGE_DENOMINATOR - bps)) / SLIPPAGE_DENOMINATOR;

  return {
    side,
    pool,
    amountIn,
    amountOut,
    amountOutMinimum,
    inputSymbol: side === "buy" ? chainConfig.nativeSymbol : metadata?.symbol ?? "BUGZ",
    outputSymbol: side === "buy" ? metadata?.symbol ?? "BUGZ" : chainConfig.nativeSymbol,
    inputDecimals: side === "buy" ? 18 : tokenDecimals,
    outputDecimals: side === "buy" ? tokenDecimals : 18
  };
};

const encodeExactInputSingle = (quote: BugzTradeQuote): string =>
  abiCoder.encode(
    [exactInputSingleAbiType],
    [
      [
        [
          quote.pool.key.currency0,
          quote.pool.key.currency1,
          quote.pool.key.fee,
          quote.pool.key.tickSpacing,
          quote.pool.key.hooks
        ],
        isInputCurrency0(quote.pool, quote.side),
        quote.amountIn,
        quote.amountOutMinimum,
        0,
        "0x"
      ]
    ]
  );

const encodeV4Swap = (actions: string, params: string[]): string => abiCoder.encode(["bytes", "bytes[]"], [actions, params]);

const deadline = (): number => Math.floor(Date.now() / 1000) + 60 * 5;

const approvalHash = (receiptHash: string | null | undefined, fallback: string): HexString =>
  normalizeAddress(receiptHash ?? fallback);

const approveBugzForPermit2 = async (owner: HexString, amount: bigint, signer: Awaited<ReturnType<typeof getWriteSigner>>) => {
  const token = new Contract(chainConfig.bugzTokenAddress, erc20TradeAbi, signer);
  const allowance = (await token.allowance(owner, PERMIT2_BASE)) as bigint;
  if (allowance >= amount) {
    return null;
  }

  const approval = await token.approve(PERMIT2_BASE, amount);
  const receipt = await approval.wait();
  return approvalHash(receipt?.hash, approval.hash);
};

const approvePermit2ForRouter = async (owner: HexString, amount: bigint, signer: Awaited<ReturnType<typeof getWriteSigner>>) => {
  if (amount > MAX_UINT160) {
    throw new Error("BUGZ sell amount is too large for Permit2.");
  }

  const permit2 = new Contract(PERMIT2_BASE, permit2Abi, signer);
  const [allowance, expiration] = (await permit2.allowance(
    owner,
    chainConfig.bugzTokenAddress,
    UNISWAP_UNIVERSAL_ROUTER_211_BASE
  )) as [bigint, bigint, bigint];
  const minExpiration = BigInt(Math.floor(Date.now() / 1000) + 60);
  if (allowance >= amount && expiration > minExpiration) {
    return null;
  }

  const permitExpiration = Math.floor(Date.now() / 1000) + PERMIT2_EXPIRATION_SECONDS;
  const approval = await permit2.approve(
    chainConfig.bugzTokenAddress,
    UNISWAP_UNIVERSAL_ROUTER_211_BASE,
    amount,
    permitExpiration
  );
  const receipt = await approval.wait();
  return approvalHash(receipt?.hash, approval.hash);
};

export const buyBugzOnchain = async (
  rawEthAmount: string,
  rawSlippagePercent: string
): Promise<BugzTradeResult> => {
  const quote = await quoteBugzTrade("buy", rawEthAmount, rawSlippagePercent);
  const signer = await getWriteSigner();
  const router = new Contract(UNISWAP_UNIVERSAL_ROUTER_211_BASE, universalRouterAbi, signer);
  const wrapInput = abiCoder.encode(["address", "uint256"], [ADDRESS_THIS, quote.amountIn]);
  const swapInput = encodeV4Swap(`0x${ACTION_SWAP_EXACT_IN_SINGLE}${ACTION_SETTLE}${ACTION_TAKE_ALL}`, [
    encodeExactInputSingle(quote),
    abiCoder.encode(["address", "uint256", "bool"], [quote.pool.pairedToken, quote.amountIn, false]),
    abiCoder.encode(["address", "uint256"], [chainConfig.bugzTokenAddress, quote.amountOutMinimum])
  ]);
  const tx = await router.execute(`0x${COMMAND_WRAP_ETH}${COMMAND_V4_SWAP}`, [wrapInput, swapInput], deadline(), {
    value: quote.amountIn
  });
  const receipt = await tx.wait();
  clearBugzTokenCache();
  return {
    txHash: normalizeAddress(receipt?.hash ?? tx.hash),
    quote
  };
};

export const sellBugzOnchain = async (
  rawBugzAmount: string,
  rawSlippagePercent: string
): Promise<BugzTradeResult> => {
  const quote = await quoteBugzTrade("sell", rawBugzAmount, rawSlippagePercent);
  const signer = await getWriteSigner();
  const owner = connectedAddress();
  const approvalTxHashes = [
    await approveBugzForPermit2(owner, quote.amountIn, signer),
    await approvePermit2ForRouter(owner, quote.amountIn, signer)
  ].filter((hash): hash is HexString => Boolean(hash));

  const router = new Contract(UNISWAP_UNIVERSAL_ROUTER_211_BASE, universalRouterAbi, signer);
  const swapInput = encodeV4Swap(`0x${ACTION_SWAP_EXACT_IN_SINGLE}${ACTION_SETTLE_ALL}${ACTION_TAKE}`, [
    encodeExactInputSingle(quote),
    abiCoder.encode(["address", "uint256"], [chainConfig.bugzTokenAddress, quote.amountIn]),
    abiCoder.encode(["address", "address", "uint256"], [quote.pool.pairedToken, ADDRESS_THIS, quote.amountOutMinimum])
  ]);
  const unwrapInput = abiCoder.encode(["address", "uint256"], [owner, quote.amountOutMinimum]);
  const tx = await router.execute(`0x${COMMAND_V4_SWAP}${COMMAND_UNWRAP_WETH}`, [swapInput, unwrapInput], deadline());
  const receipt = await tx.wait();
  clearBugzTokenCache();

  return {
    txHash: normalizeAddress(receipt?.hash ?? tx.hash),
    approvalTxHashes,
    quote
  };
};
