// Roles (PRD R11).
export const ROLES = ["buyer", "developer", "admin"] as const;
export type Role = (typeof ROLES)[number];
