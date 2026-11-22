import type { ModelCatalog } from "./contracts.ts";
const unconfirmed = new WeakSet<ModelCatalog>();
export function unconfirmedModelCatalog(catalog: ModelCatalog): void { unconfirmed.add(catalog); }
export const isUnconfirmed = (catalog: ModelCatalog): boolean => unconfirmed.has(catalog);
