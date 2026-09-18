ALTER TABLE delayed_sends ADD COLUMN watchedProjectId TEXT;
ALTER TABLE delayed_sends ADD COLUMN watchedSessionId TEXT;
PRAGMA user_version = 38;
