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
        "name": "initialReviewers",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "nonpayable"
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
        "internalType": "struct CheapBugsBugIndex.Submission",
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
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getReviewVote",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reviewer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct CheapBugsBugIndex.ReviewVote",
        "components": [
          {
            "name": "reportHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reviewer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "validity",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.Validity"
          },
          {
            "name": "impact",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.Impact"
          },
          {
            "name": "rewardClass",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.RewardClass"
          },
          {
            "name": "confidence",
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
    "name": "getReviewVotes",
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
        "type": "tuple[]",
        "internalType": "struct CheapBugsBugIndex.ReviewVote[]",
        "components": [
          {
            "name": "reportHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reviewer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "validity",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.Validity"
          },
          {
            "name": "impact",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.Impact"
          },
          {
            "name": "rewardClass",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.RewardClass"
          },
          {
            "name": "confidence",
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
    "name": "hasReviewVote",
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
    "name": "reviewVoteCount",
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
    "name": "reviewVoteReviewerAt",
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
    "name": "reviewers",
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
    "name": "setReviewer",
    "inputs": [
      {
        "name": "reviewer",
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
    "name": "submitReport",
    "inputs": [
      {
        "name": "input",
        "type": "tuple",
        "internalType": "struct CheapBugsBugIndex.SubmissionInput",
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
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitReviewVote",
    "inputs": [
      {
        "name": "input",
        "type": "tuple",
        "internalType": "struct CheapBugsBugIndex.ReviewVoteInput",
        "components": [
          {
            "name": "reportHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "validity",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.Validity"
          },
          {
            "name": "impact",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.Impact"
          },
          {
            "name": "rewardClass",
            "type": "uint8",
            "internalType": "enum CheapBugsBugIndex.RewardClass"
          },
          {
            "name": "confidence",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
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
    "name": "ReportSubmitted",
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
        "name": "createdAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "disclosureMode",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.DisclosureMode"
      },
      {
        "name": "publicSummary",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "encryptedPayloadCid",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "targetKind",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.TargetKind"
      },
      {
        "name": "targetRefHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "tags",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "contentHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReviewVoteSubmitted",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "reviewer",
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
        "name": "validity",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.Validity"
      },
      {
        "name": "impact",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.Impact"
      },
      {
        "name": "rewardClass",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum CheapBugsBugIndex.RewardClass"
      },
      {
        "name": "confidence",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReviewerSet",
    "inputs": [
      {
        "name": "reviewer",
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
    "type": "error",
    "name": "EmptyField",
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
    "name": "InvalidConfidence",
    "inputs": [
      {
        "name": "confidence",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MissingReport",
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
    "name": "MissingReviewVote",
    "inputs": [
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reviewer",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotReviewer",
    "inputs": []
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
  }
] as const;
