export const BUN_BINARY = "opencode"
export const NODE_BINARY = "opencode-node"

export function platformBinary(name: string, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name
}
