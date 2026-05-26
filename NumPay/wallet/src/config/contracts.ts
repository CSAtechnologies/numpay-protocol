export const BANP_REGISTRY_ADDRESS =
  (process.env.NEXT_PUBLIC_BANP_CONTRACT_ADDRESS as `0x${string}`) ??
  "0x0000000000000000000000000000000000000000";

export const BANP_REGISTRY_ABI = [
  {
    inputs: [{ name: "_registrationFee", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  // Registration
  {
    inputs: [{ name: "number", type: "uint256" }],
    name: "registerNumber",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  // Wallet Mappings
  {
    inputs: [
      { name: "number", type: "uint256" },
      { name: "chain", type: "string" },
      { name: "wallet", type: "string" },
    ],
    name: "setWalletMapping",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "number", type: "uint256" },
      { name: "chain", type: "string" },
    ],
    name: "removeWalletMapping",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // View
  {
    inputs: [
      { name: "number", type: "uint256" },
      { name: "chain", type: "string" },
    ],
    name: "getWalletMapping",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "number", type: "uint256" }],
    name: "getChains",
    outputs: [{ name: "", type: "string[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "number", type: "uint256" }],
    name: "getAllMappings",
    outputs: [
      { name: "chains", type: "string[]" },
      { name: "wallets", type: "string[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "number", type: "uint256" }],
    name: "isRegistered",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "registrationFee",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalRegistered",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // ERC-721
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "number", type: "uint256" },
      { indexed: true, name: "owner", type: "address" },
    ],
    name: "NumberRegistered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "number", type: "uint256" },
      { indexed: false, name: "chain", type: "string" },
      { indexed: false, name: "walletAddress", type: "string" },
    ],
    name: "WalletMappingSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "number", type: "uint256" },
      { indexed: false, name: "chain", type: "string" },
    ],
    name: "WalletMappingRemoved",
    type: "event",
  },
] as const;
