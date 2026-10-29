// Registry of every rule code check-docs can emit. The config validator, the profile logic and the
// test that keeps references/check-rules.md in sync all read from here.

export const RULE_CODES = [
  "ID001", "ID002", "ID003", "ID004",
  "REF001", "REF002", "REF003",
  "LNK001", "LNK002", "LNK003", "LNK004",
  "AC001", "AC002", "AC003", "AC004", "AC005", "AC006", "AC007", "AC008", "AC009", "AC010",
  "BR001", "BR002", "BR003",
  "TD001", "FC001",
  "ST001", "ST002", "ST003", "ST004", "ST005", "ST006", "ST007",
  "DC001",
  "EV001", "EV002", "EV003", "EV004", "EV005",
  "VR001", "TPL001",
  "CFG001", "CFG002", "CFG003"
];

export const CONFIG_KEYS = ["project", "browser", "exclude", "featureTracks", "keyDecisions", "docGoals", "check", "profile"];

// S / M / L from references/doc-structure.md. Only "small" changes behaviour.
//
// A Draft spec is not yet an input to coding (status-and-ids.md §3), so in a small project the
// completeness rules below wait until the spec is Ready. Every other rule, including the ones that
// guard the hard rules (IDs, links, duplicates, evidence honesty), runs unchanged at every size.
export const PROFILES = {
  small: { draftExempt: ["AC001", "AC004", "AC005", "AC006", "TD001", "FC001"] },
  medium: { draftExempt: [] },
  large: { draftExempt: [] }
};

export function closestRule(code) {
  const upper = String(code).toUpperCase();
  return RULE_CODES.find(known => known === upper) || null;
}
