// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title NumberValidation
 * @notice Utility library for validating 11-digit BANP account numbers.
 */
library NumberValidation {
    uint256 internal constant MIN_NUMBER = 10_000_000_000;
    uint256 internal constant MAX_NUMBER = 99_999_999_999;

    /**
     * @notice Check whether `number` is a valid 11-digit account number.
     * @param number The number to validate.
     * @return True if the number is in the range [10000000000, 99999999999].
     */
    function isValid(uint256 number) internal pure returns (bool) {
        return number >= MIN_NUMBER && number <= MAX_NUMBER;
    }

    /**
     * @notice Revert if `number` is not a valid 11-digit number.
     * @param number The number to validate.
     */
    function requireValid(uint256 number) internal pure {
        require(isValid(number), "NumberValidation: not an 11-digit number");
    }
}
