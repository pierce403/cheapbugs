export const bugIndexAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialBondVault",
        "type": "address",
        "internalType": "contract ICheapBugsBondVault"
      },
      {
        "name": "initialTreasuryVault",
        "type": "address",
        "internalType": "contract ICheapBugsTreasuryVault"
      },
      {
        "name": "initialBrokers",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "initialAdmins",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "JUDGMENT_PERIOD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_PAYOUT_MULTIPLIER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "adminAt",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "adminCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "admins",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bondVault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICheapBugsBondVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bondVoteCount",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bondVoteVoterAt",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "brokerAt",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "brokerCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "brokers",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "completePayout",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "multiplier",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "detailsKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "downVoteWeight",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "exists",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "flagBug",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum CheapBugsBugIndex.BugStatus"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getBondVote",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "voter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct CheapBugsBugIndex.BondVote",
        "components": [
          {
            "name": "reportHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "voter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "support",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "weight",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getReport",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct CheapBugsBugIndex.Bug",
        "components": [
          {
            "name": "reportHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reporter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disclosureMode",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.DisclosureMode"
          },
          {
            "name": "publicSummary",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "encryptedPayloadCid",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "targetKind",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.TargetKind"
          },
          {
            "name": "targetRefHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tags",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "contentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bugBundleHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "encryptedDetailsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "detailsKeyCommitment",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "revealAfter",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "detailsKey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "detailsKeyRevealed",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.BugStatus"
          },
          {
            "name": "payoutCompleted",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "payoutAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "payoutMultiplier",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasBondVote",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "latestReportHashes",
    "inputs": [
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextPayoutIndex",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextPayoutReportHash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "publishBug",
    "inputs": [
      {
        "name": "input",
        "type": "tuple",
        "internalType": "struct CheapBugsBugIndex.BugInput",
        "components": [
          {
            "name": "reportHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reporter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disclosureMode",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.DisclosureMode"
          },
          {
            "name": "publicSummary",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "bugBundleCid",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "targetKind",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.TargetKind"
          },
          {
            "name": "targetRefHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tags",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "contentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bugBundleHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "encryptedDetailsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "detailsKeyCommitment",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "revealAfter",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reporterSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "publishBugDigest",
    "inputs": [
      {
        "name": "input",
        "type": "tuple",
        "internalType": "struct CheapBugsBugIndex.BugInput",
        "components": [
          {
            "name": "reportHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reporter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disclosureMode",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.DisclosureMode"
          },
          {
            "name": "publicSummary",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "bugBundleCid",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "targetKind",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.TargetKind"
          },
          {
            "name": "targetRefHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tags",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "contentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bugBundleHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "encryptedDetailsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "detailsKeyCommitment",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "revealAfter",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "broker",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reportCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reportHashAt",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "revealDetailsKey",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "detailsKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAdmin",
    "inputs": [
      {
        "name": "admin",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setBondVault",
    "inputs": [
      {
        "name": "newBondVault",
        "type": "address",
        "internalType": "contract ICheapBugsBondVault"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setBroker",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTreasuryVault",
    "inputs": [
      {
        "name": "newTreasuryVault",
        "type": "address",
        "internalType": "contract ICheapBugsTreasuryVault"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitBondVote",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "support",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasuryVault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICheapBugsTreasuryVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "upVoteWeight",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "usedReporterNonces",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AdminSet",
    "inputs": [
      {
        "name": "admin",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BondVaultSet",
    "inputs": [
      {
        "name": "bondVault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BondVoteSubmitted",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "support",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "weight",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BrokerSet",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BugFlagged",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "admin",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "status",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.BugStatus"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BugPublished",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "reportId",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "reporter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "createdAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "revealAfter",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "bugBundleCid",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "detailsKeyCommitment",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DetailsKeyRevealed",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "detailsKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PayoutCompleted",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "multiplier",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TreasuryVaultSet",
    "inputs": [
      {
        "name": "treasuryVault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "DetailKeyAlreadyRevealed",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureLength",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureS",
    "inputs": [
      {
        "name": "s",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDetailsKey",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidField",
    "inputs": [
      {
        "name": "field",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPayoutMultiplier",
    "inputs": [
      {
        "name": "multiplier",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidRevealAfter",
    "inputs": [
      {
        "name": "revealAfter",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidStatus",
    "inputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum CheapBugsBugIndex.BugStatus"
      }
    ]
  },
  {
    "type": "error",
    "name": "MissingBug",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoVotingPower",
    "inputs": [
      {
        "name": "voter",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NonceUsed",
    "inputs": [
      {
        "name": "reporter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotAdmin",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotBroker",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OutOfOrderPayout",
    "inputs": [
      {
        "name": "expectedReportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actualReportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PayoutRequiresAdminStatus",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "PayoutRequiresZeroMultiplier",
    "inputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum CheapBugsBugIndex.BugStatus"
      }
    ]
  },
  {
    "type": "error",
    "name": "RevealNotReady",
    "inputs": [
      {
        "name": "revealAfter",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "SignatureExpired",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "SubmissionExists",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "VotingClosed",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongReporterSignature",
    "inputs": [
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recovered",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const;
