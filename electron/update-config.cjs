const UPDATE_FEED = {
  provider: 'generic',
  url: 'https://raw.githubusercontent.com/Westron-W/Westron-Client/updates-feed/',
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
