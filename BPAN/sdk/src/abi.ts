export const BANPRegistryABI = [
  // Registration
  "function registerNumber(uint256 number) external payable",

  // Wallet Mappings
  "function setWalletMapping(uint256 number, string chain, string wallet) external",
  "function removeWalletMapping(uint256 number, string chain) external",

  // View / Query
  "function getWalletMapping(uint256 number, string chain) external view returns (string)",
  "function getChains(uint256 number) external view returns (string[])",
  "function getAllMappings(uint256 number) external view returns (string[] chains, string[] wallets)",
  "function isRegistered(uint256 number) external view returns (bool)",

  // Admin
  "function setRegistrationFee(uint256 newFee) external",
  "function withdrawFees(address to) external",

  // Public state
  "function registrationFee() external view returns (uint256)",
  "function totalRegistered() external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",

  // Constants
  "function MIN_NUMBER() external view returns (uint256)",
  "function MAX_NUMBER() external view returns (uint256)",

  // ERC-721
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function transferFrom(address from, address to, uint256 tokenId) external",
  "function safeTransferFrom(address from, address to, uint256 tokenId) external",
  "function approve(address to, uint256 tokenId) external",
  "function getApproved(uint256 tokenId) external view returns (address)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address owner, address operator) external view returns (bool)",

  // Events
  "event NumberRegistered(uint256 indexed number, address indexed owner)",
  "event WalletMappingSet(uint256 indexed number, string chain, string walletAddress)",
  "event WalletMappingRemoved(uint256 indexed number, string chain)",
  // Emitted when an NFT transfer wipes the previous owner's mappings. Event-cache
  // consumers MUST handle this or they will keep resolving a transferred BPAN to
  // the old owner (CONTRACT-3).
  "event AllMappingsCleared(uint256 indexed number, address indexed previousOwner, address indexed newOwner)",
  "event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
] as const;
