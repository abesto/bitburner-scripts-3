export const generateId = (len: number): string => {
  const buffer = new Uint8Array(len);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((byte) => byte.toString(16))
    .join("");
};
