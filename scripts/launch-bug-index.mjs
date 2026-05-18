import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { createPublicClient, createWalletClient, formatEther, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const projectRoot = process.cwd();
const artifactDir = path.join(projectRoot, "artifacts");
const frontendAbiPath = path.join(projectRoot, "src", "contracts", "bugIndexAbi.ts");

const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const dryRun = process.argv.includes("--dry-run") || process.env.BUG_INDEX_DRY_RUN === "1";
const deployerKey = process.env.BUG_INDEX_DEPLOYER_PRIVATE_KEY;

const contracts = {
  index: {
    source: "CheapBugsBugIndex.sol",
    name: "CheapBugsBugIndex",
    artifact: "CheapBugsBugIndex.json"
  },
  bondVault: {
    source: "CheapBugsBondVault.sol",
    name: "CheapBugsBondVault",
    artifact: "CheapBugsBondVault.json"
  },
  treasuryVault: {
    source: "CheapBugsTreasuryVault.sol",
    name: "CheapBugsTreasuryVault",
    artifact: "CheapBugsTreasuryVault.json"
  }
};

const parseCsvAddresses = (value, label) =>
  (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!isAddress(entry)) {
        console.error(`${label} contains an invalid address: ${entry}`);
        process.exit(1);
      }
      return entry;
    });

const initialBrokers = parseCsvAddresses(process.env.BUG_INDEX_INITIAL_BROKERS, "BUG_INDEX_INITIAL_BROKERS");
const initialAdmins = parseCsvAddresses(process.env.BUG_INDEX_INITIAL_ADMINS, "BUG_INDEX_INITIAL_ADMINS");
const initialSlashers = parseCsvAddresses(process.env.BUG_INDEX_INITIAL_SLASHERS, "BUG_INDEX_INITIAL_SLASHERS");

try {
  execFileSync("forge", ["build"], { cwd: projectRoot, stdio: "inherit" });
} catch {
  console.error("Contract compilation failed. Install Foundry and run `forge build` for details.");
  process.exit(1);
}

const loadContract = ({ source, name, artifact }) => {
  const foundryArtifactPath = path.join(projectRoot, "out", source, `${name}.json`);
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

  const artifactPath = path.join(artifactDir, artifact);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        contractName: name,
        abi,
        bytecode
      },
      null,
      2
    )
  );

  return { abi, bytecode, artifactPath };
};

const compiled = {
  index: loadContract(contracts.index),
  bondVault: loadContract(contracts.bondVault),
  treasuryVault: loadContract(contracts.treasuryVault)
};

fs.writeFileSync(frontendAbiPath, `export const bugIndexAbi = ${JSON.stringify(compiled.index.abi, null, 2)} as const;\n`);

if (dryRun) {
  console.log("Dry run complete.");
  console.log(`Index artifact: ${compiled.index.artifactPath}`);
  console.log(`Bond vault artifact: ${compiled.bondVault.artifactPath}`);
  console.log(`Treasury vault artifact: ${compiled.treasuryVault.artifactPath}`);
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
if (!isAddress(owner)) {
  console.error(`BUG_INDEX_OWNER is not a valid address: ${owner}`);
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

const ownableAbi = [
  {
    type: "function",
    name: "transferOwnership",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: []
  }
];

const isFeeError = (error) => {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /insufficient funds|intrinsic gas|exceeds balance|fee cap|gas required exceeds/i.test(text);
};

const printFeeErrorAndExit = async (error) => {
  const balance = await publicClient.getBalance({ address: account.address }).catch(() => null);
  console.error("Deployment stopped because the deployer does not appear to have enough ETH for Base fees.");
  console.error(`Deployer: ${account.address}`);
  if (balance !== null) {
    console.error(`Current balance: ${formatEther(balance)} ETH`);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
};

const ensureFunded = async () => {
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    console.error("Deployer has 0 ETH on Base and cannot pay deployment fees.");
    console.error(`Deployer: ${account.address}`);
    process.exit(1);
  }
  console.log(`Deployer balance: ${formatEther(balance)} ETH`);
};

const deploy = async (label, abi, bytecode, args) => {
  console.log(`Deploying ${label}...`);
  const txHash = await walletClient.deployContract({ abi, bytecode, args });
  console.log(`${label} tx: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${label} deployment failed in transaction ${txHash}.`);
  }
  console.log(`${label}: ${receipt.contractAddress}`);
  return receipt.contractAddress;
};

const write = async (label, address, abi, functionName, args) => {
  console.log(label);
  const txHash = await walletClient.writeContract({ address, abi, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`${label} failed in transaction ${txHash}.`);
  }
};

console.log("Deploying CheapBugs contracts to Base...");
console.log(`RPC: ${rpcUrl}`);
console.log(`Deployer: ${account.address}`);
console.log(`Final owner: ${owner}`);
console.log(`Initial brokers: ${initialBrokers.length ? initialBrokers.join(", ") : "(none)"}`);
console.log(`Initial admins: ${initialAdmins.length ? initialAdmins.join(", ") : "(none)"}`);
console.log(`Initial slashers: ${initialSlashers.length ? initialSlashers.join(", ") : "(none)"}`);

try {
  await ensureFunded();

  const treasuryVaultAddress = await deploy(
    "CheapBugsTreasuryVault",
    compiled.treasuryVault.abi,
    compiled.treasuryVault.bytecode,
    [account.address]
  );
  const bondVaultAddress = await deploy(
    "CheapBugsBondVault",
    compiled.bondVault.abi,
    compiled.bondVault.bytecode,
    [treasuryVaultAddress, account.address]
  );
  const indexAddress = await deploy("CheapBugsBugIndex", compiled.index.abi, compiled.index.bytecode, [
    account.address,
    bondVaultAddress,
    treasuryVaultAddress,
    initialBrokers,
    initialAdmins
  ]);

  await write("Setting treasury index...", treasuryVaultAddress, compiled.treasuryVault.abi, "setIndex", [indexAddress]);
  for (const broker of initialBrokers) {
    await write(`Allowing treasury broker ${broker}...`, treasuryVaultAddress, compiled.treasuryVault.abi, "setBroker", [
      broker,
      true
    ]);
  }
  for (const slasher of initialSlashers) {
    await write(`Allowing bond slasher ${slasher}...`, bondVaultAddress, compiled.bondVault.abi, "setSlasher", [
      slasher,
      true
    ]);
  }
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    await write("Transferring treasury ownership...", treasuryVaultAddress, ownableAbi, "transferOwnership", [owner]);
    await write("Transferring bond vault ownership...", bondVaultAddress, ownableAbi, "transferOwnership", [owner]);
    await write("Transferring index ownership...", indexAddress, ownableAbi, "transferOwnership", [owner]);
  }

  console.log("");
  console.log("CheapBugs contracts deployed.");
  console.log(`Index: ${indexAddress}`);
  console.log(`Bond vault: ${bondVaultAddress}`);
  console.log(`Treasury vault: ${treasuryVaultAddress}`);
  console.log(`Index artifact: ${compiled.index.artifactPath}`);
  console.log(`Frontend ABI: ${frontendAbiPath}`);
  console.log("");
  console.log("Export this for the frontend:");
  console.log(`VITE_BUG_INDEX_ADDRESS=${indexAddress}`);
  console.log("");
  console.log("Record these operational addresses:");
  console.log(`BUG_INDEX_BOND_VAULT_ADDRESS=${bondVaultAddress}`);
  console.log(`BUG_INDEX_TREASURY_VAULT_ADDRESS=${treasuryVaultAddress}`);
} catch (error) {
  if (isFeeError(error)) {
    await printFeeErrorAndExit(error);
  }
  throw error;
}
