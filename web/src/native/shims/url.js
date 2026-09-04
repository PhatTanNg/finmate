export const fileURLToPath = (u) => String(u).replace(/^file:\/\//, '');
export const pathToFileURL = (p) => new URL(`file://${p}`);
export default { fileURLToPath, pathToFileURL };
