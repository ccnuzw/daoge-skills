const { syncWorkspaceToDb, closeDatabase } = require('./repository');

function syncWorkspaceToDbIfAvailable(outputDir, options = {}) {
  try {
    const result = syncWorkspaceToDb(outputDir, options);
    closeDatabase(result.db);
    return { ...result, db: null };
  } catch (error) {
    if (error.code === 'SQLITE_UNAVAILABLE') {
      return { dbWarning: error.message, outputDir };
    }
    throw error;
  }
}

module.exports = { syncWorkspaceToDbIfAvailable };
