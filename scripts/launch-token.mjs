import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import solc from "solc";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const projectRoot = process.cwd();
const contractPath = path.join(projectRoot, "contracts", "CheapBugsToken.sol");
const artifactDir = path.join(projectRoot, "artifacts");
const artifactPath = path.join(artifactDir, "CheapBugsToken.json");
const frontendAbiPath = path.join(projectRoot, "src", "contracts", "bugzTokenAbi.ts");

const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const dryRun = process.argv.includes("--dry-run") || process.env.BUGZ_DRY_RUN === "1";
const deployerKey = process.env.BUGZ_DEPLOYER_PRIVATE_KEY;

const source = fs.readFileSync(contractPath, "utf8");

const findImports = (importPath) => {
  const localPath = path.join(projectRoot, importPath);
  const nodeModulesPath = path.join(projectRoot, "node_modules", importPath);

  for (const candidate of [localPath, nodeModulesPath]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `File not found: ${importPath}` };
};

const input = {
  language: "Solidity",
  sources: {
    "contracts/CheapBugsToken.sol": {
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

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const contractOutput = output.contracts?.["contracts/CheapBugsToken.sol"]?.CheapBugsToken;

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
      contractName: "CheapBugsToken",
      abi,
      bytecode
    },
    null,
    2
  )
);
fs.writeFileSync(frontendAbiPath, `export const bugzTokenAbi = ${JSON.stringify(abi, null, 2)} as const;\n`);

if (dryRun) {
  console.log("Dry run complete.");
  console.log(`Artifact: ${artifactPath}`);
  console.log(`Frontend ABI: ${frontendAbiPath}`);
  console.log("Deployment was skipped.");
  process.exit(0);
}

if (!deployerKey) {
  console.error("Missing BUGZ_DEPLOYER_PRIVATE_KEY.");
  process.exit(1);
}

const account = privateKeyToAccount(deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`);
const initialHolder = process.env.BUGZ_INITIAL_HOLDER || account.address;

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl)
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(rpcUrl)
});

console.log("Deploying CheapBugsToken to Base...");
console.log(`RPC: ${rpcUrl}`);
console.log(`Deployer: ${account.address}`);
console.log(`Initial holder: ${initialHolder}`);

const txHash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [initialHolder]
});

console.log(`Deployment tx: ${txHash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

if (!receipt.contractAddress) {
  console.error("Deployment completed without a contract address.");
  process.exit(1);
}

console.log("");
console.log("CheapBugs token deployed.");
console.log(`Contract: ${receipt.contractAddress}`);
console.log("Initial supply: 10000000 BUGZ");
console.log(`Artifact: ${artifactPath}`);
console.log(`Frontend ABI: ${frontendAbiPath}`);
console.log("");
console.log("Export this for the frontend when token features are wired:");
console.log(`VITE_BUGZ_TOKEN_ADDRESS=${receipt.contractAddress}`);
