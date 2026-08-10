// Shared numeric limits used across compilation and resolution.
// Kept in a leaf module so compile/resolve logic never depends on the Node
// class (no import cycles).
export const MAX_COMPILE_DEPTH = 8
