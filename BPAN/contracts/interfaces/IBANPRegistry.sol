// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title IBANPRegistry
 * @notice Consumer-facing interface for the Blockchain Account Number Protocol
 *         registry. Mirrors the deployed V2 contract surface (events, errors,
 *         and external functions) so SDK/consumer code can decode every event
 *         and revert reason the live contract can emit (CONTRACT-3/CONTRACT-9).
 */
interface IBANPRegistry {
    // ── Events ──────────────────────────────────

    event NumberRegistered(uint256 indexed number, address indexed owner);
    event WalletMappingSet(uint256 indexed number, string chain, string walletAddress);
    event WalletMappingRemoved(uint256 indexed number, string chain);
    event AllMappingsCleared(
        uint256 indexed number,
        address indexed previousOwner,
        address indexed newOwner
    );
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event MigrationWindowClosed();

    // ── Errors ──────────────────────────────────

    error InvalidNumber(uint256 number);
    error NumberAlreadyRegistered(uint256 number);
    error AlreadyOwnsNumber(address owner);
    error NotNumberOwner(uint256 number, address caller);
    error EmptyChainName();
    error InvalidChainName(string chain);
    error EmptyWalletAddress();
    error WalletAddressTooLong(uint256 length, uint256 max);
    error TooManyChainMappings(uint256 number, uint256 max);
    error MappingNotFound(uint256 number, string chain);
    error InsufficientFee(uint256 sent, uint256 required);
    error FeeTooHigh(uint256 requested, uint256 max);
    error WithdrawFailed();
    error ZeroAddress();
    error MigrationAlreadyClosed();
    error MigrationLengthMismatch();

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

    function registrationFee() external view returns (uint256);
    function totalRegistered() external view returns (uint256);
    function migrationOpen() external view returns (bool);
    function MIN_NUMBER() external view returns (uint256);
    function MAX_NUMBER() external view returns (uint256);
    function MAX_CHAIN_MAPPINGS() external view returns (uint256);
    function MAX_WALLET_LENGTH() external view returns (uint256);
    function MAX_REGISTRATION_FEE() external view returns (uint256);

    // ── Admin ───────────────────────────────────

    function setRegistrationFee(uint256 newFee) external;
    function migrateFromV1(
        uint256[] calldata numbers,
        address[] calldata owners,
        string[][] calldata chainsList,
        string[][] calldata walletsList
    ) external;
    function closeMigration() external;
    function withdrawFees(address payable to) external;
}
