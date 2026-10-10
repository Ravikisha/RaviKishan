// BROWSER. Memory — what the agents have been taught — for the Memory tab.
//
// Everything goes through /api/memory via adminJson, so the request carries
// the org this admin is acting in and the panel sees exactly what recall would:
// this org's memories plus the global layer, never another org's.
import { adminJson } from "./adminFetch";

const call = (body) => adminJson("/api/memory", body);

// { memories, total, layers, tags, kinds, orgId }
export const listMemories = ({ layer = "all", kinds, tags, includeArchived = false, limit = 200 } = {}) =>
  call({ action: "list", layer, kinds, tags, includeArchived, limit });

export const searchMemories = (query, { layer = "all", kinds, includeArchived = false } = {}) =>
  call({ action: "search", query, layer, kinds, includeArchived });

// "What would an agent be handed for this task?" Counts as a use.
export const recallFor = (task, { limit = 8 } = {}) => call({ action: "recall", task, limit });

// { action: created|updated|superseded, memory, similarity?, superseded? }
export const rememberMemory = (m) => call({ action: "remember", ...m });

export const updateMemory = (id, patch) => call({ action: "update", id, ...patch }).then((j) => j.memory);

// Archive unless confirm — then deleted for good.
export const forgetMemory = (id, { confirm = false } = {}) => call({ action: "forget", id, confirm });
