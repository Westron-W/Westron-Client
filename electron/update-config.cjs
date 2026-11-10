const UPDATE_FEED = {
  provider: 'github',
  owner: 'Westron-W',
  repo: 'Westron-Client',
  releaseType: 'release',
};

function configureUpdateFeed(updater, platform) {
  if (platform !== 'win32') return false;
  if (!updater || typeof updater.setFeedURL !== 'function') {
    throw new Error('Windows update feed could not be configured.');
  }
  updater.setFeedURL(UPDATE_FEED);
  return true;
}

module.exports = { UPDATE_FEED, configureUpdateFeed };
