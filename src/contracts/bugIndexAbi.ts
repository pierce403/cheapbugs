export const bugIndexAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "initialOwner",
        "type": "address"
      },
      {
        "internalType": "address[]",
        "name": "initialReviewers",
        "type": "address[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "field",
        "type": "string"
      }
    ],
    "name": "EmptyField",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reportHash",
        "type": "bytes32"
      }
    ],
    "name": "MissingReport",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reportHash",
        "type": "bytes32"
      }
    ],
    "name": "SubmissionExists",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "reportHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reportId",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "reporter",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "createdAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.DisclosureMode",
        "name": "disclosureMode",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "publicSummary",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "encryptedPayloadCid",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.TargetKind",
        "name": "targetKind",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "targetRefHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "tags",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "contentHash",
        "type": "bytes32"
      }
    ],
    "name": "ReportSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "reviewer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "allowed",
        "type": "bool"
      }
    ],
    "name": "ReviewerSet",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "exists",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reportHash",
        "type": "bytes32"
      }
    ],
    "name": "getReport",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "reportHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "reportId",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "reporter",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          },
          {
            "internalType": "enum CheapBugsBugIndex.DisclosureMode",
            "name": "disclosureMode",
            "type": "uint8"
          },
          {
            "internalType": "string",
            "name": "publicSummary",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "encryptedPayloadCid",
            "type": "string"
          },
          {
            "internalType": "enum CheapBugsBugIndex.TargetKind",
            "name": "targetKind",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "targetRefHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "tags",
            "type": "string"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          }
        ],
        "internalType": "struct CheapBugsBugIndex.Submission",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "latestReportHashes",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "reportCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "reportHashAt",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "reviewers",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "reviewer",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "allowed",
        "type": "bool"
      }
    ],
    "name": "setReviewer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "reportHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "reportId",
            "type": "string"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          },
          {
            "internalType": "enum CheapBugsBugIndex.DisclosureMode",
            "name": "disclosureMode",
            "type": "uint8"
          },
          {
            "internalType": "string",
            "name": "publicSummary",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "encryptedPayloadCid",
            "type": "string"
          },
          {
            "internalType": "enum CheapBugsBugIndex.TargetKind",
            "name": "targetKind",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "targetRefHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "tags",
            "type": "string"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          }
        ],
        "internalType": "struct CheapBugsBugIndex.SubmissionInput",
        "name": "input",
        "type": "tuple"
      }
    ],
    "name": "submitReport",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
