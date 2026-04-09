import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import solc from "solc";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const projectRoot = process.cwd();
const contractPath = path.join(projectRoot, "contracts", "CheapBugsBugIndex.sol");
const artifactDir = path.join(projectRoot, "artifacts");
const artifactPath = path.join(artifactDir, "CheapBugsBugIndex.json");
const frontendAbiPath = path.join(projectRoot, "src", "contracts", "bugIndexAbi.ts");

const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const dryRun = process.argv.includes("--dry-run") || process.env.BUG_INDEX_DRY_RUN === "1";
const deployerKey = process.env.BUG_INDEX_DEPLOYER_PRIVATE_KEY;

const initialReviewers = (process.env.BUG_INDEX_INITIAL_REVIEWERS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const source = fs.readFileSync(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "CheapBugsBugIndex.sol": {
      content: source
    }
  },
  settings: {
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 200
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"]
      }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const contractOutput = output.contracts?.["CheapBugsBugIndex.sol"]?.CheapBugsBugIndex;

if (!contractOutput) {
  console.error("Contract compilation failed.");
  console.error(JSON.stringify(output.errors || [], null, 2));
  process.exit(1);
}

if (output.errors?.some((entry) => entry.severity === "error")) {
  console.error(JSON.stringify(output.errors, null, 2));
  process.exit(1);
}

const abi = contractOutput.abi;
const bytecode = `0x${contractOutput.evm.bytecode.object}`;

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
console.log(`Initial reviewers: ${initialReviewers.length ? initialReviewers.join(", ") : "(none)"}`);

const txHash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [owner, initialReviewers]
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
