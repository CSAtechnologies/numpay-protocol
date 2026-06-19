// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BANPRegistry V3 (ready-to-deploy; NOT yet deployed)
 * @author BANP Protocol
 * @notice Core registry for the Blockchain Account Number Protocol. Each
 *         11-digit account number is minted as an ERC-721 NFT; the NFT owner
 *         controls that number's per-chain wallet-address mappings.
 *
 * This V3 source is prepared for a future redeploy. The live contract is V2
 * (`BANPRegistry.sol`), which is non-upgradeable, so these changes only take
 * effect with a new deployment + a V2->V3 re-migration. Until then the V2
 * source above is the on-chain reference and must not be edited.
 *
 * Changes over the deployed V2:
 *  [PRODUCT #5] Multi-BPAN per owner: the one-BPAN-per-address restriction is
 *               removed (owner decision). An address may register and hold any
 *               number of BPANs, and may receive transfers regardless of how
 *               many it already holds.
 *  [CONTRACT-5.1] migrateFromV1 number-range check: each migrated id is
 *               validated against [MIN_NUMBER, MAX_NUMBER] before mint, so a bad
 *               migration array can no longer create out-of-range tokenIds.
 *  [CONTRACT-5.2] migrateFromV1 length-mismatch is a hard revert: a record whose
 *               chains/wallets arrays differ in length now reverts
 *               (MigrationLengthMismatch) instead of silently dropping the
 *               surplus entries.
 *
 * Carried over from V2 (unchanged):
 *  - Stale-mapping fix: all wallet mappings are wiped when the NFT transfers.
 *  - Chain-name validation (lowercase a-z, 0-9, hyphen) to block shadow keys.
 *  - MAX_CHAIN_MAPPINGS (50) and MAX_WALLET_LENGTH (128) caps.
 *  - Registration-fee cap (MAX_REGISTRATION_FEE).
 *  - Owner-only, migration-window-only migrateFromV1; permanent closeMigration().
 */
contract BANPRegistryV3 is ERC721, Ownable, ReentrancyGuard {

    // ─────────────────────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Smallest valid 11-digit number (10_000_000_000).
    uint256 public constant MIN_NUMBER = 10_000_000_000;

    /// @notice Largest valid 11-digit number  (99_999_999_999).
    uint256 public constant MAX_NUMBER = 99_999_999_999;

    /// @notice Maximum chain mappings stored per BPAN.
    uint256 public constant MAX_CHAIN_MAPPINGS = 50;

    /// @notice Maximum byte length of a wallet address string.
    uint256 public constant MAX_WALLET_LENGTH = 128;

    /// @notice Hard upper bound on the registration fee (~$10 at $2 000/ETH).
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

    /// @notice True while V2-to-V3 migration is in progress.
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
     * @notice Register an 11-digit account number. Mints an ERC-721 NFT with
     *         tokenId == number. An address may hold any number of BPANs (#5).
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

        // _safeMint so a contract recipient that cannot receive ERC-721s reverts
        // instead of locking the BPAN. nonReentrant guards the onERC721Received hook.
        _safeMint(msg.sender, number);
        totalRegistered++;

        emit NumberRegistered(number, msg.sender);

        // Refund any excess payment (state already updated above).
        uint256 excess = msg.value - registrationFee;
        if (excess > 0) {
            (bool ok, ) = payable(msg.sender).call{value: excess}("");
            if (!ok) revert WithdrawFailed();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Wallet Mappings
    // ─────────────────────────────────────────────────────────────────────────

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

    function getWalletMapping(uint256 number, string calldata chain)
        external view returns (string memory)
    {
        return _walletMappings[number][chain];
    }

    function getChains(uint256 number)
        external view returns (string[] memory)
    {
        return _chainKeys[number];
    }

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

    function isRegistered(uint256 number) external view returns (bool) {
        return _ownerOf(number) != address(0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setRegistrationFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_REGISTRATION_FEE) revert FeeTooHigh(newFee, MAX_REGISTRATION_FEE);
        uint256 oldFee = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Batch-replicate prior registrations into V3. Bypasses the fee
     *         because it faithfully restores historical state. Owner-only,
     *         migration-window only.
     *
     * @param numbers     Token IDs (BPAN numbers).
     * @param owners      Owner of each number.
     * @param chainsList  Parallel: chain keys per number.
     * @param walletsList Parallel: wallet address strings per number.
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

            // CONTRACT-5.1: enforce the same range check registerNumber uses, so
            // a malformed migration array cannot mint out-of-range tokenIds.
            if (num < MIN_NUMBER || num > MAX_NUMBER) revert InvalidNumber(num);

            // Skip if this number already landed in V3 (idempotent batching).
            if (_ownerOf(num) != address(0)) continue;

            // _mint (not _safeMint) on purpose: faithfully restores historical
            // ownership; recipients already held this NFT previously, and
            // _safeMint could revert the whole batch on a contract owner without
            // onERC721Received. Owner-only, migration-window only.
            _mint(owners[i], num);
            totalRegistered++;
            emit NumberRegistered(num, owners[i]);

            string[] calldata chains  = chainsList[i];
            string[] calldata wallets = walletsList[i];

            // CONTRACT-5.2: a per-record length mismatch is a hard error rather
            // than silently truncating to min(length) and dropping mappings.
            if (chains.length != wallets.length) revert MigrationLengthMismatch();

            for (uint256 j = 0; j < chains.length; j++) {
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
     * @notice Permanently close the migration window. migrateFromV1 is disabled
     *         forever afterwards.
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
        if (to == address(0)) revert ZeroAddress(); // never burn accumulated fees
        uint256 bal = address(this).balance;
        (bool success, ) = to.call{value: bal}("");
        if (!success) revert WithdrawFailed();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev OZ ERC-721 V5 single transfer hook. Clears all wallet mappings when
     *      the NFT changes hands so the new owner starts with a clean slate.
     *      Mappings are NOT cleared on mint (from == 0) or burn (to == 0).
     *
     *      Note: the one-BPAN-per-address transfer guard from V2 is intentionally
     *      removed here (#5). An address may receive a BPAN regardless of how
     *      many it already holds.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);

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
     * @dev Validates a chain name string: non-empty, max 32 bytes, only
     *      lowercase a-z, digits 0-9, or hyphens. Rejects case variants to
     *      prevent shadow-key attacks.
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
