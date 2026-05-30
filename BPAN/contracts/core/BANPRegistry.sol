// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BANPRegistry V2
 * @author BANP Protocol
 * @notice Core registry contract for Blockchain Account Number Protocol.
 *         Each 11-digit account number is minted as an ERC-721 NFT.
 *         The NFT owner controls the wallet-address mappings for that number.
 *
 * Security fixes over V1:
 *  [HIGH]   One BPAN per address: balanceOf check in registerNumber prevents
 *           an address from owning more than one number at a time.
 *  [HIGH]   Stale-mapping fix: all wallet mappings are wiped when an NFT
 *           transfers to a new owner, so the new owner starts with a clean slate.
 *  [MEDIUM] Chain name validation: only lowercase a-z, 0-9, and hyphens accepted.
 *           Prevents shadow keys from case variants ("ethereum" vs "Ethereum").
 *  [MEDIUM] Chain mapping cap: MAX_CHAIN_MAPPINGS (50) per number prevents
 *           unbounded array growth and gas exhaustion on transfer clears.
 *  [MEDIUM] Wallet address length cap: MAX_WALLET_LENGTH (128) prevents
 *           garbage data being stored in mappings.
 *  [LOW]    Fee cap: MAX_REGISTRATION_FEE prevents owner from pricing out users.
 *           Default fee set to ~$0.50 at $2 000/ETH (0.00025 ether).
 */
contract BANPRegistry is ERC721, Ownable, ReentrancyGuard {

    // ─────────────────────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Smallest valid 11-digit number (10_000_000_000).
    uint256 public constant MIN_NUMBER = 10_000_000_000;

    /// @notice Largest valid 11-digit number  (99_999_999_999).
    uint256 public constant MAX_NUMBER = 99_999_999_999;

    /// @notice Maximum chain mappings stored per BPAN.
    ///         Prevents unbounded arrays and gas exhaustion during transfer clears.
    uint256 public constant MAX_CHAIN_MAPPINGS = 50;

    /// @notice Maximum byte length of a wallet address string.
    uint256 public constant MAX_WALLET_LENGTH = 128;

    /// @notice Hard upper bound on the registration fee (~$10 at $2 000/ETH).
    ///         Owner can price-adjust within this cap; cannot lock out users above it.
    uint256 public constant MAX_REGISTRATION_FEE = 0.005 ether;

    // ─────────────────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Current registration fee in wei. Adjustable by owner within cap.
    uint256 public registrationFee;

    /// @dev number => chain => walletAddress
    mapping(uint256 => mapping(string => string)) private _walletMappings;

    /// @dev number => ordered list of chain keys (for enumeration)
    mapping(uint256 => string[]) private _chainKeys;

    /// @dev number => chain => 1-based index in _chainKeys (0 = not present)
    mapping(uint256 => mapping(string => uint256)) private _chainKeyIndex;

    /// @notice Total numbers ever registered (never decremented on burn/transfer).
    uint256 public totalRegistered;

    /// @notice True while V1-to-V2 migration is in progress.
    ///         Set to false permanently by closeMigration(). Only the owner
    ///         can call migrateFromV1(), and only while this flag is true.
    bool public migrationOpen;

    // ─────────────────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────────────────

    event NumberRegistered(uint256 indexed number, address indexed owner);
    event WalletMappingSet(uint256 indexed number, string chain, string walletAddress);
    event WalletMappingRemoved(uint256 indexed number, string chain);

    /// @notice Emitted when an NFT transfer wipes the previous owner's mappings.
    event AllMappingsCleared(
        uint256 indexed number,
        address indexed previousOwner,
        address indexed newOwner
    );

    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);

    /// @notice Emitted once when the migration window is permanently closed.
    event MigrationWindowClosed();

    // ─────────────────────────────────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────────────────────────────────

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
    error MigrationAlreadyClosed();
    error MigrationLengthMismatch();

    // ─────────────────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier validNumber(uint256 number) {
        if (number < MIN_NUMBER || number > MAX_NUMBER) revert InvalidNumber(number);
        _;
    }

    modifier onlyNumberOwner(uint256 number) {
        if (ownerOf(number) != msg.sender) revert NotNumberOwner(number, msg.sender);
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param _registrationFee Initial fee in wei.
     *                         Suggested: 0.00025 ether (~$0.50 at $2 000/ETH).
     *                         Must not exceed MAX_REGISTRATION_FEE.
     */
    constructor(uint256 _registrationFee)
        ERC721("Blockchain Account Number", "BANP")
        Ownable(msg.sender)
    {
        if (_registrationFee > MAX_REGISTRATION_FEE)
            revert FeeTooHigh(_registrationFee, MAX_REGISTRATION_FEE);
        registrationFee = _registrationFee;
        migrationOpen = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Registration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Register an 11-digit account number.
     *         Mints an ERC-721 NFT with tokenId == number.
     *         Each address may hold at most one BPAN at a time.
     * @param number The 11-digit number to register.
     */
    function registerNumber(uint256 number)
        external
        payable
        validNumber(number)
        nonReentrant
    {
        if (_ownerOf(number) != address(0)) revert NumberAlreadyRegistered(number);
        if (msg.value < registrationFee)    revert InsufficientFee(msg.value, registrationFee);
        if (balanceOf(msg.sender) > 0)      revert AlreadyOwnsNumber(msg.sender);

        _mint(msg.sender, number);
        totalRegistered++;

        emit NumberRegistered(number, msg.sender);

        // Refund any excess payment (checks-effects-interactions: state already updated above).
        uint256 excess = msg.value - registrationFee;
        if (excess > 0) {
            (bool ok, ) = payable(msg.sender).call{value: excess}("");
            if (!ok) revert WithdrawFailed();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Wallet Mappings
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Set or update the wallet address for a given chain.
     * @param number  The 11-digit account number (caller must own the NFT).
     * @param chain   Chain identifier. Must be lowercase a-z / 0-9 / hyphen, max 32 chars.
     *                Examples: "ethereum", "solana", "bitcoin", "polygon-zkevm"
     * @param wallet  The wallet address on that chain (max 128 chars).
     */
    function setWalletMapping(
        uint256 number,
        string calldata chain,
        string calldata wallet
    )
        external
        onlyNumberOwner(number)
    {
        _requireValidChain(chain);

        uint256 walletLen = bytes(wallet).length;
        if (walletLen == 0) revert EmptyWalletAddress();
        if (walletLen > MAX_WALLET_LENGTH)
            revert WalletAddressTooLong(walletLen, MAX_WALLET_LENGTH);

        if (_chainKeyIndex[number][chain] == 0) {
            if (_chainKeys[number].length >= MAX_CHAIN_MAPPINGS)
                revert TooManyChainMappings(number, MAX_CHAIN_MAPPINGS);
            _chainKeys[number].push(chain);
            _chainKeyIndex[number][chain] = _chainKeys[number].length; // 1-based
        }

        _walletMappings[number][chain] = wallet;

        emit WalletMappingSet(number, chain, wallet);
    }

    /**
     * @notice Remove the wallet mapping for a given chain.
     * @param number  The 11-digit account number (caller must own the NFT).
     * @param chain   Chain identifier to remove.
     */
    function removeWalletMapping(
        uint256 number,
        string calldata chain
    )
        external
        onlyNumberOwner(number)
    {
        uint256 idx = _chainKeyIndex[number][chain];
        if (idx == 0) revert MappingNotFound(number, chain);

        delete _walletMappings[number][chain];

        // Swap-and-pop to keep the array dense without shifting.
        uint256 lastIdx = _chainKeys[number].length;
        if (idx != lastIdx) {
            string memory lastChain = _chainKeys[number][lastIdx - 1];
            _chainKeys[number][idx - 1] = lastChain;
            _chainKeyIndex[number][lastChain] = idx;
        }
        _chainKeys[number].pop();
        delete _chainKeyIndex[number][chain];

        emit WalletMappingRemoved(number, chain);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  View / Query
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Resolve a single chain mapping for a number.
     * @param number  The 11-digit account number.
     * @param chain   Chain identifier.
     * @return        The mapped wallet address (empty string if unset).
     */
    function getWalletMapping(uint256 number, string calldata chain)
        external view returns (string memory)
    {
        return _walletMappings[number][chain];
    }

    /**
     * @notice Get all chain keys that have a mapping for this number.
     */
    function getChains(uint256 number)
        external view returns (string[] memory)
    {
        return _chainKeys[number];
    }

    /**
     * @notice Batch-resolve: get all mappings for a number in one call.
     */
    function getAllMappings(uint256 number)
        external view
        returns (string[] memory chains, string[] memory wallets)
    {
        chains = _chainKeys[number];
        wallets = new string[](chains.length);
        for (uint256 i = 0; i < chains.length; i++) {
            wallets[i] = _walletMappings[number][chains[i]];
        }
    }

    /**
     * @notice Check whether a number has been registered.
     */
    function isRegistered(uint256 number) external view returns (bool) {
        return _ownerOf(number) != address(0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Update the registration fee. Capped at MAX_REGISTRATION_FEE.
     *         Adjust periodically to keep the USD-equivalent near target.
     * @param newFee New fee in wei.
     */
    function setRegistrationFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_REGISTRATION_FEE) revert FeeTooHigh(newFee, MAX_REGISTRATION_FEE);
        uint256 oldFee = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Batch-replicate V1 registrations into V2.
     *         Bypasses the fee and the one-BPAN-per-address check because
     *         we are faithfully restoring historical state, not creating new
     *         registrations. Only callable by the owner while migrationOpen.
     *
     * @param numbers    V1 token IDs (BPAN numbers).
     * @param owners     Current owners of each number on V1.
     * @param chainsList Parallel: chain keys for each number.
     * @param walletsList Parallel: wallet address strings for each number.
     */
    function migrateFromV1(
        uint256[]   calldata numbers,
        address[]   calldata owners,
        string[][]  calldata chainsList,
        string[][]  calldata walletsList
    ) external onlyOwner {
        if (!migrationOpen) revert MigrationAlreadyClosed();
        if (numbers.length != owners.length   ||
            numbers.length != chainsList.length ||
            numbers.length != walletsList.length)
            revert MigrationLengthMismatch();

        for (uint256 i = 0; i < numbers.length; i++) {
            uint256 num = numbers[i];

            // Skip if this number already landed in V2 (idempotent batching).
            if (_ownerOf(num) != address(0)) continue;

            _mint(owners[i], num);
            totalRegistered++;
            emit NumberRegistered(num, owners[i]);

            string[] calldata chains  = chainsList[i];
            string[] calldata wallets = walletsList[i];
            uint256 mapLen = chains.length < wallets.length
                ? chains.length : wallets.length;

            for (uint256 j = 0; j < mapLen; j++) {
                string calldata ch = chains[j];
                string calldata wa = wallets[j];
                if (bytes(ch).length == 0 || bytes(wa).length == 0) continue;

                // Enforce the same invariants as setWalletMapping.
                _requireValidChain(ch);
                if (bytes(wa).length > MAX_WALLET_LENGTH)
                    revert WalletAddressTooLong(bytes(wa).length, MAX_WALLET_LENGTH);
                if (_chainKeys[num].length >= MAX_CHAIN_MAPPINGS)
                    revert TooManyChainMappings(num, MAX_CHAIN_MAPPINGS);

                if (_chainKeyIndex[num][ch] == 0) {
                    _chainKeys[num].push(ch);
                    _chainKeyIndex[num][ch] = _chainKeys[num].length;
                }
                _walletMappings[num][ch] = wa;
                emit WalletMappingSet(num, ch, wa);
            }
        }
    }

    /**
     * @notice Permanently close the migration window.
     *         After this call, migrateFromV1 is disabled forever.
     */
    function closeMigration() external onlyOwner {
        if (!migrationOpen) revert MigrationAlreadyClosed();
        migrationOpen = false;
        emit MigrationWindowClosed();
    }

    /**
     * @notice Withdraw accumulated fees. Owner only.
     * @param to Recipient address.
     */
    function withdrawFees(address payable to) external onlyOwner {
        uint256 bal = address(this).balance;
        (bool success, ) = to.call{value: bal}("");
        if (!success) revert WithdrawFailed();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev OZ ERC-721 V5 single transfer hook.
     *      Clears all wallet mappings when the NFT changes hands so the new
     *      owner starts with a clean slate. Mappings are NOT cleared on mint
     *      (from == address(0)) or burn (to == address(0)).
     */
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);

        // Enforce the one-number-per-address invariant on transfers too, not
        // just at registration. Without this, an address that already owns a
        // BPAN could receive a second one via ERC-721 transfer. Mints
        // (from == address(0)) are already gated in registerNumber; burns
        // (to == address(0)) are exempt.
        if (from != address(0) && to != address(0) && from != to && balanceOf(to) > 0) {
            revert AlreadyOwnsNumber(to);
        }

        address result = super._update(to, tokenId, auth);

        if (from != address(0) && to != address(0) && from != to) {
            _clearAllMappings(tokenId);
            emit AllMappingsCleared(tokenId, from, to);
        }

        return result;
    }

    /// @dev Wipes every chain mapping for `number`. Called on NFT ownership change.
    function _clearAllMappings(uint256 number) internal {
        string[] storage chains = _chainKeys[number];
        uint256 len = chains.length;
        for (uint256 i = 0; i < len; i++) {
            delete _chainKeyIndex[number][chains[i]];
            delete _walletMappings[number][chains[i]];
        }
        delete _chainKeys[number];
    }

    /**
     * @dev Validates a chain name string:
     *      - Non-empty, max 32 bytes
     *      - Only lowercase letters (a-z), digits (0-9), or hyphens (-)
     *      Rejects uppercase, spaces, dots, underscores, etc. to prevent
     *      shadow-key attacks from case variants.
     */
    function _requireValidChain(string calldata chain) internal pure {
        bytes memory b = bytes(chain);
        if (b.length == 0) revert EmptyChainName();
        if (b.length > 32) revert InvalidChainName(chain);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7A) || // a-z
                      (c >= 0x30 && c <= 0x39) ||  // 0-9
                      (c == 0x2D);                  // hyphen
            if (!ok) revert InvalidChainName(chain);
        }
    }
}
