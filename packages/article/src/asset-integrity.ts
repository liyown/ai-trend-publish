const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export interface DecodedContentDataUri {
  bytes: Uint8Array;
  mimeType?: string;
}

/** ContentAsset checksums are canonical lowercase SHA-256 hashes of the asset bytes. */
export function isContentAssetChecksum(value: string | undefined): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

export async function computeContentAssetChecksum(bytes: Uint8Array): Promise<string> {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyContentAssetChecksum(
  bytes: Uint8Array,
  checksum: string | undefined,
): Promise<boolean> {
  return (
    isContentAssetChecksum(checksum) && checksum === (await computeContentAssetChecksum(bytes))
  );
}

export function decodeContentDataUri(uri: string): DecodedContentDataUri {
  if (!uri.startsWith("data:")) throw new Error("资源不是 Data URI");
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("资源 Data URI 格式无效");

  const descriptors = uri.slice(5, comma).split(";");
  const mimeType = descriptors[0]?.includes("/") ? descriptors[0] : undefined;
  const base64 = descriptors.some((descriptor) => descriptor.toLowerCase() === "base64");
  const payload = uri.slice(comma + 1);
  try {
    const bytes = base64
      ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return { bytes, mimeType };
  } catch (error) {
    throw new Error("资源 Data URI 内容无效", { cause: error });
  }
}

export function encodeContentDataUri(bytes: Uint8Array, mimeType: string): string {
  const normalizedMimeType = normalizeMimeType(mimeType);
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${normalizedMimeType};base64,${btoa(binary)}`;
}

function normalizeMimeType(value: string): string {
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
    ? mimeType
    : "application/octet-stream";
}
