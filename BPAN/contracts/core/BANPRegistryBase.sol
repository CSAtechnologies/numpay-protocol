// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/** Fresh Base BPAN registry. Zero initial protocol fee. No import or migration API. */
contract BANPRegistryBase is ERC721, Ownable, ReentrancyGuard {
    mapping(address => uint256[]) private _ownedNumbers;
    mapping(uint256 => uint256) private _ownedIndex;

    error InvalidPageSize();



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

    /// @notice Hard upper bound on the registration fee in wei.
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

    constructor() ERC721("Blockchain Account Number", "BPAN") Ownable(msg.sender) {}

    // ─────────────────────────────────────────────────────────────────────────
    //  Registration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Register an 11-digit account number. Mints an ERC-721 NFT with
     *         tokenId == number. An address may hold any number of BPANs.
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

    function getOwnedNumbers(address owner, uint256 offset, uint256 limit)
        external view returns (uint256[] memory numbers)
    {
        if (limit == 0 || limit > 100) revert InvalidPageSize();
        uint256 length = _ownedNumbers[owner].length;
        if (offset >= length) return new uint256[](0);
        uint256 count = length - offset;
        if (count > limit) count = limit;
        numbers = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            numbers[i] = _ownedNumbers[owner][offset + i];
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

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address from)
    {
        from = super._update(to, tokenId, auth);
        if (from == to) return from;
        if (from != address(0) && to != address(0)) {
            _clearAllMappings(tokenId);
            emit AllMappingsCleared(tokenId, from, to);
        }
        if (from != address(0)) {
            uint256 index = _ownedIndex[tokenId];
            uint256 last = _ownedNumbers[from].length - 1;
            if (index != last) {
                uint256 moved = _ownedNumbers[from][last];
                _ownedNumbers[from][index] = moved;
                _ownedIndex[moved] = index;
            }
            _ownedNumbers[from].pop();
            delete _ownedIndex[tokenId];
        }
        if (to != address(0)) {
            // Zero-based index avoids a nonzero storage slot for the common
            // first registration. No global token enumeration is maintained.
            _ownedIndex[tokenId] = _ownedNumbers[to].length;
            _ownedNumbers[to].push(tokenId);
        }
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
