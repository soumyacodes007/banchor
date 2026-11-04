// Runs the real server against a real chain, through every buy loop.
//
// Local:
//   anvil --port 8546 --chain-id 10143
//   DEPLOYER_PRIVATE_KEY=<anvil key 0> ADDRESSES_OUT=../backend/addresses.local.json \
//     forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
//   DEPLOYER_PRIVATE_KEY=<anvil key 0> node e2e.ts
//
// Testnet, which spends about 0.5 MON:
//   RPC_URL=https://testnet-rpc.monad.xyz ADDRESSES_PATH=addresses.json \
//     node --env-file=../contracts/.env e2e.ts
//
// The dashboard signs with a passkey or session key through a smart account.
// This signs with plain keys, so it covers everything but that step.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadAddresses } from "./chain.ts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8546";
const PORT = 4055;
const API = `http://127.0.0.1:${PORT}`;
const ADDRESSES_PATH =
  process.env.ADDRESSES_PATH ??
  join(import.meta.dirname, "addresses.local.json");
const EXPLORER = "https://testnet.monadvision.com";
const KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (KEY === undefined) throw new Error("DEPLOYER_PRIVATE_KEY is required");

const SCROLL = 0;
const HIGHLIGHT = 1;
const USER_GAS = parseEther("0.3");
const JUDGE_GAS = parseEther("0.15");
/**
 * Monad executes a few blocks behind consensus, so a wallet funded a moment ago
 * is refused for "insufficient balance" until its balance catches up.
 */
const FUNDS_SETTLE_MS = 4_000;
const fundsSettled = () =>
  new Promise((resolve) => setTimeout(resolve, FUNDS_SETTLE_MS));

const USDC_ABI = parseAbi([
  "function faucet()",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const BASKET_ABI = parseAbi([
  "function buy(address stock, uint256 amount, uint256 minOut, uint8 source) returns (uint256)",
  "function buyBasket(address[] stocks, uint256[] amounts, uint256[] minOuts, uint8 source, address ref) returns (uint256[])",
  "function buyFor(address to, address stock, uint256 amount, uint256 minOut) returns (uint256)",
]);

const addresses = loadAddresses(ADDRESSES_PATH);
const chain = defineChain({
  id: addresses.chainId,
  name: "monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const client = createPublicClient({
  chain,
  transport: http(RPC),
  pollingInterval: 500,
});
const walletFor = (key: Hex) =>
  createWalletClient({
    account: privateKeyToAccount(key),
    chain,
    transport: http(RPC),
  });
type Wallet = ReturnType<typeof walletFor>;

// Chain history outlives a run, so each run gets wallets with none, as a real
// user's would be. The deployer only pays for their gas.
const funder = walletFor(KEY);
const user = walletFor(generatePrivateKey());
const USER = user.account.address;
const judge = walletFor(generatePrivateKey());
const JUDGE = judge.account.address;
const friend = privateKeyToAccount(generatePrivateKey()).address;
const sent: { label: string; hash: Hex }[] = [];

let passed = 0;
function ok(condition: unknown, name: string, detail?: unknown): void {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  passed++;
  console.log(`  ok   ${name}`);
}

async function call(path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function mined(label: string, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${label} reverted: ${hash}`);
  sent.push({ label, hash });
  return hash;
}

async function until<result>(
  read: () => Promise<result | false | undefined>,
  name: string,
  timeoutMs = 20_000,
): Promise<result> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out: ${name}`);
}

const indexed = (hash: Hex) =>
  until(async () => {
    const { body } = await call("/api/stats");
    return body.latest.some(({ txHash }: any) => txHash === hash);
  }, `indexing ${hash}`);

const approve = async (wallet: Wallet, amount: bigint) =>
  mined(
    "approve",
    await wallet.writeContract({
      address: addresses.usdc,
      abi: USDC_ABI,
      functionName: "approve",
      args: [addresses.basket, amount],
    }),
  );

const buyBasket = async (wallet: Wallet, label: string, basket: any) =>
  mined(
    label,
    await wallet.writeContract({
      address: addresses.basket,
      abi: BASKET_ABI,
      functionName: "buyBasket",
      args: [
        basket.stocks as Address[],
        basket.amounts.map(BigInt),
        basket.minOuts.map(BigInt),
        basket.source,
        basket.ref as Address,
      ],
    }),
  );

const dataDir = mkdtempSync(join(tmpdir(), "doomscroll-"));
const server = spawn(process.execPath, ["server.ts"], {
  cwd: import.meta.dirname,
  env: {
    ...process.env,
    PORT: String(PORT),
    RPC_URLS: process.env.RPC_URLS ?? RPC,
    ADDRESSES_PATH,
    DB_PATH: join(dataDir, "test.sqlite"),
    NODE_NO_WARNINGS: "1",
    // The server must work without the key this script holds.
    DEPLOYER_PRIVATE_KEY: "",
  },
  stdio: "inherit",
});

async function run() {
  for (let attempt = 0; ; attempt++) {
    const up = await fetch(`${API}/health`).catch(() => undefined);
    if (up?.ok) break;
    if (attempt > 80) throw new Error("server did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`\nChain ${addresses.chainId}, user ${USER}, judge ${JUDGE}`);

  // A fresh database starts at the deploy block, so let it reach the tip first.
  await until(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const { body } = await call("/health");
      const latest = await client.getBlockNumber();
      return BigInt(body.indexedBlock ?? 0) >= latest - 10n;
    },
    "indexer catching up",
    200_000,
  );

  const before = (await call("/api/stats")).body;

  console.log("\nPrices");
  const prices = (await call("/api/prices")).body;
  ok(Object.keys(prices).length === 20, "all 20 stocks are priced", prices);
  ok(typeof prices.NVDAx === "number", "the highlight card can read a price");
  console.log(`  NVDAx $${prices.NVDAx}, METAx $${prices.METAx}`);

  console.log("\nTop up");
  await mined(
    "fund the user's gas",
    await funder.sendTransaction({ to: USER, value: USER_GAS }),
  );
  await fundsSettled();
  await mined(
    "top up",
    await user.writeContract({
      address: addresses.usdc,
      abi: USDC_ABI,
      functionName: "faucet",
    }),
  );
  await approve(user, 500_000_000n);
  ok(true, "faucet and approval landed");

  console.log("\nScroll dividends");
  await call("/api/minutes", {
    address: USER,
    minutes: { METAx: 840, GOOGLx: 300, X: 360 },
    liveMinutes: { METAx: 20 / 60 },
  });
  const basket = (await call(`/api/basket/${USER}`)).body;
  ok(
    basket.items[0].usd === "$8.73",
    "$8.40 plus the stage's 20 seconds is ready to buy",
    basket.items,
  );
  const scrollHash = await buyBasket(user, "scroll basket", basket);
  const startedAt = Date.now();
  await indexed(scrollHash);
  console.log(`  indexed ${Date.now() - startedAt} ms after confirmation`);
  ok(Date.now() - startedAt < 2_000, "the counter updates within the PRD's 2 s");
  const again = (await call(`/api/basket/${USER}`)).body;
  ok(again.items.length === 0, "a second tap has nothing to buy", again.items);

  console.log("\nA 30 minute chunk");
  await call("/api/minutes", {
    address: USER,
    minutes: { METAx: 870, GOOGLx: 300, X: 360 },
    liveMinutes: { METAx: 20 / 60 },
  });
  const chunkHash = await mined(
    "scroll chunk",
    await user.writeContract({
      address: addresses.basket,
      abi: BASKET_ABI,
      functionName: "buy",
      args: [addresses.stocks.METAx!, 300_000n, 0n, SCROLL],
    }),
  );
  await indexed(chunkHash);
  const afterChunk = (await call(`/api/basket/${USER}`)).body;
  ok(afterChunk.items.length === 0, "a chunk comes off the weekly basket", afterChunk);

  console.log("\nHighlight to buy");
  const highlightHash = await mined(
    "highlight $5 of NVDAx",
    await user.writeContract({
      address: addresses.basket,
      abi: BASKET_ABI,
      functionName: "buy",
      args: [addresses.stocks.NVDAx!, 5_000_000n, 0n, HIGHLIGHT],
    }),
  );
  await indexed(highlightHash);
  const portfolio = (await call(`/api/portfolio/${USER}`)).body;
  const nvda = portfolio.holdings.find((h: any) => h.ticker === "NVDAx");
  ok(nvda?.usd === "$4.99" || nvda?.usd === "$5.00", "NVDAx is in the wallet", nvda);
  ok(portfolio.NVDAx?.usd > 4.9, "the highlight card can read You own", portfolio);
  console.log(`  portfolio ${portfolio.totalUsd}`);

  console.log("\nGift");
  const giftHash = await mined(
    "gift $1 of METAx",
    await user.writeContract({
      address: addresses.basket,
      abi: BASKET_ABI,
      functionName: "buyFor",
      args: [friend, addresses.stocks.METAx!, 1_000_000n, 0n],
    }),
  );
  await indexed(giftHash);
  const gifted = (await call(`/api/portfolio/${friend}`)).body;
  ok(gifted.holdings[0]?.ticker === "METAx", "the friend received the stock", gifted);

  console.log("\nCopy this basket, from a brand new wallet");
  await mined(
    "fund the judge's gas",
    await funder.sendTransaction({ to: JUDGE, value: JUDGE_GAS }),
  );
  await fundsSettled();
  await mined(
    "judge tops up",
    await judge.writeContract({
      address: addresses.usdc,
      abi: USDC_ABI,
      functionName: "faucet",
    }),
  );
  const copy = (await call(`/api/copy/${USER}?usd=10`)).body;
  ok(copy.totalUsd === "$10.00" && copy.ref === USER, "the copy is ready", copy);
  await approve(judge, BigInt(copy.total));
  const copyHash = await buyBasket(judge, "judge copies the basket", copy);
  await indexed(copyHash);
  const copied = (await call(`/api/portfolio/${JUDGE}`)).body;
  ok(
    copied.holdings.length === copy.items.length,
    "the judge now holds the same stocks",
    copied,
  );

  console.log("\nDetox");
  // Light enough to come in under the baseline however early in the week it is.
  await call("/api/minutes", { address: USER, minutes: { METAx: 1 } });
  const detox = (await call(`/api/basket/${USER}?mode=detox`)).body;
  ok(detox.items[0].ticker === "SPYx", "detox buys the S&P 500", detox.items);
  const detoxHash = await buyBasket(user, "detox SPYx", detox);
  await indexed(detoxHash);
  const spy = (await call(`/api/portfolio/${USER}`)).body.holdings.find(
    (h: any) => h.ticker === "SPYx",
  );
  ok(BigInt(spy?.balance ?? 0) > 0n, "SPYx landed in the wallet", spy);

  console.log("\nThe stage counter");
  const stats = (await call("/api/stats")).body;
  console.log(`  ${JSON.stringify({ ...stats, latest: stats.latest.length })}`);
  const added = (source: string) =>
    stats.bySource[source] - before.bySource[source];
  ok(
    stats.totalTransactions - before.totalTransactions === 6,
    "every buy is counted once",
    stats,
  );
  ok(
    added("SCROLL") === 3 &&
      added("HIGHLIGHT") === 1 &&
      added("COPY") === 1 &&
      added("GIFT") === 1,
    "the split by source is right",
    stats.bySource,
  );
  ok(
    stats.uniqueWallets - before.uniqueWallets === 2,
    "both wallets are counted",
    stats,
  );

  console.log("\nRoast card");
  await call("/api/minutes", {
    address: USER,
    minutes: { METAx: 840, GOOGLx: 300, X: 360 },
    liveMinutes: { METAx: 20 / 60 },
  });
  const roast = (await call(`/api/roast/${USER}`)).body;
  for (const line of Object.values(roast.lines)) {
    if (line !== null) console.log(`  ${line}`);
  }
  ok(roast.copyCount === 1, "the card counts the copy", roast);
  ok(
    roast.lines.highlight?.includes("Nvidia once"),
    "the card knows the highlight",
    roast.lines,
  );
  ok(roast.txUrl !== null, "the card links a transaction");

  console.log(`\nPASSED ${passed} checks`);
  if (addresses.chainId === 10143 && RPC.includes("monad")) {
    console.log("\nOn MonadVision:");
    for (const { label, hash } of sent) {
      console.log(`  ${label}: ${EXPLORER}/tx/${hash}`);
    }
  }
}

let failed = false;
await run().catch((error) => {
  failed = true;
  console.error("\nFAILED:", error.message);
});
// Windows won't delete the database until the server has really exited.
const exited = new Promise((resolve) => server.once("exit", resolve));
server.kill();
await exited;
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
process.exit(failed ? 1 : 0);
