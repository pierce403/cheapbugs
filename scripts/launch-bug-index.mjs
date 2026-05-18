import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const projectRoot = process.cwd();
const artifactDir = path.join(projectRoot, "artifacts");
const artifactPath = path.join(artifactDir, "CheapBugsBugIndex.json");
const frontendAbiPath = path.join(projectRoot, "src", "contracts", "bugIndexAbi.ts");
const foundryArtifactPath = path.join(projectRoot, "out", "CheapBugsBugIndex.sol", "CheapBugsBugIndex.json");

const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const dryRun = process.argv.includes("--dry-run") || process.env.BUG_INDEX_DRY_RUN === "1";
const deployerKey = process.env.BUG_INDEX_DEPLOYER_PRIVATE_KEY;

const initialBrokers = (process.env.BUG_INDEX_INITIAL_BROKERS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const initialAdmins = (process.env.BUG_INDEX_INITIAL_ADMINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

try {
  execFileSync("forge", ["build"], { cwd: projectRoot, stdio: "inherit" });
} catch {
  console.error("Contract compilation failed. Install Foundry and run `forge build` for details.");
  process.exit(1);
}

if (!fs.existsSync(foundryArtifactPath)) {
  console.error(`Foundry artifact was not created: ${foundryArtifactPath}`);
  process.exit(1);
}

const contractOutput = JSON.parse(fs.readFileSync(foundryArtifactPath, "utf8"));
const abi = contractOutput.abi;
const bytecode = contractOutput.bytecode?.object;

if (!Array.isArray(abi) || typeof bytecode !== "string" || bytecode === "0x") {
  console.error(`Foundry artifact is missing ABI or bytecode: ${foundryArtifactPath}`);
  process.exit(1);
}

fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(
  artifactPath,
  JSON.stringify(
    {
      contractName: "CheapBugsBugIndex",
      abi,
      bytecode
    },
    null,
    2
  )
);
fs.writeFileSync(frontendAbiPath, `export const bugIndexAbi = ${JSON.stringify(abi, null, 2)} as const;\n`);

if (dryRun) {
  console.log("Dry run complete.");
  console.log(`Artifact: ${artifactPath}`);
  console.log(`Frontend ABI: ${frontendAbiPath}`);
  console.log("Deployment was skipped.");
  process.exit(0);
}

if (!deployerKey) {
  console.error("Missing BUG_INDEX_DEPLOYER_PRIVATE_KEY.");
  process.exit(1);
}

const account = privateKeyToAccount(deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`);
const owner = process.env.BUG_INDEX_OWNER || account.address;
const bondVaultAddress = process.env.BUG_INDEX_BOND_VAULT_ADDRESS;
const treasuryVaultAddress = process.env.BUG_INDEX_TREASURY_VAULT_ADDRESS;

if (!bondVaultAddress || !treasuryVaultAddress) {
  console.error("Missing BUG_INDEX_BOND_VAULT_ADDRESS or BUG_INDEX_TREASURY_VAULT_ADDRESS.");
  process.exit(1);
}

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl)
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(rpcUrl)
});

console.log("Deploying CheapBugsBugIndex to Base...");
console.log(`RPC: ${rpcUrl}`);
console.log(`Deployer: ${account.address}`);
console.log(`Owner: ${owner}`);
console.log(`Bond vault: ${bondVaultAddress}`);
console.log(`Treasury vault: ${treasuryVaultAddress}`);
console.log(`Initial brokers: ${initialBrokers.length ? initialBrokers.join(", ") : "(none)"}`);
console.log(`Initial admins: ${initialAdmins.length ? initialAdmins.join(", ") : "(none)"}`);

const txHash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [owner, bondVaultAddress, treasuryVaultAddress, initialBrokers, initialAdmins]
});

console.log(`Deployment tx: ${txHash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

if (!receipt.contractAddress) {
  console.error("Deployment completed without a contract address.");
  process.exit(1);
}

console.log("");
console.log("CheapBugs bug index deployed.");
console.log(`Contract: ${receipt.contractAddress}`);
console.log(`Artifact: ${artifactPath}`);
console.log(`Frontend ABI: ${frontendAbiPath}`);
console.log("");
console.log("Export this for the frontend:");
console.log(`VITE_BUG_INDEX_ADDRESS=${receipt.contractAddress}`);
