// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestToken (TTK) — Sepolia 학습/테스트용 ERC-20
/// @notice 배포 시 10,000 TTK를 recipient에게 민팅. owner는 이후 언제든 추가 민팅 가능.
contract TestToken is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 10_000 * 10 ** 18;

    constructor(address recipient) ERC20("TestToken", "TTK") Ownable(recipient) {
        require(recipient != address(0), "recipient is zero");
        _mint(recipient, INITIAL_SUPPLY);
    }

    /// @param amount 18 decimals 기준 raw 수량 (스크립트에서 parseUnits 사용)
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "mint to zero");
        _mint(to, amount);
    }
}
