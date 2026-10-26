using './main.bicep'

// Defaults are sane; the deploy script (scripts/azure-deploy.sh) passes deployApp / image / buildId.
param baseName = 'hochstapler'
param logRetentionDays = 30
param logDailyCapGb = '0.1'
param shareSoftDeleteDays = 14

// Database directory on the file share. The app runs on a fresh database in /data/v2; an earlier file directly under
// /data was left untouched (see DESIGN #52). Once that file is deleted, this can go back to '/data'.
param dataDir = '/data/v2'
