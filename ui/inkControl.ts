// Bridge so the App can reset Ink's render state after an external editor
// takes over the terminal (set by index.tsx once the app is rendered).
export const inkControl: { clear: () => void } = { clear: () => {} };
