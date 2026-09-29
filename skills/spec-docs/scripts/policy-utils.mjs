/** Shared policy resolution helpers for project-local spec-docs scripts. */

export function resolveTierPolicy(policy, tierOverride = null) {
  const tier = tierOverride || policy.tier || "m";
  const tierPolicy = policy.tierRules?.[tier] || {};
  return {
    ...policy,
    ...tierPolicy,
    tier,
    quality: {
      ...(policy.quality || {}),
      ...(tierPolicy.quality || {}),
      productDocs: { ...(policy.quality?.productDocs || {}), ...(tierPolicy.quality?.productDocs || {}) },
      publicContracts: { ...(policy.quality?.publicContracts || {}), ...(tierPolicy.quality?.publicContracts || {}) },
      e2e: { ...(policy.quality?.e2e || {}), ...(tierPolicy.quality?.e2e || {}) },
      performance: { ...(policy.quality?.performance || {}), ...(tierPolicy.quality?.performance || {}) },
      technicalDesign: { ...(policy.quality?.technicalDesign || {}), ...(tierPolicy.quality?.technicalDesign || {}) },
      traceability: { ...(policy.quality?.traceability || {}), ...(tierPolicy.quality?.traceability || {}) },
      adr: { ...(policy.quality?.adr || {}), ...(tierPolicy.quality?.adr || {}) },
    },
  };
}

export function isExplicitNotApplicable(text, { minimumLength = 8 } = {}) {
  return String(text || "").split(/\r?\n/).some((line) => {
    const match = line.match(/(?:^|\|)\s*不适用\s*[：:，,]\s*(.+?)(?:\s*\||$)/);
    const rationale = match?.[1]?.trim() || "";
    return Boolean(
      match &&
      rationale.length >= minimumLength &&
      !/[<>{}]/.test(rationale) &&
      !/^(?:理由|待补充|TODO|TBD)$/i.test(rationale) &&
      /(验证|替代|因为|由于|没有|不涉及|不需要|改由|采用)/.test(rationale),
    );
  });
}
