// REFACTOR-1: shared committee-profile credential resolver.
// Previously defined only inside cron/process.js; posts/[id].js needs the
// same lookup to cancel a natively-scheduled Facebook post (see BUG-2 in
// posts/[id].js), so it's been pulled out here rather than duplicated.

/** The COMMITTEE_PROFILES env var as an array (empty when unset or unreadable). */
export function committeeProfiles() {
  try {
    const profiles = JSON.parse(process.env.COMMITTEE_PROFILES || '[]');
    return Array.isArray(profiles) ? profiles : [];
  } catch {
    return [];
  }
}

export function getCredentials(profileId) {
  const profiles = committeeProfiles();
  // H3: Never fall back to profiles[0] — an unknown profile_id would silently
  // act on the wrong committee's account. Throw instead so the caller fails
  // with a clear, attributable error.
  const p = profiles.find(x => x.id === profileId);
  if (p) {
    return { fbPageId: p.fb_page_id, fbToken: p.fb_access_token, igUserId: p.ig_user_id };
  }
  throw new Error(`Unknown profile_id '${profileId}' — add it to COMMITTEE_PROFILES`);
}

/** Profile ids configured in COMMITTEE_PROFILES (empty when unset or unreadable). */
export function knownProfileIds() {
  return new Set(committeeProfiles().map((p) => p.id).filter(Boolean));
}
