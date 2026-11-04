import { createServer } from "node:http";
import { join } from "node:path";
import { createApi } from "./api.ts";
import { DEFAULT_BASELINE_MINUTES } from "./basket.ts";
import { createChain, createClient, loadAddresses } from "./chain.ts";
import { createIndexer } from "./indexer.ts";
import { Store } from "./store.ts";

/** About a block, so `/live` stays inside the PRD's 2 seconds. */
const INDEX_INTERVAL_MS = 500;

const dir = import.meta.dirname;
const port = Number(process.env.PORT ?? 4000);
const rpcUrls = (
  process.env.RPC_URLS ??
  "https://testnet-rpc.monad.xyz,https://rpc.ankr.com/monad_testnet,https://rpc-testnet.monadinfra.com"
).split(",");

const addresses = loadAddresses(
  process.env.ADDRESSES_PATH ?? join(dir, "addresses.json"),
);
const store = new Store(
  process.env.DB_PATH ?? join(dir, "data", "doomscroll.sqlite"),
);
const client = createClient(rpcUrls);

const handle = createApi({
  store,
  chain: createChain(addresses, client),
  baselineMinutes: Number(
    process.env.DETOX_BASELINE_MINUTES ?? DEFAULT_BASELINE_MINUTES,
  ),
  explorerUrl: process.env.EXPLORER_URL ?? "https://testnet.monadvision.com",
});

const server = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  const response = await handle(
    new Request(`http://localhost${incoming.url}`, {
      method: incoming.method,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    }),
  );
  outgoing.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  );
  outgoing.end(await response.text());
});

server.listen(port, () => console.log(`backend on ${port}`));
void createIndexer({ client, addresses, store }).run(INDEX_INTERVAL_MS);
