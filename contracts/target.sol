pragma solidity ^0.8.0; contract Test { function insecure() public { selfdestruct(payable(msg.sender)); } }
