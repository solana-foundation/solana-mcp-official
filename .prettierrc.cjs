const solanaConfig = require("@solana/prettier-config-solana");

module.exports = {
  ...solanaConfig,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "none"
};
