import type { AuthHandler } from "./index.js";
import type { FetchResult } from "../feeds/fetcher.js";
import { logger } from "../utils/logger.js";

interface X402Config {
  type: "x402";
  wallet_key: string;
  network: "base" | "base-sepolia";
  max_per_call: number;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

class BudgetTracker {
  private dailySpend = 0;
  private lastResetDate = this.todayUTC();

  canSpend(amount: number, dailyMax?: number): boolean {
    this.maybeReset();
    if (!dailyMax) return true;
    return this.dailySpend + amount <= dailyMax;
  }

  recordSpend(amount: number): void {
    this.maybeReset();
    this.dailySpend += amount;
  }

  getCurrentSpend(): number {
    this.maybeReset();
    return this.dailySpend;
  }

  private maybeReset(): void {
    const today = this.todayUTC();
    if (today !== this.lastResetDate) {
      this.dailySpend = 0;
      this.lastResetDate = today;
    }
  }

  private todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

// Shared budget tracker across all x402 handlers
const globalBudgetTracker = new BudgetTracker();

export class X402AuthHandler implements AuthHandler {
  readonly type = "x402";
  private config: X402Config;
  private dailyMax?: number;
  private alertThreshold: number;

  constructor(config: X402Config, budget?: { daily_max?: number; alert_threshold?: number }) {
    this.config = config;
    this.dailyMax = budget?.daily_max;
    this.alertThreshold = budget?.alert_threshold ?? 0.8;
  }

  async applyAuth(_url: URL, _headers: Record<string, string>): Promise<void> {
    // x402 doesn't add auth on the first request — the server returns 402
  }

  async handle402(
    response: FetchResult,
    _url: URL,
    headers: Record<string, string>,
  ): Promise<{ headers: Record<string, string>; cost: number }> {
    // Parse 402 response body
    const body = response.data as {
      accepts?: Array<{
        maxAmountRequired: string;
        payTo: string;
        asset?: string;
        network?: string;
      }>;
    };

    if (!body?.accepts?.length) {
      throw new Error("402 response missing payment requirements (accepts array)");
    }

    const requirement = body.accepts[0];
    const amountWei = BigInt(requirement.maxAmountRequired);
    // Convert from wei (6 decimals for USDC) to USD
    const costUsd = Number(amountWei) / 1e6;

    // Check per-call limit
    if (costUsd > this.config.max_per_call) {
      throw new BudgetExceededError(
        `Payment of $${costUsd.toFixed(4)} exceeds max_per_call limit of $${this.config.max_per_call}`,
      );
    }

    // Check daily budget
    if (!globalBudgetTracker.canSpend(costUsd, this.dailyMax)) {
      throw new BudgetExceededError(
        `Daily budget of $${this.dailyMax} would be exceeded. Current spend: $${globalBudgetTracker.getCurrentSpend().toFixed(4)}`,
      );
    }

    // Sign payment with viem
    const paymentHeader = await this.signPayment(requirement, amountWei);

    // Record spend
    globalBudgetTracker.recordSpend(costUsd);

    // Check alert threshold
    if (this.dailyMax) {
      const currentSpend = globalBudgetTracker.getCurrentSpend();
      if (currentSpend / this.dailyMax >= this.alertThreshold) {
        logger.warn(
          `Budget alert: ${((currentSpend / this.dailyMax) * 100).toFixed(0)}% of daily budget consumed ($${currentSpend.toFixed(4)}/$${this.dailyMax})`,
        );
      }
    }

    return {
      headers: { ...headers, "X-PAYMENT": paymentHeader },
      cost: costUsd,
    };
  }

  private async signPayment(
    requirement: { payTo: string; network?: string },
    amount: bigint,
  ): Promise<string> {
    // Dynamic imports to avoid requiring viem at compile/load time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viem: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viemAccounts: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viemChains: any;
    try {
      viem = await import("viem" as string);
      viemAccounts = await import("viem/accounts" as string);
      viemChains = await import("viem/chains" as string);
    } catch {
      throw new Error(
        "x402 auth requires viem as a peer dependency. Run: npm install viem",
      );
    }

    const chain = this.config.network === "base-sepolia"
      ? viemChains.baseSepolia
      : viemChains.base;

    const account = viemAccounts.privateKeyToAccount(this.config.wallet_key);
    const client = viem.createWalletClient({
      account,
      chain,
      transport: viem.http(),
    });

    // Sign EIP-712 typed data for x402 payment authorization
    const signature = await client.signTypedData({
      domain: {
        name: "x402",
        version: "1",
      },
      types: {
        Payment: [
          { name: "payTo", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "Payment",
      message: {
        payTo: requirement.payTo,
        amount,
        nonce: BigInt(Date.now()),
      },
    });

    // Encode as base64 JSON payload
    const payload = {
      signature,
      from: account.address,
      payTo: requirement.payTo,
      amount: amount.toString(),
      network: this.config.network,
    };

    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }
}

export function createX402AuthHandler(
  config: X402Config,
  budget?: { daily_max?: number; alert_threshold?: number },
): X402AuthHandler {
  return new X402AuthHandler(config, budget);
}
