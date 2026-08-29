/**
 * Single source of truth for all collected and derived data contracts.
 *
 * Collectors (Node-side) and frontend (browser-side) code both import from
 * here; neither duplicates schemas. See each module for field-level docs.
 */
export * from "./version";
export * from "./primitives";
export * from "./aa";
export * from "./openrouter";
export * from "./deepswe";
export * from "./cursor";
export * from "./snapshot";
export * from "./derived";
