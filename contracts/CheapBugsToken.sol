// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract CheapBugsToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 10_000_000 * 10 ** 18;

    error InvalidInitialHolder();

    constructor(address initialHolder) ERC20("CheapBugs Token", "BUGZ") {
        if (initialHolder == address(0)) revert InvalidInitialHolder();

        _mint(initialHolder, INITIAL_SUPPLY);
    }
}
