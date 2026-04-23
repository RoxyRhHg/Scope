export function decodeSinaPayload(buffer, fallback = "utf8") {
  if (Buffer.isBuffer(buffer)) {
    return buffer.toString(fallback);
  }

  if (typeof buffer === "string") {
    return buffer;
  }

  return String(buffer ?? "");
}
