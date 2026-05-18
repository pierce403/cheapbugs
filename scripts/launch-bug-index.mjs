import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { createPublicClient, createWalletClient, encodeAbiParameters, formatEther, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const projectRoot = process.cwd();
const artifactDir = path.join(projectRoot, "artifacts");
const deploymentRoot = path.join(projectRoot, "deployments", `base-${base.id}`);
const latestDeploymentManifestPath = path.join(deploymentRoot, "cheapbugs-contract-suite.latest.json");
const latestGeneratedArtifactsDir = path.join(deploymentRoot, "generated", "latest");
const frontendAbiPath = path.join(projectRoot, "src", "contracts", "bugIndexAbi.ts");
const defaultContractOwner = "0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3";

const shellEnvKeys = new Set(Object.keys(process.env));
const loadEnvFile = (filePath, { overridePreviousFile = false } = {}) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    let value = normalized.slice(equalsIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || shellEnvKeys.has(key)) {
      continue;
    }
    if (!overridePreviousFile && process.env[key] !== undefined) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
};

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(projectRoot, ".env.local"), { overridePreviousFile: true });

const relativePath = (filePath) => path.relative(projectRoot, filePath).split(path.sep).join("/");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const readFileIfExists = (filePath) => (fs.existsSync(filePath) ? fs.readFileSync(filePath) : null);

const fileDigest = (filePath) => {
  const file = readFileIfExists(filePath);
  return file === null
    ? null
    : {
        path: relativePath(filePath),
        sha256: sha256(file),
        bytes: file.byteLength
      };
};

const execText = (command, args) => {
  try {
    const output = execFileSync(command, args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return output || null;
  } catch {
    return null;
  }
};

const redactUrl = (value) => {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "(invalid URL)";
  }
};

const bigintReplacer = (_key, value) => (typeof value === "bigint" ? value.toString() : value);

const writeJsonFile = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, bigintReplacer, 2)}\n`);
};

const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const dryRun = process.argv.includes("--dry-run") || process.env.BUG_INDEX_DRY_RUN === "1";
const deployerKeySource = process.env.BUG_INDEX_DEPLOYER_PRIVATE_KEY
  ? "BUG_INDEX_DEPLOYER_PRIVATE_KEY"
  : process.env.BROKER_KEY
    ? "BROKER_KEY"
    : null;
const deployerKey = process.env.BUG_INDEX_DEPLOYER_PRIVATE_KEY || process.env.BROKER_KEY;
const verifyContracts = !dryRun && process.env.BUG_INDEX_VERIFY_CONTRACTS !== "0";
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY;
const etherscanApiVersion = process.env.ETHERSCAN_API_VERSION;

const contracts = {
  index: {
    source: "CheapBugsBugIndex.sol",
    name: "CheapBugsBugIndex",
    artifact: "CheapBugsBugIndex.json",
    contractId: "contracts/CheapBugsBugIndex.sol:CheapBugsBugIndex"
  },
  bondVault: {
    source: "CheapBugsBondVault.sol",
    name: "CheapBugsBondVault",
    artifact: "CheapBugsBondVault.json",
    contractId: "contracts/CheapBugsBondVault.sol:CheapBugsBondVault"
  },
  treasuryVault: {
    source: "CheapBugsTreasuryVault.sol",
    name: "CheapBugsTreasuryVault",
    artifact: "CheapBugsTreasuryVault.json",
    contractId: "contracts/CheapBugsTreasuryVault.sol:CheapBugsTreasuryVault"
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

const normalizePrivateKey = (value) => (value.startsWith("0x") ? value : `0x${value}`);

const loadDeployerAccount = () => {
  if (!deployerKey) {
    return null;
  }

  try {
    return privateKeyToAccount(normalizePrivateKey(deployerKey));
  } catch {
    if (dryRun) {
      console.warn(`${deployerKeySource || "deployer private key"} is not a valid private key; dry-run manifest will omit the deployer address.`);
      return null;
    }
    console.error(`${deployerKeySource || "deployer private key"} is not a valid private key.`);
    process.exit(1);
  }
};

const deployerAccount = loadDeployerAccount();
const owner = process.env.BUG_INDEX_OWNER || defaultContractOwner;
if (!isAddress(owner)) {
  console.error(`BUG_INDEX_OWNER is not a valid address: ${owner}`);
  process.exit(1);
}

const hasExplicitInitialBrokers = (process.env.BUG_INDEX_INITIAL_BROKERS || "").trim() !== "";
const initialBrokers = hasExplicitInitialBrokers
  ? parseCsvAddresses(process.env.BUG_INDEX_INITIAL_BROKERS, "BUG_INDEX_INITIAL_BROKERS")
  : deployerKeySource === "BROKER_KEY" && deployerAccount
    ? [deployerAccount.address]
    : [];
const initialAdmins = parseCsvAddresses(process.env.BUG_INDEX_INITIAL_ADMINS, "BUG_INDEX_INITIAL_ADMINS");
const initialSlashers = parseCsvAddresses(process.env.BUG_INDEX_INITIAL_SLASHERS, "BUG_INDEX_INITIAL_SLASHERS");

try {
  execFileSync("forge", ["build"], { cwd: projectRoot, stdio: "inherit" });
} catch {
  console.error("Contract compilation failed. Install Foundry and run `forge build` for details.");
  process.exit(1);
}

const loadContract = ({ source, name, artifact, contractId }) => {
  const foundryArtifactPath = path.join(projectRoot, "out", source, `${name}.json`);
  if (!fs.existsSync(foundryArtifactPath)) {
    console.error(`Foundry artifact was not created: ${foundryArtifactPath}`);
    process.exit(1);
  }

  const contractOutput = JSON.parse(fs.readFileSync(foundryArtifactPath, "utf8"));
  const abi = contractOutput.abi;
  const bytecode = contractOutput.bytecode?.object;
  const deployedBytecode = contractOutput.deployedBytecode?.object;

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

  return {
    abi,
    artifactPath,
    bytecode,
    contractId,
    contractOutput,
    deployedBytecode,
    foundryArtifactPath,
    metadata: contractOutput.metadata ?? null,
    name,
    rawMetadata: contractOutput.rawMetadata ?? null,
    source
  };
};

const compiled = {
  index: loadContract(contracts.index),
  bondVault: loadContract(contracts.bondVault),
  treasuryVault: loadContract(contracts.treasuryVault)
};

fs.writeFileSync(frontendAbiPath, `export const bugIndexAbi = ${JSON.stringify(compiled.index.abi, null, 2)} as const;\n`);

const bytecodeBytes = (value) =>
  typeof value === "string" && value.startsWith("0x") ? Math.max(0, (value.length - 2) / 2) : null;

const metadataSources = () => {
  const sourcePaths = new Set([
    "foundry.toml",
    "remappings.txt",
    "package.json",
    "package-lock.json",
    "script/LaunchBugIndex.s.sol",
    "scripts/launch-bug-index.mjs"
  ]);

  for (const contract of Object.values(compiled)) {
    for (const sourcePath of Object.keys(contract.metadata?.sources ?? {})) {
      sourcePaths.add(sourcePath);
    }
  }

  return [...sourcePaths]
    .sort()
    .map((sourcePath) => fileDigest(path.join(projectRoot, sourcePath)))
    .filter(Boolean);
};

const writeGeneratedArtifacts = (targetDir) => {
  const generatedArtifacts = {};
  fs.mkdirSync(targetDir, { recursive: true });

  for (const [key, contract] of Object.entries(compiled)) {
    const filePath = path.join(targetDir, `${contract.name}.json`);
    writeJsonFile(filePath, {
      schema: "cheapbugs.generated-contract-artifact.v1",
      contractName: contract.name,
      sourceName: `contracts/${contract.source}`,
      contractId: contract.contractId,
      foundryArtifactPath: relativePath(contract.foundryArtifactPath),
      generatedBy: {
        command: "forge build",
        foundryProfile: "default"
      },
      artifact: contract.contractOutput
    });
    generatedArtifacts[key] = fileDigest(filePath);
  }

  return generatedArtifacts;
};

const foundryBuildSettings = {
  profile: "default",
  src: "contracts",
  test: "test",
  script: "script",
  out: "out",
  libs: ["lib", "node_modules"],
  cache_path: "cache/foundry",
  solc_version: "0.8.24",
  optimizer: true,
  optimizer_runs: 200,
  via_ir: true
};

const toolVersions = () => ({
  node: process.version,
  npm:
    execText("npm", ["--version"]) ||
    process.env.npm_config_user_agent?.match(/(?:^|\s)npm\/([^\s]+)/u)?.[1] ||
    null,
  forge: execText("forge", ["--version"]),
  cast: execText("cast", ["--version"]),
  anvil: execText("anvil", ["--version"])
});

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

const gitSnapshot = () => {
  const statusShort = execText("git", [
    "status",
    "--short",
    "--untracked-files=all",
    "--",
    "contracts",
    "foundry.toml",
    "remappings.txt",
    "package.json",
    "package-lock.json",
    "script/LaunchBugIndex.s.sol",
    "scripts/launch-bug-index.mjs"
  ]);
  return {
    branch: execText("git", ["branch", "--show-current"]),
    commit: execText("git", ["rev-parse", "HEAD"]),
    statusShort: statusShort ? statusShort.split(/\r?\n/u).filter(Boolean) : []
  };
};

const constructorInputs = (abi) => abi.find((entry) => entry.type === "constructor")?.inputs ?? [];

const plannedConstructorArguments = () => ({
  treasuryVault: {
    contractName: contracts.treasuryVault.name,
    inputs: constructorInputs(compiled.treasuryVault.abi),
    values: deployerAccount ? [deployerAccount.address] : [null],
    encoded: deployerAccount ? encodeAbiParameters([{ type: "address" }], [deployerAccount.address]) : null
  },
  bondVault: {
    contractName: contracts.bondVault.name,
    inputs: constructorInputs(compiled.bondVault.abi),
    values: [null, deployerAccount ? deployerAccount.address : null],
    encoded: null
  },
  index: {
    contractName: contracts.index.name,
    inputs: constructorInputs(compiled.index.abi),
    values: [deployerAccount ? deployerAccount.address : null, null, null, initialBrokers, initialAdmins],
    encoded: null
  }
});

const buildVerifyContractArgs = (address, contractId, constructorArgs) => {
  const args = [
    "verify-contract",
    "--verifier",
    "etherscan",
    "--chain",
    String(base.id),
    "--rpc-url",
    rpcUrl,
    "--watch",
    "--compiler-version",
    "0.8.24",
    "--num-of-optimizations",
    "200",
    "--via-ir",
    "--constructor-args",
    constructorArgs,
    address,
    contractId
  ];

  if (etherscanApiVersion) {
    args.splice(8, 0, "--etherscan-api-version", etherscanApiVersion);
  }

  return args;
};

const sanitizedCommandArgs = (args) =>
  args.map((arg, index) => {
    if (args[index - 1] === "--rpc-url") {
      return redactUrl(arg);
    }
    return arg;
  });

const contractSummary = (key, generatedArtifacts) => {
  const contract = compiled[key];
  return {
    contractName: contract.name,
    sourceName: `contracts/${contract.source}`,
    contractId: contract.contractId,
    foundryArtifactPath: relativePath(contract.foundryArtifactPath),
    ignoredLauncherArtifactPath: relativePath(contract.artifactPath),
    committedGeneratedArtifact: generatedArtifacts[key],
    compiler: contract.metadata?.compiler ?? null,
    optimizer: contract.metadata?.settings?.optimizer ?? null,
    viaIR: contract.metadata?.settings?.viaIR ?? null,
    evmVersion: contract.metadata?.settings?.evmVersion ?? null,
    remappings: contract.metadata?.settings?.remappings ?? [],
    constructorInputs: constructorInputs(contract.abi),
    abiItems: contract.abi.length,
    methodIdentifiers: contract.contractOutput.methodIdentifiers ?? null,
    bytecode: {
      sha256: sha256(contract.bytecode),
      bytes: bytecodeBytes(contract.bytecode)
    },
    deployedBytecode: {
      sha256: typeof contract.deployedBytecode === "string" ? sha256(contract.deployedBytecode) : null,
      bytes: bytecodeBytes(contract.deployedBytecode)
    },
    rawMetadata: {
      sha256: typeof contract.rawMetadata === "string" ? sha256(contract.rawMetadata) : null,
      bytes: typeof contract.rawMetadata === "string" ? Buffer.byteLength(contract.rawMetadata) : null
    }
  };
};

const buildDeploymentManifest = ({
  mode,
  status,
  generatedArtifacts,
  deployedContracts = null,
  transactions = [],
  constructorArguments = plannedConstructorArguments(),
  verificationResults = []
}) => ({
  schema: "cheapbugs.contract-suite-deploy-log.v1",
  mode,
  status,
  generatedAt: mode === "dry-run" ? null : new Date().toISOString(),
  network: {
    chainName: base.name,
    chainId: base.id,
    rpcUrl: redactUrl(rpcUrl)
  },
  launchPlan: {
    script: "scripts/launch-bug-index.mjs",
    argv: process.argv.slice(2),
    deployer: {
      address: deployerAccount?.address ?? null,
      keySource: deployerKeySource,
      privateKeyRecorded: false
    },
    finalOwner: owner,
    initialBrokers,
    initialAdmins,
    initialSlashers,
    verification: {
      requested: verifyContracts,
      verifier: "etherscan",
      apiKeyConfigured: Boolean(etherscanApiKey),
      apiKeyRecorded: false,
      etherscanApiVersion: etherscanApiVersion || null
    }
  },
  build: {
    toolVersions: toolVersions(),
    package: {
      name: packageJson.name,
      version: packageJson.version,
      packageJson: fileDigest(path.join(projectRoot, "package.json")),
      packageLock: fileDigest(path.join(projectRoot, "package-lock.json"))
    },
    git: gitSnapshot(),
    foundry: {
      configFile: fileDigest(path.join(projectRoot, "foundry.toml")),
      settings: foundryBuildSettings
    },
    sourceFiles: metadataSources()
  },
  contracts: Object.fromEntries(Object.keys(compiled).map((key) => [key, contractSummary(key, generatedArtifacts)])),
  constructorArguments,
  deployedContracts,
  transactions,
  verificationResults,
  reproduction: {
    commands: [
      "git checkout <recorded commit>",
      "git submodule update --init --recursive",
      "npm install",
      "forge build",
      "npm run launch:bug-index:dry-run"
    ],
    notes: [
      "Private keys, API keys, and full RPC URLs are intentionally omitted from this manifest.",
      "Full generated contract artifacts are committed under the committedGeneratedArtifact paths."
    ]
  }
});

const writeDeploymentManifest = (filePath, manifest) => {
  writeJsonFile(filePath, manifest);
  console.log(`Deployment manifest: ${relativePath(filePath)}`);
};

const latestGeneratedArtifacts = writeGeneratedArtifacts(latestGeneratedArtifactsDir);

if (dryRun) {
  writeDeploymentManifest(
    latestDeploymentManifestPath,
    buildDeploymentManifest({
      mode: "dry-run",
      status: "build-only",
      generatedArtifacts: latestGeneratedArtifacts
    })
  );
  console.log("Dry run complete.");
  console.log(`Index artifact: ${compiled.index.artifactPath}`);
  console.log(`Bond vault artifact: ${compiled.bondVault.artifactPath}`);
  console.log(`Treasury vault artifact: ${compiled.treasuryVault.artifactPath}`);
  console.log(`Frontend ABI: ${frontendAbiPath}`);
  console.log("Deployment was skipped.");
  process.exit(0);
}

if (!deployerKey) {
  console.error("Missing BUG_INDEX_DEPLOYER_PRIVATE_KEY or BROKER_KEY.");
  process.exit(1);
}

if (verifyContracts && !etherscanApiKey) {
  console.error("Missing ETHERSCAN_API_KEY or BASESCAN_API_KEY for contract verification.");
  console.error("Set BUG_INDEX_VERIFY_CONTRACTS=0 only when intentionally deploying without explorer verification.");
  process.exit(1);
}

const account = deployerAccount;

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
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
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

const receiptLog = (receipt) => ({
  transactionHash: receipt.transactionHash,
  blockNumber: receipt.blockNumber,
  gasUsed: receipt.gasUsed,
  cumulativeGasUsed: receipt.cumulativeGasUsed,
  effectiveGasPrice: receipt.effectiveGasPrice ?? null,
  status: receipt.status
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readContractWithRetry = async (label, options) => {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await publicClient.readContract(options);
    } catch (error) {
      lastError = error;
      const text = error instanceof Error ? error.message : String(error);
      const retryable = /over rate limit|rate limit|timeout|temporarily unavailable|network error|fetch failed/i.test(text);
      if (!retryable || attempt === 4) {
        break;
      }
      const delayMs = 1_500 * (attempt + 1);
      console.warn(`${label} read failed, retrying in ${delayMs}ms: ${text.split("\n")[0]}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
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
  return {
    type: "deployment",
    label,
    address: receipt.contractAddress,
    ...receiptLog(receipt)
  };
};

const write = async (label, address, abi, functionName, args) => {
  console.log(label);
  const txHash = await walletClient.writeContract({ address, abi, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`${label} failed in transaction ${txHash}.`);
  }
  return {
    type: "write",
    label,
    contractAddress: address,
    functionName,
    args,
    ...receiptLog(receipt)
  };
};

const assertContractRead = async (label, address, abi, functionName, args, expected) => {
  const actual = await readContractWithRetry(label, { address, abi, functionName, args });
  if (typeof actual === "string" && typeof expected === "string") {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`${label} check failed: expected ${expected}, got ${actual}.`);
    }
    return;
  }
  if (actual !== expected) {
    throw new Error(`${label} check failed: expected ${String(expected)}, got ${String(actual)}.`);
  }
};

const verifyContract = async (label, address, contractId, constructorArgs) => {
  const args = buildVerifyContractArgs(address, contractId, constructorArgs);
  const command = {
    executable: "forge",
    args: sanitizedCommandArgs(args)
  };

  if (!verifyContracts) {
    return {
      label,
      address,
      contractId,
      constructorArgs,
      status: "skipped",
      command
    };
  }

  console.log(`Verifying ${label} on Etherscan...`);

  try {
    execFileSync("forge", args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ETHERSCAN_API_KEY: etherscanApiKey
      }
    });
    return {
      label,
      address,
      contractId,
      constructorArgs,
      status: "passed",
      command
    };
  } catch {
    console.error(`${label} deployed at ${address}, but explorer verification failed.`);
    console.error(`Constructor arguments: ${constructorArgs}`);
    throw new Error(`${label} verification failed.`);
  }
};

const verifyDeploymentState = async (treasuryVaultAddress, bondVaultAddress, indexAddress) => {
  console.log("Checking deployed contract wiring...");
  await assertContractRead("Treasury index", treasuryVaultAddress, compiled.treasuryVault.abi, "index", [], indexAddress);
  await assertContractRead("Bond treasury", bondVaultAddress, compiled.bondVault.abi, "treasury", [], treasuryVaultAddress);
  await assertContractRead("Index bond vault", indexAddress, compiled.index.abi, "bondVault", [], bondVaultAddress);
  await assertContractRead("Index treasury vault", indexAddress, compiled.index.abi, "treasuryVault", [], treasuryVaultAddress);
  await assertContractRead("Treasury owner", treasuryVaultAddress, ownableAbi, "owner", [], owner);
  await assertContractRead("Bond vault owner", bondVaultAddress, ownableAbi, "owner", [], owner);
  await assertContractRead("Index owner", indexAddress, ownableAbi, "owner", [], owner);

  for (const broker of initialBrokers) {
    await assertContractRead(`Index broker ${broker}`, indexAddress, compiled.index.abi, "brokers", [broker], true);
    await assertContractRead(
      `Treasury broker ${broker}`,
      treasuryVaultAddress,
      compiled.treasuryVault.abi,
      "brokers",
      [broker],
      true
    );
  }
  for (const admin of initialAdmins) {
    await assertContractRead(`Index admin ${admin}`, indexAddress, compiled.index.abi, "admins", [admin], true);
  }
  for (const slasher of initialSlashers) {
    await assertContractRead(`Bond slasher ${slasher}`, bondVaultAddress, compiled.bondVault.abi, "slashers", [
      slasher
    ], true);
  }
  console.log("Deployment wiring checks passed.");
};

console.log("Deploying CheapBugs contracts to Base...");
console.log(`RPC: ${rpcUrl}`);
console.log(`Deployer: ${account.address}`);
console.log(`Deployer key source: ${deployerKeySource}`);
console.log(`Final owner: ${owner}`);
console.log(`Initial brokers: ${initialBrokers.length ? initialBrokers.join(", ") : "(none)"}`);
console.log(`Initial admins: ${initialAdmins.length ? initialAdmins.join(", ") : "(none)"}`);
console.log(`Initial slashers: ${initialSlashers.length ? initialSlashers.join(", ") : "(none)"}`);

try {
  await ensureFunded();

  const transactions = [];

  const treasuryDeployment = await deploy(
    "CheapBugsTreasuryVault",
    compiled.treasuryVault.abi,
    compiled.treasuryVault.bytecode,
    [account.address]
  );
  transactions.push(treasuryDeployment);
  const treasuryVaultAddress = treasuryDeployment.address;
  const treasuryConstructorArgs = encodeAbiParameters([{ type: "address" }], [account.address]);
  const bondDeployment = await deploy(
    "CheapBugsBondVault",
    compiled.bondVault.abi,
    compiled.bondVault.bytecode,
    [treasuryVaultAddress, account.address]
  );
  transactions.push(bondDeployment);
  const bondVaultAddress = bondDeployment.address;
  const bondConstructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [treasuryVaultAddress, account.address]
  );
  const indexDeployment = await deploy("CheapBugsBugIndex", compiled.index.abi, compiled.index.bytecode, [
    account.address,
    bondVaultAddress,
    treasuryVaultAddress,
    initialBrokers,
    initialAdmins
  ]);
  transactions.push(indexDeployment);
  const indexAddress = indexDeployment.address;
  const indexConstructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address[]" }, { type: "address[]" }],
    [account.address, bondVaultAddress, treasuryVaultAddress, initialBrokers, initialAdmins]
  );
  const constructorArguments = {
    treasuryVault: {
      contractName: contracts.treasuryVault.name,
      inputs: constructorInputs(compiled.treasuryVault.abi),
      values: [account.address],
      encoded: treasuryConstructorArgs
    },
    bondVault: {
      contractName: contracts.bondVault.name,
      inputs: constructorInputs(compiled.bondVault.abi),
      values: [treasuryVaultAddress, account.address],
      encoded: bondConstructorArgs
    },
    index: {
      contractName: contracts.index.name,
      inputs: constructorInputs(compiled.index.abi),
      values: [account.address, bondVaultAddress, treasuryVaultAddress, initialBrokers, initialAdmins],
      encoded: indexConstructorArgs
    }
  };

  transactions.push(
    await write("Setting treasury index...", treasuryVaultAddress, compiled.treasuryVault.abi, "setIndex", [
      indexAddress
    ])
  );
  for (const broker of initialBrokers) {
    transactions.push(
      await write(`Allowing treasury broker ${broker}...`, treasuryVaultAddress, compiled.treasuryVault.abi, "setBroker", [
        broker,
        true
      ])
    );
  }
  for (const slasher of initialSlashers) {
    transactions.push(
      await write(`Allowing bond slasher ${slasher}...`, bondVaultAddress, compiled.bondVault.abi, "setSlasher", [
        slasher,
        true
      ])
    );
  }
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    transactions.push(
      await write("Transferring treasury ownership...", treasuryVaultAddress, ownableAbi, "transferOwnership", [owner])
    );
    transactions.push(
      await write("Transferring bond vault ownership...", bondVaultAddress, ownableAbi, "transferOwnership", [owner])
    );
    transactions.push(await write("Transferring index ownership...", indexAddress, ownableAbi, "transferOwnership", [owner]));
  }

  await verifyDeploymentState(treasuryVaultAddress, bondVaultAddress, indexAddress);
  const deployedContracts = {
    treasuryVault: treasuryVaultAddress,
    bondVault: bondVaultAddress,
    index: indexAddress
  };
  const deploymentGeneratedArtifacts = writeGeneratedArtifacts(
    path.join(deploymentRoot, "generated", indexAddress.toLowerCase())
  );
  const deploymentManifestPath = path.join(deploymentRoot, `cheapbugs-contract-suite.${indexAddress.toLowerCase()}.json`);
  const writeBroadcastManifests = (status, verificationResults) => {
    writeDeploymentManifest(
      deploymentManifestPath,
      buildDeploymentManifest({
        mode: "broadcast",
        status,
        generatedArtifacts: deploymentGeneratedArtifacts,
        deployedContracts,
        transactions,
        constructorArguments,
        verificationResults
      })
    );
    const refreshedLatestGeneratedArtifacts = writeGeneratedArtifacts(latestGeneratedArtifactsDir);
    writeDeploymentManifest(
      latestDeploymentManifestPath,
      buildDeploymentManifest({
        mode: "broadcast",
        status,
        generatedArtifacts: refreshedLatestGeneratedArtifacts,
        deployedContracts,
        transactions,
        constructorArguments,
        verificationResults
      })
    );
  };

  writeBroadcastManifests("deployed-verification-pending", []);

  const verificationResults = [
    await verifyContract(
      "CheapBugsTreasuryVault",
      treasuryVaultAddress,
      contracts.treasuryVault.contractId,
      treasuryConstructorArgs
    ),
    await verifyContract("CheapBugsBondVault", bondVaultAddress, contracts.bondVault.contractId, bondConstructorArgs),
    await verifyContract("CheapBugsBugIndex", indexAddress, contracts.index.contractId, indexConstructorArgs)
  ];

  writeBroadcastManifests(verifyContracts ? "deployed-and-verified" : "deployed-unverified", verificationResults);

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
