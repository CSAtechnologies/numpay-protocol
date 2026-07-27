// Per-origin dApp connection permissions now live in @numpay/core/dapp so the
// mobile in-app browser shares ONE permission model with the extension (a site
// connected in one client is a site connected, with the same no-silent-reconnect
// rule). Re-exported here so existing importers are unaffected.
//
// Storage note: core writes this key as a JSON string, while this module used
// to write a chrome.storage object. Core's reader accepts both shapes, so
// grants made by an older build survive the upgrade and are rewritten as JSON
// on the next change.
export {
  type OriginPermission,
  getPermission,
  isConnected,
  grant,
  revoke,
  listOrigins,
  updateAllConnected,
  setOriginChain,
} from "@numpay/core/dapp";
