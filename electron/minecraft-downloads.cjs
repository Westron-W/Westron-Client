const KNOWN_ASM_METADATA = {
  'https://maven.fabricmc.net/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar': {
    mirrorUrl: 'https://repo1.maven.org/maven2/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar',
    sha1: 'ada2141c0cc52ee8f5c48cd5fa4ce0e794f22236',
    size: 126151,
  },
  'https://maven.fabricmc.net/org/ow2/asm/asm-analysis/9.10.1/asm-analysis-9.10.1.jar': {
    mirrorUrl: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-analysis/9.10.1/asm-analysis-9.10.1.jar',
    sha1: '8d49f14d51f632cb1d87c88d1ceaf50db0d8af1b',
    size: 35140,
  },
  'https://maven.fabricmc.net/org/ow2/asm/asm-commons/9.10.1/asm-commons-9.10.1.jar': {
    mirrorUrl: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.10.1/asm-commons-9.10.1.jar',
    sha1: '4229e4c55fd8e01c23f9fe9884075cc628aacc50',
    size: 74840,
  },
  'https://maven.fabricmc.net/org/ow2/asm/asm-tree/9.10.1/asm-tree-9.10.1.jar': {
    mirrorUrl: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.10.1/asm-tree-9.10.1.jar',
    sha1: 'e244332a17564c1d1572449399a842de35881be2',
    size: 51958,
  },
  'https://maven.fabricmc.net/org/ow2/asm/asm-util/9.10.1/asm-util-9.10.1.jar': {
    mirrorUrl: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-util/9.10.1/asm-util-9.10.1.jar',
    sha1: '7bb9d450e8d4cbf9f9e04096c44bbfe7fba80b15',
    size: 95628,
  },
};

function addVerifiedMavenMirrors(plan) {
  let changed = false;
  const actions = plan.actions.map((action) => {
    if (action.kind !== 'download-file') return action;

    const urls = Array.isArray(action.url) ? action.url : [action.url];
    let mirrorUrl = null;
    let expectedSha1 = action.expectedSha1;
    let expectedSize = action.expectedSize;

    for (const url of urls) {
      if (typeof url === 'string') {
        if (KNOWN_ASM_METADATA[url]) {
          mirrorUrl = KNOWN_ASM_METADATA[url].mirrorUrl;
          expectedSha1 = expectedSha1 ?? KNOWN_ASM_METADATA[url].sha1;
          expectedSize = expectedSize ?? KNOWN_ASM_METADATA[url].size;
          break;
        }
        if (url.startsWith('https://maven.fabricmc.net/org/ow2/asm/')) {
          mirrorUrl = url.replace('https://maven.fabricmc.net/', 'https://repo1.maven.org/maven2/');
          break;
        }
      }
    }

    if (!mirrorUrl) return action;

    changed = true;
    return {
      ...action,
      url: [...new Set([mirrorUrl, ...urls])],
      expectedSha1,
      expectedSize,
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
