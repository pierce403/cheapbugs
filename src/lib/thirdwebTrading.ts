import { parseEther, parseUnits } from "ethers";
import { createThirdwebClient, NATIVE_TOKEN_ADDRESS } from "thirdweb";
import * as Bridge from "thirdweb/bridge";

import { chainConfig } from "../config/chains";
import { env } from "../config/env";
import type { HexString } from "../types/domain";

export const MIN_BASE_ETH_FOR_GAS = parseEther("0.0005");

const BASE_CHAIN_ID = 8453;
const GAS_TOP_UP_AMOUNT = parseEther("0.002");
const BUGZ_ROUTE_PROBE_AMOUNT = parseUnits("2000000", 18);
const ONRAMP_PROVIDERS = ["stripe", "coinbase", "transak"] as const;

type OnrampProvider = (typeof ONRAMP_PROVIDERS)[number];

export type ThirdwebRouteStatus =
  | {
      status: "available";
      message: string;
      steps: number;
    }
  | {
      status: "unavailable" | "disabled";
      message: string;
    };

export type ThirdwebOnrampLink = {
  link: string;
  provider: OnrampProvider;
  destination: "BUGZ" | "Base ETH";
};

const client = createThirdwebClient({ clientId: env.thirdwebClientId });

const shortenError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
};

const safeHttpsLink = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("thirdweb returned a non-HTTPS checkout link.");
  }
  return url.toString();
};

export const thirdwebTradingCapabilities = () => ({
  bridgeApiAvailable: true,
  buyWidgetRequested: chainConfig.enableThirdwebBuyWidget,
  swapWidgetRequested: chainConfig.enableThirdwebSwapWidget,
  directBugzRoute: "runtime-check" as const,
  bugzSellRoute: "hidden-by-policy" as const
});

export const checkThirdwebBugzBuyRoute = async (): Promise<ThirdwebRouteStatus> => {
  if (chainConfig.id !== BASE_CHAIN_ID) {
    return {
      status: "disabled",
      message: "thirdweb easy buy is configured for BUGZ on Base mainnet only."
    };
  }
  if (!chainConfig.bugzTokenAddress) {
    return {
      status: "disabled",
      message: "BUGZ token address is not configured."
    };
  }

  try {
    const quote = await Bridge.Buy.quote({
      client,
      originChainId: BASE_CHAIN_ID,
      originTokenAddress: NATIVE_TOKEN_ADDRESS,
      destinationChainId: BASE_CHAIN_ID,
      destinationTokenAddress: chainConfig.bugzTokenAddress,
      buyAmountWei: BUGZ_ROUTE_PROBE_AMOUNT,
      maxSteps: 3
    });

    return {
      status: "available",
      steps: quote.steps.length,
      message: `thirdweb returned a Base ETH -> BUGZ crypto route with ${quote.steps.length} step${
        quote.steps.length === 1 ? "" : "s"
      }. Easy Buy still depends on thirdweb checkout availability; use Advanced Trading if checkout routing fails.`
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: `thirdweb direct BUGZ routing is unavailable right now: ${shortenError(
        error
      )}. Use Add Base ETH, then Advanced Trading below.`
    };
  }
};

const prepareOnramp = async (
  destination: ThirdwebOnrampLink["destination"],
  receiver: HexString,
  tokenAddress: HexString,
  amount?: bigint
): Promise<ThirdwebOnrampLink> => {
  const errors: string[] = [];

  for (const provider of ONRAMP_PROVIDERS) {
    try {
      const prepared = await Bridge.Onramp.prepare({
        client,
        onramp: provider,
        chainId: BASE_CHAIN_ID,
        tokenAddress,
        receiver,
        amount,
        currency: "USD",
        country: "US",
        maxSteps: 3,
        purchaseData: {
          app: "cheapbugs",
          destination
        }
      });

      return {
        link: safeHttpsLink(prepared.link),
        provider,
        destination
      };
    } catch (error) {
      errors.push(`${provider}: ${shortenError(error)}`);
    }
  }

  throw new Error(`thirdweb ${destination} checkout is unavailable. ${errors.join(" ")}`);
};

export const prepareThirdwebBugzOnramp = async (receiver: HexString): Promise<ThirdwebOnrampLink> => {
  if (chainConfig.id !== BASE_CHAIN_ID || !chainConfig.bugzTokenAddress) {
    throw new Error("thirdweb BUGZ checkout is configured for BUGZ on Base mainnet only.");
  }
  return prepareOnramp("BUGZ", receiver, chainConfig.bugzTokenAddress, BUGZ_ROUTE_PROBE_AMOUNT);
};

export const prepareThirdwebBaseEthOnramp = async (receiver: HexString): Promise<ThirdwebOnrampLink> =>
  prepareOnramp("Base ETH", receiver, NATIVE_TOKEN_ADDRESS, GAS_TOP_UP_AMOUNT);

// Keep thirdweb-powered selling hidden until we deliberately ship an experimental sell UX.
// The direct Clanker / Uniswap v4 sell form remains the reliable default sell path.
export const shouldShowThirdwebSellExperiment = (): boolean => false;
