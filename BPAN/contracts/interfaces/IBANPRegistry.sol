// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title IBANPRegistry
 * @notice Interface for the Blockchain Account Number Protocol registry.
 */
interface IBANPRegistry {
    // ── Events ──────────────────────────────────

    event NumberRegistered(uint256 indexed number, address indexed owner);
    event WalletMappingSet(uint256 indexed number, string chain, string walletAddress);
    event WalletMappingRemoved(uint256 indexed number, string chain);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);

    // ── Errors ──────────────────────────────────

    error InvalidNumber(uint256 number);
    error NumberAlreadyRegistered(uint256 number);
    error NotNumberOwner(uint256 number, address caller);
    error EmptyChainName();
    error EmptyWalletAddress();
    error MappingNotFound(uint256 number, string chain);
    error InsufficientFee(uint256 sent, uint256 required);
    error WithdrawFailed();

    // ── Registration ────────────────────────────

    function registerNumber(uint256 number) external payable;

    // ── Wallet Mappings ─────────────────────────

    function setWalletMapping(uint256 number, string calldata chain, string calldata wallet) external;
    function removeWalletMapping(uint256 number, string calldata chain) external;

    // ── View / Query ────────────────────────────

    function getWalletMapping(uint256 number, string calldata chain) external view returns (string memory);
    function getChains(uint256 number) external view returns (string[] memory);
    function getAllMappings(uint256 number) external view returns (string[] memory chains, string[] memory wallets);
    function isRegistered(uint256 number) external view returns (bool);

    // ── Admin ───────────────────────────────────

    function setRegistrationFee(uint256 newFee) external;
    function withdrawFees(address payable to) external;
}
