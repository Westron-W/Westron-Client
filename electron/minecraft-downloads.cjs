const ASM_ANALYSIS_URL =
  'https://maven.fabricmc.net/org/ow2/asm/asm-analysis/9.10.1/asm-analysis-9.10.1.jar';
const ASM_ANALYSIS_MIRROR_URL =
  'https://repo1.maven.org/maven2/org/ow2/asm/asm-analysis/9.10.1/asm-analysis-9.10.1.jar';
const ASM_ANALYSIS_SHA1 = '8d49f14d51f632cb1d87c88d1ceaf50db0d8af1b';
const ASM_ANALYSIS_SIZE = 35140;

function addVerifiedMavenMirrors(plan) {
  let changed = false;
  const actions = plan.actions.map((action) => {
    if (action.kind !== 'download-file') return action;

    const urls = Array.isArray(action.url) ? action.url : [action.url];
    if (!urls.includes(ASM_ANALYSIS_URL)) return action;

    changed = true;
    return {
      ...action,
      url: [...new Set([ASM_ANALYSIS_MIRROR_URL, ...urls])],
      expectedSha1: action.expectedSha1 ?? ASM_ANALYSIS_SHA1,
      expectedSize: action.expectedSize ?? ASM_ANALYSIS_SIZE,
    };
  });

  return changed ? { ...plan, actions } : plan;
}

function formatInstallError(error) {
  if (!(error instanceof Error)
    || !/^(?:Download failed for|All \d+ mirror URLs failed for) /.test(error.message)) {
    return error;
  }

  const causes = error.cause instanceof AggregateError
    ? error.cause.errors
    : [error.cause];
  const details = causes
    .filter((cause) => cause instanceof Error)
    .map((cause) => cause.message)
    .join('; ');
  const suffix = details ? ` (${details})` : '';
  return new Error(
    `${error.message}${suffix}. İnternet bağlantınızı ve indirme kaynaklarına erişimi kontrol edip yeniden deneyin.`,
    { cause: error },
  );
}

module.exports = { addVerifiedMavenMirrors, formatInstallError };
