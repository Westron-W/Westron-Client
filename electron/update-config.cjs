const UPDATE_FEED_URL = 'https://westronskin.sytes.net/updates/';

function configureUpdateFeed(updater, platform) {
  if (platform !== 'win32') return false;
  if (!updater || typeof updater.setFeedURL !== 'function') {
    throw new Error('Windows update feed could not be configured.');
  }
  updater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });
  return true;
}

module.exports = { UPDATE_FEED_URL, configureUpdateFeed };
